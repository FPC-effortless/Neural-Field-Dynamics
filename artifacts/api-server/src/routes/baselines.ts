import { Router, type IRouter } from "express";
import { baselinesStore, nextBaselineId } from "../lib/baselinesStore.js";

const router: IRouter = Router();

router.get("/baselines", (_req, res) => {
  const list = baselinesStore.list().sort((a, b) => b.createdAt - a.createdAt);
  res.json({ baselines: list });
});

router.post("/baselines", (req, res) => {
  const body = (req.body ?? {}) as {
    name?: string;
    batchId?: string;
    notes?: string;
  };
  const batchId = String(body.batchId ?? "").trim();
  if (!batchId) {
    res.status(400).json({ error: "batchId required" });
    return;
  }
  const id = nextBaselineId();
  const rec = {
    id,
    name: String(body.name ?? id).slice(0, 64),
    batchId,
    createdAt: Date.now(),
    ...(typeof body.notes === "string" ? { notes: body.notes.slice(0, 500) } : {}),
  };
  baselinesStore.put(rec);
  res.status(201).json(rec);
});

router.delete("/baselines/:id", (req, res) => {
  const id = String(req.params.id ?? "");
  const ok = baselinesStore.delete(id);
  if (!ok) {
    res.status(404).json({ error: "not found" });
    return;
  }
  res.json({ id, removed: true });
});

export default router;
