import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { codeGenApi, type CodeGenResult, type CodeTarget } from "../lib/api";

interface CodeGenPanelProps {
  open: boolean;
  onClose: () => void;
}

const TARGETS: { id: CodeTarget; label: string; description: string; color: string; icon: string }[] = [
  {
    id: "cpu",
    label: "CPU (NumPy)",
    description: "Runs on any machine. Pure NumPy vectorised operations. ~200 ticks/sec for N=81. Best for validation and debugging.",
    color: "#00ffc4",
    icon: "⚙",
  },
  {
    id: "gpu",
    label: "GPU (PyTorch CUDA)",
    description: "10–100x faster than CPU. Enables N=10 000+. Requires CUDA GPU. Best for large-scale hypothesis testing.",
    color: "#aa88ff",
    icon: "⚡",
  },
  {
    id: "neuromorphic",
    label: "Neuromorphic (Norse/Loihi)",
    description: "Spiking LIF neurons via Norse library. Deployable to Intel Loihi 2 for <1mW power. Best for biological plausibility validation.",
    color: "#ffd060",
    icon: "🧠",
  },
];

const DEFAULT_PARAMS = {
  TAU_ATT: 1.5,
  GAMMA_GLOBAL: 2.0,
  BETA_ENTROPY: 0.3,
  DELTA_TEMPORAL: 0.4,
  NOISE_SIGMA: 0.01,
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

function downloadFile(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function CodeGenPanel({ open, onClose }: CodeGenPanelProps) {
  const [target, setTarget] = useState<CodeTarget>("cpu");
  const [scale, setScale] = useState<81 | 810 | 81000>(81);
  const [ticks, setTicks] = useState(30000);
  const [label, setLabel] = useState("amisgc-experiment");
  const [params, setParams] = useState<Record<string, number>>(DEFAULT_PARAMS);
  const [result, setResult] = useState<CodeGenResult | null>(null);

  const genMutation = useMutation({
    mutationFn: () =>
      codeGenApi.generate({ target, params, scale, ticksPerCombo: ticks, experimentLabel: label }),
    onSuccess: (data) => setResult(data),
  });

  if (!open) return null;

  return (
    <div style={backdropStyle} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={sheetStyle}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderBottom: "1px solid #0f4a3a" }}>
          <div>
            <div style={{ fontSize: 10, color: "#aa88ff", letterSpacing: 3 }}>
              SILICON-OPTIMISED CODE GENERATION
            </div>
            <div style={{ fontSize: 8, color: "#5a7a70", marginTop: 3 }}>
              Generate downloadable Python for CPU, GPU, or neuromorphic targets. Purpose: speed up research. Not an end goal.
            </div>
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: "1px solid #0f4a3a", color: "#00ffc4", fontSize: 12, padding: "4px 10px", borderRadius: 2, cursor: "pointer" }}>
            ✕
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 0 }}>
          {/* Config */}
          <div style={{ padding: 14, borderRight: "1px solid #0a1a14" }}>
            {/* Target selection */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 7, color: "#aa88ff", letterSpacing: 1.5, marginBottom: 6 }}>TARGET PLATFORM</div>
              {TARGETS.map((t) => (
                <div
                  key={t.id}
                  onClick={() => setTarget(t.id)}
                  style={{
                    border: `1px solid ${target === t.id ? t.color : "#0f4a3a"}`,
                    borderRadius: 3,
                    padding: "8px 10px",
                    marginBottom: 5,
                    cursor: "pointer",
                    background: target === t.id ? `rgba(0,0,0,0.4)` : "rgba(0,0,0,0.15)",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 3 }}>
                    <span style={{ fontSize: 12 }}>{t.icon}</span>
                    <span style={{ fontSize: 9, color: target === t.id ? t.color : "#7a9a90", fontWeight: 600 }}>
                      {t.label}
                    </span>
                  </div>
                  <div style={{ fontSize: 7, color: "#5a7a70", lineHeight: 1.4 }}>{t.description}</div>
                </div>
              ))}
            </div>

            {/* Scale */}
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 7, color: "#3aaf6a", letterSpacing: 1, marginBottom: 4 }}>NETWORK SCALE (N)</div>
              <select
                value={scale}
                onChange={(e) => setScale(Number(e.target.value) as typeof scale)}
                style={{ width: "100%", background: "#020c16", color: "#c5dfd4", border: "1px solid #0f4a3a", fontSize: 9, padding: "4px 6px" }}
              >
                <option value={81}>81 neurons (quick validation)</option>
                <option value={810}>810 neurons (standard)</option>
                <option value={81000}>81 000 neurons (large scale)</option>
              </select>
            </div>

            {/* Ticks */}
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 7, color: "#3aaf6a", letterSpacing: 1, marginBottom: 4 }}>TICKS</div>
              <input
                type="number"
                min={1000}
                max={100000}
                step={1000}
                value={ticks}
                onChange={(e) => setTicks(Number(e.target.value))}
                style={{ width: "100%", background: "#020c16", color: "#c5dfd4", border: "1px solid #0f4a3a", fontSize: 9, padding: "4px 6px" }}
              />
            </div>

            {/* Label */}
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 7, color: "#3aaf6a", letterSpacing: 1, marginBottom: 4 }}>EXPERIMENT LABEL</div>
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                style={{ width: "100%", background: "#020c16", color: "#c5dfd4", border: "1px solid #0f4a3a", fontSize: 9, padding: "4px 6px" }}
              />
            </div>

            {/* Params */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 7, color: "#3aaf6a", letterSpacing: 1, marginBottom: 4 }}>PARAMETERS</div>
              {Object.entries(params).map(([k, v]) => (
                <div key={k} style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 4 }}>
                  <label style={{ fontSize: 7, color: "#5a7a70", width: 110, flexShrink: 0 }}>{k}</label>
                  <input
                    type="number"
                    step={0.01}
                    value={v}
                    onChange={(e) => setParams((prev) => ({ ...prev, [k]: Number(e.target.value) }))}
                    style={{ flex: 1, background: "#020c16", color: "#c5dfd4", border: "1px solid #0f4a3a", fontSize: 8, padding: "2px 4px" }}
                  />
                </div>
              ))}
            </div>

            <button
              disabled={genMutation.isPending}
              onClick={() => genMutation.mutate()}
              style={{
                width: "100%",
                padding: "7px 12px",
                fontSize: 9,
                letterSpacing: 2,
                background: "rgba(170,136,255,0.2)",
                border: "1px solid #aa88ff",
                color: "#aa88ff",
                borderRadius: 2,
                cursor: "pointer",
                fontWeight: 600,
              }}
            >
              {genMutation.isPending ? "GENERATING…" : "⚡ GENERATE CODE"}
            </button>
          </div>

          {/* Code output */}
          <div style={{ padding: 14 }}>
            {!result && !genMutation.isPending && (
              <div style={{ fontSize: 9, color: "#3a5a50", padding: 20, textAlign: "center", lineHeight: 1.8 }}>
                Configure your target platform and parameters, then generate runnable Python code. The code faithfully implements the AMISGC attractor field with the same Phi/PU/S_C metrics and Existence Gate logic as the browser simulation.
              </div>
            )}

            {genMutation.isPending && (
              <div style={{ fontSize: 9, color: "#aa88ff", padding: 20, textAlign: "center" }}>Generating…</div>
            )}

            {result && (
              <>
                {/* Result header */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <div>
                    <div style={{ fontSize: 9, color: "#aa88ff", letterSpacing: 1 }}>{result.filename}</div>
                    <div style={{ fontSize: 7, color: "#5a7a70", marginTop: 2 }}>{result.estimatedSpeedup}</div>
                  </div>
                  <button
                    onClick={() => downloadFile(result.filename, result.code)}
                    style={{ padding: "5px 10px", fontSize: 8, letterSpacing: 1.5, background: "rgba(170,136,255,0.2)", border: "1px solid #aa88ff", color: "#aa88ff", borderRadius: 2, cursor: "pointer" }}
                  >
                    ⎘ DOWNLOAD
                  </button>
                </div>

                {/* Run instructions */}
                <div style={{ marginBottom: 10, padding: "6px 8px", background: "rgba(0,0,0,0.3)", border: "1px solid #0f4a3a", borderRadius: 2 }}>
                  <div style={{ fontSize: 7, color: "#3aaf6a", letterSpacing: 1, marginBottom: 3 }}>RUN INSTRUCTIONS</div>
                  <pre style={{ fontSize: 8, color: "#9aaaa6", margin: 0, whiteSpace: "pre-wrap" }}>
                    {result.runInstructions}
                  </pre>
                </div>

                {/* Code preview */}
                <div style={{ position: "relative" }}>
                  <pre
                    style={{
                      fontSize: 8,
                      color: "#7a9a90",
                      background: "rgba(0,0,0,0.4)",
                      border: "1px solid #0a1a14",
                      borderRadius: 2,
                      padding: 10,
                      overflowX: "auto",
                      maxHeight: 480,
                      overflowY: "auto",
                      margin: 0,
                      lineHeight: 1.5,
                      fontFamily: "monospace",
                      whiteSpace: "pre",
                    }}
                  >
                    {result.code}
                  </pre>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
