/** The prepared eye circuit: retina and lamina cut from MaleCNS v1.0 by scripts/extract_eye_circuit.py. */

export interface CircuitManifest {
  dataset: string;
  neurons: number;
  edges: number;
  synaptic_contacts: number;
  neurons_without_soma_position: number;
  types: string[];
  model: Record<string, number | string>;
  screen: { width: number; height: number };
  generated: string;
}

export interface Circuit {
  manifest: CircuitManifest;
  n: number;
  bodyId: string[];
  type: Int16Array;            // index into manifest.types
  typeName: (i: number) => string;
  side: string;                // 'L' | 'R' | '?' per neuron
  driveChannel: Int8Array;     // 0 none, 1 luminance, 2 blue (R8p), 3 green (R8y)
  driveU: Float32Array;
  driveV: Float32Array;
  bias: Int8Array;             // 1 for L1, L2, L3, L5 (12 mV lamina bias)
  colU: Float32Array;          // column screen position for every cell (display and glance map)
  colV: Float32Array;
  uvSource: Int8Array;         // 0 none, 1 receptor sample, 2 column, 3 strongest partner
  offsets: Int32Array;         // CSR by presynaptic neuron
  targets: Int32Array;
  weights: Float32Array;       // mV, signed
}

export const SCREEN_W = 320;
export const SCREEN_H = 180;

export function parseCircuit(raw: any): Circuit {
  const n: number = raw.manifest.neurons;
  const need = ['type', 'driveChannel', 'driveU', 'driveV', 'bias', 'colU', 'colV', 'uvSource', 'offsets', 'targets', 'weights'];
  for (const k of need) if (!Array.isArray(raw[k])) throw new Error(`circuit missing ${k}`);
  if (raw.type.length !== n || raw.offsets.length !== n + 1 || raw.targets.length !== raw.weights.length)
    throw new Error('circuit arrays are inconsistent');
  const types: string[] = raw.manifest.types;
  const type = Int16Array.from(raw.type);
  const targets = Int32Array.from(raw.targets);
  for (let i = 0; i < targets.length; i++) if (targets[i] < 0 || targets[i] >= n) throw new Error('edge target out of range');
  return {
    manifest: raw.manifest,
    n,
    bodyId: raw.bodyId,
    type,
    typeName: (i) => types[type[i]],
    side: raw.side,
    driveChannel: Int8Array.from(raw.driveChannel),
    driveU: Float32Array.from(raw.driveU),
    driveV: Float32Array.from(raw.driveV),
    bias: Int8Array.from(raw.bias),
    colU: Float32Array.from(raw.colU),
    colV: Float32Array.from(raw.colV),
    uvSource: Int8Array.from(raw.uvSource),
    offsets: Int32Array.from(raw.offsets),
    targets,
    weights: Float32Array.from(raw.weights),
  };
}

/** Plain-data form for posting to the worker (no functions; typed arrays clone cheaply). */
export type CircuitData = Omit<Circuit, 'typeName' | 'bodyId'> & { bodyId?: string[] };

export function toData(c: Circuit): CircuitData {
  const { typeName: _t, bodyId: _b, ...rest } = c;
  return rest;
}

export function fromData(d: CircuitData): Circuit {
  const types = d.manifest.types;
  return { ...d, bodyId: d.bodyId ?? [], typeName: (i) => types[d.type[i]] };
}

export async function loadCircuit(url = '/data/eye-circuit.json'): Promise<Circuit> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Cannot load circuit: ${response.status}`);
  return parseCircuit(await response.json());
}
