# Private combat replay

Migration203 stores accepted combat commands in `roguelike_combat_events` in the
same transaction as the runtime and idempotency receipt. Duplicate command IDs
return the existing receipt before another event can be inserted. Unique
`(run_id, command_id)` and `(run_id, revision)` constraints enforce this boundary.

Each combat has an opaque `combat_key`. Initialization records the accepted
envelope as an `after` baseline. A fight started before journal rollout gets a
`before` baseline at its first subsequently accepted command. The remaining
records contain intent, actual random values, artifact hash, runtime revision
and hashes of both complete envelopes. They do not repeat the content catalog.

To diagnose an authorized run, select one combat key and export its private
records in revision order using parameterized SQL:

```sql
SELECT jsonb_agg(record ORDER BY revision)
FROM roguelike_combat_events
WHERE run_id = $1 AND combat_key = $2;
```

Keep the resulting file private: the baseline includes combat entropy. Use the
matching immutable `/artifacts/<sha256>.cjs` executable, not the current release
by default:

```sh
node worker/replay.mjs private-records.json pinned-artifact.cjs
```

The command checks the executable checksum, replays accepted intents through the
shared engine and runtime projection, compares every random value and complete
envelope hash, and prints only the verification result and hashes. The script
does not connect to production or mutate a run. Missing, reordered or altered
transitions fail verification.

This is replay from an accepted snapshot. It does not reconstruct initialization
from RuleEvents alone, certify content availability before the baseline, or
claim coverage for historical commands before journal rollout. Camp receipts
retain their input payload and accepted response; they are not part of the
combat replay command.
