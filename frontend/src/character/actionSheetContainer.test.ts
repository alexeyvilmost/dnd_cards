/**
 * Контейнеры S2: распаковка mode='all' (Набор артиста). containerUnpackAction деривирует действие
 * «Распаковать» из ДАННЫХ карты (container_mode+contents) — add_item ×N содержимого + consumes_self
 * (расход самого набора). Поведение не хардкодится, различается только данными. Cycle-guard само-ссылки.
 */
import { describe, expect, it } from 'vitest';
import { collectSheetActions, containerUnpackAction } from './actionSheet';
import { executeAction } from '../engine/execute';
import type { AssembledCharacter } from './assemble';
import type { Card } from '../types';
import type { CharacterContext, ExecuteContext, RuntimeState } from '../mvp/contracts';

const emptyAssembled = { actions: [], effects: [], spells: [] } as unknown as AssembledCharacter;
const container = (mode: string, contents: { card_id: string; quantity: number }[], id = 'pack'): Card =>
  ({ id, name: 'Набор артиста', type: 'container', container_mode: mode, contents, image_url: '/x.png' } as unknown as Card);

describe('S2 — containerUnpackAction (распаковка mode=all)', () => {
  it('деривирует действие «Распаковать» с add_item по содержимому + расход набора', () => {
    const a = containerUnpackAction(container('all', [{ card_id: 'lute', quantity: 1 }, { card_id: 'costume', quantity: 2 }]));
    expect(a).toBeTruthy();
    expect((a!.mechanics.effects as { result: unknown }[])[0].result)
      .toEqual([{ kind: 'add_item', card_id: 'lute', qty: 1 }, { kind: 'add_item', card_id: 'costume', qty: 2 }]);
    const cost = (a!.mechanics.activation as { cost: Record<string, unknown>[] }).cost;
    expect(cost.some((c) => c.resource === 'item' && c.card_id === 'pack')).toBe(true); // consumes_self
    expect(a!.group).toBe('item');
  });

  it('cycle-guard: само-ссылка в содержимом пропускается (дата-баг)', () => {
    const a = containerUnpackAction(container('all', [{ card_id: 'pack', quantity: 1 }, { card_id: 'lute', quantity: 1 }]));
    expect((a!.mechanics.effects as { result: unknown }[])[0].result).toEqual([{ kind: 'add_item', card_id: 'lute', qty: 1 }]);
  });

  it('nameOf резолвит имена содержимого для журнала (best-effort; нет карты → без имени)', () => {
    const a = containerUnpackAction(container('all', [{ card_id: 'lute', quantity: 1 }, { card_id: 'x', quantity: 1 }]), (id) => (id === 'lute' ? 'Лютня' : undefined))!;
    const result = (a.mechanics.effects as { result: Record<string, unknown>[] }[])[0].result;
    expect(result[0]).toEqual({ kind: 'add_item', card_id: 'lute', qty: 1, name: 'Лютня' });
    expect(result[1]).toEqual({ kind: 'add_item', card_id: 'x', qty: 1 }); // без имени — деградирует
  });

  it('mode=choice → null (одноразовый выбор — отдельный слайс S3)', () => {
    expect(containerUnpackAction(container('choice', [{ card_id: 'x', quantity: 1 }]))).toBeNull();
  });

  it('пустое / только-само-ссылка содержимое → null', () => {
    expect(containerUnpackAction(container('all', []))).toBeNull();
    expect(containerUnpackAction(container('all', [{ card_id: 'pack', quantity: 1 }]))).toBeNull();
  });

  it('collectSheetActions: containerCards → строка листа группы item', () => {
    const out = collectSheetActions(emptyAssembled, [], [], [], [container('all', [{ card_id: 'lute', quantity: 1 }])]);
    const item = out.filter((a) => a.group === 'item');
    expect(item).toHaveLength(1);
    expect(item[0].name).toContain('Распаковать');
  });

  it('ИНТЕГРАЦИЯ: распаковка кладёт содержимое в инвентарь и расходует набор', () => {
    const a = containerUnpackAction(container('all', [{ card_id: 'lute', quantity: 1 }, { card_id: 'costume', quantity: 2 }]))!;
    const s = { hp: { current: 10, max: 10, temp: 0 }, resources: {}, maxResources: {}, equipment: {}, inventory: [{ cardId: 'pack', qty: 1 }], activeEffects: [] } as unknown as RuntimeState;
    const character: CharacterContext = { abilityMods: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 }, profBonus: 2, level: 5 };
    const r = executeAction(s, a.mechanics as Record<string, unknown>, { character, rng: () => 0.5 } as unknown as ExecuteContext);
    expect(r.state.inventory.find((i) => i.cardId === 'lute')?.qty).toBe(1);
    expect(r.state.inventory.find((i) => i.cardId === 'costume')?.qty).toBe(2);
    expect(r.state.inventory.find((i) => i.cardId === 'pack')).toBeUndefined(); // набор израсходован
  });
});
