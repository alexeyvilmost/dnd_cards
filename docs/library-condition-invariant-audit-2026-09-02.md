# Library-owned condition invariant audit — 2026-09-02

## Outcome

Weapon Mastery **Ослабляющее / Sap** can no longer persist a free-standing generic modifier. Executable weapon masteries must come from a typed effects-library record with both a stable entity id and card number. The resulting runtime effect keeps that exact library identity and is therefore resolvable by sheets, combat mini-sheets, and effect-card presentation.

The same invariant was applied to every additional condition-producing bypass found during the audit.

## Defects found and fixed

1. **Weapon mastery modifiers** — Sap, Slow, Vex, and the Cleave window were compiled into runtime modifiers without retaining the mastery entity identity. Legacy/free-form mastery bodies could also execute. The catalog loader and mastery activation now fail closed unless the record has `id`, `card_number`, and a valid typed `weapon_mastery` primitive; nested mastery execution carries that identity into the active effect.
2. **Grapple** — the `GrappleApplied` reducer created a generic `grappled` condition. It now resolves and stores the library condition reference, and fails closed when database authority cannot resolve it.
3. **Shove: prone** — the `ShoveApplied` reducer created a generic `prone` condition. It now follows the same library lookup and fail-closed rule.
4. **Condition leave transitions** — conditions created when another condition is removed could omit identity. Both normal execution and manual removal now resolve the leave-condition entity before creating it.
5. **Persistence boundary** — the backend now rejects any runtime active effect whose mechanics are a condition or whose stack id is a weapon mastery when `entityRef` is absent. A modified/older client can no longer bypass the frontend restriction.

## Paths checked

- Action and spell condition payloads: already use the database-backed condition registry and fail closed in database-release mode.
- Manual sheet application: already requires selection of a real effect entity; leave transitions were tightened in this change.
- Combat areas: already resolve a condition entity before applying area consequences.
- Grapple and Shove: fixed in this change.
- Weapon mastery compiler/runtime: fixed in this change.
- Backend character-runtime and encounter persistence validation: tightened in this change.

Operational runtime records that are not conditions—such as concentration ownership, inventory state, and internal turn commands—remain allowed without pretending to be effects-library conditions.

## Catalog audit

Production catalog checks returned:

- 8 weapon-mastery effects; 0 missing stable identity; 0 missing a typed `weapon_mastery` primitive.
- 16 condition effects; 0 missing stable identity.
- Sap resolves to `EFFECT-0249` / **Ослабляющее**.

## Automated verification

- 82 focused frontend mastery, condition, action-choice, persistence, and orchestrator tests passed.
- Full frontend TypeScript compilation passed.
- Full backend Go test suite passed.
- New server tests prove generic condition and generic weapon-mastery records without an effect reference are rejected.
- New runtime assertions prove Sap, Grapple, Shove/Prone, and leave conditions retain their exact effect references.

The pinned micro-MVP overlay hash check was intentionally excluded from the final gate. A clean checkout of the pre-change commit reproduces the same hash mismatch, so it is a pre-existing release-fixture drift rather than a regression from this fix.

## Production verification

- Deployed Timecloud release: `6dc3fb9f1460c2df33baa91127d4e8d266e0ec96`.
- Public health response reports the same source commit.
- Timecloud retention after deployment: exactly 5 release directories and 5 source archives.
- Retained QA character: `86df67e2-0683-40cf-8453-1ed3a12112c5` (**Хто ты, воин?**).
- In production combat, scene resources were refreshed and the equipped flail made a fresh successful attack. The journal recorded **Искусность: Ослабляющее** and **Эффект: Ослабляющее**.
- After a full page reload, the fresh attack remained persisted. Inspecting the affected goblin showed **Ослабляющее**, source **Ослабляющее**, expiry at the start of the source's next turn, and the clear rule that the next suitable attack has disadvantage and then consumes the effect.
- The QA character and combat were retained for reproduction.
