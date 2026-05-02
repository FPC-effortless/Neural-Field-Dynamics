import { Router, type IRouter } from "express";
import { HYPOTHESES } from "../lib/hypotheses.js";

const router: IRouter = Router();

// GET /api/hypotheses — list all 7 research hypotheses with their status
// and sweep configs (when available).
router.get("/hypotheses", (_req, res) => {
  res.json({ hypotheses: HYPOTHESES });
});

// GET /api/hypotheses/:id — return a single hypothesis by id.
router.get("/hypotheses/:id", (req, res) => {
  const h = HYPOTHESES.find((x) => x.id === req.params["id"]);
  if (!h) {
    res.status(404).json({ error: "Hypothesis not found" });
    return;
  }
  res.json(h);
});

export default router;
