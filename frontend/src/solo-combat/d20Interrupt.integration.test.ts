import { describe, expect, it } from 'vitest';
import compiledFixtureJson from '../pages/rulesLabFixture.generated.json';
import {
  createWorld,
  type ActorState,
  type RuleActionDefinition,
  type RulesCatalog,
  type RulesetReference,
} from '../rules-core/domain';
import type { SheetCanonicalRuntime } from '../character/sheetCanonicalWorld';
import type { SheetCombatParticipantSeed } from '../character/sheetCombatSession';
import type { ForgeCharacter } from '../character/types';
import type { Action } from '../types';
import type { Monster } from '../monsters/types';
import {
  createSoloCombatState,
  executeCombatAction,
  resolveD20Interrupt,
  resolvePlayerSavingThrow,
  runMonsterTurn,
} from './engine';
import { readSoloCombatState, writeSoloCombatState } from './persistence';
import type { SoloCombatState } from './types';
import { validateMechanics } from '../engine/validateMechanics';

const fixture = compiledFixtureJson as unknown as {
  source: { ruleset: RulesetReference };
  roots: {
    magicInitiateFighter: { actor: ActorState; actions: RuleActionDefinition[] };
    wizard: { actor: ActorState; actions: RuleActionDefinition[] };
  };
};

const ATTACK_ID = 'a8400000-0000-4000-8000-000000000001';
const CHECK_ID = 'a8400000-0000-4000-8000-000000000002';

function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }

function participant(root: 'magicInitiateFighter' | 'wizard'): SheetCombatParticipantSeed {
  const actor = clone(fixture.roots[root].actor);
  delete actor.capabilities.featureSources?.['alert.initiative_swap'];
  const actions = clone(fixture.roots[root].actions);
  const byId = new Map(actions.map((action) => [action.id, action]));
  const catalog: RulesCatalog = { getAction: (id) => byId.get(id), listActions: () => actions };
  const canonical: SheetCanonicalRuntime = {
    actorId: actor.id,
    world: createWorld({ id: `d20-interrupt:${actor.id}`, ruleset: fixture.source.ruleset, actors: [actor] }),
    actions, catalog, cards: [], resourceBindings: {},
    actionFor: () => { throw new Error('not used'); },
  };
  const character = {
    id: actor.id, name: actor.name, user_id: 'd20-interrupt-test', access_mode: 'owner',
    system_id: 'dnd5e-2024', ruleset_version: '2024', runtime_revision: 3,
    current_hp: actor.runtime.hp.current, max_hp: actor.runtime.hp.max,
    resources: clone(actor.runtime.resources), max_resources: clone(actor.runtime.maxResources),
    active_effects: clone(actor.runtime.activeEffects), turn_state: {},
    initiative_bonus: root === 'wizard' ? 10 : 0, speed: actor.character.characterSpeed ?? 30,
  } as unknown as ForgeCharacter;
  return { character, canonical };
}

function interruptPassive(kind: 'warding' | 'cutting'): Record<string, unknown> {
  if (kind === 'warding') {
    return {
      id: 'EFFECT-0121', name: 'Защищающая вспышка',
      activation: {
        mode: 'triggered', optional: true,
        cost: [{ resource: 'reaction' }, { resource: 'warding_flare' }],
        trigger: { event: 'attack_roll_made', timing: 'before' },
      },
      effects: [{ resolution: 'auto', result: [
        { kind: 'resource', op: 'grant', id: 'warding_flare', amount: 'max(1,wis)', per: 'long_rest' },
        {
          kind: 'd20_interrupt', operation: 'impose_disadvantage', timing: 'before_roll',
          eligible_rolls: ['attack_roll'], range_ft: 30, requires_line_of_sight: true,
          allowed_relations: ['enemy'],
        },
      ] }],
    };
  }
  return {
    id: 'EFFECT-0012', name: 'Острое словцо',
    activation: {
      mode: 'triggered', optional: true,
      cost: [{ resource: 'reaction' }, { resource: 'bardic_inspiration' }],
      trigger: { events: ['attack_roll_made', 'ability_check_made'], timing: 'after' },
    },
    effects: [{ resolution: 'auto', result: [{
      kind: 'd20_interrupt', operation: 'subtract_die', timing: 'after_outcome',
      eligible_rolls: ['attack_roll', 'ability_check'], eligible_outcomes: ['hit', 'success'],
      range_ft: 60, requires_line_of_sight: true, allowed_relations: ['enemy'],
      die: { class: 'bard', by_level: { 1: 6, 5: 8, 10: 10, 15: 12 } },
    }] }],
  };
}

