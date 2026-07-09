/**
 * Контент-свип narrative→choice: для КАЖДОГО конвертированного эффекта проверяем 3 вещи —
 *   1) механика валидна по схеме (validateMechanics),
 *   2) выбор всплывает нужного типа (collectChoices),
 *   3) грант применяется после выбора (resolveCharacterRules → ruleState).
 * Источник правды — contentSweep.fixtures.json (его же читает сид-скрипт), поэтому тест
 * проверяет ровно то, что уходит в прод. Результаты прогона см. в docs/content-sweep-2026-07-09.md.
 */
import { describe, expect, it } from 'vitest';
import fixtures from './contentSweep.fixtures.json';
import { validateMechanics } from '../engine/validateMechanics';
import { collectChoices, type ChoiceOrigin } from './collectChoices';
import { choiceKey } from './choiceKey';
import { resolveCharacterRules } from '../character/rules/resolveCharacterRules';
import { emptyDraft, type CharacterDraft } from '../character/types';
import type { AssembledCharacter, OriginEffect } from '../character/assemble';

const ORIGIN: ChoiceOrigin = { kind: 'feat', id: 'sweep', name: 'Свип' };

// Мини-сборка одного эффекта → ruleState (как build() в resolveCharacterRules.test.ts).
function ruleStateWith(effectId: string, mechanics: unknown, resolvedChoices: Record<string, string[]>) {
  const effect = { id: effectId, name: effectId, mechanics } as unknown as OriginEffect['effect'];
  const assembled = {
    race: { id: 'x', name: 'x', speed: 30 },
    klass: null, subclass: null, background: null,
    feats: [], effects: [{ effect, origin: ORIGIN }], actions: [], spells: [],
    pendingChoices: [], featAbilityIncreases: [], derived: {},
  } as unknown as AssembledCharacter;
  const draft: CharacterDraft = {
    ...emptyDraft(),
    abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    level: 1,
    resolvedChoices,
  };
  return resolveCharacterRules({ draft, assembled });
}

describe('Контент-свип: narrative → choice', () => {
  for (const fx of fixtures) {
    describe(`${fx.card} «${fx.name}»`, () => {
      it('1) механика валидна по схеме', () => {
        const { valid, errors } = validateMechanics(fx.mechanics as Record<string, unknown>, {
          id: fx.effectId, name: fx.name, kind: 'passive_effect',
        });
        expect(valid, errors.join('; ')).toBe(true);
      });

      it(`2) выбор всплывает (source: ${fx.test.source})`, () => {
        const pcs = collectChoices(fx.mechanics as Record<string, unknown>, { ...ORIGIN, featureId: fx.effectId });
        const pc = pcs.find((p) => p.id.endsWith(`:${fx.test.choiceId}`));
        expect(pc, 'ожидался pending-выбор').toBeTruthy();
        expect(pc?.source).toBe(fx.test.source);
      });

      it('3) грант применяется после выбора', () => {
        const key = choiceKey({ ...ORIGIN, featureId: fx.effectId }, fx.test.choiceId);
        const rs = ruleStateWith(fx.effectId, fx.mechanics, { [key]: fx.test.pick });
        const a = fx.test.assert;
        for (const v of a.values) {
          if (a.type === 'feat') {
            expect(rs.appliedGrants.some((g) => g.kind === 'feat' && g.value === v), `feat ${v}`).toBe(true);
          } else if (a.type === 'spell') {
            expect(rs.spells.known, `spell ${v}`).toContain(v);
          } else if (a.type === 'tool') {
            expect(rs.proficiencies.tools, `tool ${v}`).toContain(v);
          } else if (a.type === 'sense') {
            expect(rs.senses.some((s) => s.sense === v), `sense ${v}`).toBe(true);
          } else {
            throw new Error(`неизвестный тип проверки: ${a.type}`);
          }
        }
      });
    });
  }
});
