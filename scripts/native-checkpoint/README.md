# Native NFD checkpoint engineering candidate

This Node-only tool saves the real simulator state, context buffers and PRNG continuation. It does not start a worker, run a fit or qualify any architecture. The core package remains browser-compatible; no Node I/O is added to its exports.

Use Node 24.22.1 for the checked receipt. The preparation step uses Node's experimental built-in TypeScript stripping, requiring no dependency install. It copies the four actual native sources into an isolated directory and binds both their TypeScript identities and emitted JavaScript bytes. Do not edit a prepared directory.

```sh
node scripts/native-checkpoint/test.mjs 0c507d460b844bb4e317c1bedf99dfab2d787ab8
node scripts/native-checkpoint/prepare.mjs /absolute/persistent/path/nfd-runtime
```

The prepared directory exports `captureNative({sim,ctx})` and `restoreNative(envelope)` from `checkpoint.mjs`. Serialize the returned envelope as JSON; store it atomically using a trusted caller. Persistent storage, supervision, queue admission, restart recovery of jobs and training recipes remain separate integrations. This tool does not provide them.

The codec is restricted to **trusted local checkpoints**, 81 neurons, the exact same Node version and the exact same prepared source. It uses V8 serialization to retain typed arrays, shared references, undefined and nonfinite normalization sentinels. Never deserialize downloaded/user-supplied envelopes: shape, runtime and source checks are compatibility checks, not authentication or a sandbox. No HTTP endpoint exposes this loader. Its 16 MiB size bound is a resource guard, not an untrusted-input security guarantee. Cryptographic signing, arbitrary scales and portable cross-runtime migration are outside this candidate.

Only the PRNG gains getState/setState methods; its random-number equation is unchanged. Current native sim/math/params/tasks forward behavior is checked against the immutable Git base above. Three fixed seeds cover 65 ticks with nine native task transitions; resumed state and RNG match each of the final 45 ticks, including an independent child process. A sim-only restore negative control diverges. Twelve malformed envelopes/source-map mutations are rejected. These are small deterministic engineering tests, not neural-model fits or a claim about generalization.

Provenance: the candidate mechanism was reviewed in LABOPS003 against ARCHPAR002_Scientific_Master.zip (`libfile_1a76323fd44c819188eb4fd69bc9887c`, archive SHA256 `c2ba36f9558f5629f6f90eaea511a54f5b7cd7d2a21aeccf614bd4335adbc039`). Its archived `on/sim.js` has sensory-refresh/statistics fixes absent from this native repository. Archive/native full-state parity fails at tick 1: archive advances statistics/history inside simTick, while native does so via calcStats. That negative result is retained; this patch deliberately does not import those unrelated changes. The present integration needs a fresh independent review, which prior archive review does not satisfy.
