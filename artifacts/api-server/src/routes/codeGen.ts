import { Router, type IRouter } from "express";
import { generateCode, type CodeTarget } from "../lib/codeGenerator.js";
import { ABSTRACTIONS, composeAbstractions, type AbstractionId } from "../lib/abstractions.js";

const router: IRouter = Router();

// GET /api/abstractions — list all available abstraction layers
router.get("/abstractions", (_req, res) => {
  res.json({
    abstractions: ABSTRACTIONS.map((a) => ({
      id: a.id,
      name: a.name,
      description: a.description,
      biologicalJustification: a.biologicalJustification,
      status: a.status,
      impact: a.impact,
      minPhiRequired: a.minPhiRequired,
    })),
  });
});

// POST /api/codegen — generate downloadable code for a given target
// Body: { target: "cpu"|"gpu"|"neuromorphic", params, scale, ticksPerCombo, experimentLabel }
router.post("/codegen", (req, res) => {
  const body = (req.body ?? {}) as {
    target?: CodeTarget;
    params?: Record<string, number | boolean | string>;
    scale?: 81 | 810 | 81000;
    ticksPerCombo?: number;
    experimentLabel?: string;
  };

  const target = body.target ?? "cpu";
  if (!["cpu", "gpu", "neuromorphic"].includes(target)) {
    res.status(400).json({ error: "target must be cpu, gpu, or neuromorphic" });
    return;
  }

  const params = body.params ?? {
    TAU_ATT: 1.5,
    GAMMA_GLOBAL: 2.0,
    BETA_ENTROPY: 0.3,
    DELTA_TEMPORAL: 0.4,
    NOISE_SIGMA: 0.01,
  };

  const result = generateCode({
    target,
    params,
    scale: body.scale ?? 81,
    ticksPerCombo: body.ticksPerCombo ?? 30000,
    experimentLabel: body.experimentLabel ?? "amisgc-experiment",
  });

  res.json(result);
});

// POST /api/abstractions/preview — preview the parameter patch from composing abstractions
router.post("/abstractions/preview", (req, res) => {
  const body = (req.body ?? {}) as {
    abstractionIds?: string[];
    baseRanges?: Record<string, number[]>;
    scale?: 81 | 810 | 81000;
  };

  const ids = (body.abstractionIds ?? []) as AbstractionId[];

  if (ids.length === 0) {
    res.json({ message: "No abstractions selected", patch: null, combinedImpact: null });
    return;
  }

  const baseRanges = body.baseRanges ?? {
    TAU_ATT: [1.0, 1.5, 2.0],
    GAMMA_GLOBAL: [1.5, 2.0, 3.0],
    BETA_ENTROPY: [0.3, 0.5],
    DELTA_TEMPORAL: [0.4],
  };

  const result = composeAbstractions(ids, baseRanges, body.scale ?? 81);
  res.json(result);
});

export default router;
