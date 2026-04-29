import { Router, type IRouter } from "express";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const router: IRouter = Router();

// Resolve a coarse package version from artifacts/api-server/package.json.
// Git SHA / build time are best-effort env-driven so deployments can stamp
// them without code changes.
const PKG_PATH = join(process.cwd(), "package.json");
let pkgVersion = "0.0.0";
try {
  if (existsSync(PKG_PATH)) {
    const j = JSON.parse(readFileSync(PKG_PATH, "utf8")) as { version?: string };
    if (j.version) pkgVersion = j.version;
  }
} catch {
  /* ignore */
}

const startedAt = Date.now();

router.get("/version", (_req, res) => {
  res.json({
    version: pkgVersion,
    gitSha: process.env["GIT_SHA"] ?? null,
    buildTime: process.env["BUILD_TIME"] ?? null,
    nodeEnv: process.env["NODE_ENV"] ?? "development",
    startedAt,
    uptimeMs: Date.now() - startedAt,
    authRequired: Boolean(process.env["AMISGC_TOKEN"]),
  });
});

export default router;
