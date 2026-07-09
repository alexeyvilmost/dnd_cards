/**
 * C4: бюджет каскада событий — жёсткая страховка от стек-оверфлоу при зацикленном on-hit-контенте
 * (слушатель, атакующий по собственному hit). Плюс: per-turn слушатель, помеченный ДО запуска,
 * не перезапускает себя в том же каскаде. Тесты дискриминирующие: без C4 первый тест уходит в
 * бесконечную рекурсию (RangeError), т.е. не завершился бы.
 */
import { describe, expect, it } from 'vitest';
import { executeAction } from './execute';
import type { CharacterContext, EngineEvent, ExecuteContext, RuntimeState } from '../mvp/contracts';

type Dict = Record<string, unknown>;
type Ctx = ExecuteContext & { passives?: Dict[] };
const character: CharacterContext = { abilityMods: { str: 3, dex: 0, con: 0, int: 0, wis: 0, cha: 0 }, profBonus: 2, level: 5 };
const CRIT = () => 0.99; // к20 = 20 → nat20, всегда попадает
const fresh = (): RuntimeState => ({ hp: { current: 20, max: 20, temp: 0 }, resources: {}, maxResources: {}, equipment: {}, inventory: [], activeEffects: [] });

// Действие-атака: на попадании эмитит hit.
const attack: Dict = { name: 'Атака', activation: { cost: [] }, effects: [{ resolution: 'attack_roll', ability: 'str', on_hit: [] }] };
// Слушатель, который на КАЖДЫЙ hit сам атакует (→ снова hit) — источник зацикливания.
const looper = (extra: Dict = {}): Dict => ({
  id: 'looper', name: 'Зациклённый', ...extra,
  activation: { mode: 'triggered', trigger: { event: 'hit' } },
  effects: [{ resolution: 'attack_roll', ability: 'str', on_hit: [] }],
});
const count = (events: EngineEvent[], sub: string) => events.filter((e) => JSON.stringify(e).includes(sub)).length;
const warned = (events: EngineEvent[]) => events.some((e) => JSON.stringify(e).includes('превысил лимит'));

describe('C4 — бюджет каскада событий', () => {
  it('зацикленный не-turn слушатель ОГРАНИЧИВАЕТСЯ бюджетом, а не роняет стек', () => {
    const ctx = { character, rng: CRIT, target: { ac: 1 }, passives: [looper()] } as unknown as Ctx;
    const { events } = executeAction(fresh(), attack, ctx); // без C4 — бесконечная рекурсия
    expect(warned(events)).toBe(true);                    // лимит сработал
    const fires = count(events, 'Сработало: Зациклённый');
    expect(fires).toBeGreaterThan(1);                     // цикл реально был
    expect(fires).toBeLessThanOrEqual(16);                // но ограничен бюджетом
  });

  it('per-turn слушатель на своём же hit срабатывает РОВНО один раз (помечен ДО запуска)', () => {
    const ctx = { character, rng: CRIT, target: { ac: 1 }, passives: [looper({ uses: { per: 'turn' } })] } as unknown as Ctx;
    const { events } = executeAction(fresh(), attack, ctx);
    expect(count(events, 'Сработало: Зациклённый')).toBe(1); // не перезапустил себя
    expect(warned(events)).toBe(false);                       // до лимита не дошло
  });

  it('обычный on-hit-райдер (не зацикленный) срабатывает один раз, без предупреждения', () => {
    const rider: Dict = {
      id: 'sneak', name: 'Скрытая атака', uses: { per: 'turn' },
      activation: { mode: 'triggered', trigger: { event: 'hit' } },
      effects: [{ resolution: 'auto', result: [{ kind: 'temp_hp', amount: '1' }] }],
    };
    const ctx = { character, rng: CRIT, target: { ac: 1 }, passives: [rider] } as unknown as Ctx;
    const { events } = executeAction(fresh(), attack, ctx);
    expect(count(events, 'Сработало: Скрытая атака')).toBe(1);
    expect(warned(events)).toBe(false);
  });

  it('per-turn слушатель, помеченный ВЛОЖЕННЫМ каскадом, не срабатывает повторно во внешнем цикле', () => {
    // l1 на hit сам атакует → вложенный hit, где срабатывает l2. l2 помечается fired во вложенном
    // каскаде; внешний цикл ДОЛЖЕН увидеть эту отметку и не запустить l2 второй раз.
    const l1: Dict = { id: 'l1', name: 'L1', uses: { per: 'turn' }, activation: { mode: 'triggered', trigger: { event: 'hit' } }, effects: [{ resolution: 'attack_roll', ability: 'str', on_hit: [] }] };
    const l2: Dict = { id: 'l2', name: 'L2', uses: { per: 'turn' }, activation: { mode: 'triggered', trigger: { event: 'hit' } }, effects: [{ resolution: 'auto', result: [{ kind: 'temp_hp', amount: '1' }] }] };
    const ctx = { character, rng: () => 0.5, target: { ac: 1 }, passives: [l1, l2] } as unknown as Ctx;
    const { state, events } = executeAction(fresh(), attack, ctx);
    expect(count(events, 'Сработало: L2')).toBe(1);       // без фикса firedThisTurn затирался → 2
    expect(state.firedThisTurn).toContain('l1');
    expect(state.firedThisTurn).toContain('l2');
  });

  it('эмиссия без слушателей НЕ жжёт бюджет (нет ложного лимита на широком линейном действии)', () => {
    // Действие из 20 auto-эффектов, каждый эмитит «пустое» событие через отдельную атаку без
    // слушателей: бюджет не должен исчерпаться, предупреждения быть не должно.
    const manyAttacks: Dict = { name: 'Шквал', activation: { cost: [] }, effects: Array.from({ length: 20 }, () => ({ resolution: 'attack_roll', ability: 'str', on_hit: [] })) };
    const ctx = { character, rng: CRIT, target: { ac: 1 }, passives: [] } as unknown as Ctx; // НЕТ слушателей
    const { events } = executeAction(fresh(), manyAttacks, ctx);
    expect(warned(events)).toBe(false); // 20 hit+crit эмиссий без слушателей — но лимит не тронут
  });

  it('бюджет свежий на каждое действие: два подряд зацикленных прогона оба доходят до лимита', () => {
    const mk = () => ({ character, rng: CRIT, target: { ac: 1 }, passives: [looper()] }) as unknown as Ctx;
    expect(warned(executeAction(fresh(), attack, mk()).events)).toBe(true);
    expect(warned(executeAction(fresh(), attack, mk()).events)).toBe(true); // не «залип» из-за утечки бюджета
  });
});
