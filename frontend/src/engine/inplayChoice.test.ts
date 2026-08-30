/**
 * Ярус 1.2: выбор в момент исполнения действия. Движок читает ctx.choices[<сырой id>] и
 * применяет выбранную ветку через общий роутер payload-ов. Тесты дискриминирующие: без выбора
 * действие fail-closed до оплаты; who:'target' направляет исход ЦЕЛИ.
 */
import { describe, expect, it } from 'vitest';
import { executeAction, applyIncomingDamage, MechanicsExecutionError } from './execute';
import {
  STONEWORK_CONTACT_CHOICE_ID,
  collectInPlayActionChoices,
  stoneworkContactFactsFromChoices,
} from '../mechanics/collectChoices';
import type { CharacterContext, ExecuteContext, RuntimeState } from '../mvp/contracts';

type Dict = Record<string, unknown>;
type Ctx = ExecuteContext & { passives?: Dict[] };
const character: CharacterContext = { abilityMods: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 }, profBonus: 2, level: 5 };
const fresh = (): RuntimeState => ({ hp: { current: 20, max: 20, temp: 0 }, resources: {}, maxResources: {}, equipment: {}, inventory: [], activeEffects: [] });

// Действие с выбором аспекта при активации (self-ветки).
const aspectAction: Dict = {
  name: 'Аспект', activation: { cost: [] },
  effects: [{ kind: 'choice', id: 'aspect', context: 'in_play', options: { source: 'explicit', items: [
    { id: 'bear', name: 'Медведь', grants: [{ kind: 'temp_hp', amount: '5' }] },
    { id: 'eagle', name: 'Орёл', grants: [{ kind: 'modifier', applies_to: { roll: 'ability_check' }, op: 'advantage' }] },
  ] } }],
};

describe('Ярус 1.2 — выбор в момент исполнения (ctx.choices)', () => {
  it('выбранная ветка применяется (Медведь → temp_hp 5)', () => {
    const ctx = { character, rng: () => 0.5, choices: { aspect: 'bear' } } as unknown as Ctx;
    expect(executeAction(fresh(), aspectAction, ctx).state.hp.temp).toBe(5);
  });
  it('без выбора — typed fail-closed, а не успешный no-op', () => {
    const ctx = { character, rng: () => 0.5, choices: {} } as unknown as Ctx;
    expect(() => executeAction(fresh(), aspectAction, ctx)).toThrow(MechanicsExecutionError);
  });
  it('другой выбор → другая ветка (Орёл → модификатор, temp остаётся 0)', () => {
    const ctx = { character, rng: () => 0.5, choices: { aspect: 'eagle' } } as unknown as Ctx;
    const { state } = executeAction(fresh(), aspectAction, ctx);
    expect(state.hp.temp).toBe(0);
    expect(state.activeEffects.some((e) => (e.mechanics as Dict).kind === 'modifier')).toBe(true);
  });
  it('choice с who:target направляет выбранное состояние ЦЕЛИ', () => {
    const markAction: Dict = { name: 'Метка', activation: { cost: [] }, effects: [{ kind: 'choice', id: 'mark', context: 'in_play', who: 'target', options: { items: [
      { id: 'fear', grants: [{ kind: 'condition', value: 'frightened' }] },
    ] } }] };
    const ctx = { character, rng: () => 0.5, target: { runtimeState: fresh() }, choices: { mark: 'fear' } } as unknown as Ctx;
    const res = executeAction(fresh(), markAction, ctx);
    expect(res.targetState?.activeEffects.some((e) => (e.mechanics as Dict).value === 'frightened')).toBe(true);
  });
  it('выбор внутри on_hit (вложенный в результат броска) тоже разворачивается', () => {
    const atk: Dict = { name: 'Удар', activation: { cost: [] }, effects: [{ resolution: 'attack_roll', ability: 'str', on_hit: [
      { kind: 'choice', id: 'rider', context: 'in_play', options: { items: [{ id: 'burn', grants: [{ kind: 'temp_hp', amount: '3' }] }] } },
    ] }] };
    const ctx = { character, rng: () => 0.95, target: { ac: 1 }, choices: { rider: 'burn' } } as unknown as Ctx; // к20≈20 → hit
    expect(executeAction(fresh(), atk, ctx).state.hp.temp).toBe(3);
  });
});

