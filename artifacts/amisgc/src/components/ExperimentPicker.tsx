import { memo, useState } from "react";
import { Panel, Pill } from "./Panel";
import { PHCOL } from "../lib/colors";
import type { ExperimentSummary, PhaseGroup, CreateRunRequest } from "../lib/api";

interface ExperimentPickerProps {
  experiments: ExperimentSummary[] | undefined;
  groups: PhaseGroup[] | undefined;
  onLaunch: (req: CreateRunRequest) => void;
  launching: boolean;
}

export const ExperimentPicker = memo(function ExperimentPicker({
  experiments,
  groups,
  onLaunch,
  launching,
}: ExperimentPickerProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const [scale, setScale] = useState<81 | 810 | 81000>(81);
  const [overrideTicks, setOverrideTicks] = useState<string>("");
  // Optional neuron-count override. Empty string ⇒ use the scale enum above.
  const [overrideNeurons, setOverrideNeurons] = useState<string>("");

  const expById = new Map((experiments ?? []).map((e) => [e.id, e]));

  const buildLaunchReq = (extra: Partial<CreateRunRequest> = {}): CreateRunRequest => {
    const neuronsNum = overrideNeurons.trim() === "" ? undefined : Number(overrideNeurons);
    const req: CreateRunRequest = { scale, ...extra };
    if (overrideTicks) req.ticks = Number(overrideTicks);
    if (typeof neuronsNum === "number" && Number.isFinite(neuronsNum)) {
      req.neurons = neuronsNum;
    }
    return req;
  };
  const sel = selected ? expById.get(selected) : undefined;

  return (
    <Panel title="EXPERIMENT BATTERY" accent="#0f4a3a">
      <div className="space-y-2">
        {(groups ?? []).map((g) => (
          <div key={g.phase} className="space-y-1">
            <div className="flex items-center gap-2">
              <Pill color={PHCOL[g.phase] ?? "#0f4a3a"}>{g.phase}</Pill>
              <span style={{ fontSize: 7, color: "#1a3a30", letterSpacing: 1 }}>
                {g.label}
              </span>
            </div>
            <div className="flex flex-wrap gap-1">
              {g.experimentIds.map((id) => {
                const exp = expById.get(id);
                if (!exp) return null;
                const active = id === selected;
                const color = PHCOL[g.phase] ?? "#0f4a3a";
                return (
                  <button
                    key={id}
                    onClick={() => setSelected(id)}
                    title={exp.desc}
                    style={{
                      background: active ? color : "rgba(0,0,0,0.4)",
                      border: `1px solid ${color}`,
                      color: active ? "#020c16" : color,
                      padding: "3px 6px",
                      borderRadius: 2,
                      fontFamily: "var(--font-mono)",
                      fontSize: 8,
                      letterSpacing: 1,
                    }}
                  >
                    {exp.id}
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        {sel && (
          <div
            className="fade-in"
            style={{
              marginTop: 8,
              padding: 8,
              background: "rgba(0,0,0,0.4)",
              border: `1px solid ${PHCOL[sel.phase] ?? "#0f4a3a"}`,
              borderRadius: 2,
            }}
          >
            <div
              style={{
                fontSize: 9,
                color: PHCOL[sel.phase] ?? "#0f4a3a",
                letterSpacing: 2,
                marginBottom: 2,
              }}
            >
              {sel.id} · {sel.name}
            </div>
            <div style={{ fontSize: 9, color: "#2a5a40", marginBottom: 4, lineHeight: 1.3 }}>
              {sel.desc}
            </div>
            <div
              style={{
                fontSize: 8,
                color: "#0d7060",
                marginBottom: 4,
                fontStyle: "italic",
                lineHeight: 1.4,
              }}
            >
              "{sel.hypothesis}"
            </div>
            <div style={{ fontSize: 8, color: "#1a3a30", letterSpacing: 1 }}>
              METRIC: <span style={{ color: "#00ffc4" }}>{sel.metric}</span>{" "}
              {sel.targetDir === 1 ? "≥" : "≤"}{" "}
              <span style={{ color: "#00ffc4" }}>{sel.targetVal}</span> · TICKS:{" "}
              <span style={{ color: "#00ffc4" }}>{sel.ticks}</span>
            </div>

            <div className="flex flex-wrap items-center gap-2 mt-3">
              <div className="flex items-center gap-1">
                <span style={{ fontSize: 7, color: "#1a3a30", letterSpacing: 1 }}>SCALE</span>
                <select
                  value={scale}
                  onChange={(e) =>
                    setScale(Number(e.target.value) as 81 | 810 | 81000)
                  }
                  style={{
                    background: "#020c16",
                    color: "#00ffc4",
                    border: "1px solid #0f4a3a",
                    fontSize: 9,
                    padding: "2px 4px",
                  }}
                >
                  <option value={81}>81</option>
                  <option value={810}>810</option>
                  <option value={81000}>81000</option>
                </select>
              </div>
              <div className="flex items-center gap-1">
                <span
                  style={{ fontSize: 7, color: "#1a3a30", letterSpacing: 1 }}
                  title="Optional override of total neuron count. Clamped to [9, 102 400]. Takes precedence over SCALE."
                >
                  NEURONS
                </span>
                <input
                  type="number"
                  min={9}
                  max={102400}
                  step={1}
                  value={overrideNeurons}
                  placeholder="auto"
                  onChange={(e) => setOverrideNeurons(e.target.value)}
                  style={{
                    background: "#020c16",
                    color: "#00ffc4",
                    border: "1px solid #0f4a3a",
                    fontSize: 9,
                    padding: "2px 4px",
                    width: 80,
                  }}
                />
              </div>
              <div className="flex items-center gap-1">
                <span style={{ fontSize: 7, color: "#1a3a30", letterSpacing: 1 }}>TICKS</span>
                <input
                  type="number"
                  value={overrideTicks}
                  placeholder={String(sel.ticks)}
                  onChange={(e) => setOverrideTicks(e.target.value)}
                  style={{
                    background: "#020c16",
                    color: "#00ffc4",
                    border: "1px solid #0f4a3a",
                    fontSize: 9,
                    padding: "2px 4px",
                    width: 70,
                  }}
                />
              </div>
              <button
                disabled={launching}
                onClick={() => onLaunch(buildLaunchReq({ experimentId: sel.id }))}
                style={{
                  background: launching ? "#0a2828" : "#00ffc4",
                  color: launching ? "#0f4a3a" : "#020c16",
                  border: "1px solid #00ffc4",
                  padding: "4px 12px",
                  fontSize: 9,
                  letterSpacing: 2,
                  borderRadius: 2,
                  fontWeight: 700,
                }}
              >
                ▶ LAUNCH
              </button>
            </div>
          </div>
        )}

        <div
          style={{
            marginTop: 8,
            padding: 8,
            background: "rgba(0,0,0,0.3)",
            border: "1px solid #ffcc44",
            borderRadius: 2,
          }}
        >
          <div style={{ fontSize: 9, color: "#ffcc44", letterSpacing: 2, marginBottom: 4 }}>
            ARC MOCK BENCHMARK
          </div>
          <div style={{ fontSize: 8, color: "#2a5a40", marginBottom: 6, lineHeight: 1.4 }}>
            Run a mini ARC-style transformation challenge. The network is trained
            on a few examples per task and evaluated on held-out inputs.
          </div>
          <button
            disabled={launching}
            onClick={() =>
              onLaunch(
                buildLaunchReq({
                  type: "arc",
                  arc: { numTasks: 5, trainTicksPerTask: 600, testInputs: 3 },
                }),
              )
            }
            style={{
              background: launching ? "#0a2828" : "#ffcc44",
              color: launching ? "#0f4a3a" : "#020c16",
              border: "1px solid #ffcc44",
              padding: "4px 12px",
              fontSize: 9,
              letterSpacing: 2,
              borderRadius: 2,
              fontWeight: 700,
            }}
          >
            ▶ ARC RUN
          </button>
        </div>
      </div>
    </Panel>
  );
});
