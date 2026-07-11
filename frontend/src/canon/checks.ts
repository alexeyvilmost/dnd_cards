/**
 * Раннер декларативных checks реестра канона — структурная сверка по прод-снапшоту
 * (офлайн, детерминированно). Каждый check либо ПОДТВЕРЖДАЕТ поддержку фичи
 * (green — идёт в must-pass пилота), либо фиксирует ГАП (watch/known_bug — в отчёт,
 * не роняет тест). docs/rules-coverage-plan-2026-07-11.md §3.4.
 */
import type { CanonFeature, Snapshot, SnapshotEntity } from './audit';

export interface CheckResult {
  feature: string;
  type: string;
  ok: boolean;
  blocking: boolean; // ok=false && blocking → провал теста; иначе — гап в отчёте
  detail: string;
}

/** Все kind-ы payload-ов в дереве механик (+ вложенные grant.kind у choice). */
export function collectPayloadKinds(mechanics: unknown): Set<string> {
  const kinds = new Set<string>();
  const walk = (n: unknown): void => {
    if (!n || typeof n !== 'object') return;
    const o = n as Record<string, unknown>;
    if (typeof o.kind === 'string') kinds.add(o.kind);
    const grant = o.grant as Record<string, unknown> | undefined;
    if (grant && typeof grant.kind === 'string') kinds.add(grant.kind);
    for (const v of Object.values(o)) {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') walk(v);
    }
  };
  walk(mechanics);
  return kinds;
}

/** Значение variable-payload с данным id в механике (число) или undefined. */
function variableValue(mechanics: unknown, varId: string): number | undefined {
  let found: number | undefined;
  const walk = (n: unknown): void => {
    if (!n || typeof n !== 'object') return;
    const o = n as Record<string, unknown>;
    if (o.kind === 'variable' && o.id === varId && o.value != null) {
      const num = Number(o.value);
      if (!Number.isNaN(num)) found = num;
    }
    for (const v of Object.values(o)) {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') walk(v);
    }
  };
  walk(mechanics);
  return found;
}

function effectsAtLevel(unit: SnapshotEntity, level: number, byCard: Map<string, SnapshotEntity>): SnapshotEntity[] {
  const lp = unit.level_progression || {};
  const ids = [...(lp[String(level)]?.effects || []), ...(lp[String(level)]?.actions || [])];
  return ids.map((id) => byCard.get(id)).filter((x): x is SnapshotEntity => !!x);
}

function cardByAnyId(snapshot: Snapshot): Map<string, SnapshotEntity> {
  const m = new Map<string, SnapshotEntity>();
  for (const e of [...snapshot.effects, ...snapshot.actions]) {
    if (e.id) m.set(e.id, e);
    if (e.card_number) m.set(e.card_number, e);
  }
  return m;
}

/** Пул ресурса на уровне из by_level/count (мини-повтор resolveByLevel движка). */
function resourcePoolAt(res: Record<string, unknown> | undefined, level: number): number | undefined {
  if (!res) return undefined;
  const byLevel = res.by_level as Record<string, number> | undefined;
  if (byLevel && typeof byLevel === 'object') {
    let best: number | undefined;
    for (const k of Object.keys(byLevel)) if (Number(k) <= level) best = byLevel[k];
    return best;
  }
  const count = res.count ?? res.max;
  return typeof count === 'number' ? count : undefined;
}

export function runChecks(
  feature: CanonFeature,
  checks: Record<string, unknown>[],
  ctx: { unit: SnapshotEntity; snapshot: Snapshot; progressionTables?: Record<string, Record<string, number>> },
): CheckResult[] {
  const byCard = cardByAnyId(ctx.snapshot);
  const out: CheckResult[] = [];
  const R = (type: string, ok: boolean, blocking: boolean, detail: string) =>
    out.push({ feature: feature.id, type, ok, blocking, detail });

  for (const c of checks) {
    const type = String(c.type);
    switch (type) {
      case 'variable': {
        const level = Number(c.at_level);
        const name = String(c.name);
        const cards = effectsAtLevel(ctx.unit, level, byCard);
        let val: number | undefined;
        for (const card of cards) { val = variableValue(card.mechanics, name); if (val !== undefined) break; }
        const ok = val === Number(c.expect);
        R('variable', ok, true, `${name}@L${level}: ${val ?? '—'} (ожид. ${c.expect})`);
        break;
      }
      case 'payload_kinds': {
        const card = byCard.get(String(c.match));
        const kinds = card ? collectPayloadKinds(card.mechanics) : new Set<string>();
        const expect = (c.expect as string[]) || [];
        const missing = expect.filter((k) => !kinds.has(k));
        R('payload_kinds', missing.length === 0, true,
          `${c.match}: есть [${[...kinds].join(',')}]; ожид. [${expect.join(',')}]${missing.length ? ` — НЕТ [${missing.join(',')}]` : ''}`);
        // watch — не блокирующие «должны бы быть, но пока нет»
        const watch = (c.watch as string[]) || [];
        for (const w of watch) {
          const present = kinds.has(w);
          R('payload_kinds(watch)', present, false, `${c.match}: watch «${w}» — ${present ? 'есть' : 'ОТСУТСТВУЕТ (гап контента)'}`);
        }
        break;
      }
      case 'grant_kind': {
        const ref = feature.match?.effect || feature.match?.action || '';
        const card = byCard.get(ref);
        const kinds = card ? collectPayloadKinds(card.mechanics) : new Set<string>();
        const ok = kinds.has(String(c.kind));
        R('grant_kind', ok, true, `${ref}: ${ok ? 'есть' : 'нет'} ${c.kind}`);
        break;
      }
      case 'feat_slot': {
        const ref = feature.match?.effect || '';
        const card = byCard.get(ref);
        const kinds = card ? collectPayloadKinds(card.mechanics) : new Set<string>();
        const ok = kinds.has('grant_feat');
        R('feat_slot', ok, true, `${ref}@L${c.at_level}: ${ok ? 'grant_feat есть' : 'нет grant_feat'}`);
        break;
      }
      case 'subclass_choice': {
        const kids = ctx.snapshot.classes.filter((cl) => cl.parent_class_id === ctx.unit.id);
        R('subclass_choice', kids.length > 0, true, `подклассов в проде: ${kids.length}`);
        break;
      }
      case 'resource_scaling': {
        const res = (ctx.unit.resources as Record<string, Record<string, unknown>> | undefined)?.[String(c.resource)];
        const table = ctx.progressionTables?.[String(c.table)] || {};
        const mismatches: string[] = [];
        for (const lvlStr of Object.keys(table)) {
          const level = Number(lvlStr);
          const expected = table[lvlStr];
          const actual = resourcePoolAt(res, level);
          if (actual !== expected) mismatches.push(`L${level}: ${actual ?? '—'}≠${expected}`);
        }
        const ok = mismatches.length === 0;
        // known_bug: расхождение ОЖИДАЕМО (прод не растит ресурс) → не блокируем, в отчёт
        R('resource_scaling', ok, !c.known_bug,
          ok ? `${c.resource}: масштабируется по «${c.table}»`
             : `${c.resource}: НЕ по таблице «${c.table}» [${mismatches.join('; ')}]${c.known_bug ? ' (известный баг)' : ''}`);
        break;
      }
      default:
        R(type, true, false, 'неизвестный тип check — пропущен');
    }
  }
  return out;
}
