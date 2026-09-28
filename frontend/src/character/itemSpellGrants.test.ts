import { describe, expect, it, vi } from 'vitest';
import type { Card, Spell } from '../types';
import type { ForgeCharacter } from './types';
import type { AssembledCharacter } from './assemble';
import { createSheetCombatRuntime } from './sheetCombatRuntimeFactory';
import { loadItemGrantedSpells, withItemGrantedSpells } from './itemSpellGrants';
import { prepareSpellExecution } from '../rules-core/spellcastingExecution';
import { activeEffectRequirementIssue } from '../engine/actionRequirements';
import { pay } from '../engine/cost';
import { InMemoryRulesSession } from '../rules-core/session';
import { createLogicalClock, createSequentialIdFactory, createStrictRngTape } from '../rules-core/determinism';
import type { UseActionCommand } from '../rules-core/domain';
import {startEncounter} from '../engine/encounter';
import {longRest} from '../engine/turn';

function fixtures() {
  const spells = ['first', 'second'].map((key, index) => ({
    id: `spell-${key}`, card_number: `SPELL-${key}`, name: `Spell ${key}`, description: 'Test spell', rarity: 'common',
    level: 1, school: 'evocation', casting_time: 'Действие', range: 'На себя', duration: 'Мгновенная',
    component_verbal: true, mechanics: {
      spell_class_list_ids: ['CLASS-wizard'],
      activation: { mode: 'active', cost: [{ resource: 'action', amount: 1 }, { resource: 'spell_slot', level: 1, amount: 1 }] },
      targeting: { target: 'self', range: { distance: 0, unit: 'ft' } },
      effects: [{ resolution: 'auto', result: [{ kind: 'healing', amount: index + 1 }] }],
    },
  })) as unknown as Spell[];
  const cards = spells.map((spell, index) => ({ id: `item-${index}`, card_number: `ITEM-${index}`, name: `Item ${index}`, type: 'ring',
    requires_attunement: index === 1,
    mechanics: { activation: { mode: 'passive', while: 'equipped' }, effects: [{ resolution: 'auto', result: [
      { kind: 'grant_spell', value: spell.card_number, label: 'known', ability: index === 0 ? 'cha' : 'wis', freeuse: index === 0 ? { at_will: true } : { count: 2, recharge: 'long_rest' } },
    ] }] },
  })) as unknown as Card[];
  const assembled = { race: { id: 'race', name: 'Human', speed: 30 }, klass: null, subclass: null, background: null,
    feats: [], effects: [], actions: [], spells: [], pendingChoices: [], featAbilityIncreases: [], derived: {} } as unknown as AssembledCharacter;
  const character = { id: 'hero', name: 'Hero', user_id: 'qa', access_mode: 'owner', system_id: 'dnd5e-2024', ruleset_version: '2024',
    level: 1, race_id: 'race', abilities: { str: 12, dex: 12, con: 12, int: 12, wis: 16, cha: 12 }, runtime_revision: 0,
    current_hp: 8, max_hp: 10, resources: { action: 1, bonus_action: 1, reaction: 1 }, max_resources: { action: 1, bonus_action: 1, reaction: 1 },
    active_effects: [], resolved_choices: {}, equipment: { ring_left: cards[0].id, ring_right: cards[1].id },
    inventory_items: cards.map(card => ({ card_id: card.id, qty: 1 })), turn_state: { attuned_ids: [cards[1].id] },
  } as unknown as ForgeCharacter;
  const resolve = vi.fn(async (ref: string) => {
    const spell = spells.find(spell => spell.id === ref || spell.card_number === ref);
    if (!spell) throw new Error(`Missing ${ref}`);
    return spell;
  });
  const factory = createSheetCombatRuntime({ loadAssembly: async () => assembled,
    cardsApi: { getCard: async id => cards.find(card => card.id === id)! }, spellsApi: { getSpell: resolve },
    actionsApi: { getAction: async () => { throw new Error('Unexpected action'); } },
    effectsApi: { getEffect: async () => { throw new Error('Unexpected effect'); } }, loadMasteryEffectsStrict: async () => [],
  });
  return { spells, cards, assembled, character, resolve, factory };
}

