/**
 * KB-022: статический реестр registries.CONDITIONS разошёлся с движковым
 * BUILTIN_CONDITION_RULES (deafened = «Оглушён» vs RAW «Оглохший»). Пока это два источника
 * (единый — задача KB-024/I.10), держим их ярлыки синхронными этим гейтом: иначе редакторы
 * (WhenEditor, конструктор механик) показывают не то, что применяет движок и лист.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONDITIONS } from './registries';
import { BUILTIN_CONDITION_RULES } from '../engine/conditions';
import { REPO_ROOT } from '../canon/reports';

type Dict = Record<string, unknown>;
const snap = (name: string): Dict[] => {
  const raw = JSON.parse(readFileSync(join(REPO_ROOT, `officials/canon/prod-snapshot/${name}.json`), 'utf8')) as unknown;
  return (Array.isArray(raw) ? raw : (Object.values(raw as Dict).find(Array.isArray) as Dict[])) ?? [];
};

describe('KB-022: ярлыки состояний registries ↔ движок', () => {
  it('каждое встроенное состояние в registries.CONDITIONS имеет тот же label, что и движок', () => {
    const mismatches: string[] = [];
    for (const c of CONDITIONS) {
      const rule = BUILTIN_CONDITION_RULES[c.id];
      if (rule && rule.label !== c.label) {
        mismatches.push(`${c.id}: registries «${c.label}» ≠ движок «${rule.label}»`);
      }
    }
    expect(mismatches, 'ярлык из реестра редакторов расходится с движком').toEqual([]);
  });

  it('deafened — «Оглохший» (RAW), не «Оглушён» (это перевод stunned)', () => {
    expect(CONDITIONS.find((c) => c.id === 'deafened')?.label).toBe('Оглохший');
    expect(BUILTIN_CONDITION_RULES.deafened.label).toBe('Оглохший');
  });
});

describe('KB-023: condition-payload прода несут КЛЮЧ, не русское имя', () => {
  const collectConditionValues = (entities: Dict[]): string[] => {
    const out: string[] = [];
    const scan = (arr: unknown): void => {
      if (!Array.isArray(arr)) return;
      for (const p of arr as Dict[]) {
        if (p && p.kind === 'condition' && typeof p.value === 'string' && p.op !== 'remove') out.push(p.value);
      }
    };
    for (const e of entities) {
      for (const eff of ((e.mechanics as Dict)?.effects as Dict[]) ?? []) {
        scan(eff.result); scan(eff.on_fail); scan(eff.on_hit); scan(eff.on_success);
      }
    }
    return out;
  };

  it('ни один applied-condition (op≠remove) не использует кириллический ключ («Покров теней» = invisible)', () => {
    const values = [...collectConditionValues(snap('effects')), ...collectConditionValues(snap('spells'))];
    const cyrillic = [...new Set(values.filter((v) => /[А-Яа-я]/.test(v)))];
    expect(cyrillic, 'русское имя вместо ключа реестра → состояние не наступает').toEqual([]);
  });
});
