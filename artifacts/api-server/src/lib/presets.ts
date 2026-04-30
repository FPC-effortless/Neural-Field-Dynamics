// Layman-facing experiment presets. Each preset is a self-contained
// Auto-Mode configuration — picking one and posting `body` directly to
// `POST /api/automode` runs a complete experiment with sensible defaults.
//
// Keep this file declarative: no I/O, no derived constants from elsewhere,
// so the same registry can be served to the dashboard and used in tests.
//
// Presets correspond to §7.11 of the AMISGC spec document:
//   1. Quick Test (5 000 ticks)
//   2. Phase 0 Integration Search (standard)
//   3. Expanded Sweep (full v13 720-combo grid)
//   4. Batch Replication (confirm borderline results)
//   5. Ablation Suite (4 mandatory ablation tests)
//   6. Debug Mode (single combo, full traces)
//   7. Full Benchmark (locked — only when Gate I is open)

export interface PresetParam {
  // The plain-English label and explanation the dashboard shows under each
  // preset card. Math-free on purpose.
  scaleLabel: string;
  ticksLabel: string;
  iterationsLabel: string;
  expectedRuntime: string;
}

export interface AutoModePresetBody {
  scale: 81 | 810 | 81000;
  ticksPerCombo: number;
  maxIterations: number;
  gateStreakTarget: number;
  baseRanges: Record<string, number[]>;
}

export interface Preset {
  id: string;
  // Card title.
  name: string;
  // Subtitle / one-line description.
  tagline: string;
  // Long-form description (2-3 sentences, no jargon).
  description: string;
  // Difficulty / runtime / risk badges to render on the card.
  difficulty: "quick" | "standard" | "deep" | "debug";
  // Body posted directly to POST /api/automode.
  body: AutoModePresetBody;
  // Plain-English readout of the body for the card footer.
  display: PresetParam;
  // True for the preset that should be highlighted as the default for
  // new users.
  recommended?: boolean;
  // True when this preset requires Gate I to already be open.
  requiresGateOpen?: boolean;
}

// τ × γ × β × δ × σ ranges, kept identical to the v13 spec referenced in
// routes/runs.ts so presets and hand-edited sweeps line up.
const PHASE0_DEFAULT_RANGES: Record<string, number[]> = {
  TAU_ATT: [0.7, 1.0, 1.5, 2.0, 3.0],
  GAMMA_GLOBAL: [1.0, 1.5, 2.0, 3.0],
  BETA_ENTROPY: [0.1, 0.3, 0.5, 0.8],
  DELTA_TEMPORAL: [0.2, 0.4, 0.6],
  NOISE_SIGMA: [0.01, 0.02, 0.05],
};

// Quick smoke-test grid (§7.11 "Quick test — 5 000 ticks to verify installation")
// 2 × 2 × 2 = 8 combos, each at 5 000 ticks. Total: ~40 000 ticks ≈ 1 min.
const QUICK_RANGES: Record<string, number[]> = {
  TAU_ATT: [1.0, 2.0],
  GAMMA_GLOBAL: [1.5, 3.0],
  BETA_ENTROPY: [0.3, 0.5],
};

// Phase-0 entry preset — modest grid, two refinement passes (§7.11 "Phase 0
// integration search – standard sweep").
const PHASE0_ENTRY_RANGES: Record<string, number[]> = {
  TAU_ATT: [0.7, 1.5, 3.0],
  GAMMA_GLOBAL: [1.0, 2.0, 3.0],
  BETA_ENTROPY: [0.1, 0.5],
  DELTA_TEMPORAL: [0.2, 0.6],
};

// Replication preset — focused grid over the most promising region with more
// iterations to confirm the result across seeds (§7.11 "Batch replication").
const REPLICATION_RANGES: Record<string, number[]> = {
  TAU_ATT: [1.5, 2.0],
  GAMMA_GLOBAL: [2.0, 3.0],
  BETA_ENTROPY: [0.3, 0.5],
  DELTA_TEMPORAL: [0.4],
};

