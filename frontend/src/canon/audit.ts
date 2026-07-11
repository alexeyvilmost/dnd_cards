/**
 * Аудитор покрытия правил: сверка канонического реестра фичи-за-фичей с прод-снапшотом.
 * (docs/rules-coverage-plan-2026-07-11.md §3.3.) Чистые функции — офлайн, детерминированно,
 * без сети: источник тел сущностей — officials/canon/prod-snapshot (этап 0.3).
 *
 * Даёт по юниту (класс/подкласс): present / missing / misplaced / extra + метрику покрытия
 * и счётчики категорий. Пишущий обёртку — reports.ts (генерирует docs/coverage/<unit>.md).
 */

export type SupportStatus = 'full' | 'partial' | 'needs_engine' | 'needs_content' | 'narrative';

export interface CanonAspect {
  text: string;
  status: SupportStatus;
  engine_ref?: string;
  note?: string;
}

export interface CanonFeature {
  id: string;
  level: number;
  name_ru: string;
  name_en: string;
  status: SupportStatus;
  match?: { effect?: string; action?: string } | null;
  structural?: boolean;
  aspects?: CanonAspect[];
  note?: string;
  checks?: unknown[];
}

export interface CanonSubclass {
  unit: string;
  names: { ru: string; en: string };
  match?: { class_name?: string };
  subclass_level: number;
  features: CanonFeature[];
}

export interface CanonUnit {
  unit: string;
  names: { ru: string; en: string };
  match?: { class_name?: string };
  core_traits?: Record<string, unknown>;
  progression_tables?: Record<string, unknown>;
  features: CanonFeature[];
  subclasses?: CanonSubclass[];
}

export interface SnapshotEntity {
  id?: string;
  card_number?: string;
  name?: string;
  mechanics?: Record<string, unknown> | null;
  is_subclass?: boolean;
  parent_class_id?: string;
  level_progression?: Record<string, { effects?: string[]; actions?: string[] }>;
  related_effects?: string[];
  related_actions?: string[];
  [k: string]: unknown;
}

export interface Snapshot {
  classes: SnapshotEntity[];
  races: SnapshotEntity[];
  effects: SnapshotEntity[];
  actions: SnapshotEntity[];
  spells?: SnapshotEntity[];
}

export interface GrantedRef {
  card_number: string;
  name: string;
  level: number;
  kind: 'effect' | 'action';
  hasMechanics: boolean;
}

export interface FeatureVerdict {
  id: string;
  level: number;
  name: string;
  status: SupportStatus;
  presence: 'present' | 'missing' | 'misplaced';
  actualLevel?: number; // при misplaced
  matchRef?: string | null;
}

export interface UnitReport {
  unit: string;
  name: string;
  verdicts: FeatureVerdict[];
  extra: GrantedRef[]; // выдано прод-ом, но нет в реестре (не carrier/structural)
  broken: string[]; // битые id-ссылки
  coverage: {
    totalFeatures: number;
    present: number;
    missing: number;
    misplaced: number;
    byStatus: Record<SupportStatus, number>;
  };
}

/** Эффект-носитель механики (реализация фичи, не самостоятельная фича) — не «extra». */
function isCarrier(cardNumber: string): boolean {
  return /^VAR-/i.test(cardNumber) || /^pf_\d+$/i.test(cardNumber);
}

function index(snapshot: Snapshot): Map<string, { ent: SnapshotEntity; kind: 'effect' | 'action' }> {
  const byId = new Map<string, { ent: SnapshotEntity; kind: 'effect' | 'action' }>();
  for (const e of snapshot.effects) if (e.id) byId.set(e.id, { ent: e, kind: 'effect' });
  for (const a of snapshot.actions) if (a.id) byId.set(a.id, { ent: a, kind: 'action' });
  return byId;
}

function hasMechanics(e?: SnapshotEntity): boolean {
  return !!(e && e.mechanics && typeof e.mechanics === 'object' && Object.keys(e.mechanics).length > 0);
}

/**
 * Перечислить фичи, которые прод реально выдаёт юниту (класс/подкласс) до уровня maxLevel.
 * Класс — из level_progression; вид/подвид — из related_* (+ LP). broken — битые ссылки.
 */
