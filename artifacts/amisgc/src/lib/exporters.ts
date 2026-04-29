import type { RunDetail, RunSummary, Stats } from "./api";

const EXPORT_KEYS: Array<keyof Stats> = [
  "networkPhi",
  "networkSC",
  "networkPU",
  "networkH_C",
  "networkCAR",
  "existenceGate",
  "gateStreak",
  "networkMI",
  "networkSE",
  "networkCR",
  "networkR",
  "networkIC",
  "J_star",
  "J_emb",
  "avgAtp",
  "avgH",
  "phaseRegion",
  "taskKey",
  "attractorCount",
];

function downloadBlob(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function statValue(s: Stats, k: keyof Stats): string {
  const v = s[k] as unknown;
  if (v === undefined || v === null) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  if (typeof v === "boolean") return v ? "1" : "0";
  return String(v);
}

export function exportRunCSV(run: RunDetail | null): void {
  if (!run) return;
  const hist = run.history ?? [];
  const header = ["t", "runId", ...EXPORT_KEYS].join(",");
  const lines = [header];
  for (const h of hist) {
    const row = [h.t, run.id, ...EXPORT_KEYS.map((k) => statValue(h.stats, k))].join(",");
    lines.push(row);
  }
  const slug = (run.experimentId ?? run.id).replace(/[^a-z0-9]+/gi, "_");
  downloadBlob(`amisgc_${slug}_${run.id}.csv`, lines.join("\n"), "text/csv");
}

export function exportRunJSON(run: RunDetail | null): void {
  if (!run) return;
  const slug = (run.experimentId ?? run.id).replace(/[^a-z0-9]+/gi, "_");
  downloadBlob(
    `amisgc_${slug}_${run.id}.json`,
    JSON.stringify(run, null, 2),
    "application/json",
  );
}

const TABLE_KEYS: Array<keyof Stats> = [
  "networkPhi",
  "networkSC",
  "networkPU",
  "existenceGate",
  "gateStreak",
  "networkR",
  "networkIC",
  "J_star",
  "J_emb",
];

export function exportRunsTable(runs: RunSummary[]): void {
  const finished = runs.filter((r) => r.latestStats);
  const header = [
    "id",
    "experimentId",
    "status",
    "passed",
    "metric",
    "measured",
    "target",
    "ticksDone",
    "ticks",
    "createdAt",
    ...TABLE_KEYS,
  ].join(",");
  const lines = [header];
  for (const r of finished) {
    const s = r.latestStats as Stats;
    const row = [
      r.id,
      r.experimentId ?? "",
      r.status,
      r.passed === undefined ? "" : r.passed ? "1" : "0",
      r.metric ?? "",
      r.measured ?? "",
      r.target ?? "",
      r.ticksDone,
      r.ticks,
      new Date(r.createdAt).toISOString(),
      ...TABLE_KEYS.map((k) => statValue(s, k)),
    ].join(",");
    lines.push(row);
  }
  downloadBlob(`amisgc_runs_table_${Date.now()}.csv`, lines.join("\n"), "text/csv");
}
