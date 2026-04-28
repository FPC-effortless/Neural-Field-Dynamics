import type { Neuron, NormBuffer, SimState } from "./types.js";
import { TASK_ORDER } from "./tasks.js";

export function clamp(v: number, lo = 0, hi = 1): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function tdist(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  G: number
): number {
  const dx = Math.min(Math.abs(ax - bx), G - Math.abs(ax - bx));
  const dy = Math.min(Math.abs(ay - by), G - Math.abs(ay - by));
  return Math.sqrt(dx * dx + dy * dy);
}

export function xlogx(p: number, q: number): number {
  if (p < 1e-10 || q < 1e-10) return 0;
  return p * Math.log2(p / q);
}

export function th(x: number): number {
  return Math.tanh(x);
}

export function mkNB(max = 200): NormBuffer {
  return { arr: [], lo: Infinity, hi: -Infinity, max };
}

export function nbPush(nb: NormBuffer, val: number): number {
  const v = isFinite(val) && !isNaN(val) ? val : 0;
  nb.arr.push(v);
  if (v < nb.lo) nb.lo = v;
  if (v > nb.hi) nb.hi = v;
  if (nb.arr.length > nb.max) {
    const rem = nb.arr.shift();
    if (rem !== undefined && (rem <= nb.lo || rem >= nb.hi)) {
      nb.lo = Infinity;
      nb.hi = -Infinity;
      for (let i = 0; i < nb.arr.length; i++) {
        const x = nb.arr[i] as number;
        if (x < nb.lo) nb.lo = x;
        if (x > nb.hi) nb.hi = x;
      }
    }
  }
  return nb.hi > nb.lo ? (v - nb.lo) / (nb.hi - nb.lo) : 0.5;
}

export function pearson(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 4) return 0;
  let sa = 0,
    sb = 0,
    sab = 0,
    sa2 = 0,
    sb2 = 0;
  for (let i = 0; i < n; i++) {
    const av = a[i] as number;
    const bv = b[i] as number;
    sa += av;
    sb += bv;
    sab += av * bv;
    sa2 += av * av;
    sb2 += bv * bv;
  }
  const num = n * sab - sa * sb;
  const den = Math.sqrt((n * sa2 - sa * sa) * (n * sb2 - sb * sb));
  return den < 1e-10 ? 0 : clamp(num / den, -1, 1);
}

export function computeMI(n: Neuron): number {
  const tot = n.mi_n1 + n.mi_n0;
  if (tot < 20) return 0;
  const p1 = n.mi_n1 / tot,
    p0 = n.mi_n0 / tot;
  const f1 = n.mi_f1 / Math.max(n.mi_n1, 1),
    f0 = n.mi_f0 / Math.max(n.mi_n0, 1);
  const f = f1 * p1 + f0 * p0;
  return clamp(
    p1 * (xlogx(f1, f) + xlogx(1 - f1, 1 - f)) +
      p0 * (xlogx(f0, f) + xlogx(1 - f0, 1 - f))
  );
}

export function computeCR(ns: Neuron[], N: number): number {
  let wS = 0,
    wSq = 0,
    wC = 0,
    fire = 0;
  for (let i = 0; i < N; i++) {
    const n = ns[i] as Neuron;
    if (n.state === "alarming") fire++;
    for (let j = 0; j < n.conns.length; j++) {
      const w = (n.conns[j] as { w: number }).w;
      wS += w;
      wSq += w * w;
      wC++;
    }
  }
  const wM = wC ? wS / wC : 0,
    wV = wC ? wSq / wC - wM * wM : 0;
  const pf = clamp(fire / N, 0.001, 0.999);
  return Math.min(
    10,
    -(pf * Math.log2(pf) + (1 - pf) * Math.log2(1 - pf)) /
      Math.max(0.001, Math.min(1, wV * 5))
  );
}

export function computeCoh(ns: Neuron[], N: number): number {
  let mu = 0;
  for (let i = 0; i < N; i++) mu += (ns[i] as Neuron).epsilon;
  mu /= N;
  let sig = 0;
  for (let i = 0; i < N; i++) {
    const d = (ns[i] as Neuron).epsilon - mu;
    sig += d * d;
  }
  return clamp(1 - Math.sqrt(sig / N) / (mu + 0.01));
}

export function makePhiPairs(N: number): Array<[number, number]> {
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < 28; i++) {
    pairs.push([
      Math.floor(Math.random() * N),
      Math.floor(Math.random() * N),
    ]);
  }
  return pairs;
}

