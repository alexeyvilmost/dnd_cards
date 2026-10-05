/** Saved attack/damage decisions. Rules and projection services remain owned by
 * their existing implementations; this module owns only continuation order. */
import {hasReactionTrigger} from './triggerOwnership';
import {damageTransferSpec, transferDamageEvents} from './damageTransfer';
import {effectiveArmorClass} from './actorArmorClass';
import {CORE_WEAPON_ATTACK, unarmedDamageActionFor, weaponAttackAction} from './attackDefinitions';
import {meleeWeaponDefenseEligible, singleAttackDefenseBonus} from './attackDefenseRuntime';
import {canPay, deniedCapabilities, executeAction, addBonusDieToD20Roll} from './legacy/engineAdapter';
import {defensiveDuelistReactionEligible} from './generalFeatReactionRuntime';
import type {EngineEvent} from './legacy/engineAdapter';
import type {ActorState, CommandResult, DeterministicEnvironment, GameCommand, PendingResolutionFollowUp, RuleActionDefinition, RulesCatalog, WorldState} from './domain';
import {foldEvents} from './reducer';
import {SYSTEM_ACTION_IDS} from './systemActions';
import {familiarAttackRuleAction} from './familiarRuntime';
import type {AttackDamageContinuationServices, EventInput, CanonicalSpellContext} from './handler';