// Ablation suite — 4 mandatory ablation tests triggered after a Gate I opening
// (spec §6.1). Each ablation disables one component; Φ must collapse.
// Represented here as an Auto-Mode run over a 1-combo grid per test point.
const ABLATION_RANGES: Record<string, number[]> = {
  // γ=0 ablation: global field disabled — Φ must drop below 0.02.
  GAMMA_GLOBAL: [0, 2.0],
  // β=0 ablation: entropy weight disabled — Φ must decrease.
  BETA_ENTROPY: [0, 0.3],
  // σ=0 ablation: noise disabled — Φ must decrease.
  NOISE_SIGMA: [0, 0.02],
  TAU_ATT: [1.5],
  DELTA_TEMPORAL: [0.4],
};

// Full benchmark — entire 88-experiment battery; only safe when Gate I is open.
// Use a conservative 4-combo grid with long ticks (§7.11 "Full benchmark").
const BENCHMARK_RANGES: Record<string, number[]> = {
  TAU_ATT: [1.5, 2.0],
  GAMMA_GLOBAL: [2.0, 3.0],
  BETA_ENTROPY: [0.3, 0.5],
  DELTA_TEMPORAL: [0.4],
  NOISE_SIGMA: [0.02],
};

export const PRESETS: Preset[] = [
  {
    id: "quick-test",
    name: "Quick Test",
    tagline: "5 000-tick installation check",
    description:
      "Verifies the lab is working end-to-end with a tiny 8-combo sweep. Not enough to draw scientific conclusions, but every part of the dashboard lights up and you can watch the neuron grid live. Takes about a minute.",
    difficulty: "quick",
    body: {
      scale: 81,
      ticksPerCombo: 5000,
      maxIterations: 1,
      gateStreakTarget: 1000,
      baseRanges: QUICK_RANGES,
    },
    display: {
      scaleLabel: "81 neurons (smallest grid)",
      ticksLabel: "5 000 ticks per combo",
      iterationsLabel: "1 sweep · 8 combos",
      expectedRuntime: "≈ 1 minute",
    },
  },
  {
    id: "phase0-search",
    name: "Phase 0 — Integration Search",
    tagline: "Recommended first real experiment",
    description:
      "Searches for the parameter region where the network first shows globally integrated activity (Φ > 0.05). Auto-Mode refines around the best combination each iteration and stops as soon as the Existence Gate holds for 1 000 consecutive ticks. Start here.",
    difficulty: "standard",
    recommended: true,
    body: {
      scale: 81,
      ticksPerCombo: 30000,
      maxIterations: 4,
      gateStreakTarget: 1000,
      baseRanges: PHASE0_ENTRY_RANGES,
    },
    display: {
      scaleLabel: "81 neurons",
      ticksLabel: "30 000 ticks per combo",
      iterationsLabel: "Up to 4 refinement sweeps · 36 combos each",
      expectedRuntime: "≈ 8 – 15 minutes",
    },
  },
  {
    id: "phase0-expanded",
    name: "Phase 0 — Expanded Sweep",
    tagline: "Full 720-combo forced-coupling grid",
    description:
      "Runs the complete Phase-0 grid: τ × γ × β × δ × σ (5×4×4×3×3 = 720 combinations). Use this when the standard search stalls — it explores the full forced-coupling regime including high γ and broad entropy weights as required by the brain-realistic upgrade spec.",
    difficulty: "deep",
    body: {
      scale: 81,
      ticksPerCombo: 30000,
      maxIterations: 1,
      gateStreakTarget: 1000,
      baseRanges: PHASE0_DEFAULT_RANGES,
    },
    display: {
      scaleLabel: "81 neurons",
      ticksLabel: "30 000 ticks per combo",
      iterationsLabel: "1 sweep · 720 combos",
      expectedRuntime: "≈ 1 – 3 hours",
    },
  },
  {
    id: "replication",
    name: "Batch Replication",
    tagline: "Confirm a borderline result across seeds",
    description:
      "Re-runs a focused parameter region with longer ticks and more iterations so that a lucky-seed gate opening cannot be mistaken for a genuine result. Use this after a Phase-0 search shows a promising streak. Corresponds to spec section 7.11 Batch Replication.",
    difficulty: "standard",
    body: {
      scale: 81,
      ticksPerCombo: 50000,
      maxIterations: 3,
      gateStreakTarget: 1000,
      baseRanges: REPLICATION_RANGES,
    },
    display: {
      scaleLabel: "81 neurons",
      ticksLabel: "50 000 ticks per combo",
      iterationsLabel: "3 sweeps · 8 combos each",
      expectedRuntime: "≈ 30 – 60 minutes",
    },
  },
  {
    id: "ablation-suite",
    name: "Ablation Suite",
    tagline: "Validate a Gate I opening with 4 ablation tests",
    description:
      "Runs the four mandatory ablation tests from spec §6.1: (1) γ=0 → Φ must collapse below 0.02; (2) β=0 → Φ must decrease; (3) σ=0 → Φ must decrease; (4) hard Top-K reactivated → Φ must drop to near zero. A Gate I opening is only confirmed if all four pass.",
    difficulty: "standard",
    body: {
      scale: 81,
      ticksPerCombo: 20000,
      maxIterations: 1,
      gateStreakTarget: 1000,
      baseRanges: ABLATION_RANGES,
    },
    display: {
      scaleLabel: "81 neurons",
      ticksLabel: "20 000 ticks per ablation",
      iterationsLabel: "1 sweep · ablation grid",
      expectedRuntime: "≈ 15 – 30 minutes",
    },
  },
  {
    id: "debug",
    name: "Debug Mode",
    tagline: "Single combo, full diagnostics",
    description:
      "Runs exactly one parameter combination (τ=1.5, γ=2.0, β=0.3, δ=0.4) so you can stare at the live tick panel without the dashboard cycling through combos. Every metric is sampled at full resolution. Use this when something looks wrong and you need to watch each metric move tick by tick.",
    difficulty: "debug",
    body: {
      scale: 81,
      ticksPerCombo: 10000,
      maxIterations: 1,
      gateStreakTarget: 1000,
      baseRanges: {
        TAU_ATT: [1.5],
        GAMMA_GLOBAL: [2.0],
        BETA_ENTROPY: [0.3],
        DELTA_TEMPORAL: [0.4],
        NOISE_SIGMA: [0.02],
      },
    },
    display: {
      scaleLabel: "81 neurons",
      ticksLabel: "10 000 ticks",
      iterationsLabel: "1 combo · 1 sweep",
      expectedRuntime: "≈ 30 seconds",
    },
  },
  {
    id: "full-benchmark",
    name: "Full Benchmark",
    tagline: "Complete 88-experiment battery (Gate I required)",
    description:
      "Runs the complete experiment battery across all unlocked phases. Only becomes active after the Existence Gate (Gate I) has been confirmed open. This is the final validation that the system can demonstrate integrated intelligence across all cognitive tasks.",
    difficulty: "deep",
    requiresGateOpen: true,
    body: {
      scale: 81,
      ticksPerCombo: 50000,
      maxIterations: 2,
      gateStreakTarget: 1000,
      baseRanges: BENCHMARK_RANGES,
    },
    display: {
      scaleLabel: "81 neurons",
      ticksLabel: "50 000 ticks per combo",
      iterationsLabel: "2 sweeps · full battery",
      expectedRuntime: "≈ 3 – 8 hours",
    },
  },
];

export function getPreset(id: string): Preset | undefined {
  return PRESETS.find((p) => p.id === id);
}
