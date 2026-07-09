/**
 * S3 «предмет=эффект»: grant_effect ПРЕДМЕТА разворачивается в самостоятельный эффект-бусину той же
 * машинерией (expandEffectGrants), что и эффекты класса/черт — повязка на глаза даёт эффект «Тёмное
 * зрение», пока надета. Выданный эффект маршрутизируется как item-источник (слайс 1) → его чувства/
 * статы доходят до листа. Здесь fake-resolver (без сети) + интеграция через resolveCharacterRules.
 */
import { describe, expect, it } from 'vitest';
import { expandEffectGrants, type OriginEffect } from './assemble';
import { resolveCharacterRules } from './rules/resolveCharacterRules';
import type { RuntimeRuleSource } from './rules/types';
import { emptyDraft, type CharacterDraft } from './types';
import type { AssembledCharacter } from './assemble';
import type { PassiveEffect } from '../types';

const DV_MECH = { effects: [{ resolution: 'auto', result: [{ kind: 'grant_sense', sense: 'darkvision', range: 60 }] }] };
const DV_EFFECT = { id: 'dv', name: 'Тёмное зрение', card_number: 'darkvision-eff', mechanics: DV_MECH } as unknown as PassiveEffect;
const resolve = (slug: string) => Promise.resolve(slug === 'darkvision-eff' ? DV_EFFECT : null);

function pseudoItem(grantValue: string): OriginEffect {
  return {
    effect: { id: 'band', name: 'Повязка', card_number: '', mechanics: { effects: [{ resolution: 'auto', result: [{ kind: 'grant_effect', value: grantValue }] }] } } as unknown as PassiveEffect,
    origin: { kind: 'other', id: 'band', name: 'Повязка' },
  };
}

describe('S3 — grant_effect от предмета → эффект-бусина', () => {
  it('предмет с grant_effect разворачивается в загруженный эффект', async () => {
    const expanded = await expandEffectGrants([pseudoItem('darkvision-eff')], emptyDraft(), resolve);
    const ids = expanded.map((e) => e.effect.id);
    expect(ids).toContain('band'); // сам предмет (псевдо-эффект) в base
    expect(ids).toContain('dv');   // выданный эффект загружен
  });

  it('битая ссылка grant_effect → мягкий пропуск (остаётся только предмет)', async () => {
    const expanded = await expandEffectGrants([pseudoItem('missing')], emptyDraft(), resolve);
    expect(expanded.map((e) => e.effect.id)).toEqual(['band']);
  });

  it('ИНТЕГРАЦИЯ: выданный эффект как item-источник даёт чувство на листе (Тёмное зрение)', () => {
    const assembled = {
      race: { id: 'x', name: 'x', speed: 30 }, klass: null, subclass: null, background: null,
      feats: [], effects: [], actions: [], spells: [], pendingChoices: [], featAbilityIncreases: [], derived: {},
    } as unknown as AssembledCharacter;
    const draft: CharacterDraft = { ...emptyDraft(), abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, level: 1 };
    const runtimeSources: RuntimeRuleSource[] = [{ source: { type: 'item', id: 'dv', name: 'Тёмное зрение' }, mechanics: DV_MECH }];
    const rs = resolveCharacterRules({ draft, assembled, runtimeSources });
    expect(rs.senses.some((s) => s.sense === 'darkvision' && s.range === 60)).toBe(true);
  });
});
