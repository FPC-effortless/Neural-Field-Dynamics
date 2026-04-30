# AMISGC Research Programme

**Emergent Intelligence from a Metabolically Constrained Predictive Neural Field — v13.0**

A full working research codebase that runs on Kaggle, the web, and the CLI, with the web UI and CLI driving the same simulation engine simultaneously.

## v12 revision — soft globally coupled attractor field

The previous v12 used a hard top-K bottleneck which was unable to clear the **Existence Gate** (`Φ > 0.05 ∧ PU > 0.1 ∧ S_C > 0.1` sustained ≥ 100 ticks). The current revision replaces it with a soft attractor field driven by five named parameters:

| Param | Default | Role |
| --- | --- | --- |
| `TAU_ATT` (τ) | 0.7 | softmax temperature on attention logits |
| `GAMMA_GLOBAL` (γ) | 1.0 | global field coupling strength |
| `BETA_ENTROPY` (β) | 0.2 | entropy gradient pressure — broad-participation reward |
| `DELTA_TEMPORAL` (δ) | 0.3 | temporal coherence (slow EMA pull) |
| `NOISE_SIGMA` (σ) | 0.02 | Box-Muller exploration noise |

`ALPHA_SLOW = 0.02` updates the per-neuron slow apical EMA `a_slow`, and `PU_LAG = 4` is the lag used by the Predictive Utility MI estimator. The legacy top-K path is still reachable by setting `ATTN_MODE = "topk"` for ablation experiments.

Per-tick stats now expose `networkPU`, `networkH_C`, `networkCAR`, `existenceGate ∈ {0,1}`, `gateStreak`, and `failureReason`. Phase 0 (`PH0.gate`, `PH0.topk_baseline`, `PH0.no_global`, `PH0.no_temporal`) sits at the top of the experiment battery.

### Post-B3 revision — coherence-amplifying global field

B3 confirmed that the linear weighted average `G = Σ Cᵢ · aᵢ` was too weak to force consensus: neurons could satisfy the global term by cluster agreement without true global coherence, producing partial coupling without integration. The global field is therefore redefined to amplify consensus:

```
G = Σ Cᵢ · aᵢ²   /   (Σ Cᵢ · aᵢ + ε)
```

Confident, attended cells now weight quadratically: when the field is coherent, strong neurons pull `G` toward their consensus; when fragmented, the denominator shrinks so `(aᵢ − G)` grows, creating pressure to resolve disagreement. The implementation guards the denominator (sign-preserving, `ε = 1e-8`) and clamps `G ∈ [-4, 4]` for numerical safety.

A new diagnostic — **CAR**, the Coherence Amplification Ratio — distinguishes genuine integration from accidental peaks:

```
H(C) = -Σ Cᵢ log(Cᵢ + 1e-8)
CAR  = Φ / (1 - H(C)/Hₘₐₓ + ε),   Hₘₐₓ = log N
```

Large CAR ⇒ Φ is rising because the field genuinely integrates (high participation entropy). Small CAR ⇒ a few neurons synchronised by accident.

The Existence-Gate failure-reason text now reports the metric furthest below its threshold (worst relative gap), so the dashboard `NO-GO` badge points at the primary blocker rather than the first metric checked.

The default `POST /api/sweeps` body has been expanded to the **v13 final Phase-0 sweep — 5 × 4 × 4 × 3 × 3 = 720 combinations**, designed to force strong global coupling:

```json
{
  "TAU_ATT":        [0.7, 1.0, 1.5, 2.0, 3.0],
  "GAMMA_GLOBAL":   [1.0, 1.5, 2.0, 3.0],
  "BETA_ENTROPY":   [0.1, 0.3, 0.5, 0.8],
  "DELTA_TEMPORAL": [0.2, 0.4, 0.6],
  "NOISE_SIGMA":    [0.01, 0.02, 0.05]
}
```

**v13 final-spec deltas:** τ extended to `[0.7, 1.0, 1.5, 2.0, 3.0]`; β extended to `[0.1, 0.3, 0.5, 0.8]`; δ kept at `[0.2, 0.4, 0.6]` (its original coherence range). The Existence-Gate streak target is **1000 consecutive ticks** before the gate is considered "open". Default `ticksPerCombo` is **30 000** (`PHASE0_DEFAULT_TICKS`), and may be manually raised up to `PHASE0_MAX_TICKS = 50000` when a borderline combo shows a clear upward Φ trend in its final 5 000 ticks. The sweep cap is raised from 400 → **1000** combinations (`SWEEP_MAX_COMBOS`) to fit the 720-combo grid plus hand-edited explorations.

