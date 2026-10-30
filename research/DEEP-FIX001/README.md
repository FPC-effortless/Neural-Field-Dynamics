# DEEP-FIX001: Make metric reads observational

Simulation ticks now own normalization, convergence windows and gate-duration updates. calcStats reads a structured clone without advancing live state. This changes reporting cadence prospectively; old DEEP001/NSF001 results remain historical. Three seeds each ran2400 ticks at two observation frequencies: complete persistent state and returned statistics match. One/two dynamics steps count one/two gate ticks;100 same-tick reads add none. Primary predictive utility and premature ATS interpretation remain unresolved. No optimizer or GPU.

Validation: Node v24.22.1; 3 regression groups; six2400-tick runs;29.29s. See RESULTS.json. The original source fails the same read-purity regression.

These are source/correctness diagnostics, not real-data capability evidence. No model training, GPU quota, protected holdout, merge or historical score rewrite. Portfolio audit: FPC-effortless/nsf-vibe PR3. Draft for source review.
