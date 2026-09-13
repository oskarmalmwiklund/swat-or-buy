/**
 * The fly's two eyes as point clouds, one point per real neuron, lit by live activity.
 *
 * Layout: the retina is not in the MaleCNS imaging volume and most lamina somas are not
 * annotated, so cells are placed by their retinotopic column position on a schematic
 * eye surface (receptors outermost, then L cells, then feedback cells). Positions are a
 * display layout; identities, wiring and activity are real.
 */
import * as THREE from 'three';
import type { Circuit } from '../neural/circuit';
import { neuralColors, palette, roleOf } from '../theme/palette';

const EYE_OFFSET = 0.46;
const LAYER: Record<string, number> = { receptor: 0.5, lamina: 0.435, feedback: 0.37 };
const AZIMUTH_DEG = 150;
const ELEVATION_DEG = 110;

export interface Picked { index: number; type: string; side: string; bodyId: string; role: string; rateHz: number }

export class EyeRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 50);
  private readonly group = new THREE.Group();
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly activity: Float32Array;
  private readonly roleColor: THREE.Color[];
  private readonly roleIndex: Uint8Array;
  private readonly points: THREE.Points;
  private readonly rest = new THREE.Color(palette.nodeRest);
  private readonly tmp = new THREE.Color();
  private readonly proj = new THREE.Vector3();
  private drag: { x: number; y: number; id: number; moved: boolean } | null = null;
  private width = 320;
  private height = 300;
  private disposed = false;
  private lastRate: Float32Array | null = null;
  onPick: ((p: Picked | null) => void) | null = null;

  constructor(readonly canvas: HTMLCanvasElement, readonly circuit: Circuit) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.setClearColor(palette.brain, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.camera.position.set(0, 0, 10);
    this.camera.lookAt(0, 0, 0);

    const n = circuit.n;
    this.positions = new Float32Array(n * 3);
    this.colors = new Float32Array(n * 3);
    this.activity = new Float32Array(n);
    const size = new Float32Array(n);
    this.roleColor = [new THREE.Color(neuralColors.receptor), new THREE.Color(neuralColors.lamina), new THREE.Color(neuralColors.feedback)];
    this.roleIndex = new Uint8Array(n);
    let seed = 7;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    for (let i = 0; i < n; i++) {
      const role = roleOf(circuit.typeName(i));
      this.roleIndex[i] = role === 'receptor' ? 0 : role === 'lamina' ? 1 : 2;
      const side = circuit.side[i];
      let u = circuit.colU[i], v = circuit.colV[i];
      if (circuit.uvSource[i] === 0 || u < 0) { u = side === 'L' ? 0.3 : 0.7; v = 0.5; u += (rnd() - 0.5) * 0.3; v += (rnd() - 0.5) * 0.3; }
      const r = LAYER[role] + (rnd() - 0.5) * 0.012;
      const az = THREE.MathUtils.degToRad((u - 0.5) * AZIMUTH_DEG);
      const el = THREE.MathUtils.degToRad((0.5 - v) * ELEVATION_DEG);
      const cx = side === 'L' ? -EYE_OFFSET : side === 'R' ? EYE_OFFSET : 0;
      this.positions[i * 3] = cx + r * Math.sin(az) * Math.cos(el);
      this.positions[i * 3 + 1] = r * Math.sin(el);
      this.positions[i * 3 + 2] = r * Math.cos(az) * Math.cos(el);
      this.rest.toArray(this.colors, i * 3);
      size[i] = role === 'receptor' ? 1 : role === 'lamina' ? 1.15 : 0.9;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('activity', new THREE.BufferAttribute(this.activity, 1).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('emphasis', new THREE.BufferAttribute(size, 1));
    this.points = new THREE.Points(geometry, new THREE.ShaderMaterial({
      uniforms: { pixelRatio: { value: this.renderer.getPixelRatio() }, scale: { value: 1 } },
      vertexShader: `
        attribute vec3 color; attribute float activity; attribute float emphasis;
        uniform float pixelRatio; uniform float scale;
        varying vec3 vColor; varying float vActivity; varying float vDepth;
        void main() {
          vColor = color; vActivity = activity;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vDepth = clamp((mv.z + 10.0 + 0.7) / 1.4, 0.0, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = (2.0 + sqrt(max(activity, 0.0)) * 7.0) * emphasis * pixelRatio * scale * mix(0.7, 1.0, vDepth);
        }`,
      fragmentShader: `
        varying vec3 vColor; varying float vActivity; varying float vDepth;
        void main() {
          float r = length(gl_PointCoord - vec2(0.5)) * 2.0;
          if (r > 1.0) discard;
          float core = 1.0 - smoothstep(0.12, 0.55, r);
          float halo = (1.0 - smoothstep(0.0, 1.0, r)) * 0.22;
          float e = clamp(vActivity, 0.0, 1.0);
          float alpha = mix(0.5 * (1.0 - smoothstep(0.3, 1.0, r)), core * 0.98 + halo, sqrt(e));
          alpha *= mix(0.18, 1.0, vDepth);
          vec3 lit = mix(vColor * mix(0.55, 1.0, vDepth), vec3(1.0), core * e * 0.35);
          gl_FragColor = vec4(lit, alpha);
          #include <colorspace_fragment>
        }`,
      transparent: true, depthWrite: false, depthTest: false,
    }));
    this.points.renderOrder = 2;
    // A dark head between the eyes so the two clouds read as a face looking at the screen.
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.36, 32, 24), new THREE.MeshBasicMaterial({ color: palette.brainLine, transparent: true, opacity: 0.35 }));
    head.position.set(0, -0.05, -0.14);
    head.scale.set(1, 1.2, 1);
    this.group.add(head, this.points);
    this.group.rotation.set(0.18, 0.55, 0);
    this.scene.add(this.group);
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointercancel', this.onUp);
    this.resize(canvas.clientWidth || 320, canvas.clientHeight || 300);
  }

  private onDown = (e: PointerEvent) => { this.drag = { x: e.clientX, y: e.clientY, id: e.pointerId, moved: false }; this.canvas.setPointerCapture(e.pointerId); };
  private onMove = (e: PointerEvent) => {
    if (!this.drag || this.drag.id !== e.pointerId) return;
    const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 2) this.drag.moved = true;
    this.group.rotation.y += dx * 0.008;
    this.group.rotation.x = THREE.MathUtils.clamp(this.group.rotation.x + dy * 0.008, -1.2, 1.2);
    this.drag.x = e.clientX; this.drag.y = e.clientY;
  };
  private onUp = (e: PointerEvent) => {
    if (this.drag?.id !== e.pointerId) return;
    const moved = this.drag.moved;
    this.drag = null;
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    if (!moved && this.onPick) this.onPick(this.pick(e.clientX, e.clientY));
  };

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0 || this.disposed) return;
    this.width = width; this.height = height;
    this.renderer.setSize(width, height, false);
    // The pair of eyes is about 2 units wide; let it fill most of the width, and keep at
    // least 0.85 units of half height so a wide, short view still shows the whole face.
    const aspect = width / height;
    let halfW = 1.12, halfH = halfW / aspect;
    if (halfH < 0.85) { halfH = 0.85; halfW = halfH * aspect; }
    this.camera.left = -halfW; this.camera.right = halfW; this.camera.top = halfH + 0.08; this.camera.bottom = -halfH + 0.08;
    this.camera.updateProjectionMatrix();
    const unitsPerPx = (2 * halfW) / width;
    (this.points.material as THREE.ShaderMaterial).uniforms.scale.value = Math.min(1.6, Math.max(0.6, 0.0065 / unitsPerPx));
  }

  /** Feed live activity (0..1 per cell, drives size), rates, and change against the grey
   *  baseline in Hz (drives colour): cells that the ad changed light up in their role colour,
   *  cells doing what they did on grey stay muted. */
  update(activity: Float32Array, rate: Float32Array, change: Float32Array | null): void {
    this.lastRate = rate;
    const n = this.circuit.n;
    const rest = this.rest, colors = this.colors;
    for (let i = 0; i < n; i++) {
      const a = activity[i];
      this.activity[i] = a;
      const target = this.roleColor[this.roleIndex[i]];
      const c = change ? change[i] : 0;
      const k = Math.min(1, 0.22 + Math.min(1, c / 25) * 0.85 + a * 0.3);
      colors[i * 3] = rest.r + (target.r - rest.r) * k;
      colors[i * 3 + 1] = rest.g + (target.g - rest.g) * k;
      colors[i * 3 + 2] = rest.b + (target.b - rest.b) * k;
    }
    this.points.geometry.attributes.color.needsUpdate = true;
    this.points.geometry.attributes.activity.needsUpdate = true;
  }

  pick(clientX: number, clientY: number): Picked | null {
    const rect = this.canvas.getBoundingClientRect();
    const px = clientX - rect.left, py = clientY - rect.top;
    this.group.updateMatrixWorld(true);
    let best = -1, dist = 12 * 12;
    for (let i = 0; i < this.circuit.n; i++) {
      this.proj.fromArray(this.positions, i * 3).applyMatrix4(this.group.matrixWorld).project(this.camera);
      const x = ((this.proj.x + 1) * rect.width) / 2, y = ((1 - this.proj.y) * rect.height) / 2;
      const d = (x - px) ** 2 + (y - py) ** 2;
      if (d < dist) { dist = d; best = i; }
    }
    if (best < 0) return null;
    const type = this.circuit.typeName(best);
    return { index: best, type, side: this.circuit.side[best], bodyId: this.circuit.bodyId[best], role: roleOf(type), rateHz: this.lastRate ? this.lastRate[best] : 0 };
  }

  render(): void {
    if (!this.disposed) this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.disposed = true;
    this.canvas.removeEventListener('pointerdown', this.onDown);
    this.canvas.removeEventListener('pointermove', this.onMove);
    this.canvas.removeEventListener('pointerup', this.onUp);
    this.canvas.removeEventListener('pointercancel', this.onUp);
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
    this.renderer.dispose();
  }
}
