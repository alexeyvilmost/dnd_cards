/**
 * S6 «предмет=эффект»: grant_action даёт доступ к библиотечному действию (приёмы оружия BG3). Экономика
 * (activation/cost) и поведение — на КАРТЕ действия, а не в grant_action (там только ссылка value|values).
 * collectGrantActionSlugs собирает slug'и; collectSheetActions оборачивает загруженные действия в строки
 * листа группы item с источником-предметом.
 */
import { describe, expect, it } from 'vitest';
import {
  collectActionUsesPools,
  collectActionUsesRecharge,
  collectGrantActionSlugs,
  collectGrantEffectSlugs,
  collectSheetActions,
  type GrantedAction,
} from './actionSheet';
import type { AssembledCharacter } from './assemble';
import type { Action } from '../types';
import { executeAction } from '../engine/execute';
import type { CharacterContext, RuntimeState } from '../mvp/contracts';

const emptyAssembled = { actions: [], effects: [], spells: [] } as unknown as AssembledCharacter;

const dashAction = {
  id: 'act-dash', name: 'Рывок', card_number: 'dash', type: 'action',
  mechanics: {
    name: 'Рывок', activation: { mode: 'active', cost: [{ resource: 'bonus_action' }] },
    effects: [{ resolution: 'auto', result: [{ kind: 'narrative', description: 'Рывок' }] }],
  },
} as unknown as Action;

const triggeredAction = {
  id: 'act-follow-up', name: 'Ответный приём', card_number: 'follow-up', type: 'action',
  mechanics: {
    activation: {
      mode: 'triggered', optional: true,
      trigger: { event: 'hit', source_action_card_number: 'action_basic_unarmed' },
      cost: [{ resource: 'bonus_action', amount: 1 }],
    },
    effects: [{ resolution: 'auto', result: [{ kind: 'narrative', description: 'Ответный приём' }] }],
  },
} as unknown as Action;

const limitedAction = {
  id: 'act-limited', name: 'Дар с зарядом', card_number: 'ACT-limited-grant', type: 'action',
  mechanics: {
    activation: {
      mode: 'active',
      cost: [{ resource: 'bonus_action' }, { resource: 'self_uses' }],
    },
    uses: { count: 'prof_bonus', per: 'long_rest' },
    effects: [{ resolution: 'auto', result: [] }],
  },
} as unknown as Action;

describe('S6 — collectGrantActionSlugs', () => {
  it('читает grant_action.value (форма effects[{resolution:auto,result}])', () => {
    expect(collectGrantActionSlugs({ effects: [{ resolution: 'auto', result: [{ kind: 'grant_action', value: 'dash' }] }] })).toEqual(['dash']);
  });

  it('читает grant_action.values (несколько slug) в прямой форме kind', () => {
    expect(collectGrantActionSlugs({ effects: [{ kind: 'grant_action', values: ['riposte', 'lunge'] }] })).toEqual(['riposte', 'lunge']);
  });

  it('без grant_action / null → пусто', () => {
    expect(collectGrantActionSlugs({ effects: [{ kind: 'modifier' }] })).toEqual([]);
    expect(collectGrantActionSlugs(null)).toEqual([]);
  });

  it('level_gate: приём доступен только с нужного уровня персонажа', () => {
    const mech = { effects: [{ kind: 'grant_action', value: 'riposte', level_gate: 5 }] };
    expect(collectGrantActionSlugs(mech, 1)).toEqual([]);          // 1 < 5 → скрыт
    expect(collectGrantActionSlugs(mech, 5)).toEqual(['riposte']); // 5 ≥ 5 → доступен
    expect(collectGrantActionSlugs(mech)).toEqual(['riposte']);    // без уровня (Infinity) → доступен
  });

  it('читает grant_action только из выбранного варианта build-time choice', () => {
    const mechanics = { effects: [{
      id: 'telekinetic_ability', kind: 'choice',
      options: { source: 'explicit', items: [
        { id: 'int', grants: [{ kind: 'grant_action', values: ['push-int', 'pull-int'] }] },
        { id: 'wis', grants: [{ kind: 'grant_action', values: ['push-wis', 'pull-wis'] }] },
      ] },
    }] };
    const origin = { kind: 'feat' as const, id: 'feat-telekinetic', name: 'Телекинетик', featureId: 'effect-telekinetic' };
    const choiceId = 'feat:feat-telekinetic:effect-telekinetic:telekinetic_ability';
    expect(collectGrantActionSlugs(mechanics)).toEqual([]);
    expect(collectGrantActionSlugs(mechanics, 4, {
      origin,
      resolvedChoices: { [choiceId]: ['wis'] },
    })).toEqual(['push-wis', 'pull-wis']);
  });
});

describe('runtime effect library references', () => {
  it('находит grant_effect внутри on_hit, on_fail и runtime-choice', () => {
    expect(collectGrantEffectSlugs({ effects: [{
      on_hit: [{ kind: 'grant_effect', value: 'ray-slow' }],
      on_fail: [{ kind: 'grant_effect', values: ['bane-attack', 'bane-save'] }],
      result: [{ kind: 'choice', options: { items: [{ grants: [
        { kind: 'grant_effect', value: 'hex-strength' },
        { kind: 'grant_effect', value: 'hex-rider' },
      ] }] } }],
    }] })).toEqual(['ray-slow', 'bane-attack', 'bane-save', 'hex-strength', 'hex-rider']);
  });

  it('дедуплицирует библиотечную ссылку, повторённую в вариантах выбора', () => {
    expect(collectGrantEffectSlugs({ effects: [{ result: [
      { kind: 'grant_effect', value: 'shared' },
      { kind: 'grant_effect', values: ['shared'] },
    ] }] })).toEqual(['shared']);
  });
});

