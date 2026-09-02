import type { RuleEventPayload, UncommittedRuleEvent, WorldState } from './domain';
import { evolveWorldObjectEvent, worldObjectLedgerIssue } from './worldObjects';
import {
  attackSequenceInvariantHolds,
  performUnarmedStrike,
  performWeaponSequenceAttack,
  replaceSequenceAttack,
} from './attackSequence';
import { getSystemActionDefinition, SYSTEM_ACTION_IDS } from './systemActions';
import {
  familiarActorStateIssue,
  familiarActorsOwnedBy,
  pactChainProjection,
} from './familiarRuntime';
import {
  advanceProtection2024Effect,
  resolveProtection2024Reaction,
} from './protection';
import {
  actorHoldsCanonicalShield,
  actorProtectionEffects,
  protectionEffectEntry,
  protectionEffectEntryIssue,
} from './protectionRuntime';
import {
  evolvePactTomeOwnerDied,
  evolvePactTomeRestCompleted,
} from './pactTomeWorldAdapter';
import {
  applyAuthorizedPactBladeBonded,
  applyAuthorizedPactBladeDistanceAdvanced,
  applyAuthorizedPactBladeEndedOnOwnerDeath,
} from './pactBladeWorldAdapter';
import { PACT_BLADE_STATE_CAPABILITY } from './warlockPacts';
import {
  conditionEffectEntityRef,
  conditionRegistryAuthority,
} from '../engine/conditions';

function conditionEntityRefForRuntime(condition: string) {
  const ref = conditionEffectEntityRef(condition);
  if (!ref && conditionRegistryAuthority().mode === 'database_release') {
    throw new Error(`condition «${condition}» has no effects-library entity`);
  }
  return ref;
}

function ownerWithFamiliarProjection(
  owner: WorldState['actors'][string],
  familiar: NonNullable<WorldState['actors'][string]['familiarState']> | null,
): WorldState['actors'][string] {
  const chain = owner.warlockPacts?.chain;
  if (!chain) {
    if (familiar?.extension === 'pact_chain') {
      throw new Error(`Actor ${owner.id} has no Pact Chain state for its familiar`);
    }
    return owner;
  }
  if (familiar && familiar.extension !== 'pact_chain') {
    if (chain.activeFamiliar?.actorId !== familiar.actorId) return owner;
    return {
      ...owner,
      warlockPacts: {
        ...owner.warlockPacts,
        chain: { ...chain, activeFamiliar: null },
      },
    };
  }
  return {
    ...owner,
    warlockPacts: {
      ...owner.warlockPacts,
      chain: {
        ...chain,
        activeFamiliar: familiar ? pactChainProjection(familiar) : null,
      },
    },
  };
}

function sceneWithoutActor(world: WorldState, actorId: string): WorldState['scene'] {
  if (world.scene.mode !== 'encounter') return world.scene;
  const removedIndex = world.scene.initiative.indexOf(actorId);
  if (removedIndex < 0) return world.scene;
  const initiative = world.scene.initiative.filter((id) => id !== actorId);
  if (initiative.length < 2) throw new Error('A familiar lifecycle event cannot invalidate Initiative');
  let activeIndex = world.scene.activeIndex;
  if (removedIndex < activeIndex) activeIndex -= 1;
  else if (removedIndex === activeIndex) activeIndex %= initiative.length;
  return { ...world.scene, initiative, activeIndex };
}

