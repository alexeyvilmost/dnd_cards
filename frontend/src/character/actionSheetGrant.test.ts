/**
 * S6 «предмет=эффект»: grant_action даёт доступ к библиотечному действию (приёмы оружия BG3). Экономика
 * (activation/cost) и поведение — на КАРТЕ действия, а не в grant_action (там только ссылка value|values).
 * collectGrantActionSlugs собирает slug'и; collectSheetActions оборачивает загруженные действия в строки
 * листа группы item с источником-предметом.
 */
import { describe, expect, it } from 'vitest';
import { collectSheetActions, collectGrantActionSlugs, collectGrantEffectSlugs, type GrantedAction } from './actionSheet';
import type { AssembledCharacter } from './assemble';
import type { Action } from '../types';

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
});