describe('S6 — collectSheetActions fromGranted', () => {
  it('выданное действие появляется как строка листа группы item с экономикой С КАРТЫ действия', () => {
    const granted: GrantedAction[] = [{ action: dashAction, sourceLabel: 'Сапоги скорохода', group: 'item' }];
    const out = collectSheetActions(emptyAssembled, [], [], granted);
    const item = out.filter((a) => a.group === 'item');
    expect(item).toHaveLength(1);
    expect(item[0].name).toBe('Рывок');
    expect(item[0].sourceLabel).toBe('Сапоги скорохода');
    expect(item[0].actionRef).toBe(dashAction);
    // Экономика — бонусное действие с карты «Рывок», НЕ из grant_action (там нет as/options).
    expect((item[0].mechanics.activation as { cost?: { resource?: string }[] }).cost?.[0]?.resource).toBe('bonus_action');
    // id-префикс granted- исключает коллизию с классовым действием того же id.
    expect(item[0].id).toBe('granted-act-dash');
  });

  it('без grantedActions группа не появляется (регресс)', () => {
    expect(collectSheetActions(emptyAssembled, [], []).filter((a) => a.group === 'item')).toHaveLength(0);
  });

  it('сохраняет выданное triggered-действие для шины событий, а не отбрасывает его как некликабельное', () => {
    const granted: GrantedAction[] = [{ action: triggeredAction, sourceLabel: 'Черта', group: 'class' }];
    const out = collectSheetActions(emptyAssembled, [], [], granted);
    expect(out).toHaveLength(1);
    expect((out[0].mechanics.activation as { mode?: string }).mode).toBe('triggered');
    expect(out[0].actionRef).toBe(triggeredAction);
  });

  it('binds a limited granted action to the same pool materialized for rest', () => {
    const granted: GrantedAction[] = [{
      action: limitedAction,
      sourceLabel: 'Дар подкласса',
      group: 'class',
    }];
    const [projected] = collectSheetActions(emptyAssembled, [], [], granted);

    expect(projected.usesKey).toBe('uses_ACT-limited-grant');
    expect((projected.mechanics.activation as { cost: unknown }).cost).toEqual([
      { resource: 'bonus_action' },
      { resource: 'uses_ACT-limited-grant' },
    ]);
    expect(collectActionUsesPools(emptyAssembled, [], granted)).toEqual([{
      key: 'uses_ACT-limited-grant',
      count: 'prof_bonus',
      per: 'long_rest',
      source: 'Дар с зарядом · Дар подкласса',
    }]);
    expect(collectActionUsesRecharge(emptyAssembled, [], granted)).toEqual({
      'uses_ACT-limited-grant': 'long_rest',
    });

    const runtime = {
      hp: { current: 10, max: 10, temp: 0 },
      resources: { bonus_action: 1, 'uses_ACT-limited-grant': 2 },
      maxResources: { bonus_action: 1, 'uses_ACT-limited-grant': 2 },
      equipment: {},
      inventory: [],
      activeEffects: [],
    } as RuntimeState;
    const context = {
      abilityMods: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
      profBonus: 2,
      level: 5,
    } as CharacterContext;
    const result = executeAction(runtime, projected.mechanics, { character: context, rng: () => 0.5 });
    expect(result.state.resources).toMatchObject({
      bonus_action: 0,
      'uses_ACT-limited-grant': 1,
    });
  });

  it('materializes the pool of a limited triggered grant used by the event bus', () => {
    const action = {
      ...triggeredAction,
      mechanics: {
        ...triggeredAction.mechanics,
        activation: {
          ...(triggeredAction.mechanics?.activation as Record<string, unknown>),
          cost: [{ resource: 'focus' }, { resource: 'self_uses' }],
        },
        uses: { count: 1, per: 'turn' },
      },
    } as Action;
    const granted: GrantedAction[] = [{ action, sourceLabel: 'Монах', group: 'class' }];
    const [projected] = collectSheetActions(emptyAssembled, [], [], granted);

    expect((projected.mechanics.activation as { mode: string }).mode).toBe('triggered');
    expect(projected.usesKey).toBe('uses_follow-up');
    expect(collectActionUsesPools(emptyAssembled, [], granted)[0]).toMatchObject({
      key: 'uses_follow-up',
      count: 1,
      per: 'turn',
    });
  });
});

describe('direct class/species trigger actions', () => {
  it('keeps a direct triggered action for the event bus', () => {
    const assembled = {
      ...emptyAssembled,
      actions: [{
        action: triggeredAction,
        origin: { kind: 'race', id: 'goliath', name: 'Голиаф' },
      }],
    } as unknown as AssembledCharacter;
    const [projected] = collectSheetActions(assembled);
    expect(projected.name).toBe('Ответный приём');
    expect((projected.mechanics.activation as { mode?: string }).mode).toBe('triggered');
    expect(projected.group).toBe('race');
  });
});
