# AMISGC Research Programme

**Emergent Intelligence from a Metabolically Constrained Predictive Neural Field — v12.0**

A full working research codebase that runs on Kaggle, the web, and the CLI, with the web UI and CLI driving the same simulation engine simultaneously.

## v12 revision — soft globally coupled attractor field

The previous v12 used a hard top-K bottleneck which was unable to clear the **Existence Gate** (`Φ > 0.05 ∧ PU > 0.1 ∧ S_C > 0.1` sustained ≥ 100 ticks). The current revision replaces it with a soft attractor field driven by five named parameters:

| Param | Default | Role |
| --- | --- | --- |
| `TAU_ATT` (τ) | 0.7 | softmax temperature on attention logits |
| `GAMMA_GLOBAL` (γ) | 1.0 | global field coupling strength |
| `BETA_ENTROPY` (β) | 0.2 | entropy gradient pressure |
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

The default `POST /api/sweeps` body has been expanded to the post-B3 targeted Phase 0 sweep (3 × 4 × 3 × 3 × 3 = 324 combos):

```json
{
  "TAU_ATT":        [0.7, 1.0, 1.5],
  "GAMMA_GLOBAL":   [1.0, 1.5, 2.0, 3.0],
  "DELTA_TEMPORAL": [0.2, 0.4, 0.6],
  "BETA_ENTROPY":   [0.1, 0.3, 0.5],
  "NOISE_SIGMA":    [0.01, 0.02, 0.05]
}
```

The sweep cap has been raised from 64 to 400 combinations to accommodate this grid; per-combo ticks now cap at 50k (extend from 30k when Φ shows a rising trend).

### AUTO SWEEP UI (April 2026)

The dashboard's **⚡ AUTO SWEEP** header button now opens a one-click launcher for the full 324-combo Phase 0 grid. The launch form exposes:

- `SCALE` — 81 / 810 / 81 000 (G ∈ {9, 29, 285})
- `NEURONS (override)` — optional explicit neuron count, clamped server-side to `[9, 102 400]`. When set, the simulator grid is rebuilt for `G = round(√neurons)` and overrides `SCALE`.
- `TICKS PER COMBO` — 500 – 50 000

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
