import { describe, expect, it } from 'vitest';
import { buildResourceRuntimePatch, syncRuntimeResources } from './resourceInit';
import type { AssembledCharacter } from './assemble';
import type { CharacterContext } from '../mvp/contracts';
import type { ForgeCharacter } from './types';
import type { Card } from '../types';
import type { Action } from '../types';
import type { GrantedAction } from './actionSheet';

const ctx: CharacterContext = {
  abilityMods: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 3 },
  profBonus: 2,
  level: 5,
};

const assembled = {
  klass: {
    name: 'Бард',
    resources: { inspiration: { count: 'max(cha, 1)', per: 'long_rest' } },
  },
  effects: [{
    effect: {
      id: 'feature',
      name: 'Особая способность',
      mechanics: {
        name: 'Особая способность',
        effects: [{ resolution: 'auto', result: [{ kind: 'resource', op: 'grant', id: 'heroic', amount: 2 }] }],
      },
    },
    origin: { kind: 'race', id: 'human', name: 'Человек' },
  }],
  actions: [],
  spells: [],
} as unknown as AssembledCharacter;

describe('MM4 — resource maximum sources', () => {
  it('fills gained class slots and ability-scaled capacity while preserving already spent charges', () => {
    const caster = {...assembled, klass: {id:'wizard',name:'Renamed caster',resources:{
      spell_slot_1:{by_level:{1:2,2:3},level_source:'wizard'},
      spell_slot_2:{by_level:{3:2},level_source:'wizard'},
      class_pool:{count:'max(cha, 1)'},
    }}, effects:[]} as unknown as AssembledCharacter;
    const existing = {hp:{current:5,max:10,temp:0},resources:{action:0,bonus_action:1,reaction:1,spell_slot_1:0,class_pool:1},
      maxResources:{action:1,bonus_action:1,reaction:1,spell_slot_1:2,class_pool:3},equipment:{},inventory:[],activeEffects:[],firedThisTurn:[],firedThisRest:[]};
    const synced = syncRuntimeResources({...ctx,level:7,classLevels:{wizard:3,fighter:4},abilityMods:{...ctx.abilityMods,cha:4}},caster,existing);
    expect(synced.maxResources).toMatchObject({spell_slot_1:3,spell_slot_2:2,class_pool:4});
    expect(synced.resources).toMatchObject({action:0,spell_slot_1:1,spell_slot_2:2,class_pool:2});
    const repeated = syncRuntimeResources({...ctx,level:7,classLevels:{wizard:3,fighter:4},abilityMods:{...ctx.abilityMods,cha:4}},caster,{...existing,...synced});
    expect(repeated.resources).toEqual(synced.resources);
  });

  it('makes additional limited action uses available without restoring old spent uses in a multiclass', () => {
    const action = {id:'limited',card_number:'ACT-limited',name:'Renamed action',mechanics:{activation:{mode:'active',cost:[{resource:'self_uses'}]},
      uses:{count:2,by_level:{1:2,4:3},level_source:'fighter',per:'long_rest'},effects:[]}} as unknown as Action;
    const mixed = {...assembled,effects:[],actions:[{action,origin:{kind:'class',id:'fighter',name:'Fighter'}}]} as unknown as AssembledCharacter;
    const before = syncRuntimeResources({...ctx,level:5,classLevels:{fighter:1,wizard:4}},mixed);
    const existing = {hp:{current:5,max:10,temp:0},resources:{...before.resources,'uses_ACT-limited':0},maxResources:before.maxResources,
      equipment:{},inventory:[],activeEffects:[],firedThisTurn:[],firedThisRest:[]};
    const after = syncRuntimeResources({...ctx,level:8,classLevels:{fighter:4,wizard:4}},mixed,existing);
    expect(after.resources['uses_ACT-limited']).toBe(1);
    expect(after.maxResources['uses_ACT-limited']).toBe(3);
  });

  it('preserves an exhausted item pool through unequip and re-equip', () => {
    const card = {id:'item',name:'Renamed item',mechanics:{activation:{mode:'passive'},effects:[{resolution:'auto',result:[{kind:'resource',op:'grant',id:'item_pool',amount:2}]}]}} as unknown as Card;
    const noSources = {...assembled,klass:null,effects:[]} as unknown as AssembledCharacter;
    const existing = {hp:{current:5,max:10,temp:0},resources:{action:1,bonus_action:1,reaction:1,item_pool:0},
      maxResources:{action:1,bonus_action:1,reaction:1,item_pool:2},equipment:{},inventory:[{cardId:card.id,qty:1}],activeEffects:[],firedThisTurn:[],firedThisRest:[]};
    const dormant = syncRuntimeResources(ctx,noSources,existing,[],[card]);
    expect(dormant.maxResources.item_pool).toBe(0);
    const equipped = syncRuntimeResources({...ctx,equippedCards:[card]},noSources,{...existing,...dormant,equipment:{ring:card.id}},[],[card]);
    expect(equipped.maxResources.item_pool).toBe(2);
    expect(equipped.resources.item_pool).toBe(0);
  });

  it('returns base, class and granted pool sources', () => {
    const result = syncRuntimeResources(ctx, assembled);

    expect(result.maxResources.inspiration).toBe(3);
    expect(result.sources.inspiration).toEqual([
      { value: 3, source: 'Бард', reason: 'классовый максимум' },
    ]);
    expect(result.maxResources.heroic).toBe(2);
    expect(result.sources.heroic).toEqual([
      { value: 2, source: 'Особая способность', reason: 'грант ресурса' },
    ]);
    expect(result.sources.action).toEqual([
      { value: 1, source: 'Базовый ресурс хода', reason: 'базовый максимум на ход' },
    ]);
  });

  it('does not write merely because jsonb returned resource keys in another order', () => {
    const maxResources = {
      heroic: 2,
      inspiration: 3,
      reaction: 1,
      bonus_action: 1,
      action: 1,
    };
    const character = {
      current_hp: 10,
      max_hp: 10,
      resources: { ...maxResources },
      max_resources: maxResources,
      turn_state: {},
      inventory_items: [],
      equipment: {},
      active_effects: [],
    } as unknown as ForgeCharacter;

    expect(buildResourceRuntimePatch(character, ctx, assembled, false, 10)).toBeNull();
  });

  it('preserves Heroic Inspiration granted by another character across sheet reconciliation', () => {
    const character = {
      current_hp: 10,
      max_hp: 10,
      resources: {
        action: 1,
        bonus_action: 1,
        reaction: 1,
        inspiration: 3,
        heroic: 2,
        heroic_inspiration: 1,
      },
      max_resources: {
        action: 1,
        bonus_action: 1,
        reaction: 1,
        inspiration: 3,
        heroic: 2,
        heroic_inspiration: 1,
      },
      turn_state: {},
      inventory_items: [],
      equipment: {},
      active_effects: [],
    } as unknown as ForgeCharacter;

    const synced = syncRuntimeResources(ctx, assembled, undefined, []);
    expect(synced.maxResources.heroic_inspiration).toBeUndefined();

    expect(buildResourceRuntimePatch(character, ctx, assembled, false, 10)).toBeNull();
    expect(syncRuntimeResources(ctx, assembled, {
      hp: { current: 10, max: 10, temp: 0 },
      resources: character.resources ?? {},
      maxResources: character.max_resources ?? {},
      equipment: {},
      inventory: [],
      activeEffects: [],
      firedThisTurn: [],
      firedThisRest: [],
    }).resources.heroic_inspiration).toBe(1);
  });

  it('initializes a bounded uses pool declared by a carried item', () => {
    const healerKit = {
      id: 'kit-id', card_number: 'CARD-0491', name: 'Комплект целителя',
      mechanics: {
        activation: { mode: 'active', while: 'carried', cost: [{ resource: 'self_uses' }] },
        uses: { count: 10, per: 'never' },
        effects: [{ resolution: 'auto', result: [{ kind: 'stabilize', who: 'target' }] }],
      },
    } as unknown as Card;

    const synced = syncRuntimeResources(ctx, assembled, undefined, [], [healerKit]);
    expect(synced.maxResources['uses_CARD-0491']).toBe(10);
    expect(synced.resources['uses_CARD-0491']).toBe(10);
  });

  it('materializes and preserves the spent pool of a limited granted action', () => {
    const action = {
      id: 'flight-id',
      card_number: 'ACT-dragonborn-draconic-flight',
      name: 'Драконьий полёт',
      mechanics: {
        activation: {
          mode: 'active',
          cost: [{ resource: 'bonus_action' }, { resource: 'self_uses' }],
        },
        uses: { count: 1, per: 'long_rest' },
        effects: [{ resolution: 'auto', result: [] }],
      },
    } as unknown as Action;
    const grantedActions: GrantedAction[] = [{
      action,
      sourceLabel: 'Драконорождённый',
      group: 'race',
    }];

    const fresh = syncRuntimeResources(ctx, assembled, undefined, [], [], grantedActions);
    expect(fresh.maxResources['uses_ACT-dragonborn-draconic-flight']).toBe(1);
    expect(fresh.resources['uses_ACT-dragonborn-draconic-flight']).toBe(1);

    const spent = {
      hp: { current: 10, max: 10, temp: 0 },
      resources: { ...fresh.resources, 'uses_ACT-dragonborn-draconic-flight': 0 },
      maxResources: fresh.maxResources,
      equipment: {},
      inventory: [],
      activeEffects: [],
      firedThisTurn: [],
      firedThisRest: [],
    };
    const reconciled = syncRuntimeResources(ctx, assembled, spent, [], [], grantedActions);
    expect(reconciled.resources['uses_ACT-dragonborn-draconic-flight']).toBe(0);
    expect(reconciled.maxResources['uses_ACT-dragonborn-draconic-flight']).toBe(1);
    expect(reconciled.sources['uses_ACT-dragonborn-draconic-flight']).toEqual([{
      value: 1,
      source: 'Драконьий полёт · Драконорождённый',
      reason: 'число использований',
    }]);
  });

  it('scales Second Wind uses by Fighter level in a multiclass', () => {
    const secondWind = {
      id: 'second-wind-id',
      card_number: 'ACT-second-wind',
      name: 'Второе дыхание',
      mechanics: {
        activation: { mode: 'active', cost: [{ resource: 'bonus_action' }, { resource: 'self_uses' }] },
        uses: { count: 2, by_level: { 1: 2, 4: 3 }, level_source: 'warrior', per: 'long_rest' },
        effects: [{ resolution: 'auto', result: [{ kind: 'healing', amount: '1d10 + class_level:warrior' }] }],
      },
    } as unknown as Action;
    const fighterAssembly = {
      ...assembled,
      actions: [{ action: secondWind, origin: { kind: 'class', id: 'fighter', name: 'Воин' } }],
    } as unknown as AssembledCharacter;

    const fighterOne = syncRuntimeResources({ ...ctx, classLevels: { warrior: 1, wizard: 4 } }, fighterAssembly);
    expect(fighterOne.maxResources['uses_ACT-second-wind']).toBe(2);

    const fighterFour = syncRuntimeResources({ ...ctx, level: 8, classLevels: { warrior: 4, wizard: 4 } }, fighterAssembly);
    expect(fighterFour.maxResources['uses_ACT-second-wind']).toBe(3);
  });

  it('adds a newly gained secondary-class Hit Die without restoring spent dice', () => {
    const multiclass = {
      ...assembled,
      klass: { id: 'fighter', card_number: 'CLASS-warrior', name: 'Воин', hit_die: 'd10', resources: {} },
      classes: [
        { id: 'fighter', card_number: 'CLASS-warrior', name: 'Воин', hit_die: 'd10' },
        { id: 'wizard', card_number: 'CLASS-wizard', name: 'Волшебник', hit_die: 'd6' },
      ],
      effects: [],
    } as unknown as AssembledCharacter;
    const leveledContext: CharacterContext = {
      ...ctx,
      level: 3,
      hitDie: 'd10',
      classLevels: { warrior: 1, wizard: 2 },
    };
    const existing = {
      hp: { current: 10, max: 10, temp: 0 },
      resources: {
        action: 1, bonus_action: 1, reaction: 1,
        hit_dice_d10: 0, hit_dice_d6: 0,
      },
      maxResources: {
        action: 1, bonus_action: 1, reaction: 1,
        hit_dice_d10: 1, hit_dice_d6: 1,
      },
      equipment: {}, inventory: [], activeEffects: [], firedThisTurn: [], firedThisRest: [],
    };

    const result = syncRuntimeResources(leveledContext, multiclass, existing);
    expect(result.maxResources).toMatchObject({ hit_dice_d10: 1, hit_dice_d6: 2 });
    expect(result.resources).toMatchObject({ hit_dice_d10: 0, hit_dice_d6: 1 });
  });
});
