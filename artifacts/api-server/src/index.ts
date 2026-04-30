import app from "./app";
import { logger } from "./lib/logger";
import { markRunningWorkInterrupted } from "./routes/runs";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = app.listen(port, () => {
  logger.info({ port }, "Server listening");
});

server.on("error", (err) => {
  logger.error({ err }, "Error listening on port");
  process.exit(1);
});

// Graceful shutdown: mark any in-flight batches/sweeps as interrupted, persist
// them, then close the HTTP server. Force-exit after 8s so workflow restarts
// don't hang on lingering SSE clients.
let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    const { batches: bN, sweeps: sN } = markRunningWorkInterrupted();
    logger.info({ signal, batches: bN, sweeps: sN }, "graceful shutdown");
  } catch (err) {
    logger.error({ err }, "shutdown persistence failed");
  }
  server.close(() => {
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 8000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// Keep the process alive on unexpected errors. Individual run/sweep/batch
// promises all have their own .catch() handlers; these backstops are for
// anything that slips through (e.g. a third-party callback that throws).
process.on("uncaughtException", (err) => {
  logger.error({ err }, "uncaughtException — continuing");
});
process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "unhandledRejection — continuing");
});
