import { describe, expect, it } from 'vitest';
import type { RuleActionDefinition } from '../rules-core/domain';
import type { SpellcastingAccessState } from '../rules-core/spellcastingAccess';
import type { SoloCombatState } from './types';
import {
  combatFreeuseActionIds, combatHotbarActionGroup, combatHotbarActionHasSource, combatHotbarResourceKeys,
  filterCombatActionsByResource, isCombatHotbarAction,
} from './hotbarActions';
import { FREEUSE_SHOWCASE_KEY } from '../engine/freeuse';

function spell(id: string, level = 1): RuleActionDefinition {
  return { id, name: id, kind: 'spell', spell: { level }, sourceEntityIds: [id],
    mechanics: { activation: { mode: 'triggered', trigger: { event: 'hit' },
      cost: [{ resource: 'bonus_action' }, { resource: 'spell_slot', level }] } } };
}
const access = (actions: RuleActionDefinition[], slotResource = 'spell_slot_1'): SpellcastingAccessState => ({
  grants: actions.map(action => ({ grantId: `grant:${action.id}`, actionId: action.id, sourceId: 'declared-source',
    access: 'spellbook', level: action.kind === 'spell' ? action.spell.level : 1, slotResource })),
  preparedSources: {},
});

describe('combat hotbar capability projection', () => {
  const itemSnapshot = (): SoloCombatState => ({world: {actors: {hero: {character: {
    knownCards: [{id:'vial',card_number:'item-vial'}, {id:'charm',card_number:'item-charm',requires_attunement:true}],
    equippedCards: [{id:'charm',card_number:'item-charm'}],
  }, runtime: {inventory:[{cardId:'vial',qty:0}, {cardId:'vial',qty:2,containerId:'bag'}],
    equipment:{ring:'charm'},resources:{action:0,charge:0}}}},objects:{}}} as unknown as SoloCombatState);

  it('keeps copies in containers and equipment, but never counts stale known/equipped card definitions as copies', () => {
    const state=itemSnapshot(), before=JSON.stringify(state);
    const vial={id:'drink',name:'Drink',kind:'nonSpell',sourceEntityIds:['item-vial'],mechanics:{damage_source_kind:'item'}} as RuleActionDefinition;
    const charm={id:'cast',name:'Cast',kind:'nonSpell',sourceEntityIds:['action:cast'],mechanics:{requires_item_source:'charm'}} as RuleActionDefinition;
    expect([vial,charm].map(action=>combatHotbarActionHasSource(state,'hero',action))).toEqual([true,true]);
    expect(JSON.stringify(state)).toBe(before);
    state.world.actors.hero.runtime.inventory=[{cardId:'vial',qty:0}];
    expect(combatHotbarActionHasSource(state,'hero',vial)).toBe(false);
    state.world.actors.hero.runtime.equipment.ring=null;
    expect(combatHotbarActionHasSource(state,'hero',charm)).toBe(false);
    expect(state.world.actors.hero.character.knownCards).toHaveLength(2);
    expect(state.world.actors.hero.character.equippedCards).toHaveLength(1);
  });

  it('retains a grant while any exact provider survives, independent of spent resources or attunement', () => {
    const state=itemSnapshot();
    const grant={...spell('item-grant'),mechanics:{requires_any_item_source:['vial','item-charm'],activation:{cost:[{resource:'charge'}]}}};
    expect(combatHotbarActionHasSource(state,'hero',grant)).toBe(true);
    state.world.actors.hero.runtime.inventory=[];
    expect(combatHotbarActionHasSource(state,'hero',grant)).toBe(true);
    state.world.actors.hero.runtime.equipment={};
    expect(combatHotbarActionHasSource(state,'hero',grant)).toBe(false);
    const classSpell={...spell('class-grant'),sourceEntityIds:['spell-entity','class'] as const};
    expect(combatHotbarActionHasSource(state,'hero',classSpell)).toBe(true);
    const materialCost={...classSpell,mechanics:{activation:{cost:[{resource:'item',card_id:'vial'}]}}};
    expect(combatHotbarActionHasSource(state,'hero',materialCost)).toBe(true);
  });

  it('reads immutable provider declarations for two legacy item grants without changing the saved catalog', () => {
    const state=itemSnapshot(), actor=state.world.actors.hero;
    actor.character.knownCards![0].mechanics={effects:[{resolution:'auto',result:[{kind:'grant_action',value:'grant:one'}]}]};
    actor.character.knownCards![1].mechanics={effects:[{kind:'grant_action',values:['grant:two']}]};
    const first={id:'granted-one',name:'First',kind:'nonSpell',sourceEntityIds:['one'],mechanics:{damage_source_kind:'item'}} as RuleActionDefinition;
    const second={...first,id:'granted-two',sourceEntityIds:['two'] as const};
    state.actionPresentation={'granted-one':{actionRef:{card_number:'grant:one'} as never},'granted-two':{actionRef:{card_number:'grant:two'} as never}};
    const actions=[first,second], frozen=JSON.stringify(actions);
    expect(actions.map(action=>combatHotbarActionHasSource(state,'hero',action))).toEqual([true,true]);
    actor.runtime.inventory=[]; actor.runtime.equipment={};
    expect(actions.map(action=>combatHotbarActionHasSource(state,'hero',action))).toEqual([false,false]);
    expect(JSON.stringify(actions)).toBe(frozen);
  });

  it('preserves only explicitly granting world instances, including a bond recall outside the bag', () => {
    const state=itemSnapshot(), actor=state.world.actors.hero;
    actor.runtime.inventory=[];actor.runtime.equipment={};
    const action={id:'recall',name:'Recall',kind:'nonSpell',sourceEntityIds:['recall-ref'],mechanics:{requires_item_source:'charm'}} as RuleActionDefinition;
    state.world.objects.instance={id:'instance',name:'Instance',kind:'item',size:'small',itemCardId:'charm',ownerActorId:'hero',grantedActionRefs:['recall-ref']};
    expect(combatHotbarActionHasSource(state,'hero',action)).toBe(false);
    state.world.objects.instance.grantsToOwner=true;
    expect(combatHotbarActionHasSource(state,'hero',action)).toBe(true);
    delete state.world.objects.instance.grantsToOwner;
    state.world.objects.instance.carriedByActorId='hero';
    expect(combatHotbarActionHasSource(state,'hero',action)).toBe(true);
    state.world.objects.instance.grantedActionRefs=[];
    expect(combatHotbarActionHasSource(state,'hero',action)).toBe(false);
  });
  it('retains two hit-triggered spells with distinct free-use grants even when unprepared or exhausted', () => {
    const actions = [spell('one'), spell('two')], grants = access(actions);
    grants.grants[0].freeUseResource = 'freeuse-owned-one';
    grants.grants[1].freeUseResource = 'freeuse-owned-two';
    const maxima = { spell_slot_1: 3, 'freeuse-owned-one': 1, 'freeuse-owned-two': 2 };
    const free = combatFreeuseActionIds(actions, maxima, grants);
    expect(actions.every(isCombatHotbarAction)).toBe(true);
    expect(filterCombatActionsByResource(actions, FREEUSE_SHOWCASE_KEY, free, grants)).toEqual(actions);
    expect(filterCombatActionsByResource(actions, 'spell_slot_1', free, grants)).toEqual(actions);
    expect(combatHotbarResourceKeys(maxima, actions, free, grants)).toEqual(['spell_slot_1']);
  });

  it('matches upcasting in the declared slot family, preserving Pact access instead of the template cost', () => {
    const first = spell('book-one'), second = spell('book-two', 2), grants = access([first, second]);
    grants.grants[1].slotResource = 'pact_slot_3';
    expect(filterCombatActionsByResource([first, second], 'spell_slot_2', new Set(), grants)).toEqual([first]);
    expect(filterCombatActionsByResource([first, second], 'pact_slot_3', new Set(), grants)).toEqual([second]);
    expect(filterCombatActionsByResource([first, second], 'pact_slot_1', new Set(), grants)).toEqual([]);
    // Non-spell cost consumers remain visible next to granted spell casts.
    const recovery = { id: 'recovery', name: 'Recovery', kind: 'nonSpell', sourceEntityIds: ['recovery'],
      mechanics: { activation: { mode: 'active', cost: [{ resource: 'spell_slot', level: 2 }] } } } as RuleActionDefinition;
    expect(filterCombatActionsByResource([first, recovery], 'spell_slot_2', new Set(), grants)).toEqual([first, recovery]);
  });

  it('hides resources whose only consumer is a variant and excludes variants at every filter boundary', () => {
    const parent = spell('parent'), child = { ...spell('child'), mechanics: {
      variant_of_spell_id: parent.id, activation: { mode: 'active', cost: [{ resource: 'variant_charge' }] },
    } };
    const grants = access([parent, child]);
    grants.grants[1].slotResource = 'child_slot';grants.grants[1].freeUseResource = 'freeuse-child';
    const maxima = { bonus_action: 1, variant_charge: 4, child_slot: 2, 'freeuse-child': 1, hit_dice_d8: 3 };
    const free = combatFreeuseActionIds([parent, child], maxima, grants);
    expect(free.size).toBe(0);
    expect(combatHotbarResourceKeys(maxima, [parent, child], free, grants)).toEqual(['bonus_action']);
    for (const key of [null, 'variant_charge', 'child_slot', FREEUSE_SHOWCASE_KEY]) {
      expect(filterCombatActionsByResource([child], key, new Set([child.id]), grants)).toEqual([]);
    }
  });

  it('uses item provenance for item spells and granted actions, keeping a basic weapon attack in its basic group', () => {
    const snapshot = { world: { actors: { hero: { character: { knownCards: [
      { id: 'item-one', card_number: 'item-ref-one' }, { id: 'item-two', card_number: 'item-ref-two' },
    ], equippedCards: [] } } } }, actionPresentation: {
      basic: { actionRef: { type: 'basic' } }, feature: { actionRef: { type: 'class_feature' } },
    } } as unknown as SoloCombatState;
    const itemSpell = { ...spell('item-spell'), sourceEntityIds: ['item-spell', 'item-two'] } as RuleActionDefinition;
    const granted = { id: 'granted', name: 'Granted', kind: 'nonSpell', sourceEntityIds: ['feature-entity'],
      mechanics: { requires_any_item_source: ['item-one'] } } as RuleActionDefinition;
    const container = { id: 'container', name: 'Container', kind: 'nonSpell', sourceEntityIds: ['item-ref-one'], mechanics: {} } as RuleActionDefinition;
    const basic = { id: 'basic', name: 'Weapon attack', kind: 'nonSpell', sourceEntityIds: ['basic-entity'],
      mechanics: { primitive: { type: 'weapon_attack' } } } as RuleActionDefinition;
    expect([itemSpell, granted, container].map(action => combatHotbarActionGroup(snapshot, 'hero', action))).toEqual(['items', 'items', 'items']);
    expect(combatHotbarActionGroup(snapshot, 'hero', basic)).toBe('basic');
    expect(combatHotbarActionGroup(snapshot, 'hero', spell('class-spell'))).toBe('spells');
    expect(combatHotbarActionGroup(snapshot, 'hero', { ...basic, id: 'feature' })).toBe('features');
  });
});