### Phase lock — higher phases gated by the Existence Gate (v13)

Spec §3.2 — every experiment in a phase above PH0 is **locked** until the Existence Gate (`Φ > 0.05 ∧ PU > 0.1 ∧ S_C > 0.1`) has held continuously for ≥ 1000 ticks in at least one Phase-0 run. Enforced server-side: `POST /api/runs` and `POST /api/batches` return HTTP `423 Locked` with `{ error: "phase_locked", lockedExperimentIds, phaseStatus }` when a request includes any locked experiment. Lock state lives in `data/phase-status.json`, persisted across restarts. Endpoints:

- `GET /api/phase-status` — current state including `gateStreakRequired`
- `POST /api/phase-status/override` — body `{ enabled: boolean }`. Bypasses the lock for debugging; does NOT count as the gate having opened.
- `POST /api/phase-status/reset` — wipes the unlock back to its initial state.

`GET /api/experiments` now also tags each experiment / phase group with `locked: boolean` so the UI can grey-out blocked phases without making a second call. The Phase 0 sweep / Auto-Mode / single-PH0 run paths automatically promote the unlock as soon as any qualifying gate streak is observed (see `maybeMarkGateOpened` in `phaseLockStore.ts`). The dashboard renders a **`PhaseLockBanner`** at the top of the page (red while locked, green once opened) with one-click `MANUAL OVERRIDE` and `RESET` controls.

### Six-category failure classifier (v13)

Spec §5.1 — when the Existence Gate is closed, `Stats.failureReason` now reports the *root cause* rather than which gate metric is failing. The classifier picks the worst of six candidates each tick (after a 200-tick burn-in to avoid transients):