describe('Ярус 1.2 — правки ревью', () => {
  it('count>1: применяются ВСЕ выбранные ветки (массив в ctx.choices)', () => {
    const twin: Dict = { name: 'Двойной аспект', activation: { cost: [] }, effects: [{ kind: 'choice', id: 'twin', context: 'in_play', count: 2, options: { items: [
      { id: 'a', grants: [{ kind: 'temp_hp', amount: '5' }] },
      { id: 'b', grants: [{ kind: 'resource', op: 'grant', id: 'ki', amount: 1 }] },
    ] } }] };
    const { state } = executeAction(fresh(), twin, { character, rng: () => 0.5, choices: { twin: ['a', 'b'] } } as unknown as Ctx);
    expect(state.hp.temp).toBe(5);      // ветка a
    expect(state.resources.ki).toBe(1); // ветка b — обе применились
  });
  it('resistance через apply-шаблон в рантайме нормализуется и режет урон', () => {
    const resAct: Dict = { name: 'Стихийный доспех', activation: { cost: [] }, effects: [{ kind: 'choice', id: 'ward', context: 'in_play', options: { source: 'damage_type' }, grant: { kind: 'resistance' } }] };
    const { state } = executeAction(fresh(), resAct, { character, rng: () => 0.5, choices: { ward: 'fire' } } as unknown as Ctx);
    expect(applyIncomingDamage(state, 10, { character, rng: () => 0.5 } as unknown as Ctx, { damageType: 'fire' }).state.hp.current).toBe(15);
  });
  it('build-грант из in-play выбора отклоняется до исполнения', () => {
    const sklAct: Dict = { name: 'Наставник', activation: { cost: [] }, effects: [{ kind: 'choice', id: 'teach', context: 'in_play', options: { source: 'skill' }, apply: { kind: 'grant_proficiency', prof: 'skill' } }] };
    expect(() => executeAction(
      fresh(),
      sklAct,
      { character, rng: () => 0.5, choices: { teach: 'stealth' } } as unknown as Ctx,
    )).toThrow(MechanicsExecutionError);
  });
  it('choice внутри resolution:auto исполняется (не только собирается)', () => {
    const autoAct: Dict = { name: 'Авто', activation: { cost: [] }, effects: [{ resolution: 'auto', result: [{ kind: 'choice', id: 'z', context: 'in_play', options: { items: [{ id: 't', grants: [{ kind: 'temp_hp', amount: '4' }] }] } }] }] };
    expect(executeAction(fresh(), autoAct, { character, rng: () => 0.5, choices: { z: 't' } } as unknown as Ctx).state.hp.temp).toBe(4);
  });
  it('choice без явного id читается по общему fallback-ключу «choice» (коллектор ↔ движок)', () => {
    const noId: Dict = { name: 'Безымянный', activation: { cost: [] }, effects: [{ kind: 'choice', context: 'in_play', options: { items: [{ id: 'x', grants: [{ kind: 'temp_hp', amount: '6' }] }] } }] };
    expect(executeAction(fresh(), noId, { character, rng: () => 0.5, choices: { choice: ['x'] } } as unknown as Ctx).state.hp.temp).toBe(6);
  });
});

describe('collectInPlayActionChoices', () => {
  const origin = { kind: 'other', id: 'x', name: 'X' } as const;
  it('извлекает in_play выборы с СЫРЫМ id, отбрасывает build/без контекста', () => {
    const mech: Dict = { effects: [
      { kind: 'choice', id: 'a', context: 'in_play', options: { source: 'explicit' } },
      { kind: 'choice', id: 'b', context: 'build', options: { source: 'skill' } },
      { kind: 'choice', id: 'c', options: { source: 'skill' } },
    ] };
    expect(collectInPlayActionChoices(mech, origin).map((c) => c.id)).toEqual(['a']);
  });
  it('видит in_play choice внутри resolution:auto', () => {
    const mech: Dict = { effects: [{ resolution: 'auto', result: [{ kind: 'choice', id: 'z', context: 'in_play', options: {} }] }] };
    expect(collectInPlayActionChoices(mech, origin).map((c) => c.id)).toEqual(['z']);
  });
  it('видит выбор результата внутри попадания и провала спасброска', () => {
    const choice = (id: string): Dict => ({
      kind: 'choice',
      id,
      context: 'in_play',
      options: { source: 'explicit', items: [] },
    });
    const mech: Dict = {
      effects: [
        { resolution: 'attack_roll', on_hit: [choice('damage_type')] },
        { resolution: 'save', on_fail: [choice('damage_die')] },
      ],
    };
    expect(collectInPlayActionChoices(mech, origin).map((c) => c.id)).toEqual(['damage_type', 'damage_die']);
  });
  it('нет in_play выборов → пусто', () => {
    expect(collectInPlayActionChoices({ effects: [{ kind: 'choice', id: 'a', context: 'build' }] }, origin)).toEqual([]);
  });
  it('превращает требование контакта с камнем в явный вопрос сценария', () => {
    const choices = collectInPlayActionChoices({
      targeting: { requires_stonework_contact: true },
      effects: [{ resolution: 'auto', result: [{ kind: 'narrative' }] }],
    }, origin);
    expect(choices).toEqual([expect.objectContaining({
      id: STONEWORK_CONTACT_CHOICE_ID,
      prompt: 'Как вы соприкасаетесь с каменной поверхностью?',
      items: [
        { id: 'natural_on_surface', name: 'Стою на природном камне' },
        { id: 'natural_touching', name: 'Касаюсь природного камня' },
        { id: 'worked_on_surface', name: 'Стою на обработанном камне' },
        { id: 'worked_touching', name: 'Касаюсь обработанного камня' },
      ],
    })]);
    expect(choices[0]).not.toHaveProperty('recommended');
    expect(stoneworkContactFactsFromChoices({
      [STONEWORK_CONTACT_CHOICE_ID]: ['worked_touching'],
    })).toEqual({ material: 'stone', stoneForm: 'worked', contact: 'touching_surface' });
    expect(stoneworkContactFactsFromChoices({})).toBeNull();
  });
});