export function enumerateGranted(
  unit: SnapshotEntity,
  snapshot: Snapshot,
  maxLevel = 20,
): { granted: GrantedRef[]; broken: string[] } {
  const byId = index(snapshot);
  const granted: GrantedRef[] = [];
  const broken: string[] = [];
  const push = (id: string, level: number) => {
    const hit = byId.get(id);
    if (!hit) { broken.push(`${id} (уровень ${level})`); return; }
    granted.push({
      card_number: hit.ent.card_number || id,
      name: hit.ent.name || '?',
      level,
      kind: hit.kind,
      hasMechanics: hasMechanics(hit.ent),
    });
  };
  const lp = unit.level_progression || {};
  for (const lvlStr of Object.keys(lp)) {
    const level = Number(lvlStr);
    if (level > maxLevel) continue;
    for (const id of lp[lvlStr].effects || []) push(id, level);
    for (const id of lp[lvlStr].actions || []) push(id, level);
  }
  // виды: related_* без уровня → уровень 1
  for (const id of unit.related_effects || []) push(id, 1);
  for (const id of unit.related_actions || []) push(id, 1);
  return { granted, broken };
}

function matchOf(f: CanonFeature): string | null {
  return f.match?.effect || f.match?.action || null;
}

/** Свести реестр-фичи к вердиктам present/missing/misplaced относительно выданного. */
export function auditFeatures(
  features: CanonFeature[],
  granted: GrantedRef[],
): { verdicts: FeatureVerdict[]; matchedCards: Set<string> } {
  const grantedByCard = new Map<string, GrantedRef>();
  for (const g of granted) if (!grantedByCard.has(g.card_number)) grantedByCard.set(g.card_number, g);

  const verdicts: FeatureVerdict[] = [];
  const matchedCards = new Set<string>();

  for (const f of features) {
    const ref = matchOf(f);
    if (f.structural || !ref) {
      // structural (выбор подкласса/ASI-«умение подкласса») или match:null (нет в проде)
      verdicts.push({
        id: f.id, level: f.level, name: f.name_ru, status: f.status,
        presence: f.structural ? 'present' : 'missing', matchRef: ref,
      });
      continue;
    }
    const g = grantedByCard.get(ref);
    if (!g) {
      verdicts.push({ id: f.id, level: f.level, name: f.name_ru, status: f.status, presence: 'missing', matchRef: ref });
    } else {
      matchedCards.add(ref);
      const misplaced = g.level !== f.level;
      verdicts.push({
        id: f.id, level: f.level, name: f.name_ru, status: f.status,
        presence: misplaced ? 'misplaced' : 'present',
        actualLevel: misplaced ? g.level : undefined,
        matchRef: ref,
      });
    }
  }
  return { verdicts, matchedCards };
}

export function auditUnit(
  unitEntity: SnapshotEntity,
  registryFeatures: CanonFeature[],
  snapshot: Snapshot,
  unitId: string,
  unitName: string,
  maxLevel = 20,
): UnitReport {
  const { granted, broken } = enumerateGranted(unitEntity, snapshot, maxLevel);
  const { verdicts, matchedCards } = auditFeatures(registryFeatures, granted);

  const extra = granted.filter((g) => !matchedCards.has(g.card_number) && !isCarrier(g.card_number));

  const byStatus: Record<SupportStatus, number> = {
    full: 0, partial: 0, needs_engine: 0, needs_content: 0, narrative: 0,
  };
  for (const f of registryFeatures) byStatus[f.status] = (byStatus[f.status] || 0) + 1;

  return {
    unit: unitId,
    name: unitName,
    verdicts,
    extra,
    broken,
    coverage: {
      totalFeatures: registryFeatures.length,
      present: verdicts.filter((v) => v.presence === 'present').length,
      missing: verdicts.filter((v) => v.presence === 'missing').length,
      misplaced: verdicts.filter((v) => v.presence === 'misplaced').length,
      byStatus,
    },
  };
}

/** Найти сущность-юнит (класс/подкласс) в снапшоте по match.class_name. */
export function findClassUnit(snapshot: Snapshot, className: string): SnapshotEntity | undefined {
  return snapshot.classes.find((c) => c.name === className);
}
