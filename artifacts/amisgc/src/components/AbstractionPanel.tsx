import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { abstractionApi, autoModeApi, type AbstractionDef } from "../lib/api";
import { Panel } from "./Panel";

interface AbstractionPanelProps {
  open: boolean;
  onClose: () => void;
  onStarted?: (id: string) => void;
}

const STATUS_COLOR: Record<string, string> = {
  stable: "#3aaf6a",
  beta: "#c2a040",
  experimental: "#5a8aaa",
};

const backdropStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(2,12,22,0.92)",
  zIndex: 200,
  overflowY: "auto",
  padding: "16px 8px",
};

const sheetStyle: React.CSSProperties = {
  maxWidth: 900,
  margin: "0 auto",
  background: "#020c16",
  border: "1px solid #0f4a3a",
  borderRadius: 4,
};

function ImpactBar({ value, max = 1, color }: { value: number; max?: number; color: string }) {
  const pct = Math.min(100, Math.max(0, (Math.abs(value) / max) * 100));
  return (
    <div style={{ height: 4, background: "#0a1a14", borderRadius: 2, overflow: "hidden" }}>
      <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 2 }} />
    </div>
  );
}

export function AbstractionPanel({ open, onClose, onStarted }: AbstractionPanelProps) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<null | { combinedImpact: Record<string, number>; baseRanges: Record<string, number[]>; scale: number }>(null);

  const abstractionsQuery = useQuery({
    queryKey: ["abstractions"],
    queryFn: () => abstractionApi.list(),
    enabled: open,
    staleTime: 300_000,
  });

  const previewMutation = useMutation({
    mutationFn: (ids: string[]) =>
      abstractionApi.preview({ abstractionIds: ids }),
    onSuccess: (data) => setPreview(data as unknown as typeof preview),
  });

  const launchMutation = useMutation({
    mutationFn: (body: { scale: number; baseRanges: Record<string, number[]>; ticksPerCombo?: number }) =>
      autoModeApi.create({
        scale: body.scale as 81 | 810 | 81000,
        baseRanges: body.baseRanges,
        ticksPerCombo: body.ticksPerCombo ?? 30000,
        maxIterations: 3,
        gateStreakTarget: 1000,
      }),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ["automodes"] });
      onStarted?.(data.id);
      onClose();
    },
  });

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setPreview(null);
  };

  if (!open) return null;

  const abstractions: AbstractionDef[] = abstractionsQuery.data?.abstractions ?? [];
  const selectedArr = [...selected];

  return (
    <div style={backdropStyle} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={sheetStyle}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderBottom: "1px solid #0f4a3a" }}>
          <div>
            <div style={{ fontSize: 10, color: "#5a8aaa", letterSpacing: 3 }}>
              ABSTRACTION LAYER · SCALE UP EXPERIMENTS
            </div>
            <div style={{ fontSize: 8, color: "#5a7a70", marginTop: 3 }}>
              Apply biological abstractions to reduce compute cost. Only abstractions that preserve Phi &gt; 0.05 are valid.
            </div>
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: "1px solid #0f4a3a", color: "#00ffc4", fontSize: 12, padding: "4px 10px", borderRadius: 2, cursor: "pointer" }}>
            ✕
          </button>
        </div>

        <div style={{ padding: 14 }}>
          {/* Rule banner */}
          <div style={{ marginBottom: 12, padding: "6px 10px", background: "rgba(0,255,196,0.04)", border: "1px solid #0f4a3a", borderRadius: 2, fontSize: 8, color: "#5a9a80", lineHeight: 1.6 }}>
            <strong style={{ color: "#00ffc4" }}>KEY RULE:</strong> Abstractions are valid only if they preserve emergent specialisation: Phi &gt; 0.05, PU &gt; 0.8, S_C &gt; 0.9. Each abstraction below shows its estimated impact before you apply it. Estimated values are conservative — actual impact depends on network configuration.
          </div>

          {abstractionsQuery.isLoading && (
            <div style={{ color: "#5a7a70", fontSize: 9 }}>Loading abstractions…</div>
          )}

          {/* Abstraction cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(400px, 1fr))", gap: 10, marginBottom: 14 }}>
            {abstractions.map((abs) => {
              const isSelected = selected.has(abs.id);
              const statusColor = STATUS_COLOR[abs.status] ?? "#5a7a70";
              return (
                <div
                  key={abs.id}
                  onClick={() => toggle(abs.id)}
                  style={{
                    border: `1px solid ${isSelected ? "#5a8aaa" : "#0f4a3a"}`,
                    borderRadius: 3,
                    padding: "10px 12px",
                    cursor: "pointer",
                    background: isSelected ? "rgba(90,138,170,0.08)" : "rgba(0,0,0,0.3)",
                    transition: "border-color 0.1s",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                        <span style={{ fontSize: 14, color: isSelected ? "#5a8aaa" : "#334455" }}>
                          {isSelected ? "☑" : "☐"}
                        </span>
                        <span style={{ fontSize: 10, color: isSelected ? "#c5dfd4" : "#7a9a90", fontWeight: 600 }}>
                          {abs.name}
                        </span>
                      </div>
                      <div style={{ fontSize: 8, color: "#7a9a90", lineHeight: 1.4 }}>
                        {abs.description}
                      </div>
                    </div>
                    <span style={{ fontSize: 7, padding: "2px 6px", border: `1px solid ${statusColor}`, color: statusColor, borderRadius: 2, letterSpacing: 1, whiteSpace: "nowrap", flexShrink: 0, marginLeft: 8 }}>
                      {abs.status.toUpperCase()}
                    </span>
                  </div>

                  <div style={{ fontSize: 7, color: "#3aaf6a", marginBottom: 4, letterSpacing: 1 }}>
                    BIOLOGICAL JUSTIFICATION
                  </div>
                  <div style={{ fontSize: 8, color: "#4a7060", lineHeight: 1.4, marginBottom: 8, fontStyle: "italic" }}>
                    {abs.biologicalJustification}
                  </div>

                  {/* Impact grid */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4 }}>
                    {[
                      { label: "Delta Phi", value: abs.impact.deltaPhi, color: abs.impact.deltaPhi >= 0 ? "#00ffc4" : "#ff4477", format: (v: number) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%` },
                      { label: "FLOPs", value: abs.impact.flopsMultiplier, color: "#ffd060", format: (v: number) => `${(v * 100).toFixed(0)}%` },
                      { label: "Memory", value: abs.impact.memoryMultiplier, color: "#5a8aaa", format: (v: number) => `${(v * 100).toFixed(0)}%` },
                    ].map(({ label, value, color, format }) => (
                      <div key={label}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                          <span style={{ fontSize: 6, color: "#3a5a50", letterSpacing: 1 }}>{label}</span>
                          <span style={{ fontSize: 7, color }}>{format(value)}</span>
                        </div>
                        <ImpactBar value={value} color={color} />
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop: 4, fontSize: 7, color: "#3a5a50" }}>
                    Max scale enabled: N={abs.impact.maxScaleEnabled.toLocaleString()} · Min Phi required: {abs.minPhiRequired}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Combined impact preview */}
          {selectedArr.length > 0 && (
            <Panel title="COMBINED IMPACT PREVIEW" accent="#5a8aaa">
              <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                <button
                  disabled={previewMutation.isPending}
                  onClick={() => previewMutation.mutate(selectedArr)}
                  style={{ padding: "4px 10px", fontSize: 8, letterSpacing: 1.5, background: "rgba(90,138,170,0.2)", border: "1px solid #5a8aaa", color: "#5a8aaa", borderRadius: 2, cursor: "pointer" }}
                >
                  {previewMutation.isPending ? "CALCULATING…" : "PREVIEW IMPACT"}
                </button>
                <div style={{ fontSize: 8, color: "#3a5a50", lineHeight: 1.4, alignSelf: "center" }}>
                  Selected: {selectedArr.join(", ")}
                </div>
              </div>

              {preview && (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 6, marginBottom: 8 }}>
                    {[
                      { label: "Delta Phi", value: `${preview.combinedImpact["deltaPhi"] >= 0 ? "+" : ""}${((preview.combinedImpact["deltaPhi"] ?? 0) * 100).toFixed(1)}%`, color: (preview.combinedImpact["deltaPhi"] ?? 0) >= -0.05 ? "#3aaf6a" : "#ff4477" },
                      { label: "FLOPs", value: `${((preview.combinedImpact["flopsMultiplier"] ?? 1) * 100).toFixed(0)}%`, color: "#ffd060" },
                      { label: "Memory", value: `${((preview.combinedImpact["memoryMultiplier"] ?? 1) * 100).toFixed(0)}%`, color: "#5a8aaa" },
                      { label: "Max Scale N", value: (preview.combinedImpact["maxScaleEnabled"] ?? 81000).toLocaleString(), color: "#00ffc4" },
                    ].map(({ label, value, color }) => (
                      <div key={label} style={{ textAlign: "center", padding: "5px", background: "rgba(0,0,0,0.3)", border: "1px solid #0a1a14", borderRadius: 2 }}>
                        <div style={{ fontSize: 13, color, fontVariantNumeric: "tabular-nums" }}>{value}</div>
                        <div style={{ fontSize: 6, color: "#3a5a50", letterSpacing: 1 }}>{label}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ fontSize: 8, color: "#5a7a70", marginBottom: 8 }}>
                    Scale: N={preview.scale} · Patched parameter ranges applied to next sweep
                  </div>
                  <button
                    disabled={launchMutation.isPending}
                    onClick={() =>
                      launchMutation.mutate({
                        scale: preview.scale,
                        baseRanges: preview.baseRanges,
                      })
                    }
                    style={{ padding: "5px 12px", fontSize: 9, letterSpacing: 1.5, background: "rgba(20,80,40,0.45)", border: "1px solid #3aaf6a", color: "#9bf0c0", borderRadius: 2, cursor: "pointer", fontWeight: 600 }}
                  >
                    {launchMutation.isPending ? "LAUNCHING…" : "▶ LAUNCH WITH ABSTRACTIONS"}
                  </button>
                  {launchMutation.isError && (
                    <div style={{ fontSize: 8, color: "#ff4477", marginTop: 4 }}>
                      {(launchMutation.error as Error).message}
                    </div>
                  )}
                </>
              )}
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
