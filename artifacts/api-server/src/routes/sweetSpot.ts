import { Router, type IRouter } from "express";
import { findSweetSpots, type SweetSpotConfig } from "../lib/sweetSpot.js";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const router: IRouter = Router();

const SWEEPS_DIR = join(process.cwd(), "data", "sweeps");

function loadSweep(id: string): { combos: unknown[] } | null {
  try {
    const raw = readFileSync(join(SWEEPS_DIR, `${id}.json`), "utf8");
    return JSON.parse(raw) as { combos: unknown[] };
  } catch {
    return null;
  }
}

function listSweepIds(): string[] {
  try {
    return readdirSync(SWEEPS_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(".json", ""));
  } catch {
    return [];
  }
}

// POST /api/sweet-spots
// Analyses the combos of an existing sweep and returns the Pareto front.
// Body: { sweepId?: string, objectives?: string[], constraints?: object, weights?: object }
// If sweepId is omitted, uses the most recently modified sweep.
router.post("/sweet-spots", (req, res) => {
  const body = (req.body ?? {}) as {
    sweepId?: string;
    objectives?: string[];
    constraints?: Record<string, number>;
    weights?: Record<string, number>;
  };

  const objectives = (body.objectives ?? ["phi", "pu", "sc", "car"]) as SweetSpotConfig["objectives"];
  const constraints = {
    minPhi: body.constraints?.["minPhi"] ?? 0,
    minPU: body.constraints?.["minPU"] ?? 0,
    minSC: body.constraints?.["minSC"] ?? 0,
    minGateStreak: body.constraints?.["minGateStreak"] ?? 0,
  };
  const weights = (body.weights ?? {}) as SweetSpotConfig["weights"];

  // Resolve sweep ID
  let sweepId = body.sweepId;
  if (!sweepId) {
    const ids = listSweepIds();
    if (ids.length === 0) {
      res.status(404).json({ error: "No sweeps found. Run a sweep first." });
      return;
    }
    // Use the lexicographically largest id (typically most recent)
    sweepId = ids.sort().at(-1)!;
  }

  const sweep = loadSweep(sweepId);
  if (!sweep) {
    res.status(404).json({ error: `Sweep '${sweepId}' not found.` });
    return;
  }

  const combos = sweep.combos as Parameters<typeof findSweetSpots>[0];
  const result = findSweetSpots(combos, { objectives, constraints, weights });

  res.json({
    sweepId,
    ...result,
    paretoFront: result.paretoFront.map((e) => ({
      ...e,
      // Drop heavy combo internals — only expose what the UI needs
      combo: {
        index: e.combo.index,
        params: e.combo.params,
        finalPhi: e.combo.finalPhi,
        finalPU: e.combo.finalPU,
        finalSC: e.combo.finalSC,
        finalCAR: e.combo.finalCAR,
        gateStreak: e.combo.gateStreak,
        gateOpened: e.combo.gateOpened,
      },
    })),
    topByScore: result.topByScore.map((e) => ({
      score: e.score,
      paretoFront: e.paretoFront,
      summary: e.summary,
      combo: {
        index: e.combo.index,
        params: e.combo.params,
        finalPhi: e.combo.finalPhi,
        finalPU: e.combo.finalPU,
        finalSC: e.combo.finalSC,
        finalCAR: e.combo.finalCAR,
        gateStreak: e.combo.gateStreak,
        gateOpened: e.combo.gateOpened,
      },
    })),
  });
});

// GET /api/sweet-spots/sweeps — list sweep IDs available for analysis
router.get("/sweet-spots/sweeps", (_req, res) => {
  res.json({ sweepIds: listSweepIds() });
});

export default router;
