// Shared display formatters. Every panel was hand-rolling its own variant of
// these (some accepted `null | undefined`, some didn't, some used 3 decimals,
// some used 2) which made the UI feel inconsistent — same metric formatted
// differently in different places. Importing from here keeps every panel
// honest with one rule.

// Adaptive numeric formatter:
//   * non-finite (NaN / Infinity / null / undefined) → em-dash placeholder
//   * |v| ≥ 1000 → 0 decimals (e.g. "12345")
//   * |v| ≥ 100  → 1 decimal  (e.g. "123.4")
//   * |v| ≥ 10   → 2 decimals (e.g. "12.34")
//   * otherwise  → `precision` decimals (default 3)
export function fmt(v: number | null | undefined, precision = 3): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  if (abs >= 1000) return v.toFixed(0);
  if (abs >= 100) return v.toFixed(1);
  if (abs >= 10) return v.toFixed(2);
  return v.toFixed(precision);
}

// Percentage formatter — accepts a unit-interval value (0–1).
export function fmtPct(v: number | null | undefined, decimals = 0): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(decimals)}%`;
}

// Wall-clock duration in milliseconds → "1.2s" / "12.3s" / "2m 14s" / "1h 02m".
export function fmtDur(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) {
    return "—";
  }
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const mins = Math.floor(s / 60);
  const secs = Math.floor(s % 60);
  if (mins < 60) return `${mins}m ${secs.toString().padStart(2, "0")}s`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hrs}h ${remMins.toString().padStart(2, "0")}m`;
}

// Unix-ms timestamp → "HH:MM:SS" in local time. Returns "—" for null / NaN
// so panels can render a missing timestamp without a JS exception.
export function fmtTs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "—";
  const d = new Date(ms);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// Parse a string from a numeric <input>. Returns the numeric value if it's a
// finite number, else `fallback`. Use this everywhere we read a free-text
// numeric input — Number("") is 0 (a real bug source) and Number("abc") is
// NaN which then poisons every downstream calculation.
export function parseNumOr<T>(raw: string, fallback: T): number | T {
  const trimmed = raw.trim();
  if (trimmed === "") return fallback;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : fallback;
}
