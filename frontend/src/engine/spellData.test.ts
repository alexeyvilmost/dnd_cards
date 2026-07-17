/**
 * Инварианты данных заклинаний на прод-снапшоте (задача 0.7 / KB-077+078+082).
 * Держат RAW-корректность механики трёх заклинаний, чинившихся вручную.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../canon/reports';

type Dict = Record<string, unknown>;
const raw = JSON.parse(readFileSync(join(REPO_ROOT, 'officials/canon/prod-snapshot/spells.json'), 'utf8')) as unknown;
const SPELLS: Dict[] = (Array.isArray(raw) ? raw : (Object.values(raw as Dict).find(Array.isArray) as Dict[])) ?? [];
const byId = (p: string): Dict => {
  const s = SPELLS.find((x) => String(x.id).startsWith(p));
  if (!s) throw new Error(`Заклинание ${p} исчезло из снапшота`);
  return s;
};
const payloads = (spell: Dict, key: string): Dict[] => {
  const out: Dict[] = [];
  for (const eff of (spell.mechanics as Dict)?.effects as Dict[] ?? []) {
    for (const p of (eff[key] as Dict[]) ?? []) out.push(p);
  }
  return out;
};

describe('прод-данные: заклинания (KB-077/078/082)', () => {
  it('Ускорение: преимущество на спасброски — ТОЛЬКО Ловкости (не самоусиливается)', () => {
    const advSaves = payloads(byId('1661dfe1'), 'result')
      .filter((p) => p.op === 'advantage' && (p.applies_to as Dict)?.roll === 'saving_throw');
    expect(advSaves.length).toBeGreaterThan(0);
    for (const p of advSaves) {
      expect((p.applies_to as Dict).filter, 'advantage на ВСЕ спасы = самоусиление концентрации').toEqual({ ability: 'dex' });
    }
  });

  it('Паутина: НЕТ урона и апкаста (RAW), restrained с длительностью (не вечный)', () => {
    const onFail = payloads(byId('0446564e'), 'on_fail');
    expect(onFail.some((p) => p.kind === 'damage'), 'у Web нет урона по RAW').toBe(false);
    const restrained = onFail.find((p) => p.kind === 'condition' && p.value === 'restrained');
    expect(restrained, 'restrained должен применяться').toBeTruthy();
    expect(restrained?.duration, 'без duration состояние вечное').toBeTruthy();
  });

  it('Огненный снаряд: масштабируется костью 1d10 (RAW), а не 1d6', () => {
    const dmg = payloads(byId('50626b5a'), 'on_hit').find((p) => p.kind === 'damage');
    expect((dmg?.scaling as Dict)?.dice).toBe('1d10');
  });

  it('Вызов Зверя (SPELL-0178): concentration=true (KB-092)', () => {
    const sb = SPELLS.find((s) => s.card_number === 'SPELL-0178');
    expect(sb, 'SPELL-0178 в снапшоте').toBeTruthy();
    expect(sb?.concentration).toBe(true);
  });
});
