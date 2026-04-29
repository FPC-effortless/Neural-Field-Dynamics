import { JsonSingletonStore, DATA_DIR } from "./store.js";

export interface ExperimentNote {
  text: string;
  tags: string[];
  pinned: boolean;
  updatedAt: number;
}

export interface NotesFile {
  notes: Record<string, ExperimentNote>;
}

const store = new JsonSingletonStore<NotesFile>(DATA_DIR, "notes.json");
let cache: NotesFile = store.load({ notes: {} });

export const notesStore = {
  all(): Record<string, ExperimentNote> {
    return { ...cache.notes };
  },
  get(experimentId: string): ExperimentNote | null {
    return cache.notes[experimentId] ?? null;
  },
  set(experimentId: string, patch: Partial<ExperimentNote>): ExperimentNote {
    const existing: ExperimentNote = cache.notes[experimentId] ?? {
      text: "",
      tags: [],
      pinned: false,
      updatedAt: 0,
    };
    const next: ExperimentNote = {
      text: patch.text ?? existing.text,
      tags: Array.isArray(patch.tags) ? patch.tags : existing.tags,
      pinned: typeof patch.pinned === "boolean" ? patch.pinned : existing.pinned,
      updatedAt: Date.now(),
    };
    cache.notes[experimentId] = next;
    store.save(cache);
    return next;
  },
  remove(experimentId: string): boolean {
    if (!(experimentId in cache.notes)) return false;
    delete cache.notes[experimentId];
    store.save(cache);
    return true;
  },
};
