/**
 * Инициализация пулов ресурсов (фаза D1).
 */
import type { CharacterContext } from '../mvp/contracts';

type Dict = Record<string, unknown>;

const TURN_RESOURCES: Record<string, number> = {
  action: 1,
  bonus_action: 1,
  reaction: 1,
};

function resolveCount(raw: unknown, ctx: CharacterContext): number {
  if (typeof raw === 'number' && !Number.isNaN(raw)) return raw;
  if (raw === 'prof_bonus') return ctx.profBonus;
  if (typeof raw === 'string') {
    const n = Number(raw);
    if (!Number.isNaN(n)) return n;
  }
  return 0;
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

/** Ресурсы, которые не восстанавливаются коротким отдыхом. */
export const SHORT_REST_SKIP = new Set(['action', 'bonus_action', 'reaction', 'heroic_inspiration']);

export function resourcesRestoredOnShortRest(maxResources: Record<string, number>): string[] {
  return Object.keys(maxResources).filter((k) => !SHORT_REST_SKIP.has(k));
}