export function createAttackDamageContinuations(services: AttackDamageContinuationServices) {
  const {rejected, attackAdjustmentOptions, payCommandCost, activationCost, runtimeTransition, engineTrace, actorCard, weaponRanges, lightWeaponExtraAttackAction, selectedWeaponUsesMastery, hitReactionOptions, attackResolutionFinishedEvents, cloneReactionOption, blockAttackActionEvent, persistedPactBladeExecution, cleaveWindowFor, cleaveWeaponAttackAction, pactBladeWeaponAttackAction, actionDefinitionIssue, spellDeclarationIssue, prepareReactionExecution, actionContext, withoutActivationCost, shouldDeferDamageConsequences, worldActionPrimitive, resolveTemporaryHpMeleeRetaliationAfterAttack, withoutPactBladeEquipmentProjection, actionObligationIds, relabelAttackRolls, damageReactionOpenedEvents, actionDeclaredEvent, settleDamageConsequences, actionStateEvents, attackFollowUpEvents, damageReactors, requiredActionCapability, damageBeforeResistance, adjustedDamageEvents, applyReactionRuntimeDelta, hpAfterDamage, damagePackets, finalizeTargetSave, concentrationSaveFollowUp, followUpOpenedEvents} = services;


/** Resume the existing attack continuation after a source-side adjustment.
 * The original attack roll is retained; only the bonus die and eventual damage draw RNG. */
function resolveAttackAdjustment(
  world: WorldState, command: Extract<GameCommand, {type:'ResolveDecision'}>,
  catalog: RulesCatalog, env: DeterministicEnvironment,
): CommandResult | EventInput[] {
  const pending = world.pendingResolution;
  if (!pending || pending.type !== 'attack_reaction' || !pending.attackAdjustment
    || pending.id !== command.resolutionId || pending.request.id !== command.requestId
    || command.actorId !== pending.sourceActorId || pending.request.actorId !== command.actorId
    || command.response.kind !== 'reaction' || command.response.spell !== undefined) {
    return rejected(world,'InvalidDecision','The decision does not match the source attack adjustment');
  }
  const source = world.actors[pending.sourceActorId];
  const target = world.actors[pending.targetActorId];
  const obligations = ['system:attack-resolution','system:pending-resolution'];
  let attackRoll = pending.attackRoll;
  const prefix: EventInput[] = [{sourceActorId:source.id,obligationIds:obligations,payload:{
    type:'DecisionRecorded',resolutionId:pending.id,requestId:pending.request.id,actorId:source.id,response:command.response,
  }}];
  const adjustmentId = command.response.actionId;
  if(adjustmentId !== null) {
    const chosen = attackAdjustmentOptions(source,target,catalog).find(action=>action.id===adjustmentId);
    if (!chosen || !pending.request.options.some(option=>option.actionId===chosen.id) || attackRoll.attackManeuverActionId
      || (attackRoll.outcome !== 'miss' && attackRoll.outcome !== 'crit_miss')) {
      return rejected(world,'InvalidDecision','This attack adjustment is not available');
    }
    const activation = chosen.mechanics.activation as Record<string, unknown>;
    const trigger = activation.trigger as Record<string, unknown>;
    const paid = payCommandCost(source,activationCost(chosen),env);
    if(!paid.events.some(event=>event.type==='execution_cancelled')) attackRoll = {...addBonusDieToD20Roll(attackRoll,Number(trigger.attack_roll_bonus_die),chosen.name,env.rng),attackManeuverActionId:chosen.id};
    prefix.push(...runtimeTransition(source.id,source.id,source.runtime,paid.state,'action',obligations),
      ...engineTrace(source.id,[target.id],paid.events,obligations));
  }
  const adjustedWorld = foldEvents(world,prefix.map((event,ordinal)=>({...event,ordinal})));
  const adjustedPending = {...pending,attackRoll,attackAdjustment:undefined,
    request:{...pending.request,actorId:target.id,trigger:{type:'hit_by_attack' as const,sourceActorId:source.id,
      actionId:pending.actionId,attackTotal:attackRoll.total,originalAc:effectiveArmorClass(target)},options:[]}};
  const adjustedSource = adjustedWorld.actors[source.id];
  const heldWeapon = pending.weaponCardId ? actorCard(adjustedSource,pending.weaponCardId) : undefined;
  const heldRange = heldWeapon ? weaponRanges(heldWeapon,pending.facts.distanceFt) : null;
  const attack = pending.actionId === SYSTEM_ACTION_IDS.unarmedDamage ? unarmedDamageActionFor(adjustedSource)
    : pending.actionId === SYSTEM_ACTION_IDS.weaponAttack
      ? pending.weaponHand && heldRange ? weaponAttackAction(pending.weaponHand,heldRange.kind) : CORE_WEAPON_ATTACK
    : pending.actionId === SYSTEM_ACTION_IDS.lightExtraAttack
      ? pending.weaponHand && heldWeapon && heldRange ? lightWeaponExtraAttackAction(adjustedSource,pending.weaponHand,heldRange.kind,
        selectedWeaponUsesMastery(adjustedSource,heldWeapon.id,'nick') ? 'attack_action' : 'bonus_action') : undefined
    : catalog.getAction(pending.actionId) ?? familiarAttackRuleAction(adjustedSource,pending.actionId);
  if (!attack) return rejected(world,'ActionNotFound','The held attack definition is missing');
  const reactions = attackRoll.outcome === 'hit' || attackRoll.outcome === 'crit'
    ? hitReactionOptions(target,catalog,attack,pending.facts) : [];
  if(reactions.length) {
    const nextId=env.nextId();
    prefix.push(...engineTrace(source.id,[target.id],[{type:'roll',label:'Атака — после приёма',roll:attackRoll}],obligations),
      {sourceActorId:source.id,obligationIds:obligations,payload:{type:'ResolutionClosed',resolutionId:pending.id}});
    if(pending.attackActionId) prefix.push(...attackResolutionFinishedEvents({
      attackAction:world.attackActions[pending.attackActionId],resolutionId:pending.id,actorId:source.id,obligations,closeIfComplete:false,
    }));
    prefix.push({sourceActorId:source.id,obligationIds:obligations,payload:{type:'ResolutionOpened',resolution:{
      ...adjustedPending,id:nextId,request:{...adjustedPending.request,id:env.nextId(),options:reactions.map(({option})=>cloneReactionOption(option))},
    }}});
    if(pending.attackActionId) prefix.push(blockAttackActionEvent({actorId:source.id,attackActionId:pending.attackActionId,resolutionId:nextId,obligations}));
    return prefix;
  }
  // Reuse damage, mastery saves, retaliation and Attack-action ledger settlement.
  // Its synthetic decline is internal; only the actual source decision is journaled.
  const finished = resolvePendingAttack({...adjustedWorld,pendingResolution:adjustedPending},
    {...command,actorId:target.id,response:{kind:'reaction',actionId:null}},catalog,env);
  return Array.isArray(finished) ? [...prefix,...finished.filter(event=>event.payload.type !== 'DecisionRecorded')] : finished;
}


function resolvePendingAttack(
  world: WorldState,
  command: Extract<GameCommand, { type: 'ResolveDecision' }>,
  catalog: RulesCatalog,
  env: DeterministicEnvironment,
): CommandResult | EventInput[] {
  const pending = world.pendingResolution;
  if (!pending || pending.type !== 'attack_reaction') {
    return rejected(world, 'NoPendingResolution', 'There is no attack reaction to resolve');
  }
  if (pending.attackAdjustment) return resolveAttackAdjustment(world,command,catalog,env);
  if (pending.id !== command.resolutionId || pending.request.id !== command.requestId) {
    return rejected(world, 'StaleDecision', 'Decision does not match the active request');
  }
  if (pending.targetActorId !== command.actorId || pending.request.actorId !== command.actorId) {
    return rejected(world, 'InvalidDecision', 'Only the attacked actor can resolve this reaction');
  }
  if (command.response.kind !== 'reaction') {
    return rejected(world, 'InvalidDecision', 'An attack reaction requires a reaction response');
  }
  if (command.response.actionId === null && command.response.spell !== undefined) {
    return rejected(world, 'InvalidDecision', 'A declined reaction cannot select a spell source');
  }

  const source = world.actors[pending.sourceActorId];
  const target = world.actors[pending.targetActorId];
  let sourceForAttack = source;
  let pendingWeapon = pending.weaponCardId ? actorCard(source, pending.weaponCardId) : undefined;
  if (pending.pactBladeProjection) {
    if (pending.actionId !== SYSTEM_ACTION_IDS.weaponAttack
      || pending.weaponHand !== pending.pactBladeProjection.weaponHand
      || pending.weaponCardId !== pending.pactBladeProjection.weaponCardId) {
      return rejected(world, 'InvalidDecision', 'Attack reaction lost its Pact Blade continuation identity');
    }
    const persisted = persistedPactBladeExecution({
      world,
      catalog,
      source,
      commandId: pending.openedByCommandId,
      projection: pending.pactBladeProjection,
    });
    if ('issue' in persisted) return rejected(world, 'InvalidDecision', persisted.issue);
    sourceForAttack = persisted.actor;
    pendingWeapon = persisted.card;
  } else if ((pending.weaponHand === undefined) !== (pending.weaponCardId === undefined)
    || (pending.weaponHand && (!pendingWeapon
      || pendingWeapon.type !== 'weapon'
      || source.runtime.equipment[pending.weaponHand === 'main' ? 'main_hand' : 'off_hand']
        !== pendingWeapon.id))) {
    return rejected(world, 'InvalidDecision', 'Attack reaction lost its exact equipped weapon');
  }
  const pendingWeaponRange = pendingWeapon
    ? weaponRanges(pendingWeapon, pending.facts.distanceFt)
    : null;
  if (pendingWeapon && !pendingWeaponRange) {
    return rejected(world, 'InvalidDecision', 'Attack reaction weapon profile or range is no longer valid');
  }
  const baseAttack = pending.actionId === SYSTEM_ACTION_IDS.weaponAttack
    ? pending.weaponHand && pendingWeapon
      ? cleaveWindowFor({
        actor: sourceForAttack,
        weaponCardId: pendingWeapon.id,
        committedByCommandId: pending.openedByCommandId,
      })
        ? cleaveWeaponAttackAction(sourceForAttack, pending.weaponHand)
        : weaponAttackAction(pending.weaponHand, pendingWeaponRange!.kind)
      : CORE_WEAPON_ATTACK
    : pending.actionId === SYSTEM_ACTION_IDS.lightExtraAttack
      ? pending.weaponHand && pendingWeapon
        ? lightWeaponExtraAttackAction(
          sourceForAttack,
          pending.weaponHand,
          pendingWeaponRange!.kind,
          selectedWeaponUsesMastery(sourceForAttack, pendingWeapon.id, 'nick')
            ? 'attack_action'
            : 'bonus_action',
        )
        : null
    : pending.actionId === SYSTEM_ACTION_IDS.unarmedDamage
      ? unarmedDamageActionFor(sourceForAttack)
      : catalog.getAction(pending.actionId)
        ?? familiarAttackRuleAction(sourceForAttack, pending.actionId);
  const attack = baseAttack && pending.pactBladeProjection
    ? pactBladeWeaponAttackAction(baseAttack, pending.pactBladeProjection)
    : baseAttack;
  if (!attack) return rejected(world, 'ActionNotFound', `Unknown action ${pending.actionId}`);
  const attackDefinitionIssue = actionDefinitionIssue(attack);
  if (attackDefinitionIssue) return rejected(world, 'InvalidActionDefinition', attackDefinitionIssue);

  let targetRuntime = target.runtime;
  let reactionEvents: EngineEvent[] = [];
  let selectedReaction: RuleActionDefinition | undefined;
  let selectedReactionSpell: CanonicalSpellContext | undefined;
  const selectedId = command.response.actionId;
  if (selectedId !== null) {
    if (!pending.request.options.some((option) => option.actionId === selectedId)) {
      return rejected(world, 'InvalidDecision', `Reaction ${selectedId} was not offered`);
    }
    if (!target.capabilities.actionIds.includes(selectedId)) {
      return rejected(world, 'ActionNotGranted', `Actor ${target.id} does not own reaction ${selectedId}`);
    }
    const reaction = catalog.getAction(selectedId);
    if (!reaction || !hasReactionTrigger(reaction, 'hit_by_attack')) {
      return rejected(world, 'InvalidDecision', `Reaction ${selectedId} is no longer valid for this trigger`);
    }
    const reactionActivation = reaction.mechanics.activation as Record<string, unknown> | undefined;
    const reactionTrigger = reactionActivation?.trigger as Record<string, unknown> | undefined;
    if (reactionTrigger?.melee_attack_while_holding_weapon === true && !meleeWeaponDefenseEligible(target, attack)) {
      return rejected(world, 'InvalidEquipmentState', 'Parry requires a held weapon and a melee attack');
    }
    if (reactionTrigger?.feat_defensive_duelist === true
      && !defensiveDuelistReactionEligible({
        defender: target,
        incomingAction: attack,
        facts: pending.facts,
      })) {
      return rejected(world, 'InvalidEquipmentState', 'Defensive Duelist requires a held Finesse weapon and a melee attack');
    }
    const definitionIssue = actionDefinitionIssue(reaction);
    if (definitionIssue) return rejected(world, 'InvalidActionDefinition', definitionIssue);
    const declarationIssue = spellDeclarationIssue(reaction);
    if (declarationIssue) return rejected(world, 'InvalidSpellDeclaration', declarationIssue);
    if (deniedCapabilities(targetRuntime, target.passives ?? []).has('reaction')) {
      return rejected(world, 'CapabilityDenied', `${target.id} cannot take reactions in its current state`);
    }
    const preparedReaction = prepareReactionExecution(target, reaction, command.response.spell);
    if (preparedReaction.status === 'rejected') {
      return rejected(world, preparedReaction.code, preparedReaction.message);
    }
    const payable = canPay(targetRuntime, activationCost(preparedReaction.action));
    if (!payable.ok) {
      return rejected(world, 'InsufficientResources', `Missing reaction resources: ${payable.missing.join(', ')}`);
    }
    selectedReaction = preparedReaction.action;
    selectedReactionSpell = preparedReaction.spell;
    const reactionResult = executeAction(targetRuntime, preparedReaction.action.mechanics, {
      ...actionContext(target, env, undefined, undefined, undefined, selectedReactionSpell),
      actionName: preparedReaction.action.name,
      spell: selectedReactionSpell,
    });
    targetRuntime = reactionResult.state;
    reactionEvents = reactionResult.events;
  }

  const defenseBonus = selectedReaction ? singleAttackDefenseBonus(selectedReaction) : 0;
  const targetAfterReaction: ActorState = { ...target, runtime: targetRuntime,
    ...(defenseBonus ? {ac: effectiveArmorClass(target, {...target.runtime, activeEffects: []}) + defenseBonus} : {}) };
  // Weapon/stat-block cover is an execution projection, never durable actor AC.
  // Preserve the committed attack's situational offset across accepting/declining
  // a reaction; only the actual defense delta may change its AC/outcome.
  const attackAcOffset = (pending.attackRoll.target?.value ?? effectiveArmorClass(target)) - effectiveArmorClass(target);
  const targetForResolution: ActorState = attackAcOffset ? {...targetAfterReaction,
    ac: (targetAfterReaction.ac ?? effectiveArmorClass(targetAfterReaction, {...targetRuntime, activeEffects: []})) + attackAcOffset} : targetAfterReaction;
  if(source.id===target.id)sourceForAttack={...sourceForAttack,runtime:targetRuntime};
  const resumed = executeAction(sourceForAttack.runtime, withoutActivationCost(attack.mechanics), {
    ...actionContext(sourceForAttack, env, targetForResolution, targetRuntime, pending.facts, pending.spell),
    ...(pending.attackActionId ? { attackActionId: pending.attackActionId } : {}),
    attackCommandId: pending.openedByCommandId,
    choices: pending.choices,
    spell: pending.spell,
    suppressSpellCastEvent: true,
    forcedAttackRoll: pending.attackRoll,
    deferIncomingDamageConsequences: shouldDeferDamageConsequences(sourceForAttack, targetAfterReaction, attack, catalog, pending.facts, world),
    deferTargetSaves: true,
    ...(worldActionPrimitive(attack) ? { externalPrimitiveHandled: true as const } : {}),
  });
  const armor = resolveTemporaryHpMeleeRetaliationAfterAttack({
    world,
    attacker: sourceForAttack,
    defender: targetAfterReaction,
    attackerAfter: resumed.state,
    defenderAfter: resumed.targetState ?? targetRuntime,
    action: attack,
    attackEvents: resumed.events,
    env,
  });
  let sourceAfter = pending.pactBladeProjection
    ? withoutPactBladeEquipmentProjection(armor.attackerAfter, source.runtime)
    : armor.attackerAfter;
  let finalTargetRuntime = source.id===target.id?sourceAfter:armor.defenderAfter ?? targetRuntime;
  const obligations = [...new Set([
    ...actionObligationIds(
      attack,
      'system:attack-resolution',
      'system:reaction-window',
      'system:pending-resolution',
    ),
    ...(selectedReaction ? actionObligationIds(selectedReaction) : []),
    ...(armor.retaliationEvents.length ? ['system:temporary-hp-melee-retaliation', 'system:retaliation'] : []),
    ...armor.retaliationSourceEntityIds.map((sourceId) => `entity:${sourceId}`),
  ])];
  const resumedAttackEvents = relabelAttackRolls(
    resumed.events,
    selectedId ? 'Атака — после реакции' : 'Атака',
  );
  const damageWindow = damageReactionOpenedEvents({
    world,
    commandId: command.commandId,
    source: sourceForAttack,
    target: targetAfterReaction,
    action: attack,
    facts: pending.facts,
    targetRuntimeBeforeDamage: targetRuntime,
    sourceRuntimeAfter: sourceAfter,
    targetRuntimeAfter: finalTargetRuntime,
    preDamageTargetEvents: reactionEvents,
    attackEvents: resumedAttackEvents,
    retaliationEvents: armor.retaliationEvents,
    retaliationSourceEntityIds: armor.retaliationSourceEntityIds,
    deferredTargetSaves: resumed.deferredTargetSaves,
    attackActionId: pending.attackActionId,
    catalog,
    env,
    obligations,
  });
  if (damageWindow) {
    const opened = damageWindow[0]?.payload.type === 'ResolutionOpened'
      ? damageWindow[0].payload.resolution
      : null;
    if (!opened || opened.type !== 'damage_reaction') {
      return rejected(world, 'InvalidDecision', 'Damage reaction continuation was not created');
    }
    const chained: EventInput[] = [{
      sourceActorId: target.id,
      obligationIds: obligations,
      payload: {
        type: 'DecisionRecorded',
        resolutionId: pending.id,
        requestId: pending.request.id,
        actorId: target.id,
        response: command.response,
      },
    }];
    if (selectedReaction) {
      chained.push(actionDeclaredEvent({
        actorId: target.id,
        action: selectedReaction,
        targetIds: [target.id],
        timing: 'reaction',
        spell: selectedReactionSpell,
        obligationIds: obligations,
      }));
    }
    chained.push({
      sourceActorId: target.id,
      obligationIds: obligations,
      payload: { type: 'ResolutionClosed', resolutionId: pending.id },
    });
    if (pending.attackActionId) {
      const attackAction = world.attackActions[pending.attackActionId];
      if (!attackAction || attackAction.blockedByResolutionId !== pending.id) {
        return rejected(world, 'InvalidDecision', 'Attack reaction lost its canonical Attack-action ledger');
      }
      chained.push(...attackResolutionFinishedEvents({
        attackAction,
        resolutionId: pending.id,
        actorId: source.id,
        obligations: [...obligations, 'system:attack-action'],
        closeIfComplete: false,
      }));
    }
    chained.push(...damageWindow);
    if (pending.attackActionId) {
      chained.push(blockAttackActionEvent({
        actorId: source.id,
        attackActionId: pending.attackActionId,
        resolutionId: opened.id,
        obligations: [...obligations, 'system:attack-action'],
      }));
    }
    return chained;
  }
  const completedDamage = settleDamageConsequences(targetAfterReaction, finalTargetRuntime, resumedAttackEvents, env,{...source,runtime:sourceAfter});
  sourceAfter=completedDamage.sourceState??sourceAfter;
  finalTargetRuntime = completedDamage.state;
  resumedAttackEvents.splice(0, resumedAttackEvents.length, ...completedDamage.events);

  const events: EventInput[] = [];
  events.push({
    sourceActorId: target.id,
    obligationIds: obligations,
    payload: {
      type: 'DecisionRecorded',
      resolutionId: pending.id,
      requestId: pending.request.id,
      actorId: target.id,
      response: command.response,
    },
  });
  if (selectedReaction) {
    events.push(actionDeclaredEvent({
      actorId: target.id,
      action: selectedReaction,
      targetIds: [target.id],
      timing: 'reaction',
      spell: selectedReactionSpell,
      obligationIds: obligations,
    }));
  }
  events.push(...actionStateEvents({
    env,
    world,
    commandId: pending.openedByCommandId,
    source: sourceForAttack,
    action: attack,
    sourceAfter,
    target,
    targetAfter: finalTargetRuntime,
    obligations,
  }));
  if (reactionEvents.length) {
    events.push(...engineTrace(target.id, [target.id], reactionEvents, obligations));
  }
  events.push(...engineTrace(source.id, [target.id], resumedAttackEvents, obligations));
  events.push(...engineTrace(target.id, [source.id], armor.retaliationEvents, obligations, {
    sourceActorId: target.id,
    facts: { trigger: 'temporary_hp_melee_retaliation' },
  }));
  events.push({
    sourceActorId: target.id,
    obligationIds: obligations,
    payload: { type: 'ResolutionClosed', resolutionId: pending.id },
  });
  if (pending.attackActionId) {
    const attackAction = world.attackActions[pending.attackActionId];
    if (!attackAction || attackAction.blockedByResolutionId !== pending.id) {
      return rejected(world, 'InvalidDecision', 'Attack reaction lost its canonical Attack-action ledger');
    }
    events.push({
      sourceActorId: source.id,
      obligationIds: [...obligations, 'system:attack-action'],
      payload: {
        type: 'AttackActionUnblocked',
        attackActionId: attackAction.id,
        resolutionId: pending.id,
      },
    });
    if (attackAction.sequence.attacksRemaining === 0) {
      events.push({
        sourceActorId: source.id,
        obligationIds: [...obligations, 'system:attack-action'],
        payload: { type: 'AttackActionClosed', attackActionId: attackAction.id, reason: 'completed' },
      });
    }
  }
  events.push(...attackFollowUpEvents({
    world,
    commandId: command.commandId,
    source: sourceForAttack,
    sourceAfter,
    target,
    targetAfter: finalTargetRuntime,
    action: attack,
    deferred: resumed.deferredTargetSaves,
    env,
    obligations,
  }));
  return events;
}


function resolvePendingDamageReaction(
  world: WorldState,
  command: Extract<GameCommand, { type: 'ResolveDecision' }>,
  catalog: RulesCatalog,
  env: DeterministicEnvironment,
): CommandResult | EventInput[] {
  const pending = world.pendingResolution;
  if (!pending || pending.type !== 'damage_reaction') {
    return rejected(world, 'NoPendingResolution', 'There is no incoming-damage reaction to resolve');
  }
  if (pending.id !== command.resolutionId || pending.request.id !== command.requestId) {
    return rejected(world, 'StaleDecision', 'Decision does not match the active damage request');
  }
  if (pending.request.actorId !== command.actorId) {
    return rejected(world, 'InvalidDecision', 'Only the requested reactor can resolve this reaction');
  }
  if (command.response.kind !== 'reaction') {
    return rejected(world, 'InvalidDecision', 'Incoming damage requires a reaction response');
  }
  if (command.response.actionId === null && command.response.spell !== undefined) {
    return rejected(world, 'InvalidDecision', 'A declined reaction cannot select a spell source');
  }
  const source = world.actors[pending.sourceActorId];
  const target = world.actors[pending.targetActorId];
  if (!source || !target) return rejected(world, 'ActorNotFound', 'Damage continuation actor is missing');
  if (pending.request.trigger.type !== 'damage_taken'
    || pending.request.trigger.sourceActorId !== source.id
    || pending.request.trigger.actionId !== pending.actionId
    || pending.request.trigger.amount !== pending.damage.reduce((sum, packet) => sum + packet.amount, 0)) {
    return rejected(world, 'InvalidDecision', 'Incoming-damage continuation metadata is inconsistent');
  }
  if (pending.action.id !== pending.actionId || actionDefinitionIssue(pending.action)) {
    return rejected(world, 'InvalidActionDefinition', 'Held damage action is no longer a valid definition');
  }

  const reactor = world.actors[command.actorId];
  if (!reactor) return rejected(world,'ActorNotFound','Damage reactor is missing');
  const isTargetReactor = reactor.id === target.id;
  let targetReactionRuntime = pending.targetRuntimeBeforeDamage;
  let reactorRuntime = isTargetReactor ? targetReactionRuntime : reactor.id === source.id ? pending.sourceRuntimeAfter : reactor.runtime;
  let sourceAfter = pending.sourceRuntimeAfter;
  let reactionEvents: EngineEvent[] = [];
  let selectedReaction: RuleActionDefinition | undefined;
  let selectedReactionSpell: CanonicalSpellContext | undefined;
  let reactionTargetIds: string[] = [];
  const selectedId = command.response.actionId;
  if (selectedId !== null) {
    if (!pending.request.options.some((option) => option.actionId === selectedId)) {
      return rejected(world, 'InvalidDecision', `Reaction ${selectedId} was not offered`);
    }
    if (!reactor.capabilities.actionIds.includes(selectedId)) {
      return rejected(world, 'ActionNotGranted', `Actor ${reactor.id} does not own reaction ${selectedId}`);
    }
    const reaction = catalog.getAction(selectedId);
    if (!reaction || !hasReactionTrigger(reaction, 'damage_taken')) {
      return rejected(world, 'InvalidDecision', `Reaction ${selectedId} is no longer valid for damage_taken`);
    }
    const definitionIssue = actionDefinitionIssue(reaction);
    if (definitionIssue) return rejected(world, 'InvalidActionDefinition', definitionIssue);
    const declarationIssue = spellDeclarationIssue(reaction);
    if (declarationIssue) return rejected(world, 'InvalidSpellDeclaration', declarationIssue);
    const targetAtWindow: ActorState = { ...reactor, runtime: reactorRuntime };
    const available = damageReactors({...world, actors:{...world.actors,[reactor.id]:targetAtWindow}}, {...target,runtime:targetReactionRuntime}, catalog, pending.facts, pending.action,pending.attackEvents);
    if (!available.some(row=>row.actor.id===reactor.id && row.options.some(option=>option.action.id===selectedId))) return rejected(world,'InvalidDecision','Damage reaction is no longer eligible');
    if (deniedCapabilities(reactorRuntime, reactor.passives ?? []).has(requiredActionCapability(reaction))) {
      return rejected(world, 'CapabilityDenied', `${reactor.id} cannot take reactions in its current state`);
    }
    const prepared = prepareReactionExecution(targetAtWindow, reaction, command.response.spell);
    if (prepared.status === 'rejected') return rejected(world, prepared.code, prepared.message);
    const payable = canPay(reactorRuntime, activationCost(prepared.action));
    if (!payable.ok) {
      return rejected(world, 'InsufficientResources', `Missing reaction resources: ${payable.missing.join(', ')}`);
    }
    selectedReaction = prepared.action;
    selectedReactionSpell = prepared.spell;
    const selfOnly = prepared.action.targeting?.allowedRelations.every((relation) => relation === 'self') === true;
    const reactionTarget = selfOnly
      ? undefined
      : { ...source, runtime: sourceAfter };
    reactionTargetIds = !isTargetReactor ? [target.id] : selfOnly ? [target.id] : [source.id];
    const result = executeAction(reactorRuntime, prepared.action.mechanics, {
      ...actionContext(
        targetAtWindow,
        env,
        reactionTarget,
        reactionTarget?.runtime,
        reactionTarget ? pending.facts : undefined,
        selectedReactionSpell,
      ),
      actionName: prepared.action.name,
      spell: selectedReactionSpell,
      incomingDamage: damageBeforeResistance(pending.attackEvents),
    });
    reactorRuntime = result.state;
    if (isTargetReactor) targetReactionRuntime = result.state;
    if (reactor.id === source.id) sourceAfter = result.state;
    else sourceAfter = result.targetState ?? sourceAfter;
    reactionEvents = result.events;
  }

  const rolledReduction = reactionEvents.reduce((sum, event) => (
    event.type === 'damage_reduction' ? sum + event.amount : sum
  ), 0);
  const multipliers=reactionEvents.filter(event=>event.type==='damage_multiplier');
  if(multipliers.length>1)throw new Error('Only one incoming damage multiplier may resolve in a reaction');
  const multiplier=multipliers[0]?.factor??1;
  const originalAmount = pending.damage.reduce((sum, packet) => sum + packet.amount, 0);
  const reduction = Math.min(damageBeforeResistance(pending.attackEvents)*multiplier, Math.max(0, Math.floor(rolledReduction)));
  let adjusted = adjustedDamageEvents(pending.attackEvents, reduction,multiplier);
  const transfer=selectedReaction?damageTransferSpec(selectedReaction):null;
  if(transfer&&!reactionEvents.some(event=>event.type==='execution_cancelled')){
    const moved=transferDamageEvents(adjusted.events,transfer.fraction,source.id,reactor.id,selectedReaction!.name);
    adjusted={events:moved.events,amount:moved.amount};
    reactionEvents.push(...moved.transferred);
  }
  let targetAfter = applyReactionRuntimeDelta(
    pending.targetRuntimeAfter,
    pending.targetRuntimeBeforeDamage,
    targetReactionRuntime,
  );
  targetAfter = {
    ...targetAfter,
    hp: hpAfterDamage(targetReactionRuntime.hp, adjusted.amount),
  };
  const reactionObligations = [...new Set([...pending.obligationIds,...(selectedReaction?actionObligationIds(selectedReaction):[])])];
  const reactorEvents: EventInput[] = [
    {sourceActorId:reactor.id,obligationIds:reactionObligations,payload:{type:'DecisionRecorded',resolutionId:pending.id,requestId:pending.request.id,actorId:reactor.id,response:command.response}},
    ...(selectedReaction ? [actionDeclaredEvent({actorId:reactor.id,action:selectedReaction,targetIds:reactionTargetIds,timing:'reaction',spell:selectedReactionSpell,obligationIds:reactionObligations})] : []),
    ...runtimeTransition(reactor.id,reactor.id,reactor.runtime,reactorRuntime,'action',reactionObligations),
    ...engineTrace(reactor.id,reactionTargetIds,reactionEvents,reactionObligations),
  ];
  const worldAfterReaction = {...world,actors:{...world.actors,[reactor.id]:{...reactor,runtime:reactorRuntime}}};
  const remaining = adjusted.amount > 0 ? damageReactors(worldAfterReaction,{...target,runtime:targetReactionRuntime},catalog,pending.facts,pending.action,adjusted.events)
    .filter(row => pending.remainingReactorIds?.includes(row.actor.id)) : [];
  if (remaining.length) {
    const [nextReactor,...later] = remaining;
    const packets = damagePackets(adjusted.events);
    return [...reactorEvents,
      {sourceActorId:reactor.id,obligationIds:reactionObligations,payload:{type:'ResolutionClosed',resolutionId:pending.id}},
      {sourceActorId:source.id,obligationIds:reactionObligations,payload:{type:'ResolutionOpened',resolution:{...pending,
        remainingReactorIds:later.map(row=>row.actor.id), targetRuntimeBeforeDamage:targetReactionRuntime,
        targetRuntimeAfter:targetAfter,sourceRuntimeAfter:sourceAfter,damage:packets,attackEvents:adjusted.events,
        request:{...pending.request,id:env.nextId(),actorId:nextReactor.actor.id,options:nextReactor.options.map(({option})=>cloneReactionOption(option)),
          trigger:{...pending.request.trigger,amount:adjusted.amount,damageTypes:[...new Set(packets.map(packet=>packet.damageType))]}}
      }}}
    ];
  }
  const completedDamage = settleDamageConsequences(
    { ...target, runtime: targetReactionRuntime }, targetAfter, adjusted.events, env,{...source,runtime:sourceAfter},
  );
  targetAfter = completedDamage.state;
  sourceAfter=completedDamage.sourceState??sourceAfter;
  if(source.id===target.id)sourceAfter=targetAfter;
  adjusted.events = completedDamage.events;
  if(pending.targetSaveContinuation){
    const saved=pending.targetSaveContinuation;
    const prefix:EventInput[]=[{sourceActorId:reactor.id,obligationIds:reactionObligations,payload:{type:'DecisionRecorded',resolutionId:pending.id,requestId:pending.request.id,actorId:reactor.id,response:command.response}},
      ...(selectedReaction?[actionDeclaredEvent({actorId:reactor.id,action:selectedReaction,targetIds:reactionTargetIds,timing:'reaction',spell:selectedReactionSpell,obligationIds:reactionObligations})]:[]),
      ...engineTrace(reactor.id,reactionTargetIds,reactionEvents,reactionObligations),
    ];
    if(!isTargetReactor&&reactor.id!==source.id)prefix.push(...runtimeTransition(reactor.id,reactor.id,reactor.runtime,reactorRuntime,'action',reactionObligations));
    return [...prefix,...finalizeTargetSave({world,command,pending:{...saved.pending,id:pending.id},action:pending.action,source,target,
      result:{state:sourceAfter,targetState:targetAfter,events:adjusted.events},targetRuntimeForResolution:targetReactionRuntime,
      roll:saved.saveRoll,boonEvents:[],sharedDamage:{rolls:saved.sharedDamageRolls},env,alreadyRecorded:true,
    })];
  }
  const obligations = [...new Set([
    ...pending.obligationIds,
    ...(selectedReaction ? actionObligationIds(selectedReaction) : []),
  ])];
  const events: EventInput[] = [{
    sourceActorId: reactor.id,
    obligationIds: obligations,
    payload: {
      type: 'DecisionRecorded',
      resolutionId: pending.id,
      requestId: pending.request.id,
      actorId: reactor.id,
      response: command.response,
    },
  }];
  if (selectedReaction) {
    events.push(actionDeclaredEvent({
      actorId: reactor.id,
      action: selectedReaction,
      targetIds: reactionTargetIds,
      timing: 'reaction',
      spell: selectedReactionSpell,
      obligationIds: obligations,
    }));
  }
  if (!isTargetReactor && reactor.id !== source.id) events.push(...runtimeTransition(reactor.id,reactor.id,reactor.runtime,reactorRuntime,'action',obligations));
  events.push(...actionStateEvents({
    env,
    world,
    commandId: pending.openedByCommandId,
    source,
    action: pending.action,
    sourceAfter,
    target,
    targetAfter,
    obligations,
  }));
  if (pending.preDamageTargetEvents.length) {
    events.push(...engineTrace(target.id, [target.id], pending.preDamageTargetEvents, obligations));
  }
  if (reactionEvents.length) {
    events.push(...engineTrace(reactor.id, reactionTargetIds, reactionEvents, obligations, {
      sourceActorId: reactor.id,
      facts: { trigger: 'damage_taken', amount: originalAmount },
    }));
  }
  if (reduction > 0) {
    events.push(...engineTrace(target.id, [target.id], [{
      type: 'narrative',
      text: `Снижение урона: ${originalAmount} → ${adjusted.amount} (−${originalAmount - adjusted.amount})`,
    }], obligations));
  }
  events.push(...engineTrace(source.id, [target.id], adjusted.events, obligations));
  events.push(...engineTrace(target.id, [source.id], pending.retaliationEvents, obligations, {
    sourceActorId: target.id,
    facts: { trigger: 'temporary_hp_melee_retaliation' },
  }));
  events.push({
    sourceActorId: target.id,
    obligationIds: obligations,
    payload: { type: 'ResolutionClosed', resolutionId: pending.id },
  });
  if (pending.attackActionId) {
    const attackAction = world.attackActions[pending.attackActionId];
    if (!attackAction || attackAction.blockedByResolutionId !== pending.id) {
      return rejected(world, 'InvalidDecision', 'Damage reaction lost its canonical Attack-action ledger');
    }
    events.push(...attackResolutionFinishedEvents({
      attackAction,
      resolutionId: pending.id,
      actorId: source.id,
      obligations: [...obligations, 'system:attack-action'],
    }));
  }
  const followUps: PendingResolutionFollowUp[] = [...pending.followUps];
  const targetConcentration = concentrationSaveFollowUp({
    world,
    actor: target,
    actorAfter: targetAfter,
    obligations,
  });
  if (targetConcentration) followUps.push(targetConcentration);
  const sourceConcentration = concentrationSaveFollowUp({
    world,
    actor: source,
    actorAfter: sourceAfter,
    obligations,
  });
  if (sourceConcentration && source.id!==target.id) followUps.push(sourceConcentration);
  events.push(...followUpOpenedEvents({
    world,
    commandId: command.commandId,
    followUps,
    env,
  }));
  return events;
}
  return {resolveAttackAdjustment, resolvePendingAttack, resolvePendingDamageReaction};
}