function sceneWithPresentFamiliar(world: WorldState, actor: WorldState['actors'][string]): WorldState['scene'] {
  if (world.scene.mode !== 'encounter'
    || actor.familiarState?.presence !== 'present'
    || world.scene.initiative.includes(actor.id)) return world.scene;
  if (actor.familiarState.initiative.total === null) {
    throw new Error(`Present familiar ${actor.id} requires its own Initiative before joining combat`);
  }
  const initiative = [...world.scene.initiative];
  const ownerIndex = initiative.indexOf(actor.familiarState.ownerActorId);
  initiative.splice(ownerIndex < 0 ? initiative.length : ownerIndex + 1, 0, actor.id);
  return { ...world.scene, initiative };
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function evolve(world: WorldState, payload: RuleEventPayload): WorldState {
  switch (payload.type) {
    case 'ActorDeathAdjudicated': {
      const actor = world.actors[payload.actorId];
      if (!actor || actor.lifecycle?.status !== 'alive') {
        throw new Error(`Cannot adjudicate death for non-living actor ${payload.actorId}`);
      }
      if (payload.provenance !== 'canonical_actor_lifecycle'
        || !payload.factId || payload.factId.trim() !== payload.factId
        || !payload.adjudicatedBy || payload.adjudicatedBy.trim() !== payload.adjudicatedBy
        || payload.observedAtWorldRevision !== world.revision
        || payload.rulesetContentHash !== world.ruleset.contentHash) {
        throw new Error('Actor death event has invalid lifecycle authority');
      }
      return {
        ...world,
        actors: {
          ...world.actors,
          [actor.id]: {
            ...actor,
            lifecycle: {
              status: 'dead',
              adjudication: JSON.parse(JSON.stringify(payload)) as typeof payload,
            },
          },
        },
      };
    }
    case 'ActorRuntimePatched': {
      const actor = world.actors[payload.actorId];
      if (!actor) throw new Error(`Cannot evolve unknown actor ${payload.actorId}`);
      const {
        firedThisTurn,
        firedThisRest,
        ...regularPatch
      } = payload.patch;
      const runtime = { ...actor.runtime, ...regularPatch };
      if (firedThisTurn === null) delete runtime.firedThisTurn;
      else if (firedThisTurn !== undefined) runtime.firedThisTurn = firedThisTurn;
      if (firedThisRest === null) delete runtime.firedThisRest;
      else if (firedThisRest !== undefined) runtime.firedThisRest = firedThisRest;
      return {
        ...world,
        actors: {
          ...world.actors,
          [payload.actorId]: { ...actor, runtime },
        },
      };
    }
    case 'EquipmentChanged': {
      const actor = world.actors[payload.actorId];
      if (!actor) throw new Error(`Cannot evolve equipment for unknown actor ${payload.actorId}`);
      if (payload.operation !== 'don_armor' || payload.equipment.body !== payload.cardId) {
        throw new Error(`Invalid equipment event for ${payload.actorId}`);
      }
      const changedNonBodySlot = [...new Set([
        ...Object.keys(actor.runtime.equipment),
        ...Object.keys(payload.equipment),
      ])].find((slot) => (
        slot !== 'body'
        && (actor.runtime.equipment[slot] ?? null) !== (payload.equipment[slot] ?? null)
      ));
      if (changedNonBodySlot) {
        throw new Error(`Armor event for ${payload.actorId} changed unrelated slot ${changedNonBodySlot}`);
      }
      const ended = new Set(payload.endedEffectIds);
      if (ended.size !== payload.endedEffectIds.length) {
        throw new Error(`Equipment event for ${payload.actorId} contains duplicate ended effect IDs`);
      }
      const existing = new Set(actor.runtime.activeEffects.map((effect) => effect.id));
      const unknownEnded = payload.endedEffectIds.find((effectId) => !existing.has(effectId));
      if (unknownEnded) {
        throw new Error(`Equipment event for ${payload.actorId} ends unknown effect ${unknownEnded}`);
      }
      const expectedEndedEffectIds = actor.runtime.activeEffects.flatMap((effect) => {
        const mechanics = effect.mechanics as Record<string, unknown>;
        return Array.isArray(mechanics.end_triggers)
          && mechanics.end_triggers.map(String).includes('wearer_dons_armor')
          ? [effect.id]
          : [];
      });
      if (JSON.stringify(payload.endedEffectIds) !== JSON.stringify(expectedEndedEffectIds)) {
        throw new Error(`Armor event for ${payload.actorId} has an invalid ended-effect set`);
      }
      return {
        ...world,
        actors: {
          ...world.actors,
          [payload.actorId]: {
            ...actor,
            runtime: {
              ...actor.runtime,
              equipment: { ...payload.equipment },
              activeEffects: actor.runtime.activeEffects.filter((effect) => !ended.has(effect.id)),
            },
          },
        },
      };
    }
    case 'SceneSet':
      return { ...world, scene: payload.scene };
    case 'ActionDeclared':
    case 'EngineEventRecorded':
    case 'DecisionRecorded':
      return world;
    case 'AttackActionStarted': {
      const value = payload.attackAction;
      const actor = world.actors[value.actorId];
      if (!actor
        || world.attackActions[value.id]
        || value.status !== 'open'
        || value.sequence.actorId !== value.actorId
        || value.sequence.id !== value.id
        || value.sequence.entries.length !== 0
        || value.sequence.totalAttacks !== actor.attackProfile?.attacksPerAction
        || ((value.declaredActionId === undefined)
          !== (value.declaredActionSourceEntityIds === undefined))
        || (value.declaredActionId !== undefined
          && (typeof value.declaredActionId !== 'string'
            || !value.declaredActionId.length
            || !Array.isArray(value.declaredActionSourceEntityIds)
            || !value.declaredActionSourceEntityIds.length
            || value.declaredActionSourceEntityIds.some((id) => (
              typeof id !== 'string' || !id.length
            ))
            || new Set(value.declaredActionSourceEntityIds).size
              !== value.declaredActionSourceEntityIds.length))
        || !attackSequenceInvariantHolds(value.sequence)) {
        throw new Error(`Invalid Attack action ${value.id}`);
      }
      if (Object.values(world.attackActions).some((entry) => (
        entry.actorId === value.actorId && entry.status === 'open'
      ))) {
        throw new Error(`Actor ${value.actorId} already has an open Attack action`);
      }
      return {
        ...world,
        attackActions: {
          ...world.attackActions,
          [value.id]: JSON.parse(JSON.stringify(value)) as typeof value,
        },
      };
    }
    case 'AttackEntryCommitted': {
      const attackAction = world.attackActions[payload.attackActionId];
      if (!attackAction || attackAction.status !== 'open' || attackAction.blockedByResolutionId) {
        throw new Error(`Cannot append to inactive Attack action ${payload.attackActionId}`);
      }
      const entry = payload.entry;
      const expectedSystemActionId = entry.kind === 'weapon_attack'
        ? SYSTEM_ACTION_IDS.weaponAttack
        : entry.kind === 'unarmed_strike'
          ? entry.option === 'damage'
            ? SYSTEM_ACTION_IDS.unarmedDamage
            : entry.option === 'grapple'
              ? SYSTEM_ACTION_IDS.unarmedGrapple
              : SYSTEM_ACTION_IDS.unarmedShove
          : null;
      if (expectedSystemActionId) {
        const system = getSystemActionDefinition(expectedSystemActionId)!;
        if (entry.actionId !== expectedSystemActionId
          || system.sourceEntityIds.some((sourceId) => !entry.sourceEntityIds.includes(sourceId))) {
          throw new Error(`Attack entry ${entry.ordinal} shadows a ruleset-owned system action`);
        }
      }
      let sequence;
      if (entry.kind === 'weapon_attack') {
        if (!entry.weaponCardId) throw new Error('Canonical weapon entry requires a Card ID');
        sequence = performWeaponSequenceAttack({
          sequence: attackAction.sequence,
          actionId: entry.actionId,
          weaponCardId: entry.weaponCardId,
          sourceEntityIds: [...entry.sourceEntityIds],
        });
      } else if (entry.kind === 'unarmed_strike') {
        sequence = performUnarmedStrike({
          sequence: attackAction.sequence,
          actionId: entry.actionId,
          option: entry.option,
          sourceEntityIds: [...entry.sourceEntityIds],
        });
      } else {
        sequence = replaceSequenceAttack({
          sequence: attackAction.sequence,
          actionId: entry.actionId,
          replacementKey: entry.replacementKey,
          sourceEntityIds: [...entry.sourceEntityIds],
        });
      }
      if (!sameJson(sequence.entries.at(-1), entry)) {
        throw new Error(`Attack entry ${entry.ordinal} is not the canonical next entry`);
      }
      return {
        ...world,
        attackActions: {
          ...world.attackActions,
          [attackAction.id]: { ...attackAction, sequence },
        },
      };
    }
    case 'AttackActionBlocked': {
      const attackAction = world.attackActions[payload.attackActionId];
      if (!attackAction || attackAction.status !== 'open' || attackAction.blockedByResolutionId) {
        throw new Error(`Cannot block inactive Attack action ${payload.attackActionId}`);
      }
      return {
        ...world,
        attackActions: {
          ...world.attackActions,
          [attackAction.id]: { ...attackAction, blockedByResolutionId: payload.resolutionId },
        },
      };
    }
    case 'AttackActionUnblocked': {
      const attackAction = world.attackActions[payload.attackActionId];
      if (!attackAction || attackAction.status !== 'open'
        || attackAction.blockedByResolutionId !== payload.resolutionId) {
        throw new Error(`Cannot unblock Attack action ${payload.attackActionId}`);
      }
      const next = { ...attackAction };
      delete next.blockedByResolutionId;
      return {
        ...world,
        attackActions: { ...world.attackActions, [attackAction.id]: next },
      };
    }
    case 'AttackActionClosed': {
      const attackAction = world.attackActions[payload.attackActionId];
      if (!attackAction || attackAction.status !== 'open' || attackAction.blockedByResolutionId) {
        throw new Error(`Cannot close inactive Attack action ${payload.attackActionId}`);
      }
      if (payload.reason === 'completed' && attackAction.sequence.attacksRemaining !== 0) {
        throw new Error(`Cannot complete Attack action ${payload.attackActionId} with attacks remaining`);
      }
      return {
        ...world,
        attackActions: {
          ...world.attackActions,
          [attackAction.id]: { ...attackAction, status: payload.reason },
        },
      };
    }
    case 'GrappleApplied': {
      const grapple = payload.grapple;
      const grappler = world.actors[grapple.grapplerActorId];
      const target = world.actors[grapple.targetActorId];
      const source = getSystemActionDefinition(SYSTEM_ACTION_IDS.unarmedGrapple)!;
      if (!target || !grappler || world.grapples[grapple.id]
        || grapple.grapplerActorId === grapple.targetActorId) {
        throw new Error(`Invalid grapple ${grapple.id}`);
      }
      if (!grappler.attackProfile?.graspingParts.includes(grapple.sourcePart)
        || Object.values(world.grapples).some((active) => (
          active.grapplerActorId === grappler.id && active.sourcePart === grapple.sourcePart
        ))
        || ((grapple.sourcePart === 'main_hand' || grapple.sourcePart === 'off_hand')
          && !!grappler.runtime.equipment[grapple.sourcePart])
        || (target.attackProfile?.size ?? Number.POSITIVE_INFINITY)
          > (grappler.attackProfile?.size ?? Number.NEGATIVE_INFINITY) + 1
        || !Number.isInteger(grapple.escapeDc) || grapple.escapeDc < 1
        || !Number.isFinite(grapple.reachFt) || grapple.reachFt <= 0
        || grapple.reachFt !== grappler.attackProfile?.reachFt
        || source.sourceEntityIds.some((sourceId) => !grapple.sourceEntityIds.includes(sourceId))) {
        throw new Error(`Grapple ${grapple.id} violates source size, reach, part, DC, or provenance`);
      }
      const effectId = `grapple:${grapple.id}`;
      if (target.runtime.activeEffects.some((effect) => effect.id === effectId)) {
        throw new Error(`Duplicate grapple effect ${effectId}`);
      }
      const conditionEntityRef = conditionEntityRefForRuntime('grappled');
      return {
        ...world,
        actors: {
          ...world.actors,
          [target.id]: {
            ...target,
            runtime: {
              ...target.runtime,
              activeEffects: [...target.runtime.activeEffects, {
                id: effectId,
                name: 'Grappled',
                mechanics: { kind: 'condition', value: 'grappled', grappleId: grapple.id },
                expiry: 'manual',
                source: grapple.sourceEntityIds[0],
                ...(conditionEntityRef ? { entityRef: conditionEntityRef } : {}),
                ownerId: target.id,
                sourceId: grapple.grapplerActorId,
              }],
            },
          },
        },
        grapples: { ...world.grapples, [grapple.id]: { ...grapple } },
      };
    }
    case 'GrappleEnded': {
      const grapple = world.grapples[payload.grappleId];
      if (!grapple) throw new Error(`Cannot end inactive grapple ${payload.grappleId}`);
      const target = world.actors[grapple.targetActorId];
      if (!target) throw new Error(`Cannot end grapple for missing target ${grapple.targetActorId}`);
      const grapples = { ...world.grapples };
      delete grapples[grapple.id];
      return {
        ...world,
        actors: {
          ...world.actors,
          [target.id]: {
            ...target,
            runtime: {
              ...target.runtime,
              activeEffects: target.runtime.activeEffects.filter((effect) => (
                effect.id !== `grapple:${grapple.id}`
              )),
            },
          },
        },
        grapples,
      };
    }
    case 'ShoveApplied': {
      const target = world.actors[payload.targetActorId];
      if (!target || !world.actors[payload.sourceActorId]) {
        throw new Error(`Cannot apply shove to ${payload.targetActorId}`);
      }
      if ((payload.outcome !== 'prone' && payload.outcome !== 'push_5ft')
        || !payload.effectId.trim()
        || target.runtime.activeEffects.some((effect) => effect.id === payload.effectId)) {
        throw new Error(`Invalid shove outcome for ${payload.targetActorId}`);
      }
      if (payload.outcome === 'push_5ft') return world;
      const conditionEntityRef = conditionEntityRefForRuntime('prone');
      return {
        ...world,
        actors: {
          ...world.actors,
          [target.id]: {
            ...target,
            runtime: {
              ...target.runtime,
              activeEffects: [...target.runtime.activeEffects, {
                id: payload.effectId,
                name: 'Prone',
                mechanics: { kind: 'condition', value: 'prone' },
                expiry: 'manual',
                source: 'system:dnd5e-2024:unarmed-strike:shove',
                ...(conditionEntityRef ? { entityRef: conditionEntityRef } : {}),
                ownerId: target.id,
                sourceId: payload.sourceActorId,
              }],
            },
          },
        },
      };
    }
    case 'ResolutionOpened':
      if (world.pendingResolution) {
        throw new Error(`Cannot replace active resolution ${world.pendingResolution.id}`);
      }
      return { ...world, pendingResolution: payload.resolution };
    case 'ResolutionClosed':
      if (world.pendingResolution?.id !== payload.resolutionId) {
        throw new Error(`Cannot close inactive resolution ${payload.resolutionId}`);
      }
      return { ...world, pendingResolution: null };
    case 'ConcentrationSet':
      return {
        ...world,
        concentrations: {
          ...world.concentrations,
          [payload.concentration.sourceActorId]: payload.concentration,
        },
      };
    case 'ConcentrationCleared': {
      const active = world.concentrations[payload.sourceActorId];
      if (!active || active.id !== payload.concentrationId) {
        throw new Error(`Cannot clear inactive concentration ${payload.concentrationId}`);
      }
      const concentrations = { ...world.concentrations };
      delete concentrations[payload.sourceActorId];
      return { ...world, concentrations };
    }
    case 'WorldObjectMutationRecorded': {
      const objects = evolveWorldObjectEvent(world.objects, payload.event);
      const issue = worldObjectLedgerIssue(objects, new Set(Object.keys(world.actors)));
      if (issue) throw new Error(`Invalid canonical world-object ledger: ${issue}`);
      return { ...world, objects };
    }
    case 'FamiliarActorUpserted': {
      const owner = world.actors[payload.ownerActorId];
      const familiar = payload.actor.familiarState;
      if (!owner || !familiar
        || familiar.ownerActorId !== owner.id
        || familiar.actorId !== payload.actor.id
        || payload.casting.actionId !== payload.actor.familiarMetadata?.summoningActionId
        || !Number.isInteger(payload.casting.consumedIncenseGp)
        || payload.casting.consumedIncenseGp <= 0
        || payload.casting.created !== !world.actors[payload.actor.id]
        || (payload.casting.method === 'pact_chain_magic_action') !== (familiar.extension === 'pact_chain')) {
        throw new Error(`Invalid familiar upsert for ${payload.ownerActorId}`);
      }
      const other = familiarActorsOwnedBy(world, owner.id)
        .find((candidate) => candidate.id !== payload.actor.id);
      if (other) throw new Error(`Actor ${owner.id} already owns familiar ${other.id}`);
      const ownerAfter = ownerWithFamiliarProjection(owner, familiar);
      const issue = familiarActorStateIssue({ actor: payload.actor, owner: ownerAfter });
      if (issue) throw new Error(issue);
      const actors = {
        ...world.actors,
        [owner.id]: ownerAfter,
        [payload.actor.id]: {
          ...JSON.parse(JSON.stringify(payload.actor)) as typeof payload.actor,
          lifecycle: payload.actor.lifecycle ?? { status: 'alive' as const },
        },
      };
      const interim = { ...world, actors };
      return { ...interim, scene: sceneWithPresentFamiliar(interim, actors[payload.actor.id]) };
    }
    case 'FamiliarStateChanged': {
      const actor = world.actors[payload.familiarActorId];
      const owner = world.actors[payload.ownerActorId];
      if (!actor?.familiarState || !actor.familiarMetadata || !owner
        || actor.familiarState.ownerActorId !== owner.id
        || payload.familiar.actorId !== actor.id
        || payload.familiar.ownerActorId !== owner.id) {
        throw new Error(`Invalid familiar state transition for ${payload.familiarActorId}`);
      }
      const expectedDropped = payload.familiar.presence === 'present' ? [] : [
        ...actor.familiarState.carriedItemIds,
        ...actor.familiarState.wornItemIds,
      ].sort((left, right) => left.localeCompare(right));
      if (!sameJson(payload.droppedItemIds ?? [], expectedDropped)) {
        throw new Error(`Familiar ${actor.id} has an invalid lifecycle dropped-item projection`);
      }
      const nextActor = {
        ...actor,
        familiarState: JSON.parse(JSON.stringify(payload.familiar)) as typeof payload.familiar,
        runtime: {
          ...actor.runtime,
          resources: {
            ...actor.runtime.resources,
            reaction: payload.familiar.reactionAvailable ? 1 : 0,
          },
        },
      };
      const ownerAfter = ownerWithFamiliarProjection(owner, payload.familiar);
      const issue = familiarActorStateIssue({ actor: nextActor, owner: ownerAfter });
      if (issue) throw new Error(issue);
      const actors = { ...world.actors, [owner.id]: ownerAfter, [actor.id]: nextActor };
      let interim: WorldState = { ...world, actors };
      if (payload.familiar.presence === 'present') {
        interim = { ...interim, scene: sceneWithPresentFamiliar(interim, nextActor) };
      } else {
        interim = { ...interim, scene: sceneWithoutActor(interim, actor.id) };
      }
      return interim;
    }
    case 'FamiliarActorRemoved': {
      const actor = world.actors[payload.familiarActorId];
      const owner = world.actors[payload.ownerActorId];
      if (!actor?.familiarState || !owner
        || actor.familiarState.ownerActorId !== owner.id
        || payload.reason !== 'forever_dismissal'
        || Object.values(world.attackActions).some((entry) => (
          entry.actorId === actor.id && entry.status === 'open'
        ))
        || Object.values(world.grapples).some((entry) => (
          entry.grapplerActorId === actor.id || entry.targetActorId === actor.id
        ))) {
        throw new Error(`Invalid permanent familiar dismissal for ${payload.familiarActorId}`);
      }
      const expectedDropped = [
        ...actor.familiarState.carriedItemIds,
        ...actor.familiarState.wornItemIds,
      ].sort((left, right) => left.localeCompare(right));
      if (!sameJson(payload.droppedItemIds, expectedDropped)) {
        throw new Error(`Familiar ${actor.id} has an invalid dropped-item projection`);
      }
      const actors = { ...world.actors };
      delete actors[actor.id];
      actors[owner.id] = actor.familiarState.extension === 'pact_chain'
        || owner.warlockPacts?.chain?.activeFamiliar?.actorId === actor.id
        ? ownerWithFamiliarProjection(owner, null)
        : owner;
      const without = { ...world, actors };
      return { ...without, scene: sceneWithoutActor(without, actor.id) };
    }
    case 'ProtectionEffectActivated': {
      const { effect, facts } = payload;
      const protector = world.actors[effect.protectorActorId];
      if (!protector
        || !world.actors[effect.protectedTargetActorId]
        || !world.actors[effect.triggeringAttackerActorId]
        || facts.protectorActorId !== protector.id
        || facts.targetActorId !== effect.protectedTargetActorId
        || facts.attackerActorId !== effect.triggeringAttackerActorId
        || facts.attackId !== effect.triggeringAttackId
        || facts.protectorHoldingShield !== actorHoldsCanonicalShield(protector)
        || facts.protectorReactionAvailable !== true
        || (protector.runtime.resources.reaction ?? 0) < 1
        || actorProtectionEffects(protector).some((active) => active.id === effect.id)) {
        throw new Error(`Invalid Protection activation ${effect.id}`);
      }
      const resolved = resolveProtection2024Reaction({
        decision: 'use', effectId: effect.id, source: effect.source, facts,
      });
      if (resolved.status !== 'activated' || !sameJson(resolved.effect, effect)) {
        throw new Error(`Protection activation ${effect.id} does not match its pure contract`);
      }
      const entry = protectionEffectEntry(effect);
      const entryIssue = protectionEffectEntryIssue(entry, protector, world);
      if (entryIssue) throw new Error(entryIssue);
      return {
        ...world,
        actors: {
          ...world.actors,
          [protector.id]: {
            ...protector,
            runtime: {
              ...protector.runtime,
              resources: {
                ...protector.runtime.resources,
                reaction: protector.runtime.resources.reaction! - 1,
              },
              activeEffects: [...protector.runtime.activeEffects, entry],
            },
          },
        },
      };
    }
    case 'ProtectionEffectEnded': {
      const protector = world.actors[payload.protectorActorId];
      const entry = protector?.runtime.activeEffects.find((candidate) => (
        candidate.id === payload.effectId
      ));
      const effect = entry && protector
        ? actorProtectionEffects({
            ...protector,
            runtime: { ...protector.runtime, activeEffects: [entry] },
          })[0]
        : undefined;
      if (!protector || !entry || !effect
        || effect.protectedTargetActorId !== payload.protectedTargetActorId) {
        throw new Error(`Cannot end inactive Protection effect ${payload.effectId}`);
      }
      const advanced = advanceProtection2024Effect(effect, payload.lifecycleEvent);
      if (advanced.status !== 'ended' || advanced.reason !== payload.reason) {
        throw new Error(`Protection effect ${payload.effectId} has an invalid terminal observation`);
      }
      return {
        ...world,
        actors: {
          ...world.actors,
          [protector.id]: {
            ...protector,
            runtime: {
              ...protector.runtime,
              activeEffects: protector.runtime.activeEffects.filter((candidate) => (
                candidate.id !== payload.effectId
              )),
            },
          },
        },
      };
    }
    case 'PactTomeRestCompleted':
      return evolvePactTomeRestCompleted(world, payload);
    case 'PactTomeOwnerDied':
      return evolvePactTomeOwnerDied(world, payload);
    case 'PactBladeBonded':
      return applyAuthorizedPactBladeBonded(world, payload);
    case 'PactBladeDistanceAdvanced':
      return applyAuthorizedPactBladeDistanceAdvanced(world, payload);
    case 'PactBladeEndedOnOwnerDeath':
      return applyAuthorizedPactBladeEndedOnOwnerDeath(world, payload);
    case 'PactBladeAttackProjected': {
      const actor = world.actors[payload.actorId];
      const invocation = actor?.warlockPacts?.blade;
      const bond = invocation?.activeBond;
      const object = world.objects[payload.weaponObjectId];
      if (!actor || !invocation || !bond
        || payload.revision !== world.revision + 1
        || payload.worldRevision !== world.revision
        || payload.rulesetContentHash !== world.ruleset.contentHash
        || payload.sourceEntityId !== invocation.sourceEntityId
        || !actor.capabilities.featureSources?.[PACT_BLADE_STATE_CAPABILITY]
          ?.includes(payload.sourceEntityId)
        || payload.weaponObjectId !== bond.weaponObjectId
        || payload.weaponCardId !== bond.weaponCardId
        || object?.itemCardId !== bond.weaponCardId
        || !['str', 'dex', 'cha'].includes(payload.projection.attackAbility)
        || payload.projection.attackAbility !== payload.projection.damageAbility
        || !payload.projection.damageType
        || payload.projection.proficient !== true
        || payload.projection.spellcastingFocus !== true) {
        throw new Error('Pact Blade attack projection diverges from the active Card/Object bond');
      }
      return world;
    }
    case 'PactBladeMaterialFocusProjected': {
      const actor = world.actors[payload.actorId];
      const invocation = actor?.warlockPacts?.blade;
      const bond = invocation?.activeBond;
      const object = world.objects[payload.weaponObjectId];
      if (!actor || !invocation || !bond
        || payload.revision !== world.revision + 1
        || payload.worldRevision !== world.revision
        || payload.rulesetContentHash !== world.ruleset.contentHash
        || payload.sourceEntityId !== invocation.sourceEntityId
        || payload.weaponObjectId !== bond.weaponObjectId
        || payload.weaponCardId !== bond.weaponCardId
        || object?.itemCardId !== bond.weaponCardId
        || object.heldByActorId !== actor.id
        || object.heldInHand !== payload.focusHand
        || payload.components.material !== true
        || payload.replacesMaterialComponent !== true
        || payload.preservesCostlyAndConsumedMaterials !== true
        || payload.replacesVerbalComponent !== false
        || payload.replacesSomaticComponent !== false) {
        throw new Error('Pact Blade material-focus projection diverges from the held active bond');
      }
      return world;
    }
    case 'CommandCommitted':
      return {
        ...world,
        revision: payload.revision,
        logicalClock: payload.logicalClock,
        processedCommandIds: [...world.processedCommandIds, payload.commandId],
      };
  }
}

export function foldEvents(world: WorldState, events: readonly UncommittedRuleEvent[]): WorldState {
  return events.reduce((state, event) => evolve(state, event.payload), world);
}
