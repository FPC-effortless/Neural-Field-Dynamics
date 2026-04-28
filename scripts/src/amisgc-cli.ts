#!/usr/bin/env tsx
/**
 * AMISGC CLI — runs experiments and the ARC mock benchmark from the terminal.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts amisgc list
 *   pnpm --filter @workspace/scripts amisgc run <experimentId> [--scale=81|810|81000] [--ticks=N]
 *   pnpm --filter @workspace/scripts amisgc arc [--scale=81] [--tasks=5] [--train=600] [--test=3]
 *   pnpm --filter @workspace/scripts amisgc all [--scale=81]   # run every experiment
 */
import {
  startRun,
  ALL_EXPERIMENTS,
  PHASE_GROUPS,
  runArcBenchmark,
  type Stats,
  type RunSampleEvent,
  type RunCompleteEvent,
  type RunStart,
  type ArcSample,
} from "@workspace/amisgc-core";

type ScaleKey = 81 | 810 | 81000;

interface CliArgs {
  cmd: string;
  positional: string[];
  flags: Record<string, string>;
}

function parseArgs(): CliArgs {
  const argv = process.argv.slice(2);
  const flags: Record<string, string> = {};
  const positional: string[] = [];
  for (const a of argv) {
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=");
      flags[k] = v ?? "true";
    } else {
      positional.push(a);
    }
  }
  return { cmd: positional[0] ?? "list", positional: positional.slice(1), flags };
}

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  magenta: "\x1b[35m",
  red: "\x1b[31m",
  blue: "\x1b[34m",
};

function color(text: string, c: keyof typeof ANSI): string {
  if (!process.stdout.isTTY) return text;
  return `${ANSI[c]}${text}${ANSI.reset}`;
}

function listExperiments(): void {
  console.log(color("AMISGC EXPERIMENT BATTERY", "bold"));
  console.log(color("─".repeat(80), "dim"));
  for (const g of PHASE_GROUPS) {
    console.log(`\n${color(g.phase, "magenta")} ${color(g.label, "dim")}`);
    for (const exp of g.experiments) {
      const dir = exp.targetDir === 1 ? "≥" : "≤";
      console.log(
        `  ${color(exp.id.padEnd(10), "cyan")} ${exp.name.padEnd(36)} ${color(
          `${exp.metric} ${dir} ${exp.targetVal}`,
          "yellow",
        )}  ${color(`${exp.ticks}t`, "dim")}`,
      );
    }
  }
  console.log();
  console.log(color("USAGE:", "bold"));
  console.log("  amisgc run <id> [--scale=81|810|81000] [--ticks=N]");
  console.log("  amisgc arc [--scale=81] [--tasks=5] [--train=600] [--test=3]");
  console.log("  amisgc all [--scale=81]");
}

function progressBar(done: number, total: number, width = 24): string {
  const pct = total > 0 ? Math.min(1, done / total) : 0;
  const filled = Math.floor(pct * width);
  return "[" + "█".repeat(filled) + " ".repeat(width - filled) + `] ${(pct * 100).toFixed(1).padStart(5)}%`;
}

function fmtStats(s: Stats): string {
  return [
    color(`J*=${s.J_star.toFixed(3)}`, "cyan"),
    color(`Φ=${s.networkPhi.toFixed(3)}`, "magenta"),
    color(`MI=${s.networkMI.toFixed(3)}`, "yellow"),
    color(`H=${s.avgH.toFixed(3)}`, "green"),
    color(`ATP=${s.avgAtp.toFixed(1)}`, "yellow"),
    color(s.phaseRegion.padEnd(11), "blue"),
  ].join(" ");
}