| Cause | Triggered by |
| --- | --- |
| `Low Participation` | `H_C / log(N) < 0.4` (attention concentrated on too few neurons) |
| `Dominance Collapse` | inferred max-C > 0.5 (one neuron monopolises attention) |
| `Weak Coupling` | `|γ · G| < 0.05` (global field has no leverage on a-update) |
| `Temporal Instability` | `1 − CV(Φ recent) < 0.3` (Φ thrashes from tick to tick) |
| `Global Field Ineffective` | `|G| < 0.05` (consensus signal too small to act on) |
| `Noise Dominance` | `Φ / σ < 1` (signal can't beat exploration noise) |

`Warming up` is emitted while `t < 200`. The string surfaces unchanged in `RunDetail.latestStats.failureReason` and the live MetricsPanel.

### AUTO SWEEP UI (April 2026)

The dashboard's **⚡ AUTO SWEEP** header button now opens a one-click launcher for the full 720-combo Phase 0 grid. The launch form exposes:

- `SCALE` — 81 / 810 / 81 000 (G ∈ {9, 29, 285})
- `NEURONS (override)` — optional explicit neuron count, clamped server-side to `[9, 102 400]`. When set, the simulator grid is rebuilt for `G = round(√neurons)` and overrides `SCALE`.
- `TOP_K (override)` — optional absolute count of "conscious" neurons under `ATTN_MODE = "topk"`.
- `TICKS PER COMBO` — 500 – 50 000 (default 30 000)

While the sweep runs, the combos table reports a new `CAR` column (max Coherence Amplification Ratio seen so far) and supports live sorting by `CAR ↓` (default), `STREAK ↓`, or `INDEX ↑`. The "best combo" tiebreaker is now `gateStreak → bestCAR → Φ → PU` so the highlighted ★ row tracks the table's CAR-sorted leader.

### Neuron-count override everywhere

Every entry point that launches a simulator run accepts an optional `neurons` field that takes precedence over `scale`:

- `POST /api/runs`  — single experiment or ARC run
- `POST /api/sweeps` — applied to every combo in the sweep
- `POST /api/batches` — applied to every item × repeat
- `POST /api/batches/:id/rerun` — preserved from the source batch

UI surfaces:

- **Experiment battery**: a `NEURONS` input next to `SCALE` / `TICKS`
- **Auto-sweep launcher**: a `NEURONS (override)` field in the form
- **Experiment battery panel** (presets): a `NEURONS (override)` field shared by all presets, plus a `TICKS / EXPERIMENT` override

The clamp range (`9 – 102 400`) is enforced both in the core (`paramsForNeurons`) and in the API server (`clampNeurons`), so any client supplying out-of-range values gets sane defaults instead of an error.

### Production-readiness pass (April 2026)

A focused review/cleanup landed alongside the cancellation work to harden the API + simulator and unify the UI:

**Backend — `artifacts/api-server/`**

- `lib/atomicWrite.ts` (new) — `writeFileAtomicSync(path, data)` writes to a per-process tmp sibling and `rename`s. POSIX guarantees rename atomicity, so a crash mid-write can never corrupt `data/runs/*.json`, `data/sweeps/*.json`, `data/batches/*.json`, `data/automode/*.json`, `data/notes.json`, `data/baselines.json`, or `data/phase-status.json` again. Used by `store.ts`, `phaseLockStore.ts`, `notesStore.ts` (via `JsonSingletonStore.save`), and the three `persist{Sweep,Batch,AutoMode}` helpers in `routes/runs.ts`.
- `routes/runs.ts` — `sanitizeCustomParams` and `sanitizeRanges` filter every payload `customParams`, `ranges`, and `baseRanges` object: only string keys ≤ 64 chars, only `boolean` or finite-number values, ranges capped at 16 numeric entries per axis. `NaN`, `Infinity`, strings, nested objects, and unknown shapes are silently dropped before they ever reach the simulator's math layer or get persisted.
- `routes/runs.ts` — SSE heartbeat lifecycle is now centralised. `installHeartbeat(res)` stashes the 15 s timer on the response object (`res.__heartbeat`); `stopHeartbeat(res)` is called from both the per-client `req.on("close")` path and the orchestrator's "all done" path via `endAllSubscribers(subs)`. Earlier the orchestrator only called `sub.end()` and forgot the timer, leaking one timer per finished run/sweep/batch/automode subscriber.
- The single-run path now threads `body.seed` into `runArcBenchmark` so ARC probe inputs are reproducible across reruns.

**Simulator core — `lib/amisgc-core/`**

- `sim.ts` — `SimContext` carries two reusable scratch buffers (`scratchExpV: Float32Array(N)`, `scratchCB: Float32Array(B)`) sized once at `createSim`. The three per-tick `new Array(B)` / `new Float32Array(N)` allocations inside `simTick` (`PASS 1` branch coincidence count + both `PASS 2` softmax workspaces) now reuse them — at `N = 81 000` and `ATT_ITERS = 3` this eliminated ≈1.6 MB of GC pressure per tick.
- `arc.ts` — replaced `Math.random()` in the probe-input generator with a seeded `mulberry32(ctx.seed ^ 0x9e3779b9)` instance, so the whole ARC benchmark is now bit-identical for a given run seed. Added `ArcOptions.seed` and propagated it into `createSim`.

**Web UI — `artifacts/amisgc/`**

- `src/lib/format.ts` (new) — single source of truth for `fmt(v, precision)`, `fmtPct(v, decimals)`, `fmtDur(ms)`, `fmtTs(ms)`, and `parseNumOr(raw, fallback)`. Six panels (`SweepPanel`, `BatchPanel`, `LeaderboardPanel`, `AutoModePanel`, `MetricsPanel`, `RunsList`) each used to ship their own near-duplicate version with subtly different rules (some treated `null` as 0, some at 3 decimals vs 2). They now all import from `lib/format`. `LeaderboardPanel` and `AutoModePanel` retain their own custom timestamp formatters since they need different presentations (full date+time vs UTC HH:MM:SS).
- `src/App.tsx` — the four `*Open` booleans (`sweepOpen`, `batchOpen`, `autoModeOpen`, `leaderboardOpen`) are collapsed into a single `activeModal: "sweep" | "batch" | "automode" | "leaderboard" | null` state. Only one full-screen panel can be open at a time, and a single `Esc` key handler closes whatever's open (or the mobile drawer). Fixes the long-standing "chimera" feel where multiple modals could overlap and fight for the backdrop.
- `SweepPanel`'s neuron / topK input parsing now goes through `parseNumOr(...)`; previously a typo'd `"abc"` silently became `NaN` and was sent over the wire.

### Cancellation latency (April 2026)

Earlier, the simulator only yielded to the event loop every `sampleEvery × 4` ticks (default 800), and only inside the sample-emit block. With heavy grids (`scale=81 000`, N≈81k) a single `simTick` is non-trivial, so the loop could block the Node.js event loop for many seconds — during which `DELETE /api/runs/:id`, `/api/sweeps/:id`, `/api/batches/:id`, and `/api/automode/:id` couldn't even be processed and SSE streams froze. Cancellation appeared "stuck" until the next yield. The ARC benchmark was worse: its training and probe inner loops had **no `await` at all**, so cancel could not propagate until the active task finished.

The runner (`lib/amisgc-core/src/runner.ts`) and ARC harness (`lib/amisgc-core/src/arc.ts`) now yield on a **wall-clock interval** (`YIELD_INTERVAL_MS = 30 ms`), decoupled from sample/probe timing. Cancellation latency is bounded by `30 ms + the cost of the in-flight simTick`. End-to-end smoke tests (POST → 200 ms wait → DELETE → poll for status="cancelled") complete in ~200 ms for runs, sweeps, and ARC alike.

The DELETE handlers for sweeps, batches, and auto-mode also **eagerly flip status and broadcast a `*_cancelled` SSE event** (`sweep_cancelled`, `batch_cancelled`, `automode_cancelled`) so subscribed dashboards reflect the user's click immediately, instead of waiting for the orchestrator's `for` loop to unwind on the next yield.

### Top-K override everywhere (v13)

Mirroring neuron-count, every entry point now also accepts an optional `topK` integer (absolute count of "conscious" neurons selected per tick under `ATTN_MODE = "topk"` ablations). Server-side `applyTopKOverride` clamps to `[1, 102 400]`, then converts to `TOPK_FRACTION = topK / Neff` (where `Neff` is the post-override neuron count) and writes it into `customParams`, so it wins over any `TOPK_FRACTION` the caller supplied. Endpoints: `POST /api/runs`, `POST /api/sweeps`, `POST /api/batches`, `POST /api/batches/:id/rerun`, `POST /api/automode`. Persisted on `RunRecord.topK`, `SweepRecord.topK`, `BatchRecord.topK`. UI surfaces: `TOP_K` input in the experiment picker, `TOP_K (override)` in the sweep launcher, batch panel (4-column override grid), and Auto Mode launcher.

### Auto Mode (v13)

`◈ AUTO MODE` (purple header button) drives a chain of sweeps that progressively refine around the best combo until the Existence Gate is held for ≥ `gateStreakTarget` ticks (1000 by v13 spec) or `maxIterations` is exhausted (default 4, max 10). Each iteration is a real `SweepRecord` (tagged with `autoModeId` / `autoModeIteration`) so its combos persist alongside hand-launched sweeps. The refinement strategy halves the spread of each parameter range around the previous best value, sampling 3 values per parameter per subsequent iteration.

Endpoints: `POST /api/automode`, `GET /api/automode`, `GET /api/automode/:id`, `DELETE /api/automode/:id`, plus a Server-Sent Events stream at `GET /api/automode/:id/stream` (events: `snapshot`, `automode_start`, `iteration_start`, `combo_complete`, `iteration_complete`, `automode_complete`). Records persist to `data/automode/*.json`; running auto-modes are marked `cancelled` on server restart by `markRunningWorkInterrupted`.

### Auto-sweep data storage (v13)

All auto-sweeps and Auto Mode runs are persisted on disk and reloaded on server start, so dashboard navigation, restarts, and reruns all see the same canonical record:

- `data/sweeps/<sweepId>.json` — every combo's params, ticks done, final stats, plus `autoModeId` / `autoModeIteration` when applicable
- `data/batches/<batchId>.json` — batch items with `topK` / `neurons` overrides
- `data/automode/<autoId>.json` — full Auto Mode session: iterations, base ranges, best combo so far, gate-streak history
- `data/runs/<runId>.json` — the underlying simulator runs each combo produced (full history kept up to the run's tick budget)

---

## What this project implements

The full AMISGC v12.0 simulator and experiment battery:

- **CORE-1** — attractor formation
- **CORE-2 / 2.5 / 3.5 / 4 / 4.5** — attractor reuse, geometry, routing, compressed replay, structured memory
- **CORE-5 / 6 / 6.5** — embodiment, delayed consequences, TCAS
- **PHASE 7 → PHASE 12** — compositional reasoning, conscious attractor, hierarchical & counterfactual planning, attractor inheritance, symbol emergence, spatial navigation, language grounding, lifelong open-ended intelligence
- **Embodiment battery (PE)** and **ablations (PX)**
- **ARC mock benchmark** — small grid-style transformations (reverse, invert, shift L/R, rotate, swap-pairs, reverse-invert) trained per task and evaluated on held-out probes

Every experiment is parameterised across three scales: **81, 810, and 81 000 neurons**.

---

## Architecture

```
lib/amisgc-core/      # Pure-TS simulator + experiments + ARC + Run manager (composable, no I/O)
artifacts/api-server/ # Express 5 + esbuild bundle. Routes mount at /api
artifacts/amisgc/     # React + Vite + Tailwind v4 web UI (mobile-friendly)
scripts/              # tsx CLI (`pnpm --filter @workspace/scripts amisgc ...`)
notebooks/            # Kaggle-ready Jupyter notebook
```

The same engine drives all three surfaces:

- The **web UI** subscribes to `/api/runs/:id/stream` over Server-Sent Events.
- The **CLI** spawns the runner directly through `startRun(...)` and prints a live progress bar with metric ticker.
- The **Kaggle notebook** wraps the CLI and supports launching the web UI in the background.

### Visual style

The UI is a faithful port of the NSF v11.0 Neural Field reference (provided as `attached_assets/nsf-v11-3.jsx_*.txt`):

- Six neuron-grid view modes — **STATE / CONSCIOUS / ATTENTION / ENERGY / MI / HEALTH**
- Per-neuron concentric rings: ATP, health, desire/value, dendritic d_eff, input marker
- Live phase region indicator (DISORDERED / PREDICTIVE / ATTENTIVE / CONSCIOUS / OBSESSIVE / EMBODIED)
- Sparklines for J*, Φ, MI, ATP, health, and body energy/health
- Full metric panels (consciousness, information, energy, branches, body, win counters)
- Live runs list with per-run progress, status, verdict, and ARC sample readout

### Mobile

The header collapses to icon buttons, the experiment battery moves into a full-screen drawer accessed via the **☰ EXP** button, and panels stack vertically. The neuron-field canvas resizes responsively (no fixed 430 px box).

### Scroll-jump fix

The previous version pushed the user back to the bottom of the page when long-running experiments updated the DOM. This is fixed by:

- Setting `overflow-anchor: none` globally on `html`, `body`, and `*`
- Using `contain: layout paint` on every metric card
- Routing all high-frequency simulation data through canvas redraws and refs (no React re-renders for per-tick neuron state)
- Capping the live runs list at 30 items inside a fixed-height scroll container

---

## Running it

### Web (this repo)

A single `Start application` workflow runs `bash scripts/dev.sh`, which boots both processes:

- API server — Express on `PORT=8080`, routes mounted at `/api/*`
- Web UI — Vite dev server on `PORT=5000`, `BASE_PATH=/`, with `/api` proxied to `http://localhost:8080` (also forwards SSE / WebSocket upgrades)

The Vite proxy target is overridable via the `API_PROXY_TARGET` env var.

### CLI

```bash
pnpm --filter @workspace/scripts amisgc list                       # list experiment battery
pnpm --filter @workspace/scripts amisgc run C1.1 --scale=81        # one experiment
pnpm --filter @workspace/scripts amisgc run P8.1 --scale=810       # bigger network
pnpm --filter @workspace/scripts amisgc arc --scale=81 --tasks=8   # ARC mock benchmark
pnpm --filter @workspace/scripts amisgc all --scale=81             # full sweep
```

### Kaggle

Open `notebooks/amisgc_kaggle.ipynb`, allow internet access in the kernel settings, and execute the cells top to bottom.

---

## API

| Method | Path                    | Purpose                                             |
| ------ | ----------------------- | --------------------------------------------------- |
| GET    | `/api/experiments`      | List of experiments + phase groups                  |
| POST   | `/api/runs`             | Launch an experiment or ARC benchmark               |
| GET    | `/api/runs`             | List live + completed runs                          |
| GET    | `/api/runs/:id`         | Full run snapshot incl. history and ARC samples     |
| DELETE | `/api/runs/:id`         | Cancel a running job                                |
| GET    | `/api/runs/:id/stream`  | SSE: `snapshot`, `sample`, `phase`, `arc_sample`, `complete`, `cancelled`, `error` |
| POST   | `/api/sweeps`           | Auto-sweep — cartesian product over τ/γ/β ranges (≤ 64 combos)                     |
| GET    | `/api/sweeps`           | List sweeps                                                                        |
| GET    | `/api/sweeps/:id`       | Sweep snapshot incl. all combos and best index                                     |
| DELETE | `/api/sweeps/:id`       | Cancel a running sweep                                                             |
| GET    | `/api/sweeps/:id/stream`| SSE: `snapshot`, `sweep_start`, `combo_start`, `combo_progress`, `combo_complete`, `sweep_complete` |
| POST   | `/api/batches`          | Run an experiment list serially (`experimentIds[]` / `phase` / `all`), with optional `repeats` per item for variance |
| GET    | `/api/batches`          | List batches |
| GET    | `/api/batches/:id`      | Batch snapshot incl. per-experiment status, mean/std measured value, pass count |
| DELETE | `/api/batches/:id`      | Cancel a running batch |
| GET    | `/api/batches/:id/stream`| SSE: `snapshot`, `batch_start`, `item_start`, `item_progress`, `item_complete`, `batch_complete` |
| POST   | `/api/batches/:id/rerun` | Re-launch the same experiment list. `{ keepSeed: true }` → byte-identical replay (reuses the source `baseSeed`); `{ keepSeed: false }` → fresh random seed for a variance check |
| GET    | `/api/batches/:a/diff/:b`| Welch's t-test per shared experiment between two batches. Returns `{ aMean, bMean, aN, bN, delta, pTwoSided, sign }` rows |
| GET    | `/api/leaderboard`       | Aggregate view across persisted batches with `?phase=`, `?search=`, `?baseline=`, `?minRuns=`, `?excludeInterrupted=` filters. Each row carries bootstrap 95% CI, pinned/note metadata, and an optional `baselineDelta` (Welch's t vs the chosen baseline batch) |
| GET    | `/api/notes`             | List of persistent per-experiment notes (text, tags, pinned flag) |
| PUT    | `/api/notes/:experimentId`| Upsert a note. Any subset of `{ text, tags, pinned }` patches the existing record |
| DELETE | `/api/notes/:experimentId`| Drop the note |
| GET    | `/api/baselines`         | List saved baselines (named pointers to a specific batch id) |
| POST   | `/api/baselines`         | Save a batch as a named baseline (`{ batchId, name, notes? }`) |
| DELETE | `/api/baselines/:id`     | Remove a saved baseline |
| GET    | `/api/version`           | `{ version, gitSha, buildTime, nodeEnv, startedAt, uptimeMs, authRequired }` for build-info / health probes |

All run state is held in-memory in the API server (no DB required); each run owns a cooperative cancellation token wired into the simulator loop. Notes and baselines persist as JSON under `artifacts/api-server/data/`.

### Auth (optional)

Set `AMISGC_API_TOKEN=…` in the environment to require `Authorization: Bearer <token>` on every `/api/*` route except `/api/version` (so health probes still work). With the variable unset (the default), the API is unauthenticated and `/api/version` reports `authRequired: false`.

### Run All / Batch panel

The header **▶ RUN ALL** button opens the experiment battery panel, with one-click presets:

- **Run Phase 0 sweep (×2)** — the four PH0 gate experiments, two repeats each, mean ± std reported
- **Run all CORE (PH0–C5)** — the full attractor stack
- **Run everything** — every registered experiment, serially
- Or pick any phase from the dropdown

Each item shows its target metric, target threshold (≥ or ≤), measured mean ± std across repeats, pass count (`k/N`), tick progress, and elapsed time. Every batch has a `baseSeed` (shown in hex in the header); each repeat's PRNG seed derives from it via a deterministic xorshift mixer (`deriveSeed(base, itemIdx, repeatIdx)`), so identical baseSeeds reproduce identical runs. Batches can be cancelled mid-run and exported to CSV when done.

Completed (and cancelled) batches are persisted to `artifacts/api-server/data/batches/<id>.json` and reloaded on API startup, so you can scroll back through past runs in the **↺ PAST BATCHES** list inside the panel and click **LOAD** to inspect any of them. Batches that were *running* when the API was killed come back marked **`interrupted`** rather than `cancelled` — they're separated in the UI so a server restart can't silently corrupt your aggregate stats. The leaderboard's `EXCLUDE INTERRUPTED` checkbox (on by default) filters them out.

A loaded batch exposes four extra controls below `⎘ CSV`:

- **↻ RE-RUN (same seed)** — replays the same experiment list with the same `baseSeed` for a deterministic A/B replay
- **↻ RE-RUN (new seed)** — same list, fresh random seed, for a variance / robustness check
- **☆ SAVE AS BASELINE** — registers this batch as a named baseline (POST `/api/baselines`); show up in the leaderboard's BASELINE dropdown
- **DIFF VS PRIOR BATCH** panel — pick any other persisted batch and run a Welch's t-test per shared experiment, with sign-coded Δ and p-value columns

The **🏆 STATS** header button opens the **Leaderboard** — an aggregate view across every persisted batch. Each row shows: pinned star, total simulator runs, total passes, overall pass rate (colour-coded), best-ever measured value (direction-aware), mean ± std, **bootstrap 95% CI** (n=600 resamples), pass count `k/N`, and — when a baseline is selected — **Δ vs baseline** (Welch's two-sided p-value, sign-coded). Sortable by pass rate, total runs, phase, experiment id, most recent, best measured, **CI width (tightest)**, or **Δ vs baseline**. Filterable by phase, free-text search (id / name / hypothesis, debounced 250 ms), minimum-run threshold, and an `EXCLUDE INTERRUPTED` toggle. Pinned experiments always sort to the top of any view. The 📝 / + button on each row opens an inline editor for a persistent note + comma-separated tags + pin toggle. Refresh and CSV-export buttons are in the filter bar; the CSV now also carries CI bounds, baseline delta + p-value, pin flag, note text and tags. Backed by `GET /api/leaderboard`, `*/notes/*`, `*/baselines/*`.

---

## Tech stack

- pnpm monorepo, TypeScript 5.9 (project references)
- Express 5 + esbuild bundle for the API
- React 19 + Vite 7 + Tailwind v4 + framer-motion + recharts (UI)
- @tanstack/react-query for fetch state, native EventSource for streaming
- Pure-TS deterministic-where-possible simulator (no GPU dependency)

---

## File map

- `lib/amisgc-core/src/sim.ts` — full v12 simulator (7-pass attention, body, TD dopamine), seedable via `RunOptions.seed`
- `lib/amisgc-core/src/runner.ts` — RunHandle + cancellation + lifecycle callbacks; `RunStart` carries the `seed`
- `lib/amisgc-core/src/stats.ts` — `partitionFinite`, `meanStd`, `bootstrapCI` (n=600), `welchT` two-sided, `stabilityCheck`, `bestMeasured` (direction-aware)
- `lib/amisgc-core/src/experiments.ts` — every experiment spec + phase groupings
- `lib/amisgc-core/src/arc.ts` — ARC mock benchmark
- `artifacts/api-server/src/routes/runs.ts` — REST + SSE for runs / sweeps / batches, plus the leaderboard, diff, and re-run endpoints
- `artifacts/api-server/src/routes/{notes,baselines,system}.ts` — notes, baselines, `/version` routes
- `artifacts/api-server/src/middlewares/auth.ts` — env-gated bearer-token guard (`AMISGC_API_TOKEN`)
- `artifacts/api-server/src/lib/{store,notesStore,baselinesStore}.ts` — JSON-on-disk persistence under `data/`
- `artifacts/api-server/src/index.ts` — `SIGTERM` / `SIGINT` graceful shutdown that marks in-flight batches `interrupted`
- `artifacts/amisgc/src/App.tsx` — main shell, layout, mobile drawer
- `artifacts/amisgc/src/lib/api.ts` — typed client for every endpoint above (incl. `notesApi`, `baselinesApi`, `systemApi`, `batchApi.{diff,rerun}`, `leaderboardApi.get(query)`)
- `artifacts/amisgc/src/components/NeuronGrid.tsx` — canvas renderer (six view modes)
- `artifacts/amisgc/src/components/MetricsPanel.tsx` — all live metric panels
- `artifacts/amisgc/src/components/ExperimentPicker.tsx` — battery picker + launcher
- `artifacts/amisgc/src/components/RunsList.tsx` — live runs feed
- `artifacts/amisgc/src/components/RunDetailPanel.tsx` — run detail + ARC samples
- `artifacts/amisgc/src/components/BatchPanel.tsx` — battery launcher + per-batch re-run / save-as-baseline / diff modal
- `artifacts/amisgc/src/components/LeaderboardPanel.tsx` — aggregate leaderboard with CI, baseline delta, notes, pinning, search
- `scripts/src/amisgc-cli.ts` — terminal CLI
- `notebooks/amisgc_kaggle.ipynb` — Kaggle notebook
