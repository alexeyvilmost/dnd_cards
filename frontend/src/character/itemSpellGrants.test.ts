import { describe, expect, it, vi } from 'vitest';
import type { Card, Spell } from '../types';
import type { ForgeCharacter } from './types';
import type { AssembledCharacter } from './assemble';
import { createSheetCombatRuntime } from './sheetCombatRuntimeFactory';
import { prepareSheetEquipmentCommand } from './sheetEquipmentCommand';
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
      activation: { mode: 'active', cast_time: { unit: 'action', amount: 1 }, cost: [{ resource: 'action', amount: 1 }, { resource: 'spell_slot', level: 1, amount: 1 }] },
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
  it('retains two undefined item spells across equipment reloads and denies casting without a cost', async () => {
    const { cards, character, factory } = fixtures();
    for (const card of cards) {
      const effects = card.mechanics?.effects as Array<{ result: Array<Record<string, unknown>> }>;
      delete effects[0].result[0].label;
      delete effects[0].result[0].freeuse;
    }
    character.equipment = {};
    character.resources = { ...character.resources, spell_slot_1: 2 };
    character.max_resources = { ...character.max_resources, spell_slot_1: 2 };
    let current = character;

    for (const [index, card] of cards.entries()) {
      const before = await factory.loadSheetCombatParticipant({ character: current, cards: new Map() });
      const commandId = `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
      const prepared = prepareSheetEquipmentCommand(before, commandId, { equip: card.id }, () => 0.5);
      current = { ...current, ...prepared.request.participants[0].patch,
        runtime_revision: (current.runtime_revision ?? 0) + 1 } as ForgeCharacter;
      const reloaded = await factory.loadSheetCombatParticipant({ character: current, cards: new Map() });
      const actor = reloaded.canonical.world.actors.hero;
      const grant = actor.spellcastingAccess!.grants.find((row) => row.sourceId === card.card_number)!;
      expect(grant).toMatchObject({ access: 'unavailable', sourceId: card.card_number });
      expect(grant.unavailableReason).toContain('не указан способ сотворения');
      expect(grant.freeUseResource).toBeUndefined();
      expect(grant.slotResource).toBeUndefined();
      const action = reloaded.canonical.catalog.getAction(grant.actionId)!;
      expect(prepareSpellExecution({ action: action as Extract<typeof action, { kind: 'spell' }>,
        accessState: actor.spellcastingAccess!, resources: actor.runtime.resources,
        declaration: { grantId: grant.grantId, castLevel: 1 } })).toMatchObject({
        status: 'rejected', code: 'SpellGrantUnavailable', message: grant.unavailableReason,
      });
      const session = new InMemoryRulesSession(structuredClone(reloaded.canonical.world), reloaded.canonical.catalog,
        { rng: () => 0.5, clock: createLogicalClock(), nextId: createSequentialIdFactory(commandId) });
      const beforeResources = structuredClone(session.getState().actors.hero.runtime.resources);
      const result = session.dispatch({ schemaVersion: 1, type: 'UseAction', commandId,
        expectedRevision: session.getState().revision, rulesetContentHash: session.getState().ruleset.contentHash,
        actorId: 'hero', actionId: action.id, targetIds: ['hero'],
        factsByTarget: { hero: { factsSource: 'scenario', boardRevision: 0, distanceFt: 0,
          lineOfSight: true, cover: 'none', relation: 'self' } },
        spell: { baseLevel: 1, grantId: grant.grantId } });
      expect(result).toMatchObject({ status: 'rejected', code: 'InvalidSpellDeclaration', message: grant.unavailableReason });
      expect(session.getState().actors.hero.runtime.resources).toEqual(beforeResources);
    }
  });

  it('casts two unlabeled item spells from their declared uses without borrowing class slots', async () => {
    const { cards, character, factory } = fixtures();
    for (const [index, card] of cards.entries()) {
      const effects = card.mechanics?.effects as Array<{ result: Array<Record<string, unknown>> }>;
      const grant = effects[0].result[0];
      delete grant.label;
      grant.freeuse = { count: index + 1, recharge: 'long_rest' };
    }
    character.resources = { ...character.resources, spell_slot_1: 2 };
    character.max_resources = { ...character.max_resources, spell_slot_1: 2 };

    const participant = await factory.loadSheetCombatParticipant({ character, cards: new Map() });
    const actor = participant.canonical.world.actors.hero;
    const grants = actor.spellcastingAccess!.grants.filter((grant) => grant.sourceId.startsWith('ITEM-'));
    expect(grants).toHaveLength(2);
    for (const grant of grants) {
      expect(grant.access).toBe('innate');
      expect(grant.slotResource).toBeUndefined();
      expect(grant.freeUseResource).toBeTruthy();
      const action = participant.canonical.catalog.getAction(grant.actionId)!;
      const ready = prepareSpellExecution({ action: action as Extract<typeof action, { kind: 'spell' }>,
        accessState: actor.spellcastingAccess!, resources: actor.runtime.resources,
        declaration: { grantId: grant.grantId } });
      expect(ready.status).toBe('ready');
      if (ready.status === 'ready') expect(ready.payment).toEqual({ kind: 'free_use', resource: grant.freeUseResource });
      const exhausted = prepareSpellExecution({ action: action as Extract<typeof action, { kind: 'spell' }>,
        accessState: actor.spellcastingAccess!,
        resources: { ...actor.runtime.resources, [grant.freeUseResource!]: 0, spell_slot_1: 2 },
        declaration: { grantId: grant.grantId } });
      expect(exhausted).toMatchObject({ status: 'rejected', code: 'SpellResourceUnavailable' });
    }
  });

  it('retains slot casting when an item explicitly labels its grant known', async () => {
    const { character, factory } = fixtures();
    character.resources = { ...character.resources, spell_slot_1: 2 };
    character.max_resources = { ...character.max_resources, spell_slot_1: 2 };
    const participant = await factory.loadSheetCombatParticipant({ character, cards: new Map() });
    const actor = participant.canonical.world.actors.hero;
    const grant = actor.spellcastingAccess!.grants.find((row) => row.sourceId === 'ITEM-1')!;
    expect(grant.access).toBe('known');
    expect(grant.slotResource).toBe('spell_slot_1');
    const action = participant.canonical.catalog.getAction(grant.actionId)!;
    const exhausted = prepareSpellExecution({ action: action as Extract<typeof action, { kind: 'spell' }>,
      accessState: actor.spellcastingAccess!,
      resources: { ...actor.runtime.resources, [grant.freeUseResource!]: 0, spell_slot_1: 2 },
      declaration: { grantId: grant.grantId } });
    expect(exhausted).toMatchObject({ status: 'ready', payment: { kind: 'slot', resource: 'spell_slot_1' } });
  });

  it('hydrates variant children into the scoped combat catalog and presentation under one parent grant', async () => {
    const { spells, character, factory, resolve } = fixtures();
    const parent = spells[0];
    const child = { ...structuredClone(parent), id: 'spell-first-variant',
      card_number: 'SPELL-VAR-first', name: 'Spell first — chosen effect',
      mechanics: { ...structuredClone(parent.mechanics!), variant_of_spell_id: parent.id,
        effects: [{ resolution: 'auto', result: [{ kind: 'healing', amount: 3 }] }] } } as Spell;
    parent.mechanics = { ...parent.mechanics!, spell_variant_ids: [child.id] };
    spells.push(child);
    const participant = await factory.loadSheetCombatParticipant({ character, cards: new Map() });
    expect(resolve.mock.calls.some(([reference]) => reference === child.id)).toBe(true);
    const children = participant.canonical.actions.filter((action) => action.sourceEntityIds[0] === child.id);
    expect(children).toHaveLength(1);
    const childAction = children[0];
    expect(participant.canonical.catalog.getAction(childAction.id)).toEqual(childAction);
    expect(participant.actionPresentation?.[childAction.id]).toMatchObject({
      entityType: 'spell', entityId: child.id, spellRef: { id: child.id },
    });
    expect(participant.canonical.world.actors.hero.capabilities.actionIds).not.toContain(childAction.id);
    expect(participant.canonical.world.actors.hero.spellcastingAccess?.grants
      .some((grant) => grant.actionId === childAction.id)).toBe(false);
  });

  it('checks an unknown cantrip before its effect and spends the shared use on a failed check',async()=>{
    const {cards,spells,character,factory}=fixtures();
    spells[0].level=0;
    spells[0].mechanics!.activation={mode:'active',cast_time:{unit:'action',amount:1},cost:[{resource:'action',amount:1}]};
    spells[0].mechanics!.effects=[{resolution:'auto',who:'self',result:[{kind:'healing',amount:2}]}];
    const itemPayload={kind:'grant_spell',value:spells[0].id,label:'known',freeuse:{count:1,recharge:'long_rest'},
      casting_override:{free_use_resource:'unknown_cantrip',pre_action_check:{ability:'int',skill:'arcana',dc:10},requires_unknown_spell:true}};
    cards[0].mechanics={activation:{mode:'passive',while:'equipped'},effects:[{resolution:'auto',result:[
      {kind:'resource',op:'grant',id:'unknown_cantrip',amount:1,recharge:'long_rest'},itemPayload]}]};
    cards[1].mechanics={activation:{mode:'passive',while:'equipped'},effects:[{resolution:'auto',result:[
      {kind:'grant_spell',value:spells[0].id,label:'known'}]}]};
    character.resources={...character.resources,unknown_cantrip:1};
    character.max_resources={...character.max_resources,unknown_cantrip:1};
    const loaded=await factory.loadSheetCombatParticipant({character,cards:new Map()});
    const grant=loaded.canonical.world.actors.hero.spellcastingAccess!.grants.find(row=>row.sourceId===cards[0].card_number)!;
    const action=loaded.canonical.catalog.getAction(grant.actionId)!;
    expect(action.mechanics.pre_action_check).toMatchObject({ability:'int',skill:'arcana',dc:10});
    const command:UseActionCommand={schemaVersion:1,type:'UseAction',commandId:'unknown',expectedRevision:loaded.canonical.world.revision,
      rulesetContentHash:loaded.canonical.world.ruleset.contentHash,actorId:'hero',actionId:grant.actionId,targetIds:['hero'],
      factsByTarget:{hero:{factsSource:'scenario',boardRevision:0,distanceFt:0,lineOfSight:true,cover:'none',relation:'self'}},
      spell:{baseLevel:0,grantId:grant.grantId}};
    const known=new InMemoryRulesSession(structuredClone(loaded.canonical.world),loaded.canonical.catalog,
      {rng:()=>0.95,clock:createLogicalClock(),nextId:createSequentialIdFactory('known')});
    expect(known.dispatch(command).status).toBe('rejected');
    character.equipment={...character.equipment,ring_right:null};
    const unknownLoaded=await factory.loadSheetCombatParticipant({character,cards:new Map()});
    const unknownGrant=unknownLoaded.canonical.world.actors.hero.spellcastingAccess!.grants.find(row=>row.sourceId===cards[0].card_number)!;
    const failed=new InMemoryRulesSession(structuredClone(unknownLoaded.canonical.world),unknownLoaded.canonical.catalog,
      {rng:()=>0,clock:createLogicalClock(),nextId:createSequentialIdFactory('failed')});
    const unknownCommand={...command,actionId:unknownGrant.actionId,spell:{baseLevel:0,grantId:unknownGrant.grantId},
      expectedRevision:unknownLoaded.canonical.world.revision,rulesetContentHash:unknownLoaded.canonical.world.ruleset.contentHash};
    expect(failed.dispatch(unknownCommand).status).toBe('accepted');
    expect(failed.getState().actors.hero.runtime.resources.unknown_cantrip).toBe(0);
    expect(failed.getState().actors.hero.runtime.hp.current).toBe(8);
    const success=new InMemoryRulesSession(structuredClone(unknownLoaded.canonical.world),unknownLoaded.canonical.catalog,
      {rng:()=>0.95,clock:createLogicalClock(),nextId:createSequentialIdFactory('success')});
    expect(success.dispatch(unknownCommand).status).toBe('accepted');
    expect(success.getState().actors.hero.runtime.hp.current).toBe(10);
  });
  it('keeps one item resource across two selected cantrips instead of refreshing it when the choice changes',async()=>{
    const {cards,spells,character,factory}=fixtures();
    spells.forEach(spell=>{spell.level=0;const activation=spell.mechanics!.activation as Record<string,unknown>;activation.cost=[{resource:'action',amount:1}];});
    cards[0].mechanics={activation:{mode:'passive',while:'equipped'},effects:[{resolution:'auto',result:[
      {kind:'resource',op:'grant',id:'shared_cantrip',amount:1,recharge:'long_rest'},
      {kind:'choice',id:'selected-cantrip',count:1,context:'in_play',options:{source:'spell',items:spells.map(spell=>({id:spell.id,name:spell.name,
        grants:[{kind:'grant_spell',value:spell.id,label:'known',freeuse:{count:1,recharge:'long_rest'},casting_override:{free_use_resource:'shared_cantrip'}}]}))}},
    ]}]};
    character.resources={...character.resources,shared_cantrip:1};character.max_resources={...character.max_resources,shared_cantrip:1};
    character.turn_state={...character.turn_state,inPlayChoices:{'item-0:selected-cantrip':[spells[0].id]}};
    const first=await factory.loadSheetCombatParticipant({character,cards:new Map()}),owner=first.canonical.world.actors.hero;
    const grant=owner.spellcastingAccess!.grants.find(row=>row.sourceId===cards[0].card_number)!;
    expect(grant.freeUseResource).toBe('shared_cantrip');
    const firstAction=first.canonical.catalog.getAction(grant.actionId)!;
    if(firstAction.kind!=='spell')throw Error('Expected spell');
    const prepared=prepareSpellExecution({action:firstAction,accessState:owner.spellcastingAccess!,resources:owner.runtime.resources,declaration:{grantId:grant.grantId}});
    if(prepared.status!=='ready')throw Error(prepared.message);
    const after=pay(owner.runtime,(prepared.executableAction.mechanics.activation as {cost:Parameters<typeof pay>[1]}).cost).state;
    character.resources=JSON.parse(JSON.stringify(after.resources));
    character.turn_state={...character.turn_state,inPlayChoices:{'item-0:selected-cantrip':[spells[1].id]}};
    const second=await factory.loadSheetCombatParticipant({character,cards:new Map()}),reloaded=second.canonical.world.actors.hero;
    const other=reloaded.spellcastingAccess!.grants.find(row=>row.sourceId===cards[0].card_number)!;
    expect(other.actionId).not.toBe(grant.actionId);expect(other.freeUseResource).toBe('shared_cantrip');
    const secondAction=second.canonical.catalog.getAction(other.actionId)!;
    if(secondAction.kind!=='spell')throw Error('Expected spell');
    expect(prepareSpellExecution({action:secondAction,accessState:reloaded.spellcastingAccess!,resources:reloaded.runtime.resources,declaration:{grantId:other.grantId}}).status).toBe('rejected');
  });
  it.each([0, 1])('honors a limited-use cantrip grant on item %s across reload', async index => {
    const { cards, spells, character, factory } = fixtures();
    const payload = ((cards[index].mechanics!.effects as Record<string, unknown>[])[0].result as Record<string, unknown>[])[0];
    payload.freeuse = { count: 1, recharge: 'long_rest' };
    spells[index].level = 0;
    const { canonical } = await factory.loadSheetCombatParticipant({ character, cards: new Map() });
    const actor = canonical.world.actors.hero;
    const grant = actor.spellcastingAccess!.grants.find(row => row.sourceId === cards[index].card_number)!;
    const action = canonical.catalog.getAction(grant.actionId)!;
    if (action.kind !== 'spell') throw Error('Expected spell');
    const prepared = prepareSpellExecution({ action, accessState: actor.spellcastingAccess!, resources: actor.runtime.resources, declaration: { grantId: grant.grantId } });
    expect(prepared.status).toBe('ready');
    if (prepared.status !== 'ready') throw Error(prepared.message);
    expect(prepared.payment.kind).toBe('free_use');
    const cost = (prepared.executableAction.mechanics.activation as { cost: { resource: string; amount: number }[] }).cost;
    const paid = JSON.parse(JSON.stringify(pay(actor.runtime, cost).state));
    expect(prepareSpellExecution({ action, accessState: actor.spellcastingAccess!, resources: paid.resources, declaration: { grantId: grant.grantId } }).status).toBe('rejected');
    expect(longRest(paid, actor.character).state.resources[grant.freeUseResource!]).toBe(1);
  });
  it.each([0, 1])('uses modifier zero for item %s when its owner has no spellcasting ability', async index => {
    const { cards, spells, character, factory } = fixtures();
    const payload = ((cards[index].mechanics!.effects as Record<string, unknown>[])[0].result as Record<string, unknown>[])[0];
    delete payload.ability;
    spells[index].mechanics!.effects = index === 0
      ? [{ resolution: 'auto', who: 'self', result: [{ kind: 'healing', amount: '2 + spellcasting' }] }]
      : [{ resolution: 'save', who: 'target', ability: 'dex', dc: '8 + prof + spellcasting', on_fail: [{ kind: 'damage', amount: 1, type: 'fire' }] }];
    const { canonical } = await factory.loadSheetCombatParticipant({ character, cards: new Map() });
    const actor = canonical.world.actors.hero;
    const grant = actor.spellcastingAccess!.grants.find(row => row.sourceId === cards[index].card_number)!;
    expect(grant.fixedSpellcastingModifier).toBe(0);
    expect(grant.spellcastingAbility).toBeUndefined();
    const session = new InMemoryRulesSession(JSON.parse(JSON.stringify(canonical.world)), canonical.catalog,
      { rng: () => 0.5, clock: createLogicalClock(), nextId: createSequentialIdFactory('fixed') });
    const command: UseActionCommand = { schemaVersion: 1, type: 'UseAction', commandId: 'fixed-cast', expectedRevision: canonical.world.revision,
      rulesetContentHash: canonical.world.ruleset.contentHash, actorId: 'hero', actionId: grant.actionId, targetIds: ['hero'],
      factsByTarget: { hero: { factsSource: 'scenario', boardRevision: 0, distanceFt: 0, lineOfSight: true, cover: 'none', relation: 'self' } },
      spell: { baseLevel: 1, grantId: grant.grantId } };
    expect(session.dispatch(command).status).toBe('accepted');
    if (index === 0) expect(session.getState().actors.hero.runtime.hp.current).toBe(10);
    else {
      const pending = session.getState().pendingResolution;
      expect(pending?.type).toBe('target_save');
      if (pending?.type !== 'target_save') throw Error('Missing save');
      expect(pending.request.dc).toBe(10);
      expect(pending.spell?.fixedSpellcastingModifier).toBe(0);
    }
    expect(session.getState().actors.hero.character).toEqual(actor.character);
  });
  it.each([0, 1])('casts source-scoped spell %s as a bonus-action cantrip and preserves the original', async index => {
    const { cards, spells, character, factory } = fixtures();
    const payload = ((cards[index].mechanics!.effects as Record<string, unknown>[])[0].result as Record<string, unknown>[])[0];
    payload.label = 'cantrip';
    delete payload.freeuse;
    payload.casting_override = { spell_level: 0, remove_cost_resources: ['spell_slot'], replace_cost_resources: { action: 'bonus_action' } };
    const { canonical } = await factory.loadSheetCombatParticipant({ character, cards: new Map() });
    const actor = canonical.world.actors.hero;
    const grant = actor.spellcastingAccess!.grants.find(row => row.sourceId === cards[index].card_number)!;
    const action = canonical.catalog.getAction(grant.actionId)!;
    expect(action.kind === 'spell' && action.spell.level).toBe(0);
    expect(action.mechanics.activation).toMatchObject({ cast_time: { unit: 'bonus_action', amount: 1 } });
    expect(spells[index].mechanics?.activation).toMatchObject({ cast_time: { unit: 'action', amount: 1 } });
    expect(spells[index].level).toBe(1);
    const tape = createStrictRngTape([]);
    const session = new InMemoryRulesSession(JSON.parse(JSON.stringify(canonical.world)), canonical.catalog,
      { rng: tape.rng, clock: createLogicalClock(), nextId: createSequentialIdFactory('cantrip') });
    const command: UseActionCommand = { schemaVersion: 1, type: 'UseAction', commandId: `cast-${index}`, expectedRevision: canonical.world.revision,
      rulesetContentHash: canonical.world.ruleset.contentHash, actorId: 'hero', actionId: grant.actionId, targetIds: ['hero'],
      factsByTarget: { hero: { factsSource: 'scenario', boardRevision: 0, distanceFt: 0, lineOfSight: true, cover: 'none', relation: 'self' } },
      spell: { baseLevel: 0, grantId: grant.grantId } };
    expect(session.dispatch(command).status).toBe('accepted');
    expect(session.getState().actors.hero.runtime.resources).toMatchObject({ action: 1, bonus_action: 0 });
    expect(session.getState().actors.hero.runtime.hp.current).toBe(9 + index);
    expect(session.dispatch(command).status).toBe('rejected');
    expect(session.getState().actors.hero.runtime.hp.current).toBe(9 + index);
    const stale = JSON.parse(JSON.stringify(canonical.world));
    stale.actors.hero.runtime.equipment = {};
    expect(new InMemoryRulesSession(stale, canonical.catalog, { rng: tape.rng, clock: createLogicalClock(), nextId: createSequentialIdFactory('stale') })
      .dispatch(command).status).toBe('rejected');
    tape.assertExhausted();
  });
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
