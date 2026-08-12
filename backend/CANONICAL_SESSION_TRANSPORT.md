# Canonical rules sessions

The backend exposes two deliberately different trust boundaries.

## Server-authoritative API

Enabled only with `ENABLE_SERVER_RULES_AUTHORITY=1`:

- `POST /api/rules/canonical-sessions` creates or discovers an active session
  for the exact 2–16 character set and a pinned rules artifact.
- `GET /api/rules/canonical-sessions/:id` returns the authoritative snapshot.
- `POST /api/rules/canonical-sessions/:id/commands` accepts exactly
  `{ "command": GameCommand }`; client snapshots and patches are rejected.
- `POST /api/rules/canonical-sessions/:id/close` closes a quiescent session,
  releases its actors and removes compatibility mirrors from CharacterV3.

All routes require strict JWT authentication. Genesis requires caller-owned
characters, identical imported compatibility worlds, exact participant set,
the registered micro-MVP release, worker schema validation, and equality of
stored HP, resources, effects, equipment, inventory, level/proficiency and
rule-relevant Card fields (`mechanics`, mastery, weapon profile and effects).
Actor controllers are replaced with the authenticated server identity before
the snapshot is accepted.

The command path locks membership, session and actor bindings, verifies source
control, declared targets, release/hash and expected revision, then supplies a
server-secret deterministic RNG tape to the local Node worker. The worker is a
compiled copy of the same TypeScript `rules-core` used for browser prediction.
Only worker-produced events and next state are accepted. Command receipt,
events, snapshot, actor projections, pending decisions and source-owned
summoned-actor creation/removal are committed in one PostgreSQL transaction.

An exact retry uses the same `commandId` and semantic command bytes. It returns
the stored receipt even after the session revision advanced and does not run
the worker or spend resources twice. Reusing the ID with different input fails.
While a server session is active, direct CharacterV3 runtime/build/delete writes
are rejected; the CharacterV3 rows are compatibility projections, not an
independent authority.

Production requires:

```text
ENABLE_SERVER_RULES_AUTHORITY=1
ENABLE_UNVERIFIED_CANONICAL_TRANSPORT=0
RULES_WORKER_SECRET=<strong random secret>
RULES_RNG_SECRET=<independent strong random secret>
```

The backend container starts the worker on loopback and the Go API together.
If either process stops, the container exits. `RULES_WORKER_URL` defaults to
`http://127.0.0.1:9090`.

## Unverified shadow transport

`/api/transport/canonical-sessions/:id` and `/transitions` persist a complete
client-computed schema-v5 transition. They are disabled unless
`ENABLE_UNVERIFIED_CANONICAL_TRANSPORT=1`, work only with `authority_mode=local`
and report `semanticAuthority=client_semantics_unverified` and
`schemaValidation=partial_unverified`. They must not be enabled for an
untrusted production cohort.

## Residual boundary

The new API is authoritative for the certified two-sheet micro-MVP slice. The
older `/encounters` board still accepts client-calculated patches and remains a
compatibility transport. Multi-account remote decision delivery, SSE cursor
recovery for canonical sessions, durable leased worker admission and fully
server-compiled CharacterV3 builds are later hardening/rollout work; none of
them changes the rule primitive model or permits the client to commit a rules
result in the new path.