export function computePhi(
  ns: Neuron[],
  N: number,
  pairs: Array<[number, number]>
): number {
  let mu = 0;
  for (let i = 0; i < N; i++) mu += (ns[i] as Neuron).C;
  mu /= N;
  let vari = 0;
  for (let i = 0; i < N; i++) {
    const d = (ns[i] as Neuron).C - mu;
    vari += d * d;
  }
  vari /= N;
  let cs = 0,
    pcount = 0;
  for (let k = 0; k < pairs.length; k++) {
    const p = pairs[k] as [number, number];
    const ai = p[0],
      bi = p[1];
    if (ai === bi) continue;
    cs +=
      Math.abs((ns[ai] as Neuron).C - mu) *
      Math.abs((ns[bi] as Neuron).C - mu);
    pcount++;
  }
  return clamp(Math.sqrt(vari) + (pcount ? cs / pcount : 0));
}

export function computeClustering(ns: Neuron[], N: number): number {
  let tot = 0;
  for (let i = 0; i < N; i++) {
    const n = ns[i] as Neuron;
    const nb = new Set(n.conns.map((c) => c.to));
    if (nb.size < 2) continue;
    const arr = [...nb];
    let tri = 0,
      pairs = 0;
    for (let a = 0; a < arr.length; a++) {
      for (let b = a + 1; b < arr.length; b++) {
        pairs++;
        const aN = ns[arr[a] as number] as Neuron;
        if (aN.conns.some((c) => c.to === arr[b])) tri++;
      }
    }
    tot += pairs ? tri / pairs : 0;
  }
  return tot / N;
}

export function computeFSI(ns: Neuron[], N: number): number {
  const miPerTask = TASK_ORDER.map(
    (k) =>
      ns.reduce((s, n) => {
        const arr = n.branch_task_spikes[k];
        if (!arr) return s;
        const spk = arr.reduce((a, b) => a + b, 0);
        return s + spk;
      }, 0) / N
  );
  const mean = miPerTask.reduce((a, b) => a + b, 0) / miPerTask.length;
  const vari =
    miPerTask.reduce((s, v) => s + (v - mean) * (v - mean), 0) /
    miPerTask.length;
  return mean > 0.001 ? vari / mean : 0;
}

// Compress an apical state into a low-rank PCA-like projection (8 components)
// Simple deterministic projection: random Gaussian projection matrix from seed.
let _projection: number[][] | null = null;
let _projDim = 0;
function getProjection(N: number): number[][] {
  if (_projection && _projDim === N) return _projection;
  // Pseudo-random fixed projection (deterministic) for compression
  const rng = mulberry32(0xc0ffee);
  const proj: number[][] = [];
  for (let k = 0; k < 8; k++) {
    const row: number[] = [];
    for (let i = 0; i < N; i++) row.push(gaussian(rng) / Math.sqrt(N));
    proj.push(row);
  }
  _projection = proj;
  _projDim = N;
  return proj;
}

export function project8(state: number[], N: number): number[] {
  const proj = getProjection(N);
  const z: number[] = new Array(8).fill(0);
  for (let k = 0; k < 8; k++) {
    const row = proj[k] as number[];
    let s = 0;
    for (let i = 0; i < N; i++) s += (row[i] as number) * (state[i] ?? 0);
    z[k] = s;
  }
  return z;
}

export function attractorDistance(
  z1: number[],
  z2: number[],
  J1: number[],
  J2: number[],
  alpha = 0.7,
  beta = 0.3
): number {
  let zd = 0;
  for (let i = 0; i < Math.min(z1.length, z2.length); i++) {
    const d = (z1[i] as number) - (z2[i] as number);
    zd += d * d;
  }
  let jd = 0;
  for (let i = 0; i < Math.min(J1.length, J2.length); i++) {
    const d = (J1[i] as number) - (J2[i] as number);
    jd += d * d;
  }
  return alpha * Math.sqrt(zd) + beta * Math.sqrt(jd);
}

// PRNG for reproducibility
export function mulberry32(seed: number) {
  let t = seed >>> 0;
  return function () {
    t = (t + 0x6d2b79f5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function gaussian(rng: () => number = Math.random): number {
  let u = 0,
    v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Total firings within a sliding window
export function recentSpikeRate(sim: SimState): number {
  const buf = sim.firingBuffer.slice(-30);
  if (buf.length === 0) return 0;
  return buf.reduce((s, f) => s + f.count, 0) / buf.length;
}
