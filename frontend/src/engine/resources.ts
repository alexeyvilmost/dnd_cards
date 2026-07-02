/**
 * Инициализация пулов ресурсов (фаза D1).
 */
import type { CharacterContext } from '../mvp/contracts';
import { evaluate, type FormulaContext } from './formula';

type Dict = Record<string, unknown>;

const TURN_RESOURCES: Record<string, number> = {
  action: 1,
  bonus_action: 1,
  reaction: 1,
};

const TURN_KEYS = ['action', 'bonus_action', 'reaction'] as const;

function formulaCtx(ctx: CharacterContext): FormulaContext {
  return {
    abilityMods: ctx.abilityMods,
    profBonus: ctx.profBonus,
    selfLevel: ctx.level,
    classLevels: ctx.classLevels,
  };
}

function resolveCount(raw: unknown, ctx: CharacterContext): number {
  if (typeof raw === 'number' && !Number.isNaN(raw)) return raw;
  if (raw == null) return 0;
  if (typeof raw === 'string') {
    try {
      const v = evaluate(raw, formulaCtx(ctx));
      if (typeof v === 'number' && !Number.isNaN(v)) return v;
    } catch {
      const n = Number(raw);
      if (!Number.isNaN(n)) return n;
    }
  }
  return 0;
}

export function buildResourceRecharge(classResources: Dict | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!classResources) return out;
  for (const [id, def] of Object.entries(classResources)) {
    const row = def as Dict;
    const per = row.per ?? row.recharge;
    if (per) out[id] = String(per);
  }
  return out;
}

export function initResources(
  ctx: CharacterContext,
  classResources: Dict | null,
  grantPayloads: Dict[],
): { resources: Record<string, number>; maxResources: Record<string, number> } {
  const maxResources: Record<string, number> = { ...TURN_RESOURCES };
  const resources: Record<string, number> = { ...TURN_RESOURCES };

  if (classResources) {
    for (const [id, def] of Object.entries(classResources)) {
      const row = def as Dict;
      const count = resolveCount(row.count ?? row.max, ctx);
      if (count > 0) {
        maxResources[id] = count;
        resources[id] = count;
      }
    }
  }

  for (const grant of grantPayloads) {
    if (grant.kind !== 'resource' || grant.op !== 'grant') continue;
    const id = String(grant.id ?? '');
    const amount = resolveCount(grant.amount ?? 1, ctx);
    if (!id || amount <= 0) continue;
    maxResources[id] = (maxResources[id] ?? 0) + amount;
    resources[id] = (resources[id] ?? 0) + amount;
  }

  return { resources, maxResources };
}

/** Ресурсы, восстанавливаемые коротким отдыхом (R4: по recharge; без метаданных — legacy). */
export function resourcesRestoredOnShortRest(
  maxResources: Record<string, number>,
  recharge?: Record<string, string>,
): string[] {
  if (!recharge) {
    const LEGACY_SKIP = new Set(['action', 'bonus_action', 'reaction', 'heroic_inspiration']);
    return Object.keys(maxResources).filter((k) => !LEGACY_SKIP.has(k));
  }
  return Object.keys(maxResources).filter((k) => {
    if (TURN_KEYS.includes(k as typeof TURN_KEYS[number])) return false;
    return recharge[k] === 'short_rest';
  });
}
