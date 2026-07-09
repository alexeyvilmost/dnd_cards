/**
 * S6 «предмет=эффект»: grant_action даёт доступ к библиотечному действию (приёмы оружия BG3). Экономика
 * (activation/cost) и поведение — на КАРТЕ действия, а не в grant_action (там только ссылка value|values).
 * collectGrantActionSlugs собирает slug'и; collectSheetActions оборачивает загруженные действия в строки
 * листа группы item с источником-предметом.
 */
import { describe, expect, it } from 'vitest';
import { collectSheetActions, collectGrantActionSlugs, type GrantedAction } from './actionSheet';
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
});
