# Pending lifecycle corpus v1

71 synthetic accepted continuations cover all 15 `PendingResolution` variants in
the current rules core. They were captured from 105 passing semantic tests. The
world, command, catalog reads, RNG calls, clock values, generated IDs and full
accepted result are preserved. These are current test fixtures, not historical
production encounters or content certificates.

`manifest.json` binds the compressed corpus and the captured handler executable
to their SHA-256 hashes and records every bundled source hash. Normal tests must
never regenerate either file. The lifecycle test compares the current handler
with saved outcomes, verifies duplicate rejection without another payment/draw,
and executes the frozen handler in two separate Node processes. The production
worker HTTP/replay and PostgreSQL receipt suites remain separate requirements.

For a deliberately new corpus version, use:

```powershell
node frontend/scripts/capture-pending-lifecycle.mjs --version=pending-lifecycle-v2 --dry-run
```

Inspect the candidate and its semantic test report under the reported owned
`outputs/testing/pending-lifecycle-capture/` directory. Removing `--dry-run` writes
only to a new versioned directory; the tool refuses an existing target. Update
the test's version/hash constants only for the new version after reviewing its
changes. Preserve this v1 executable and corpus.

The first maintenance dry run reproduced the exact v1 corpus hash
`726929985527d894ffe6b0876aea79e2a2ed52b11fcd2eae5ef41e1c703eb726`.
