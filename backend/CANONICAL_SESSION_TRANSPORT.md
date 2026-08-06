# Canonical session transport

The canonical session API is a persistence and concurrency boundary, not a
server-side D&D rules interpreter.

## Endpoints

- `GET /api/transport/canonical-sessions/:id` returns the current canonical
  WorldState and the database-actor to WorldState-actor bindings.
- `POST /api/transport/canonical-sessions/:id/transitions` accepts one complete
  schema-v5 WorldState transition. The JSON body is limited to 256 KiB.

Both endpoints require strict JWT authentication and active
`game_session_members` membership. The transition endpoint is intentionally
available only for sessions with `authority_mode = 'local'`. Every response
and committed transport event reports
`semanticAuthority = "client_semantics_unverified"` and every response reports
`schemaValidation = "partial_unverified"`.

The routes are disabled by default. They are registered only when
`ENABLE_UNVERIFIED_CANONICAL_TRANSPORT=1`. This flag is suitable solely for a
trusted-local shadow rollout: enabling it does not make the backend a semantic
D&D authority and does not certify the complete WorldState schema.

## Commit contract

The transition request supplies a transport UUID `commandId`, a bounded stable
`semanticCommandId`, the locked `rulesetReleaseId` + `rulesArtifactHash`, the
controlled source actor, declared target actors, the exact base
revision/snapshot sequence/state hash, the complete new snapshot, its hash,
and a complete actor binding list. `processedCommandIds` appends the semantic
ID; the transport UUID remains the immutable receipt/idempotency key.
The server:

1. locks the session row, then locks active membership with `FOR SHARE` and
   verifies the caller before inspecting mutable session controls;
2. verifies the stored canonical bytes/SHA-256, immutable snapshot/event head,
   release/artifact/serializer binding, source control, target owner/controller
   membership, exact actor-set bindings, immutable controller bindings, and
   append-only `processedCommandIds`;
3. rejects a changed actor projection unless the caller owns/controls that
   actor or has `can_control_unowned_actors = true`;
4. verifies the exact CAS base and `revision + 1`, canonicalizes the new JSON,
   checks its SHA-256, and leaves the schema-v5 SQL validators enabled;
5. atomically commits the command receipt, fencing job, event, historical
   snapshot, every actor projection, decision ledger metadata, and the live
   session head.

The same `commandId` from the still-active original caller with the same
canonical request hash returns the stored response without inserting
duplicates—even after a later session freeze or actor-control change. Reusing
it with different input or submitting a stale CAS base returns HTTP 409.

Opening a decision for another character does not authorize changing that
character. Decision IDs and deciding actor identity must exactly match
`pendingResolution.id`, `pendingResolution.request.id`, and
`pendingResolution.request.actorId`; assignment is derived from the persisted
actor controller. Only that assigned controller (or an explicit GM capability)
may close/replace the pending decision, using the deciding actor as the source.
The two persisted decision IDs are stable strings of at most 128 bytes. They
must be distinct, match the pending state exactly, use request schema version
1, and are independently unique within the session.

## Deliberate residuals

- The server does not prove that damage, healing, effects, costs, rolls,
  targeting, turn order, or pending continuations follow D&D rules. It proves
  transport integrity and authorization only.
- Cross-owner automatic HP/effect mutation is rejected without an explicit GM
  capability. The safe two-owner path is an atomic pending-decision handoff
  followed by a transition from the assigned target controller. Fully
  automatic cross-owner resolution requires a future server-side semantic
  interpreter or a separately trusted adjudication authority.
- Session/release/member/actor creation and invitations are outside this
  bounded API. It operates on already provisioned canonical runtime rows.
- World-object and scene semantics remain client-provided. PostgreSQL enforces
  the existing world-v5 structural/release invariants, but not D&D meaning.
- This transport never writes `characters_v3`; product-sheet projection from a
  canonical session remains a separate, explicitly authorized concern.
- Treat all accepted snapshots as partial-schema, client-computed evidence.
  Do not expose these routes to untrusted clients until a server-side semantic
  interpreter or equivalent verified authority replaces this shadow contract.
