import { Router, type IRouter } from "express";
import { notesStore, type ExperimentNote } from "../lib/notesStore.js";

const router: IRouter = Router();

router.get("/notes", (_req, res) => {
  res.json({ notes: notesStore.all() });
});

router.get("/notes/:experimentId", (req, res) => {
  const id = String(req.params.experimentId ?? "");
  const note = notesStore.get(id);
  if (!note) {
    res.status(404).json({ error: "not found" });
    return;
  }
  res.json({ experimentId: id, ...note });
});

router.put("/notes/:experimentId", (req, res) => {
  const id = String(req.params.experimentId ?? "");
  if (!id) {
    res.status(400).json({ error: "experimentId required" });
    return;
  }
  const body = (req.body ?? {}) as Partial<ExperimentNote>;
  const text = typeof body.text === "string" ? body.text.slice(0, 4000) : undefined;
  const pinned = typeof body.pinned === "boolean" ? body.pinned : undefined;
  const tags = Array.isArray(body.tags)
    ? body.tags
        .filter((t) => typeof t === "string")
        .map((t) => t.slice(0, 32))
        .slice(0, 16)
    : undefined;
  const patch: Partial<ExperimentNote> = {};
  if (text !== undefined) patch.text = text;
  if (pinned !== undefined) patch.pinned = pinned;
  if (tags !== undefined) patch.tags = tags;
  const next = notesStore.set(id, patch);
  res.json({ experimentId: id, ...next });
});

router.delete("/notes/:experimentId", (req, res) => {
  const id = String(req.params.experimentId ?? "");
  const removed = notesStore.remove(id);
  if (!removed) {
    res.status(404).json({ error: "not found" });
    return;
  }
  res.json({ experimentId: id, removed: true });
});

export default router;
