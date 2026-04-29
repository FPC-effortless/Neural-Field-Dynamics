import { mulberry32 } from "./math.js";

export interface MeanStd {
  mean: number | null;
  std: number | null;
  n: number;
  nValid: number;
  nOutliers: number;
}

export interface CIResult {
  mean: number | null;
  ci95Lo: number | null;
  ci95Hi: number | null;
  n: number;
}

export interface StabilityResult {
  stable: boolean;
  slope: number;
  meanLastWindow: number;
  fractionWithinTol: number;
}

const isFiniteNum = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

export function partitionFinite(xs: number[]): { valid: number[]; outliers: number[] } {
  const valid: number[] = [];
  const outliers: number[] = [];
  for (const v of xs) {
    if (isFiniteNum(v)) valid.push(v);
    else outliers.push(typeof v === "number" ? v : NaN);
  }
  return { valid, outliers };
}

export function meanStd(xs: number[]): MeanStd {
  const { valid, outliers } = partitionFinite(xs);
  const n = xs.length;
  const nValid = valid.length;
  const nOutliers = outliers.length;
  if (nValid === 0) return { mean: null, std: null, n, nValid, nOutliers };
  const m = valid.reduce((a, b) => a + b, 0) / nValid;
  if (nValid < 2) return { mean: m, std: 0, n, nValid, nOutliers };
  const v = valid.reduce((a, b) => a + (b - m) ** 2, 0) / (nValid - 1);
  return { mean: m, std: Math.sqrt(v), n, nValid, nOutliers };
}

// Bootstrap percentile 95% CI of the mean. Cheap and distribution-free.
// Uses a seeded RNG so identical inputs produce identical CIs.
export function bootstrapCI(
  xs: number[],
  iterations = 1000,
  alpha = 0.05,
  seed = 0xC0FFEE,
): CIResult {
  const { valid } = partitionFinite(xs);
  const n = valid.length;
  if (n === 0) return { mean: null, ci95Lo: null, ci95Hi: null, n: 0 };
  const m0 = valid.reduce((a, b) => a + b, 0) / n;
  if (n < 3) return { mean: m0, ci95Lo: m0, ci95Hi: m0, n };
  const rng = mulberry32(seed);
  const means: number[] = new Array(iterations);
  for (let it = 0; it < iterations; it++) {
    let s = 0;
    for (let i = 0; i < n; i++) {
      const idx = Math.floor(rng() * n);
      s += valid[idx] as number;
    }
    means[it] = s / n;
  }
  means.sort((a, b) => a - b);
  const lo = means[Math.floor((alpha / 2) * iterations)] ?? m0;
  const hi = means[Math.floor((1 - alpha / 2) * iterations)] ?? m0;
  return { mean: m0, ci95Lo: lo, ci95Hi: hi, n };
}

// Welch's two-sample t-test (unequal variance).
// Returns { t, df, pTwoSided } using a normal approximation for p (good enough for n>20).
export function welchT(a: number[], b: number[]): {
  t: number | null;
  df: number | null;
  pTwoSided: number | null;
  delta: number | null;
} {
  const A = partitionFinite(a).valid;
  const B = partitionFinite(b).valid;
  if (A.length < 2 || B.length < 2) return { t: null, df: null, pTwoSided: null, delta: null };
  const ma = A.reduce((s, x) => s + x, 0) / A.length;
  const mb = B.reduce((s, x) => s + x, 0) / B.length;
  const va = A.reduce((s, x) => s + (x - ma) ** 2, 0) / (A.length - 1);
  const vb = B.reduce((s, x) => s + (x - mb) ** 2, 0) / (B.length - 1);
  const seA = va / A.length;
  const seB = vb / B.length;
  const seSq = seA + seB;
  if (seSq <= 0) return { t: 0, df: A.length + B.length - 2, pTwoSided: 1, delta: ma - mb };
  const t = (ma - mb) / Math.sqrt(seSq);
  const df = (seSq * seSq) / (
    (seA * seA) / Math.max(1, A.length - 1) + (seB * seB) / Math.max(1, B.length - 1)
  );
  // Two-sided p via standard-normal approx (for moderate-to-large df this is ~accurate)
  const z = Math.abs(t);
  const pTwoSided = 2 * (1 - normCdf(z));
  return { t, df, pTwoSided, delta: ma - mb };
}

function normCdf(z: number): number {
  // Abramowitz & Stegun 7.1.26
  const t = 1 / (1 + 0.2316419 * z);
  const d = 0.3989422804014327 * Math.exp(-(z * z) / 2);
  const p =
    d *
    t *
    (0.319381530 +
      t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return 1 - p;
}

// Stability check: regress the last `windowFrac` fraction of the series on its
// index. If the |slope| per tick is below `slopeTol` AND values stay within
// `valueTol` of their mean, declare it stable.
export function stabilityCheck(
  series: Array<{ t: number; v: number }>,
  windowFrac = 0.3,
  slopeTol = 1e-4,
  valueTol = 0.05,
): StabilityResult {
  const finite = series.filter((s) => isFiniteNum(s.v));
  if (finite.length < 4) {
    return { stable: false, slope: 0, meanLastWindow: 0, fractionWithinTol: 0 };
  }
  const start = Math.max(0, Math.floor(finite.length * (1 - windowFrac)));
  const w = finite.slice(start);
  // Linear regression slope (least squares) of v on t.
  const n = w.length;
  let sumT = 0,
    sumV = 0,
    sumTV = 0,
    sumTT = 0;
  for (const p of w) {
    sumT += p.t;
    sumV += p.v;
    sumTV += p.t * p.v;
    sumTT += p.t * p.t;
  }
  const denom = n * sumTT - sumT * sumT;
  const slope = denom === 0 ? 0 : (n * sumTV - sumT * sumV) / denom;
  const mean = sumV / n;
  const within = w.filter((p) => Math.abs(p.v - mean) <= valueTol).length;
  const fractionWithinTol = within / n;
  const stable = Math.abs(slope) <= slopeTol && fractionWithinTol >= 0.7;
  return { stable, slope, meanLastWindow: mean, fractionWithinTol };
}

// Direction-aware "best" value across a list (max for targetDir=1, min for -1).
export function bestMeasured(
  xs: Array<number | null | undefined>,
  targetDir: 1 | -1,
): number | null {
  let best: number | null = null;
  for (const v of xs) {
    if (!isFiniteNum(v)) continue;
    if (best === null) best = v;
    else if (targetDir === 1) best = Math.max(best, v);
    else best = Math.min(best, v);
  }
  return best;
}
