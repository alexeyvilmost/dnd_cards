# Event queue extraction corpus v1

Synthetic world/command/catalog/RNG/ID inputs and exact full handler results captured
before extracting `queueEventReactions` on 2026-10-04. There are 13 commands: two paid
reaction declarations, reload/continuation and duplicate rejection; ordered declines;
two automatic observer actions with different damage data; board-owned and unsupported
predicates which must not execute as unconditional world reactions.

`manifest.json` binds the compressed and uncompressed bytes and every bundled source.
The ordinary replay test reads these bytes, checks their hashes and compares complete
results twice, including events, IDs, pending decisions, resources and final world.
It does not regenerate expectations or substitute current results.

The explicit maintenance command is `node frontend/scripts/capture-handler-replay-fixture.mjs`.
It refuses to overwrite different bytes. Changes to semantics or new cases need a new
versioned corpus. This is a local refactoring baseline, not a production certificate or
an automatic manual-review status. Older executable compatibility has its separate
`frontend/worker/fixtures/replay-v1` corpus and worker tests.
