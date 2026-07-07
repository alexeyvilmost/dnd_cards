/**
 * Переменные персонажа (см. docs/variables.md). Переменная сама по себе — это
 * name + type + default_value (сущность-справочник). Её ЗНАЧЕНИЕ на персонаже
 * задают ЭФФЕКТЫ через payload { kind:'variable', op:'set'|'add'|'remove', id, value }.
 * Эффекты приходят из level_progression (только уровни ≤ уровня персонажа) в порядке
 * возрастания уровня, поэтому «5 уровень монаха: set martial_arts_die=1d8» перекрывает
 * «1 уровень: set …=1d6». Мультикласс работает нативно — эффекты собираются со всех
 * классов.
 */
import type { Variable } from '../types';
import type { VariableValue } from '../engine/formula';
import { payloadsOf } from '../engine/mechanicsView';

type Dict = Record<string, unknown>;

/** "1d8" | "d8" | "2d6" → { sides, count }; иначе null. */
export function parseDice(s: string): { sides: number; count: number } | null {
  const m = /^(\d*)\s*[dк]\s*(\d+)$/i.exec(String(s).trim());
  if (!m) return null;
  const count = m[1] ? Number(m[1]) : 1;
  const sides = Number(m[2]);
  if (!Number.isFinite(count) || !Number.isFinite(sides) || sides <= 0) return null;
  return { sides, count };
}

/** Строку/число значения → VariableValue: dice → {sides,count}, иначе число. */
export function parseValue(raw: string | number | undefined, varType?: string): VariableValue | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const dice = parseDice(String(raw));
  if (varType === 'dice' || (varType === undefined && dice)) return dice ?? undefined;
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/** Извлечь variable-payload'ы из механики эффекта/действия. */
function variablePayloadsOf(mech: unknown): Dict[] {
  return payloadsOf(mech as Dict | null | undefined).filter((p) => String(p.kind) === 'variable');
}

/**
 * Свернуть variable-payload'ы списка эффектов (в порядке следования = по возрастанию
 * уровня) в карту переменных персонажа. defsById даёт var_type и default_value.
 */
export function collectVariablesFromEffects(
  effectMechanics: Array<unknown>,
  defs: Variable[] = [],
): Record<string, VariableValue> {
  const defById = new Map(defs.map((d) => [d.variable_id, d]));
  const out: Record<string, VariableValue> = {};
  for (const mech of effectMechanics) {
    for (const p of variablePayloadsOf(mech)) {
      const id = String(p.id ?? p.variable ?? '');
      if (!id) continue;
      const op = String(p.op ?? 'set');
      const def = defById.get(id);
      const varType = def?.var_type;
      if (op === 'remove') {
        delete out[id];
        continue;
      }
      // Значение из payload; если не задано — default_value справочника.
      const rawValue = (p.value as string | number | undefined) ?? def?.default_value;
      const value = parseValue(rawValue, varType);
      if (value === undefined) continue;
      if (op === 'add') {
        const prev = out[id];
        if (typeof prev === 'number' && typeof value === 'number') out[id] = prev + value;
        else out[id] = value; // add к отсутствующей/dice — как set
      } else {
        // 'set' (и любое иное) — присвоить/перекрыть
        out[id] = value;
      }
    }
  }
  return out;
}
