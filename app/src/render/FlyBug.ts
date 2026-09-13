/**
 * A small animated fruit fly that buzzes around the stage and, at the verdict, lands on the
 * ad that got the BUY. Pure decoration: it is not driven by the model, it is the host.
 */
export class FlyBug {
  readonly el: HTMLElement;
  private x = 0; private y = 0; private vx = 0; private vy = 0;
  private heading = 0;
  private target = { x: 0, y: 0 };
  private nextWaypoint = 0;
  private state: 'wander' | 'land' | 'sit' | 'hidden' = 'hidden';
  private pace = 1;                 // 1 while the show is on, lower when idle
  private raf = 0;
  private last = performance.now();

  constructor(private readonly parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'flybug';
    this.el.setAttribute('aria-hidden', 'true');
    this.el.innerHTML = `<svg viewBox="-20 -22 40 44" width="38" height="42">
      <g class="wing l"><ellipse cx="-7" cy="-8" rx="4.6" ry="11" transform="rotate(-28 -3 -1)"/></g>
      <g class="wing r"><ellipse cx="7" cy="-8" rx="4.6" ry="11" transform="rotate(28 3 -1)"/></g>
      <g class="legs" stroke="#2b2118" stroke-width="1.2" fill="none" stroke-linecap="round">
        <path d="M-4 2 l-6 5 M4 2 l6 5 M-4 6 l-5 7 M4 6 l5 7 M-3 -2 l-7 1 M3 -2 l7 1"/></g>
      <ellipse cx="0" cy="5" rx="5" ry="9" fill="#2b2118"/>
      <path d="M-4 3 h8 M-4.6 6 h9.2 M-4 9 h8" stroke="#6b5a3a" stroke-width="1" opacity=".7"/>
      <ellipse cx="0" cy="-5" rx="5" ry="4.4" fill="#3a2c20"/>
      <circle cx="0" cy="-11" r="3.6" fill="#2b2118"/>
      <circle cx="-3" cy="-12" r="2.1" fill="#E4321A"/><circle cx="3" cy="-12" r="2.1" fill="#E4321A"/>
      <circle cx="-3.4" cy="-12.6" r=".7" fill="#fff" opacity=".8"/><circle cx="2.6" cy="-12.6" r=".7" fill="#fff" opacity=".8"/>
    </svg>`;
    this.el.hidden = true;
    parent.append(this.el);
  }

  private bounds(): { w: number; h: number } { return { w: this.parent.clientWidth || 640, h: this.parent.clientHeight || 360 }; }

  /** Buzz around the stage. `pace` 1 is show speed, 0.4 is an idle drift. */
  wander(pace = 1): void {
    const b = this.bounds();
    if (this.state === 'hidden') { this.x = b.w * 0.15; this.y = b.h * 0.2; }
    this.state = 'wander'; this.pace = pace;
    this.el.hidden = false; this.el.classList.remove('sitting');
    this.nextWaypoint = 0;
    this.start();
  }

  /** Fly to a point (fractions of the stage) and settle there. */
  landAt(xFrac: number, yFrac: number): void {
    const b = this.bounds();
    this.target = { x: xFrac * b.w, y: yFrac * b.h };
    this.state = 'land'; this.pace = 1.4;
    this.el.hidden = false; this.el.classList.remove('sitting');
    this.start();
  }

  hide(): void { this.state = 'hidden'; this.el.hidden = true; cancelAnimationFrame(this.raf); this.raf = 0; }

  private start(): void { if (!this.raf) { this.last = performance.now(); this.raf = requestAnimationFrame(this.tick); } }

  private tick = (now: number) => {
    this.raf = 0;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const b = this.bounds();
    if (this.state === 'wander') {
      if (now > this.nextWaypoint || Math.hypot(this.target.x - this.x, this.target.y - this.y) < 24) {
        this.target = { x: b.w * (0.08 + Math.random() * 0.84), y: b.h * (0.08 + Math.random() * 0.78) };
        this.nextWaypoint = now + 900 + Math.random() * 1800;
      }
    }
    if (this.state === 'wander' || this.state === 'land') {
      const dx = this.target.x - this.x, dy = this.target.y - this.y, d = Math.hypot(dx, dy) || 1;
      const maxSpeed = (this.state === 'land' ? 520 : 260) * this.pace;
      // steer toward the target, with the jittery accelerations of a real fly
      const ax = (dx / d) * 1400 * this.pace + (Math.random() - 0.5) * 900 * this.pace;
      const ay = (dy / d) * 1400 * this.pace + (Math.random() - 0.5) * 900 * this.pace;
      this.vx = (this.vx + ax * dt) * 0.96; this.vy = (this.vy + ay * dt) * 0.96;
      const sp = Math.hypot(this.vx, this.vy);
      if (sp > maxSpeed) { this.vx *= maxSpeed / sp; this.vy *= maxSpeed / sp; }
      if (this.state === 'land' && d < 140) { this.vx *= 0.9; this.vy *= 0.9; }
      this.x += this.vx * dt; this.y += this.vy * dt;
      this.x = Math.max(10, Math.min(b.w - 10, this.x)); this.y = Math.max(10, Math.min(b.h - 10, this.y));
      if (sp > 20) this.heading += ((Math.atan2(this.vy, this.vx) + Math.PI / 2 - this.heading + Math.PI * 3) % (Math.PI * 2) - Math.PI) * Math.min(1, dt * 10);
      if (this.state === 'land' && d < 6) { this.state = 'sit'; this.x = this.target.x; this.y = this.target.y; this.vx = this.vy = 0; this.heading = -0.35; this.el.classList.add('sitting'); }
    }
    this.el.style.transform = `translate(${this.x.toFixed(1)}px, ${this.y.toFixed(1)}px) translate(-50%, -50%) rotate(${this.heading.toFixed(3)}rad)`;
    if (this.state !== 'hidden' && this.state !== 'sit') this.raf = requestAnimationFrame(this.tick);
  };
}
