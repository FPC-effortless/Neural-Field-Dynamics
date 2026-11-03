# Frozen NFD restore handoff planner

`restore-plan.mjs` is a metadata-only boundary for a future Lab OS/TrainLab restore adapter. It is native to this repository and freezes the seven real source/codec/preparation inputs at PR5 commit `f7cb469427faff336bdc5986006cd44ef291b837`. It imports only Node crypto/filesystem/path modules. It neither imports the simulator nor imports/calls the trusted-local V8 codec, creates workers, deserializes checkpoint payloads, or runs commands.

Call `planRestore({sourceRoot, artifactRoot, descriptor, expectedDescriptorSha256})` after independently obtaining the descriptor pin. The expected digest is SHA256 of `JSON.stringify(descriptor)` bytes. The caller must preserve this exact serialization and external pin; hashes do not authenticate a source or grant execution authority.

The descriptor schema is `nfd.restore-plan.v1`. The executable fixture in `test-restore-plan.mjs` documents its exact required fields. It binds a job identifier, source commit, Node version, raw recipe/protocol inputs, the prepared runtime inventory, raw checkpoint bytes, and a reported-stop receipt. Paths are relative, bounded, regular non-symlink files within their stated roots. The checkpoint envelope header must match the native source/runtime contract before it is ever eligible for a separately reviewed trusted-local loader. Prepared binding/header parsing and hashing use the same captured byte snapshots. Duplicate JSON object keys reject.

`previous_attempt.state` must be `STOP_REPORTED_NOT_INDEPENDENTLY_VERIFIED`, accompanied by pinned receipt bytes; unknown/running states reject. This field deliberately does not establish actual process death. `resource.allocation_state` must be `NO_ALLOCATION_REQUESTED`; closed-allocation reuse or any new allocation request rejects. `trust` must be `TRUSTED_LOCAL_ONLY_NOT_AUTHENTICATED`; downloaded/untrusted envelopes are outside this boundary. These labels constrain the interface, but cannot prove the truth of a caller's custody/stop assertions.

Every successful result still has `admitted:false`, `resume_allowed:false`, `previous_attempt_stopped_proved:false`, and `checkpoint_deserialized:false`. No command is emitted. Recipe/protocol bytes are opaque pinned inputs; this planner does not replace native `trainlab.runner.load_config`, Lab OS protocol validation/admission, source rights, independent review, resource release, authenticated stop/custody evidence or a reviewed restore runtime. The schema is a source-only handoff proposal, not a registered Lab OS recipe or working continuous research worker. Prepared source derivation and whole-model correspondence remain outside this byte-integrity result.

The existing checkpoint codec stays restricted to trusted local exact-source/exact-Node state. Do not feed downloaded or user-supplied checkpoints to V8 deserialization on the strength of this plan. A future adapter must perform its own complete admission immediately before any effect, preserve active/unknown-work quarantine and validate the exact frozen runtime/inputs again. Persistent storage, actual liveness, restart/restore execution and scientific experiments need separate receipts.

Run the no-fit fixture with Node24.22.1:

```sh
node scripts/native-checkpoint/test-restore-plan.mjs
```

The test strips the actual TypeScript source via the existing preparation tool without importing the emitted simulator. Its checkpoint payload is intentionally invalid V8 data, and recipe/protocol/stop metadata are explicitly constructed unit fixtures. Passing those checks demonstrates metadata planning and rejection behavior only, not a real restored state, job, admission, learned model or scientific result. The original simulator/checkpoint tests are not rerun by this fixture.