async function runOne(experimentId: string, scale: ScaleKey, ticks?: number): Promise<boolean> {
  return new Promise<boolean>((resolve, reject) => {
    let lastSampleAt = 0;
    let totalTicks = 0;
    const handle = startRun({
      experimentId,
      scale,
      ticks,
      sampleEvery: scale === 81 ? 25 : scale === 810 ? 50 : 200,
      onStart: (info: RunStart) => {
        totalTicks = info.ticks;
        console.log(
          `\n${color(experimentId, "bold")} ${color(`(N=${info.N}, ticks=${info.ticks})`, "dim")}`,
        );
        if (info.hypothesis) console.log(color(`  H: ${info.hypothesis}`, "dim"));
      },
      onSample: (e: RunSampleEvent) => {
        const now = Date.now();
        if (now - lastSampleAt > 250) {
          process.stdout.write(
            `\r  ${progressBar(e.t, totalTicks)}  ${fmtStats(e.stats)}    `,
          );
          lastSampleAt = now;
        }
      },
      onComplete: (final: RunCompleteEvent) => {
        process.stdout.write("\r" + " ".repeat(120) + "\r");
        const verdict = final.passed
          ? color("✓ CONFIRMED", "green")
          : color("✗ REJECTED", "red");
        console.log(
          `  ${verdict}  ${color(`${final.metric}=${(final.measured ?? 0).toFixed(3)} / ${final.target}`, "yellow")}  ${color(`${(final.durationMs / 1000).toFixed(1)}s`, "dim")}`,
        );
        resolve(final.passed);
      },
      onError: (err: Error) => {
        console.error(color(`  ! error: ${err.message}`, "red"));
        reject(err);
      },
    });
    process.on("SIGINT", () => {
      handle.cancel();
      console.log(color("\n^C — cancelling run", "red"));
    });
  });
}

async function main(): Promise<void> {
  const { cmd, positional, flags } = parseArgs();
  const scale = (flags.scale ? Number(flags.scale) : 81) as ScaleKey;
  if (![81, 810, 81000].includes(scale)) {
    console.error(color(`invalid scale ${scale}`, "red"));
    process.exit(2);
  }
  const ticks = flags.ticks ? Number(flags.ticks) : undefined;

  if (cmd === "list" || cmd === "ls") {
    listExperiments();
    return;
  }
  if (cmd === "run") {
    const id = positional[0];
    if (!id) {
      console.error(color("usage: amisgc run <experimentId>", "red"));
      process.exit(2);
    }
    const passed = await runOne(id, scale, ticks);
    process.exit(passed ? 0 : 1);
  }
  if (cmd === "all") {
    let pass = 0;
    let fail = 0;
    for (const exp of ALL_EXPERIMENTS) {
      try {
        const ok = await runOne(exp.id, scale, ticks);
        ok ? pass++ : fail++;
      } catch {
        fail++;
      }
    }
    console.log(
      `\n${color("FINAL", "bold")} ${color(`✓ ${pass} confirmed`, "green")}  ${color(`✗ ${fail} rejected`, "red")}`,
    );
    process.exit(fail > 0 ? 1 : 0);
  }
  if (cmd === "arc") {
    const numTasks = flags.tasks ? Number(flags.tasks) : 5;
    const trainTicksPerTask = flags.train ? Number(flags.train) : 600;
    const testInputs = flags.test ? Number(flags.test) : 3;
    console.log(
      `${color("ARC MOCK BENCHMARK", "bold")} ${color(`(N=${scale}, ${numTasks} tasks, ${trainTicksPerTask} train ticks, ${testInputs} test inputs)`, "dim")}`,
    );
    const result = await runArcBenchmark({
      scale,
      numTasks,
      trainTicksPerTask,
      testInputs,
      onProgress: (done: number, total: number, sample?: ArcSample) => {
        if (sample) {
          process.stdout.write(
            `\n  [${done}/${total}] ${sample.correct ? color("✓", "green") : color("✗", "red")} ${color(sample.transformName, "magenta")} [${sample.input.join("")}] → [${sample.predicted.join("")}] sim ${sample.similarity.toFixed(2)}`,
          );
        }
      },
    });
    const pct = (result.solveRate * 100).toFixed(1);
    console.log(
      `\n\n${color("ARC RESULT", "bold")} ${color(`${result.correct}/${result.total} (${pct}%)`, "yellow")}`,
    );
    process.exit(result.correct > 0 ? 0 : 1);
  }
  console.error(color(`unknown command: ${cmd}`, "red"));
  listExperiments();
  process.exit(2);
}

main().catch((err) => {
  console.error(color(`fatal: ${err?.stack ?? err}`, "red"));
  process.exit(1);
});
