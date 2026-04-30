// Layman-facing experiment presets. Each preset is a self-contained
// Auto-Mode configuration — picking one and posting `body` directly to
// `POST /api/automode` runs a complete experiment with sensible defaults.
//
// Keep this file declarative: no I/O, no derived constants from elsewhere,
// so the same registry can be served to the dashboard and used in tests.

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

// Small smoke-test grid for "Quick Test" — 2 × 2 × 2 = 8 combos in ≤ 1 min.
const QUICK_RANGES: Record<string, number[]> = {
  TAU_ATT: [1.0, 2.0],
  GAMMA_GLOBAL: [1.5, 3.0],
  BETA_ENTROPY: [0.3, 0.5],
};

// Phase-0 entry preset — modest grid, two refinement passes.
const PHASE0_ENTRY_RANGES: Record<string, number[]> = {
  TAU_ATT: [0.7, 1.5, 3.0],
  GAMMA_GLOBAL: [1.0, 2.0, 3.0],
  BETA_ENTROPY: [0.1, 0.5],
  DELTA_TEMPORAL: [0.2, 0.6],
};

// Replication preset — same focused grid as the entry, but more iterations
// so consistent winners stand out.
const REPLICATION_RANGES: Record<string, number[]> = {
  TAU_ATT: [1.5, 2.0],
  GAMMA_GLOBAL: [2.0, 3.0],
  BETA_ENTROPY: [0.3, 0.5],
  DELTA_TEMPORAL: [0.4],
};

export const PRESETS: Preset[] = [
  {
    id: "quick-test",
    name: "Quick Test",
    tagline: "60-second smoke test",
    description:
      "Runs a tiny 8-combo sweep so you can confirm the lab is working end-to-end. Not enough to draw scientific conclusions, but it lights up every part of the dashboard.",
    difficulty: "quick",
    body: {
      scale: 81,
      ticksPerCombo: 3000,
      maxIterations: 1,
      gateStreakTarget: 1000,
      baseRanges: QUICK_RANGES,
    },
    display: {
      scaleLabel: "81 neurons (smallest grid)",
      ticksLabel: "3 000 ticks per combo",
      iterationsLabel: "1 sweep, 8 combos",
      expectedRuntime: "≈ 1 minute",
    },
  },
  {
    id: "phase0-search",
    name: "Phase 0 — Integration Search",
    tagline: "Recommended first real experiment",
    description:
      "Looks for the parameter region where the network first shows integrated activity. Auto-refines around the best combo each iteration, and stops as soon as the Existence Gate holds for 1 000 ticks.",
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
    tagline: "The full v13 grid",
    description:
      "Runs the complete 720-combination Phase-0 grid in a single iteration. Use this when the entry preset stalls — it explores stronger global coupling, sharper attention, and more temporal coherence.",
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
    name: "Replication Set",
    tagline: "Confirm a borderline result",
    description:
      "Re-runs a focused parameter region with longer ticks and more iterations, so a lucky-seed gate opening can't fool you. Use this after a Phase-0 search shows promise.",
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
    id: "debug",
    name: "Debug Mode",
    tagline: "Single combo, full traces",
    description:
      "Runs exactly one parameter combination so you can stare at the live tick panel without the dashboard cycling through combos. Useful when something looks wrong and you want to watch every metric move.",
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
      iterationsLabel: "1 combo, 1 sweep",
      expectedRuntime: "≈ 30 seconds",
    },
  },
];

export function getPreset(id: string): Preset | undefined {
  return PRESETS.find((p) => p.id === id);
}