describe('item spell grants use canonical equipment, source and payment authority', () => {
  it.each([[0,0],[0,1],[1,0],[1,1]])('keeps item %s remaining free uses %s across unequip or unattune and reload',async(index,remaining)=>{
    const {cards,spells,character,factory}=fixtures();
    const recharge=index===0?'long_rest':'encounter';
    const payload=(((cards[index].mechanics!.effects as Record<string,unknown>[])[0].result as Record<string,unknown>[])[0]);
    payload.freeuse={count:2,recharge};
    const pool=`freeuse-${spells[index].card_number}`;
    character.resources={...character.resources,[pool]:remaining};
    character.max_resources={...character.max_resources,[pool]:2};
    const prepared=await factory.loadSheetCombatParticipant({character,cards:new Map()});
    const before=prepared.canonical.world.actors.hero;
    const grant=before.spellcastingAccess!.grants.find(g=>g.sourceId===cards[index].card_number)!;
    const action=prepared.canonical.catalog.getAction(grant.actionId)!;
    character.resources=structuredClone(before.runtime.resources);character.max_resources=structuredClone(before.runtime.maxResources);
    if(index===0)character.equipment={...character.equipment,ring_left:null};
    else character.turn_state={...character.turn_state,attuned_ids:[]};
    const removed=await factory.loadSheetCombatParticipant({character,cards:new Map()});
    const inactive=removed.canonical.world.actors.hero;
    expect(inactive.spellcastingAccess?.grants.some(g=>g.sourceId===cards[index].card_number)).toBe(false);
    expect(activeEffectRequirementIssue(action.mechanics,inactive.runtime,inactive.character)).not.toBeNull();
    expect(inactive.runtime.resources[pool]).toBe(remaining);expect(inactive.runtime.maxResources[pool]).toBe(2);
    character.resources=JSON.parse(JSON.stringify(inactive.runtime.resources));character.max_resources=JSON.parse(JSON.stringify(inactive.runtime.maxResources));
    if(index===0)character.equipment={...character.equipment,ring_left:cards[index].id};
    else character.turn_state={...character.turn_state,attuned_ids:[cards[index].id]};
    const restored=(await factory.loadSheetCombatParticipant({character,cards:new Map()})).canonical.world.actors.hero;
    expect(restored.runtime.resources[pool]).toBe(remaining);
    expect(restored.character.resourceRecharge?.[pool]).toBe(recharge);
    const refreshed=index===0
      ? longRest(restored.runtime,restored.character)
      : startEncounter(restored.runtime,{character:restored.character,selfId:restored.id,passives:restored.passives,rng:()=>0});
    expect(refreshed.state.resources[pool]).toBe(2);
  });
  it.each([0, 1])('executes item %s with one payment and rejects an old grant after unequip', async index => {
    const { cards, character, factory } = fixtures();
    character.resources!['freeuse-SPELL-second'] = 1;
    character.max_resources!['freeuse-SPELL-second'] = 2;
    const { canonical } = await factory.loadSheetCombatParticipant({ character, cards: new Map() });
    const actor = canonical.world.actors.hero;
    expect(actor.runtime.resources['freeuse-SPELL-second']).toBe(1);
    const grant = actor.spellcastingAccess!.grants.find(grant => grant.sourceId === cards[index].card_number)!;
    const command: UseActionCommand = { schemaVersion: 1, type: 'UseAction', commandId: 'item-cast', expectedRevision: canonical.world.revision,
      rulesetContentHash: canonical.world.ruleset.contentHash, actorId: 'hero', actionId: grant.actionId, targetIds: ['hero'],
      factsByTarget: { hero: { factsSource: 'scenario', boardRevision: 0, distanceFt: 0, lineOfSight: true, cover: 'none', relation: 'self' } },
      spell: { baseLevel: 1, grantId: grant.grantId },
    };
    const tape = createStrictRngTape([]);
    const environment = { rng: tape.rng, clock: createLogicalClock(), nextId: createSequentialIdFactory('item-spell') };
    const session = new InMemoryRulesSession(structuredClone(canonical.world), canonical.catalog, environment);
    const result = session.dispatch(command);
    expect(result.status, JSON.stringify(result)).toBe('accepted');
    expect(session.getState().actors.hero.runtime.resources.action).toBe(0);
    expect(session.getState().actors.hero.runtime.resources['freeuse-SPELL-second']).toBe(index === 1 ? 0 : 1);
    const replay = session.dispatch(command);
    expect(replay.status).toBe('rejected');
    expect(session.getState().actors.hero.runtime.resources['freeuse-SPELL-second']).toBe(index === 1 ? 0 : 1);
    const stale = structuredClone(canonical.world);
    stale.actors.hero.runtime.equipment = {};
    const denied = new InMemoryRulesSession(stale, canonical.catalog, environment).dispatch(command);
    expect(denied).toMatchObject({ status: 'rejected', code: 'InvalidActionTiming' });
    expect(stale.actors.hero.runtime.resources.action).toBe(1);
    expect(stale.actors.hero.runtime.resources['freeuse-SPELL-second']).toBe(1);
    tape.assertExhausted();
  });

  it('hydrates two items with different abilities/payments and rechecks the current item gate', async () => {
    const { cards, character, factory, resolve } = fixtures();
    const participant = await factory.loadSheetCombatParticipant({ character, cards: new Map() });
    expect(resolve.mock.calls.map(([reference]) => reference)).toEqual(['SPELL-first', 'SPELL-second']);
    const actor = participant.canonical.world.actors.hero;
    const access = actor.spellcastingAccess!;
    expect(access.grants).toHaveLength(2);
    for (const [index, card] of cards.entries()) {
      const grant = access.grants.find(grant => grant.sourceId === card.card_number)!;
      expect(grant.spellcastingAbility).toBe(index === 0 ? 'cha' : 'wis');
      const action = participant.canonical.catalog.getAction(grant.actionId)!;
      if (action.kind !== 'spell') throw new Error('Expected canonical spell');
      const prepared = prepareSpellExecution({ action, accessState: access, resources: actor.runtime.resources, declaration: { grantId: grant.grantId } });
      expect(prepared.status).toBe('ready');
      if (prepared.status !== 'ready') throw new Error(prepared.message);
      const cost = (prepared.executableAction.mechanics.activation as { cost: { resource: string; amount: number }[] }).cost;
      expect(cost).toContainEqual({ resource: 'action', amount: 1 });
      expect(cost.some(row => row.resource.startsWith('spell_slot'))).toBe(false);
      expect(prepared.payment.kind).toBe(index === 0 ? 'none' : 'free_use');
      const { state: paid } = pay(actor.runtime, cost);
      expect(paid.resources.action).toBe(0);
      if (index === 1) expect(paid.resources['freeuse-SPELL-second']).toBe(1);
      expect(activeEffectRequirementIssue(action.mechanics, actor.runtime, actor.character)).toBeNull();
      const removed = { ...actor.runtime, equipment: {} };
      expect(activeEffectRequirementIssue(action.mechanics, removed, actor.character)).not.toBeNull();
      if (index === 1) expect(activeEffectRequirementIssue(action.mechanics, actor.runtime, { ...actor.character, attunedIds: [] })).not.toBeNull();
    }
    expect(actor.runtime.resources['freeuse-SPELL-first']).toBeUndefined();
    expect(actor.runtime.resources['freeuse-SPELL-second']).toBe(2);
    character.equipment = {};
    const removed = await factory.loadSheetCombatParticipant({ character, cards: new Map() });
    expect(removed.canonical.world.actors.hero.spellcastingAccess?.grants ?? []).toHaveLength(0);
  });

  it('does not restore an unequipped item spell when an earlier async read completes', async () => {
    const { spells, assembled } = fixtures();
    let finish!: (spell: Spell) => void;
    const pending = loadItemGrantedSpells(['SPELL-first'], () => new Promise(resolve => { finish = resolve; }));
    finish(spells[0]);
    const stale = await pending;
    expect(withItemGrantedSpells(assembled, stale, []).spells).toEqual([]);
    expect(withItemGrantedSpells(assembled, stale, ['SPELL-first']).spells).toEqual([spells[0]]);
    expect(withItemGrantedSpells({ ...assembled, spells: [spells[0]] }, stale, ['SPELL-first']).spells).toEqual([spells[0]]);
  });
});
