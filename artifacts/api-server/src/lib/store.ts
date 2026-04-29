import {
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";

export interface JsonFileStoreOptions {
  baseDir: string;
  subdir: string;
}

export class JsonFileStore<T extends { id: string }> {
  private dir: string;
  constructor(opts: JsonFileStoreOptions) {
    this.dir = join(opts.baseDir, opts.subdir);
    try {
      mkdirSync(this.dir, { recursive: true });
    } catch {
      /* best-effort */
    }
  }

  put(rec: T): void {
    try {
      writeFileSync(
        join(this.dir, `${rec.id}.json`),
        JSON.stringify(rec, null, 2),
        "utf8",
      );
    } catch {
      /* best-effort */
    }
  }

  get(id: string): T | null {
    try {
      const raw = readFileSync(join(this.dir, `${id}.json`), "utf8");
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  delete(id: string): boolean {
    try {
      unlinkSync(join(this.dir, `${id}.json`));
      return true;
    } catch {
      return false;
    }
  }

  list(): T[] {
    let entries: string[];
    try {
      entries = readdirSync(this.dir);
    } catch {
      return [];
    }
    const out: T[] = [];
    for (const file of entries) {
      if (!file.endsWith(".json")) continue;
      try {
        const raw = readFileSync(join(this.dir, file), "utf8");
        out.push(JSON.parse(raw) as T);
      } catch {
        /* skip corrupt */
      }
    }
    return out;
  }
}

// Single-file JSON store (for things like notes that are a single object)
export class JsonSingletonStore<T> {
  private path: string;
  constructor(baseDir: string, filename: string) {
    try {
      mkdirSync(baseDir, { recursive: true });
    } catch {
      /* best-effort */
    }
    this.path = join(baseDir, filename);
  }

  load(fallback: T): T {
    if (!existsSync(this.path)) return fallback;
    try {
      const raw = readFileSync(this.path, "utf8");
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }

  save(value: T): void {
    try {
      writeFileSync(this.path, JSON.stringify(value, null, 2), "utf8");
    } catch {
      /* best-effort */
    }
  }
}

export const DATA_DIR = join(process.cwd(), "data");