function reactor(kind: 'warding' | 'cutting') {
  const seed = participant('wizard');
  const actor = seed.canonical.world.actors[seed.character.id];
  actor.character.level = 5;
  actor.character.classLevels = { bard: 5 };
  delete actor.capabilities.featureSources?.['alert.initiative_swap'];
  actor.passives = [...(actor.passives ?? []), interruptPassive(kind)];
  const resource = kind === 'warding' ? 'warding_flare' : 'bardic_inspiration';
  actor.runtime.resources[resource] = 2;
  actor.runtime.maxResources[resource] = 2;
  seed.character.resources = clone(actor.runtime.resources);
  seed.character.max_resources = clone(actor.runtime.maxResources);
  return seed;
}

function monsterAttack(): Action {
  return {
    id: ATTACK_ID, name: 'Клинок испытаний', description: '', rarity: 'common',
    card_number: 'MONSTER-ACTION-D20-INTERRUPT', resource: 'action',
    action_type: 'base_action', type: 'monster', created_at: '', updated_at: '',
    mechanics: {
      interaction: { intent: 'harmful' },
      activation: { mode: 'active', cost: [{ resource: 'action' }] },
      targeting: {
        domain: 'actor', actor_targets: true, shape: 'single', min_targets: 1, max_targets: 1,
        range_ft: 5, requires_line_of_sight: true, allowed_relations: ['enemy'],
      },
      effects: [{
        resolution: 'attack_roll', ability: 'str', attack_kind: 'weapon_melee', vs: 'ac',
        on_hit: [{ kind: 'damage', dice: '1d6', ability: 'str', type: 'slashing' }],
      }],
    },
  } as Action;
}

function monsterCheck(): Action {
  return {
    id: CHECK_ID, name: 'Испытание силы', description: '', rarity: 'common',
    card_number: 'MONSTER-CHECK-D20-INTERRUPT', resource: 'action',
    action_type: 'base_action', type: 'monster', created_at: '', updated_at: '',
    mechanics: {
      activation: { mode: 'active', cost: [{ resource: 'action' }] },
      targeting: {
        domain: 'actor', actor_targets: false, shape: 'self', min_targets: 0, max_targets: 1,
        range_ft: 0, requires_line_of_sight: false, allowed_relations: ['self'],
      },
      effects: [{
        resolution: 'ability_check', ability: 'str', dc: 10,
        on_success: [{ kind: 'temp_hp', amount: 5 }], on_failure: [],
      }],
    },
  } as Action;
}

