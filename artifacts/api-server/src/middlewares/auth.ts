import type { Request, Response, NextFunction } from "express";

// Env-gated Bearer auth. If AMISGC_TOKEN is unset, the middleware is a no-op
// (zero-config local development). When set, every mutating request (POST/PUT/
// PATCH/DELETE) under /api must present `Authorization: Bearer <token>`.
// SSE GET endpoints stay public so the dashboard can stream without sending
// custom headers via EventSource.
export function bearerAuth(req: Request, res: Response, next: NextFunction): void {
  const token = process.env["AMISGC_TOKEN"];
  if (!token) {
    next();
    return;
  }
  // Only guard mutations + the health route stays open.
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    next();
    return;
  }
  const header = req.header("authorization") ?? req.header("Authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!m || m[1] !== token) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  next();
}
