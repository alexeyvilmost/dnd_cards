/**
 * Живая проверка системы переменных на прод-контенте: setter-эффекты классов в
 * level_progression задают переменные, которые растут по уровню.
 * Запуск: MVP_CONTENT=1 npx vitest run --config vitest.mvp.config.ts src/mvp/variables.live.mvp.test.ts
 */
import { describe, expect, it } from 'vitest';

// apiClient (axios) читает localStorage в интерсепторе токена — в node его нет.
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear(),
    key: () => null,
    get length() { return store.size; },
  } as Storage;
}
import { assemble, loadBundle } from '../character/assemble';
import { emptyDraft } from '../character/types';

const RUN = !!process.env.MVP_CONTENT;
const MONK = 'ed17e7b6-366f-43ef-a94c-2d62dd5d7b20';
const BARB = '9cc3ffcd-8de0-4bc1-a1c3-0a0e67952ab8';

async function buildVars(classId: string, level: number) {
  const draft = { ...emptyDraft(), classId, level };
  const bundle = await loadBundle(draft);
  return assemble({ ...bundle, spells: [] }, draft).variables;
}

describe.runIf(RUN)('Система переменных на живом контенте', () => {
  it('монах: martial_arts_die растёт d6 → d8 по setter-эффектам', async () => {
    const l1 = await buildVars(MONK, 1);
    const l5 = await buildVars(MONK, 5);
    expect(l1.martial_arts_die).toEqual({ sides: 6, count: 1 });
    expect(l5.martial_arts_die).toEqual({ sides: 8, count: 1 }); // 5-й уровень перекрывает 1-й
  }, 60000);

  it('варвар: rage_damage_modifier растёт 2 → 3', async () => {
    const l1 = await buildVars(BARB, 1);
    const l9 = await buildVars(BARB, 9);
    expect(l1.rage_damage_modifier).toBe(2);
    expect(l9.rage_damage_modifier).toBe(3);
  }, 60000);

  it('нецелевой класс не получает чужую переменную', async () => {
    const monkL1 = await buildVars(MONK, 1);
    expect(monkL1.rage_damage_modifier).toBeUndefined();
  }, 60000);
});
