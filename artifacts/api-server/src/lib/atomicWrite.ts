import { mkdirSync, renameSync, writeFileSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";

// Crash-safe write: serialise to a sibling temp file in the same directory,
// then `rename` over the destination. POSIX guarantees rename is atomic
// within a single filesystem, so a power-loss / SIGKILL during the write
// can never leave a half-written JSON file in place — the destination
// either reflects the previous successful write or the new one.
//
// Best-effort: any IO error is swallowed (matches the old writeFileSync
// pattern used across the persistence layer); the in-memory state is the
// source of truth, disk is just for restart recovery.
export function writeFileAtomicSync(path: string, data: string): void {
  const dir = dirname(path);
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    /* best-effort */
  }
  // Unique-per-process tmp suffix avoids contention if two callers race on
  // the same path. The rename will pick whichever finished last; both inputs
  // are valid snapshots so either is fine.
  const tmp = `${path}.${process.pid}.${Date.now().toString(36)}.tmp`;
  try {
    writeFileSync(tmp, data, "utf8");
    renameSync(tmp, path);
  } catch {
    try {
      unlinkSync(tmp);
    } catch {
      /* */
    }
  }
}
