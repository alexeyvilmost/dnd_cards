/**
 * Разворачивание выборов (choice) в пейлоады — ЕДИНЫЙ источник правды ключа выбора и логики
 * выбора. Резолвер сборки (resolveCharacterRules) и пассивы листа (collectPassiveMechanics)
 * читают resolvedChoices по ОДНОМУ ключу; иначе рассинхрон choiceInstanceId → тихий no-op.
 */
import { sourceKey, instanceFeatureId } from './choiceKey';

type Dict = Record<string, unknown>;

/** Предел вложенности выборов (item.grants → choice → …), защита от циклов в контенте. */
export const MAX_CHOICE_DEPTH = 6;

/**
 * id источника выбора для эффекта/действия. Совпадает с тем, что кладёт форге (choiceKey) и
 * резолвер (sourceFromOrigin.id): оба строят его из sourceKey + instanceFeatureId.
 */
export function passiveSourceId(
  origin: { kind: string; id: string; instanceKey?: string },
  feature?: { id?: string },
): string {
  return sourceKey(origin.kind, origin.id, instanceFeatureId(feature?.id ?? '', origin.instanceKey));
}

/** instance-id выбора = `${sourceId}:${rawChoiceId}`; совпадает с choiceKey(origin, choiceId). */
export const choiceInstanceId = (sourceId: string, rawChoiceId: string): string => `${sourceId}:${rawChoiceId}`;

/** Пейлоады из механики: kind-узлы напрямую + результаты resolution:'auto'. */
export function payloadsFromMechanics(mechanics: Dict | null | undefined): Dict[] {
  if (!mechanics || typeof mechanics !== 'object') return [];
  const effects = (mechanics as Dict).effects;
  if (!Array.isArray(effects)) return [];
  const out: Dict[] = [];
  for (const item of effects as Dict[]) {
    if (item?.kind) {
      out.push(item);
    } else if (item?.resolution === 'auto' && Array.isArray(item.result)) {
      out.push(...(item.result as Dict[]));
    }
  }
  return out;
}

/** Развернуть выбранные пункты choice в грант/пейлоад-шаблоны (item.grants | apply/grant | feat). */
export function selectedChoicePayloads(choice: Dict, selected: string[]): Dict[] {
  const out: Dict[] = [];
  const opts = (choice.options || {}) as Dict;
  const items = Array.isArray(opts.items) ? (opts.items as Dict[]) : [];

  for (const value of selected) {
    const item = items.find((it) => String(it.id) === value);
    if (item && Array.isArray(item.grants)) {
      out.push(...(item.grants as Dict[]));
      continue;
    }

    // `apply` — новое имя grant-шаблона (унифицированные выборы); `grant` — легаси-алиас.
    const template = (choice.apply || choice.grant || {}) as Dict;
    if (template.kind) {
      out.push({ ...template, value });
      continue;
    }

    // choice(source:"feat"/"item") без grant-шаблона: выбранное значение — id сущности.
    if (String(opts.source) === 'feat') {
      out.push({ kind: 'grant_feat', value });
    } else if (String(opts.source) === 'item') {
      // S3 контейнеры / выбор-в-моменте предмета: выбранный предмет → в инвентарь (add_item, S1).
      // qty — из варианта (контейнер несёт quantity в options.items), иначе 1.
      const q = item && (item as Dict).qty != null ? Number((item as Dict).qty) : 1;
      out.push({ kind: 'add_item', card_id: value, qty: Math.max(1, Math.floor(q) || 1) });
    }
  }

  return out;
}

/**
 * РАНТАЙМ-пейлоады, у которых ЕСТЬ работающий потребитель среди пассивов: modifier →
 * collectModifiers, resistance → resistanceLevelFor, set_value → acBaseOverrides. Намеренно НЕ
 * включаем: grant_* (build-гранты — их применяет resolveCharacterRules); мгновенные исходы
 * (damage/healing/temp_hp/…); а также resource/variable/condition — у них пока НЕТ потребителя
 * на пути пассивов (resource-пул инициализируется без resolvedChoices; variable/condition
 * читаются из assemble/activeEffects, не из синтетической механики). Добавим по мере проводки.
 */
const PASSIVE_PAYLOAD_KINDS = new Set(['modifier', 'resistance', 'set_value']);

const RESIST_LEVELS = new Set(['immunity', 'resistance', 'vulnerability']);

/**
 * apply-шаблон damage_type-выбора (blocks.ts: grant:{kind:'resistance'}) при развороте даёт
 * {kind:'resistance', value:<тип урона>} БЕЗ поля damage_type — resistanceLevelFor такой не
 * сматчит. Приводим к рабочей форме: тип урона → damage_type, уровень по умолчанию 'resistance'.
 * items-форма (damage_type уже задан) и явный уровень (value ∈ RESIST_LEVELS) не трогаются.
 */
export function normalizeChoicePayload(p: Dict): Dict {
  if (p.kind === 'resistance' && p.damage_type == null && p.value != null && !RESIST_LEVELS.has(String(p.value))) {
    return { ...p, damage_type: p.value, value: 'resistance' };
  }
  return p;
}

/**
 * Ярус 1.1: выбранные через choice РАНТАЙМ-пейлоады из механики эффекта — для пассивов
 * листа/боя. Вложенный choice (item.grants → choice) разворачивается рекурсивно тем же ключом
 * (глубина ≤ MAX_CHOICE_DEPTH). Ключ считается ровно как в резолвере, поэтому выбор совпадает.
 */
export function expandPassiveChoicePayloads(
  mechanics: Dict | null | undefined,
  sourceId: string,
  resolvedChoices: Record<string, string[]>,
): Dict[] {
  const out: Dict[] = [];
  const walk = (choice: Dict, depth: number): void => {
    if (depth >= MAX_CHOICE_DEPTH) return;
    const rawId = String(choice.id || 'choice');
    const selected = resolvedChoices[choiceInstanceId(sourceId, rawId)] || resolvedChoices[rawId] || [];
    for (const sp of selectedChoicePayloads(choice, selected)) {
      if (sp.kind === 'choice') { walk(sp, depth + 1); continue; }
      const norm = normalizeChoicePayload(sp);
      if (PASSIVE_PAYLOAD_KINDS.has(String(norm.kind))) out.push(norm);
    }
  };
  for (const p of payloadsFromMechanics(mechanics)) {
    if (p.kind === 'choice') walk(p, 0);
  }
  return out;
}
