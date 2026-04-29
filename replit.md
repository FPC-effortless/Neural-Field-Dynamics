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

Per-tick stats now expose `networkPU`, `networkH_C`, `existenceGate ∈ {0,1}`, `gateStreak`, and `failureReason`. Phase 0 (`PH0.gate`, `PH0.topk_baseline`, `PH0.no_global`, `PH0.no_temporal`) sits at the top of the experiment battery.

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

Both workflows start automatically:

- `artifacts/api-server: API Server` — Express on `PORT` (8080), routes mounted at `/api/*`
- `artifacts/amisgc: web` — Vite dev server, proxied at the artifact base path

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

All run state is held in-memory in the API server (no DB required); each run owns a cooperative cancellation token wired into the simulator loop.

---

## Tech stack

- pnpm monorepo, TypeScript 5.9 (project references)
- Express 5 + esbuild bundle for the API
- React 19 + Vite 7 + Tailwind v4 + framer-motion + recharts (UI)
- @tanstack/react-query for fetch state, native EventSource for streaming
- Pure-TS deterministic-where-possible simulator (no GPU dependency)

---

## File map

- `lib/amisgc-core/src/sim.ts` — full v12 simulator (7-pass attention, body, TD dopamine)
- `lib/amisgc-core/src/experiments.ts` — every experiment spec + phase groupings
- `lib/amisgc-core/src/arc.ts` — ARC mock benchmark
- `lib/amisgc-core/src/runner.ts` — RunHandle + cancellation + lifecycle callbacks
- `artifacts/api-server/src/routes/runs.ts` — REST + SSE
- `artifacts/amisgc/src/App.tsx` — main shell, layout, mobile drawer
- `artifacts/amisgc/src/components/NeuronGrid.tsx` — canvas renderer (six view modes)
- `artifacts/amisgc/src/components/MetricsPanel.tsx` — all live metric panels
- `artifacts/amisgc/src/components/ExperimentPicker.tsx` — battery picker + launcher
- `artifacts/amisgc/src/components/RunsList.tsx` — live runs feed
- `artifacts/amisgc/src/components/RunDetailPanel.tsx` — run detail + ARC samples
- `scripts/src/amisgc-cli.ts` — terminal CLI
- `notebooks/amisgc_kaggle.ipynb` — Kaggle notebook