function enemy(action: Action): Monster {
  return {
    id: 'c8400000-0000-4000-8000-000000000001', slug: 'd20-interrupt-enemy',
    name: 'Проверяющий противник', description: '', size: 'medium', creature_type: 'humanoid',
    alignment: '', challenge_rating: '1', armor_class: 12, max_hp: 30, speed: 30,
    initiative_bonus: 100, proficiency_bonus: 2,
    abilities: { str: 16, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    action_ids: [action.id], effect_ids: [], ai: { strategy: 'melee_chase' }, token_url: '',
    source: 'test', created_at: '', updated_at: '',
  };
}

async function combat(kind: 'warding' | 'cutting', action = monsterAttack()) {
  const target = participant('magicInitiateFighter');
  const responder = reactor(kind);
  let state = await createSoloCombatState({
    character: target.character, participant: target, allies: [responder],
    selected: [{ monster: enemy(action), quantity: 1 }], actions: [action], effects: [],
    rng: () => 0.5,
  });
  const monsterId = Object.values(state.world.actors).find((actor) => actor.kind === 'monster')!.id;
  const targetId = target.character.id;
  const responderId = responder.character.id;
  const targetPosition = state.tokens[targetId].position;
  state = {
    ...state,
    tokens: {
      ...state.tokens,
      [monsterId]: { ...state.tokens[monsterId], position: { x: targetPosition.x, y: targetPosition.y - 1 } },
      [responderId]: { ...state.tokens[responderId], position: { x: targetPosition.x + 1, y: targetPosition.y } },
    },
    boardRevision: state.boardRevision + 1,
  } as SoloCombatState;
  return { state, monsterId, targetId, responderId, action };
}

describe('persisted cross-actor d20 interrupts', () => {
  it.each([{type:'force',amount:2},{type:'fire',amount:4}])('pays $type damage before reroll, preserving concentration and the paid continuation across reload',async cost=>{
    const setup=await combat('warding');
    setup.state.world.actors[setup.responderId].passives=[];
    setup.state.controlledCharacterIds=[setup.targetId,setup.monsterId];
    const actor=setup.state.world.actors[setup.monsterId],target=setup.state.world.actors[setup.targetId];
    actor.passives=[{id:`blood-${cost.type}`,name:'Blood reroll',activation:{mode:'triggered',cost:[]},effects:[{resolution:'auto',result:[
      {kind:'roll_influence',operation:'reroll_kept_d20',timing:'after_roll_before_outcome',eligible_rolls:['attack'],eligible_outcomes:['miss','crit_miss'],self_damage:cost},
    ]}]},{effects:[{resolution:'auto',result:[{kind:'resistance',damage_type:cost.type,value:'resistance'}]}]}];
    actor.runtime.activeEffects.push({id:'concentration-local',name:'Concentration',source:'Test',mechanics:{kind:'concentration',effectIds:[]}});
    target.runtime.activeEffects.push({id:'concentration-link',name:'Linked',source:'Test',mechanics:{kind:'modifier',target:'ac',op:'add',value:0}});
    setup.state.world.concentrations[actor.id]={id:'held-concentration',sourceActorId:actor.id,actionId:setup.action.id,startedAtRevision:0,effectLinks:[{actorId:target.id,effectId:'concentration-link'}]};
    const beforeHp=actor.runtime.hp.current;
    const pending=executeCombatAction({state:setup.state,actorId:actor.id,actionId:setup.action.id,targetIds:[target.id],rng:()=>0});
    expect(pending.pendingD20Interrupt?.held?.roll.outcome).toBe('miss');
    const paid=resolveD20Interrupt(pending,actor.id,()=>{throw Error('Damage must wait for canonical concentration decision');},`blood-${cost.type}`);
    expect(paid.world.actors[actor.id].runtime.hp.current).toBe(beforeHp-cost.amount/2);
    expect(paid.world.pendingResolution?.type).toBe('concentration_save');
    expect(paid.pendingD20Interrupt).toBeUndefined();
    expect(paid.pendingRollInfluenceResume?.pending.paidInfluence?.id).toBe(`blood-${cost.type}`);
    const restored=readSoloCombatState(writeSoloCombatState({},paid),paid.characterId,paid.runtimeRevision)!;
    const values=[.9,.1];let draws=0;
    const final=resolvePlayerSavingThrow(restored,{kind:'roll',roll:{mode:'system'}},()=>{const value=values[draws++];if(value===undefined)throw Error('Extra RNG');return value;});
    expect(draws).toBe(2);
    expect(final.pendingRollInfluenceResume).toBeUndefined();
    expect(final.pendingD20Interrupt).toBeUndefined();
    expect(final.world.actors[actor.id].runtime.hp.current).toBe(beforeHp-cost.amount/2);
    expect(final.world.actors[actor.id].runtime.resources.action).toBe(0);
    expect(final.world.concentrations[actor.id]?.id).toBe('held-concentration');
    expect(()=>resolveD20Interrupt(final,actor.id,()=>{throw Error('No replay');},`blood-${cost.type}`)).toThrow();
  });
  it('uses a separate owner reaction to reroll another actor, keeping that actor action and dice transcript',async()=>{
    const setup=await combat('warding',monsterCheck());
    const owner=setup.state.world.actors[setup.responderId];
    owner.passives=[{id:'time-reaction',name:'Time reaction',activation:{mode:'triggered',cost:[{resource:'reaction',amount:1}]},effects:[{resolution:'auto',result:[{kind:'roll_influence',operation:'reroll_kept_d20',timing:'after_roll_before_outcome',eligible_rolls:['check'],affects:'any',once_per_turn:'time'}]}]}];
    const held=executeCombatAction({state:setup.state,actorId:setup.monsterId,actionId:setup.action.id,targetIds:[setup.monsterId],rng:()=>.8});
    const responder=held.pendingD20Interrupt?.responders[0];
    expect(responder?.actorId).toBe(setup.responderId);
    const settled=resolveD20Interrupt(clone(held),setup.responderId,()=>0,responder?.effectId);
    expect(settled.world.actors[setup.responderId].runtime.resources.reaction).toBe(0);
    expect(settled.world.actors[setup.monsterId].runtime.hp.temp).toBe(0);
    expect(settled.world.actors[setup.monsterId].runtime.resources.action).toBe(0);
  });
  it('persists a two-die damage roll and rerolls every die before committing damage',async()=>{
    const action=monsterAttack();
    ((action.mechanics!.effects) as Record<string,unknown>[])[0].on_hit=[{kind:'damage',dice:'2d6',ability:'str',type:'slashing'}];
    const setup=await combat('warding',action);
    const owner=setup.state.world.actors[setup.responderId];
    owner.passives=[{id:'any-die-reaction',name:'Any die',activation:{mode:'triggered',cost:[{resource:'reaction',amount:1}]},
      effects:[{resolution:'auto',result:[{kind:'roll_influence',operation:'reroll_roll',timing:'after_roll_before_outcome',
        eligible_rolls:['damage'],affects:'any',once_per_turn:'any-die'}]}]}];
    expect(validateMechanics(owner.passives[0] as Record<string,unknown>,{id:'any-die-reaction',name:'Any die',kind:'action'}).valid).toBe(true);
    const before=setup.state.world.actors[setup.targetId].runtime.hp.current;
    const held=executeCombatAction({state:setup.state,actorId:setup.monsterId,actionId:action.id,targetIds:[setup.targetId],rng:()=>.75});
    expect(held.pendingD20Interrupt?.held).toMatchObject({kind:'damage',targetId:setup.targetId,
      roll:{kind:'damage',dice:[{sides:6,result:5,drawOrdinal:1},{sides:6,result:5,drawOrdinal:2}]}});
    expect(held.world.actors[setup.targetId].runtime.hp.current).toBe(before);
    const restored=readSoloCombatState(writeSoloCombatState({},held),held.characterId,held.runtimeRevision)!;
    const effectId=restored.pendingD20Interrupt!.responders[0].effectId;
    const settled=resolveD20Interrupt(restored,setup.responderId,()=>0,effectId);
    expect(settled.pendingD20Interrupt).toBeUndefined();
    expect(settled.world.actors[setup.responderId].runtime.resources.reaction).toBe(0);
    expect(settled.world.actors[setup.targetId].runtime.hp.current).toBe(before-2);
    expect(settled.log.some(entry=>entry.text.includes('к6 → 1, к6 → 1'))).toBe(true);
    expect(()=>resolveD20Interrupt(settled,setup.responderId,()=>0,effectId)).toThrow();
  });
  it('uses the same data-owned reroll for a healing-only action with a different die',async()=>{
    const action=monsterCheck();
    action.mechanics!.effects=[{resolution:'auto',who:'self',result:[{kind:'healing',amount:'1d8'}]}];
    const setup=await combat('warding',action);
    setup.state.world.actors[setup.responderId].passives=[];
    const healer=setup.state.world.actors[setup.monsterId];
    healer.runtime.hp.current=10;
    setup.state.controlledCharacterIds=[setup.targetId,setup.monsterId];
    healer.passives=[{id:'heal-die-reaction',name:'Healing die',activation:{mode:'triggered',cost:[{resource:'reaction',amount:1}]},
      effects:[{resolution:'auto',result:[{kind:'roll_influence',operation:'reroll_roll',timing:'after_roll_before_outcome',eligible_rolls:['healing'],once_per_turn:'heal-die'}]}]}];
    const held=executeCombatAction({state:setup.state,actorId:healer.id,actionId:action.id,targetIds:[healer.id],rng:()=>.9});
    expect(held.pendingD20Interrupt?.held).toMatchObject({kind:'healing',roll:{dice:[{sides:8,result:8,drawOrdinal:0}]}});
    expect(held.world.actors[healer.id].runtime.hp.current).toBe(10);
    const effectId=held.pendingD20Interrupt!.responders[0].effectId;
    const settled=resolveD20Interrupt(clone(held),healer.id,()=>0,effectId);
    expect(settled.world.actors[healer.id].runtime.hp.current).toBe(11);
    expect(settled.world.actors[healer.id].runtime.resources.reaction).toBe(0);
  });
  it('resolves an outcome-changing d20 interrupt before offering the damage dice',async()=>{
    const setup=await combat('cutting');
    const owner=setup.state.world.actors[setup.responderId];
    owner.passives!.push({id:'later-damage-reroll',name:'Later damage',activation:{mode:'triggered',cost:[]},
      effects:[{resolution:'auto',result:[{kind:'roll_influence',operation:'reroll_roll',timing:'after_roll_before_outcome',eligible_rolls:['damage'],affects:'any'}]}]});
    const held=executeCombatAction({state:setup.state,actorId:setup.monsterId,actionId:setup.action.id,targetIds:[setup.targetId],rng:()=>.75});
    expect(held.pendingD20Interrupt?.operation).toBe('subtract_die');
    const afterDecline=resolveD20Interrupt(held,null,()=>{throw Error('The saved attack/damage dice must replay');});
    expect(afterDecline.pendingD20Interrupt?.held?.kind).toBe('damage');
  });
  it('holds item choices before any dice, persists their authority and replays the same check after a reroll offer',async()=>{
    const setup=await combat('cutting',monsterCheck());
    const actor=setup.state.world.actors[setup.monsterId];
    setup.state.controlledCharacterIds=[setup.targetId,setup.monsterId];
    actor.runtime.resources.charges=1; actor.runtime.maxResources.charges=1;
    actor.runtime.resources.heroic_inspiration=1; actor.runtime.maxResources.heroic_inspiration=1;
    actor.passives=[{id:'item-check',name:'Item check',activation:{mode:'triggered',cost:[{resource:'charges',amount:1}]},effects:[{resolution:'auto',result:[{kind:'roll_influence',operation:'advantage',timing:'before_roll',eligible_rolls:['check'],ability:'str'}]}]}];
    let draws=0;
    const pending=executeCombatAction({state:setup.state,actorId:setup.monsterId,actionId:setup.action.id,targetIds:[setup.monsterId],rng:()=>{draws++;return .5;}});
    expect(draws).toBe(0); expect(pending.pendingD20Interrupt?.operation).toBe('roll_choice');
    expect(actor.runtime.resources.charges).toBe(1);
    const restored=readSoloCombatState(writeSoloCombatState({},pending),pending.characterId,pending.runtimeRevision)!;
    const held=resolveD20Interrupt(restored,setup.monsterId,()=>.3,'item-check');
    expect(held.pendingD20Interrupt?.held?.roll.advantage).toBe('advantage');
    expect(held.world.actors[setup.monsterId].runtime.resources.charges).toBe(0);
    const finished=resolveD20Interrupt(clone(held),null,()=>{throw Error('unexpected new die');});
    expect(finished.pendingD20Interrupt).toBeUndefined();
    expect(finished.world.actors[setup.monsterId].runtime.resources.charges).toBe(0);
    expect(()=>resolveD20Interrupt(finished,null)).toThrow();
  });

  it('target-only encounter reactions cannot protect someone else or repeat after their payment',async()=>{
    const setup=await combat('warding');
    const reactor=setup.state.world.actors[setup.responderId];
    const passive=interruptPassive('warding');
    const payload=(passive.effects as {result:Record<string,unknown>[]}[])[0].result[1];
    payload.target_self=true;payload.once_per_encounter=true;
    reactor.passives=[passive];
    const other=executeCombatAction({state:setup.state,actorId:setup.monsterId,actionId:setup.action.id,targetIds:[setup.targetId],rng:()=>.7});
    expect(other.pendingD20Interrupt).toBeUndefined();
    const targetPosition=setup.state.tokens[setup.targetId].position;
    setup.state.tokens[setup.targetId].position={...setup.state.tokens[setup.responderId].position};
    setup.state.tokens[setup.responderId].position={...targetPosition};
    const held=executeCombatAction({state:setup.state,actorId:setup.monsterId,actionId:setup.action.id,targetIds:[setup.responderId],rng:()=>.7});
    expect(held.pendingD20Interrupt?.operation).toBe('impose_disadvantage');
    const spent=resolveD20Interrupt(held,setup.responderId,()=>.1);
    expect(spent.d20InterruptUses?.[`${setup.responderId}:EFFECT-0121`]).toBe(1);
    spent.world.actors[setup.responderId].runtime.resources.reaction=1;
    spent.world.actors[setup.monsterId].runtime.resources.action=1;
    const again=executeCombatAction({state:spent,actorId:setup.monsterId,actionId:setup.action.id,targetIds:[setup.responderId],rng:()=>.7});
    expect(again.pendingD20Interrupt).toBeUndefined();
  });
  it('accepts the data-driven interrupt contract and rejects an incomplete payload', () => {
    for (const kind of ['warding', 'cutting'] as const) {
      expect(validateMechanics(
        interruptPassive(kind),
        { id: `interrupt-${kind}`, name: kind, kind: 'passive_effect' },
      )).toEqual({ valid: true, errors: [] });
    }
    const incomplete = interruptPassive('warding');
    const payload = (incomplete.effects as Array<{ result: Record<string, unknown>[] }>)[0].result
      .find((candidate) => candidate.kind === 'd20_interrupt')!;
    delete payload.range_ft;
    expect(validateMechanics(
      incomplete,
      { id: 'interrupt-invalid', name: 'invalid', kind: 'passive_effect' },
    ).valid).toBe(false);
  });

  it('holds Warding Flare before the attack, persists it, then spends both resources and applies real Disadvantage', async () => {
    const setup = await combat('warding');
    const hpBefore = setup.state.world.actors[setup.targetId].runtime.hp.current;
    let state = executeCombatAction({
      state: setup.state, actorId: setup.monsterId, actionId: setup.action.id,
      targetIds: [setup.targetId], rng: () => 0.95,
    });
    expect(state.pendingD20Interrupt).toMatchObject({
      timing: 'before_roll', operation: 'impose_disadvantage',
      responders: [{ actorId: setup.responderId, effectId: 'EFFECT-0121' }],
    });
    expect(state.world.actors[setup.monsterId].runtime.resources.action).toBe(1);
    expect(readSoloCombatState(
      writeSoloCombatState({}, state), state.characterId, state.runtimeRevision,
    )?.pendingD20Interrupt).toEqual(state.pendingD20Interrupt);

    const rolls = [0.95, 0];
    state = resolveD20Interrupt(state, setup.responderId, () => rolls.shift() ?? 0);
    expect(state.pendingD20Interrupt).toBeUndefined();
    expect(state.world.actors[setup.responderId].runtime.resources).toMatchObject({
      reaction: 0, warding_flare: 1,
    });
    expect(state.world.actors[setup.targetId].runtime.hp.current).toBe(hpBefore);
    expect(state.world.actors[setup.monsterId].runtime.activeEffects).toHaveLength(0);
    const attackRoll = state.log.flatMap((entry) => entry.records ?? [])
      .flatMap((record) => record.event?.type === 'roll' ? [record.event.roll] : [])
      .find((roll) => roll.kind === 'd20' && roll.target?.type === 'ac');
    expect(attackRoll?.outcome).toBe('miss');
    expect(attackRoll?.advantage).toBe('disadvantage');
  });

  it('declining Warding Flare commits the attack only once', async () => {
    const setup = await combat('warding');
    const hpBefore = setup.state.world.actors[setup.targetId].runtime.hp.current;
    const pending = executeCombatAction({
      state: setup.state, actorId: setup.monsterId, actionId: setup.action.id,
      targetIds: [setup.targetId], rng: () => 0.95,
    });
    const resolved = resolveD20Interrupt(pending, null, () => 0.95);
    expect(resolved.world.actors[setup.targetId].runtime.hp.current).toBeLessThan(hpBefore);
    expect(resolved.world.actors[setup.monsterId].runtime.resources.action).toBe(0);
    expect(resolved.world.actors[setup.responderId].runtime.resources).toMatchObject({
      reaction: 1, warding_flare: 2,
    });
  });

  it('pauses the autonomous monster controller and advances only after the held attack resolves', async () => {
    const setup = await combat('warding');
    const pending = runMonsterTurn(setup.state, () => 0.95);
    expect(pending.pendingD20Interrupt?.operation).toBe('impose_disadvantage');
    expect(pending.world.scene.mode === 'encounter'
      ? pending.world.scene.initiative[pending.world.scene.activeIndex]
      : null).toBe(setup.monsterId);
    const resolved = resolveD20Interrupt(pending, null, () => 0.95);
    const advanced = runMonsterTurn(resolved, () => 0.5);
    expect(advanced.world.scene.mode === 'encounter'
      ? advanced.world.scene.initiative[advanced.world.scene.activeIndex]
      : null).not.toBe(setup.monsterId);
  });

  it('previews a successful attack once, persists its transcript, and Cutting Words can turn it into a miss', async () => {
    const setup = await combat('cutting');
    const hpBefore = setup.state.world.actors[setup.targetId].runtime.hp.current;
    let state = executeCombatAction({
      state: setup.state, actorId: setup.monsterId, actionId: setup.action.id,
      targetIds: [setup.targetId], rng: () => 0.75,
    });
    expect(state.pendingD20Interrupt).toMatchObject({
      timing: 'after_outcome', operation: 'subtract_die',
      preview: { rollKind: 'attack_roll', outcome: 'hit' },
      responders: [{ actorId: setup.responderId, effectId: 'EFFECT-0012' }],
    });
    expect(state.pendingD20Interrupt?.randomValues?.length).toBeGreaterThan(1);
    expect(state.world.actors[setup.targetId].runtime.hp.current).toBe(hpBefore);

    state = resolveD20Interrupt(state, setup.responderId, () => 0.999);
    expect(state.pendingD20Interrupt).toBeUndefined();
    expect(state.world.actors[setup.targetId].runtime.hp.current).toBe(hpBefore);
    expect(state.world.actors[setup.responderId].runtime.resources).toMatchObject({
      reaction: 0, bardic_inspiration: 1,
    });
    expect(state.log.some((entry) => entry.text.includes('1к8 = 8'))).toBe(true);
  });

  it('uses the same after-outcome continuation for a successful DC ability check', async () => {
    const check = monsterCheck();
    const setup = await combat('cutting', check);
    let state = executeCombatAction({
      state: setup.state, actorId: setup.monsterId, actionId: check.id,
      targetIds: [setup.monsterId], rng: () => 0.55,
    });
    expect(state.pendingD20Interrupt?.preview).toMatchObject({
      rollKind: 'ability_check', outcome: 'success',
    });
    state = resolveD20Interrupt(state, setup.responderId, () => 0.999);
    expect(state.world.actors[setup.monsterId].runtime.hp.temp).toBe(0);
    const checkRolls = state.log.flatMap((entry) => entry.records ?? [])
      .flatMap((record) => record.event?.type === 'roll' ? [record.event.roll] : []);
    expect(checkRolls.some((roll) => roll.outcome === 'fail')).toBe(true);
  });

  it('fails closed outside declared range without spending or pausing', async () => {
    const setup = await combat('warding');
    setup.state.tokens[setup.responderId].position = { x: 0, y: 0 };
    setup.state.tokens[setup.monsterId].position = { x: 11, y: 9 };
    setup.state.tokens[setup.targetId].position = { x: 10, y: 9 };
    const state = executeCombatAction({
      state: setup.state, actorId: setup.monsterId, actionId: setup.action.id,
      targetIds: [setup.targetId], rng: () => 0.75,
    });
    expect(state.pendingD20Interrupt).toBeUndefined();
    expect(state.world.actors[setup.responderId].runtime.resources).toMatchObject({
      reaction: 1, warding_flare: 2,
    });
  });
});
