import { optionsToChoiceForm } from './blocks';
import { choiceKey } from './choiceKey';

// Откуда пришёл выбор — для группировки в UI и стабильного id.
export type ChoiceOrigin = {
  kind: 'race' | 'class' | 'background' | 'feat' | 'other';
  id: string;
  name: string;
  featureId?: string;
  featureName?: string;
  /** Дискриминатор экземпляра повторяемой черты (id слота-пикера). Делает ключи вложенных
   *  выборов уникальными на КАЖДОЕ получение (ASI×N, Одарённый×N). См. instanceFeatureId. */
  instanceKey?: string;
};

// Ожидающий разрешения выбор, извлечённый из механики эффекта.
export type PendingChoice = {
  id: string; // стабильный id (choice.id)
  prompt: string;
  count: number;
  source: string; // skill | tool | feat | language | subfeature | ...
  filter?: string | string[];
  options?: Record<string, unknown>; // исходные options из механики
  /** Choice-level grant/apply template. It is materialized with the selected
   * option id by the same generic semantics used by the rules resolver. */
  grant?: Record<string, unknown>;
  recommended?: string[];
  items?: Array<{
    id: string;
    name: string;
    /** Declarative effects granted by this exact option. Consumers use these
     * primitives to explain/disable conflicts without branching on an entity
     * name, UUID, card number, or choice id. */
    grants?: Array<Record<string, unknown>>;
  }>; // для source=subfeature/explicit/effect
  origin: ChoiceOrigin;
  /** Где разрешается выбор: 'in_play' — на листе во время игры (иначе — создание/левелап). */
  context?: string;
  /** kind гранта выбора (напр. weapon_mastery) — для спец-UI на листе. */
  grantKind?: string;
  /** A prepared-spell choice is a second, non-granting selection over the
   * exact spells persisted by another choice in the same mechanics source. */
  preparedSpellSourceChoiceId?: string;
  /** Immutable option domain projected from the referenced source choice. */
  allowedOptionIds?: string[];
};

type Dict = Record<string, unknown>;

function choiceToPending(ch: Dict, origin: ChoiceOrigin): PendingChoice {
  const form = optionsToChoiceForm(ch) as Dict;
  const opts = (ch.options || {}) as Dict;
  const items = (opts.items as Array<Dict>) || [];
  const grant = (ch.apply || ch.grant || form.grant) as Dict | undefined;
  return {
    id: choiceKey(origin, ch.id as string | number | undefined),
    prompt: String(ch.prompt ?? 'Выбор'),
    count: Number(ch.count ?? 1),
    source: String(form.source ?? 'skill'),
    filter: form.filter as string | string[] | undefined,
    options: opts,
    ...(grant?.kind ? { grant: { ...grant } } : {}),
    recommended: ch.recommended as string[] | undefined,
    items: items.map((it) => ({
      id: String(it.id),
      name: String(it.name),
      ...(Array.isArray(it.grants) ? {
        grants: (it.grants as Dict[]).map((grant) => ({ ...grant })),
      } : {}),
    })),
    origin,
    context: ch.context ? String(ch.context) : undefined,
    grantKind: grant?.kind != null ? String(grant.kind) : undefined,
  };
}

function preparedSpellChoiceToPending(
  declaration: Dict,
  origin: ChoiceOrigin,
  resolvedChoices?: Record<string, string[]>,
): PendingChoice {
  const rawId = declaration.id;
  const rawSourceChoiceId = declaration.source_choice_id;
  const count = declaration.count;
  if ((typeof rawId !== 'string' && typeof rawId !== 'number')
    || String(rawId).trim().length === 0
    || (typeof rawSourceChoiceId !== 'string' && typeof rawSourceChoiceId !== 'number')
    || String(rawSourceChoiceId).trim().length === 0
    || !Number.isSafeInteger(count) || Number(count) < 1
    || declaration.resolution !== 'on_acquire') {
    throw new Error('prepared_spell_choice requires id, source_choice_id, positive count, and resolution:on_acquire');
  }
  const id = choiceKey(origin, rawId);
  const preparedSpellSourceChoiceId = choiceKey(origin, rawSourceChoiceId);
  const allowedOptionIds = [...new Set(
    resolvedChoices?.[preparedSpellSourceChoiceId]
      ?? resolvedChoices?.[String(rawSourceChoiceId)]
      ?? [],
  )];
  return {
    id,
    prompt: String(declaration.prompt ?? 'Подготовьте заклинания'),
    count: Number(count),
    source: 'prepared_spell',
    origin,
    context: declaration.context ? String(declaration.context) : undefined,
    preparedSpellSourceChoiceId,
    allowedOptionIds,
  };
}

export function isSpellSelectionChoice(choice: Pick<PendingChoice, 'source'>): boolean {
  return choice.source === 'spell' || choice.source === 'prepared_spell';
}

export function preparedSpellSelectionIssues(
  choice: PendingChoice,
  selection: readonly string[],
): string[] {
  if (choice.source !== 'prepared_spell') return [];
  const issues: string[] = [];
  if (selection.length !== choice.count) {
    issues.push(`требуется выбрать ровно ${choice.count}`);
  }
  if (new Set(selection).size !== selection.length) {
    issues.push('подготовленные заклинания должны быть различны');
  }
  const allowed = new Set(choice.allowedOptionIds ?? []);
  const outside = [...new Set(selection.filter((reference) => !allowed.has(reference)))];
  if (outside.length) {
    issues.push(`заклинания вне выбранной книги: ${outside.join(', ')}`);
  }
  if (!choice.preparedSpellSourceChoiceId) {
    issues.push('не объявлен исходный выбор книги заклинаний');
  }
  return issues;
}

/** Выбор искусности оружия (Weapon Mastery 2024) — отдельный UI на листе. */
export function isWeaponMasteryChoice(pc: PendingChoice): boolean {
  return pc.grantKind === 'weapon_mastery' || pc.source === 'weapon';
}

// Собирает все pending-выборы (kind:"choice") из механики эффекта.
// Поддерживает choice как самостоятельную интеракцию и внутри resolution:"auto".
//
// resolvedChoices (опц.): если передан, вложенные choice РАЗРЕШЁННОГО выбора всплывают
// рекурсивно. Пример: черта «Улучшение характеристик» — внешний choice режима (+2 к одной
// / +1 к двум); как только игрок выбрал режим, из item.grants выбранного пункта всплывает
// вложенный choice характеристики. Ключи вложенных выборов совпадают с тем, что читает
// резолвер (тот же source + choice.id) — см. choiceKey.
const MAX_CHOICE_DEPTH = 6;

export function collectChoices(
  mechanics: Record<string, unknown> | null | undefined,
  origin: ChoiceOrigin,
  resolvedChoices?: Record<string, string[]>,
): PendingChoice[] {
  if (!mechanics || typeof mechanics !== 'object') return [];
  const effects = (mechanics as Dict).effects;
  if (!Array.isArray(effects)) return [];
  const out: PendingChoice[] = [];

  const visit = (ch: Dict, depth: number) => {
    const pending = choiceToPending(ch, origin);
    out.push(pending);
    if (!resolvedChoices || depth >= MAX_CHOICE_DEPTH) return;
    // Всплытие вложенных выборов: спускаемся в grants выбранного пункта.
    const selected = resolvedChoices[pending.id] || [];
    if (!selected.length) return;
    const opts = (ch.options || {}) as Dict;
    const items = Array.isArray(opts.items) ? (opts.items as Dict[]) : [];
    for (const sel of selected) {
      const item = items.find((it) => String(it.id) === sel);
      const grants = item && Array.isArray(item.grants) ? (item.grants as Dict[]) : [];
      for (const g of grants) if (g?.kind === 'choice') visit(g, depth + 1);
    }
  };

  for (const it of effects as Dict[]) {
    if (it?.kind === 'choice') {
      visit(it, 0);
    } else if (it?.kind === 'prepared_spell_choice') {
      out.push(preparedSpellChoiceToPending(it, origin, resolvedChoices));
    } else if (it?.resolution === 'auto' && Array.isArray(it.result)) {
      for (const p of it.result as Dict[]) {
        if (p?.kind === 'choice') visit(p, 0);
        else if (p?.kind === 'prepared_spell_choice') {
          out.push(preparedSpellChoiceToPending(p, origin, resolvedChoices));
        }
      }
    }
  }
  return out;
}

/**
 * Ярус 1.2: выборы context:'in_play' ВНУТРИ действия — для предпрохода на клике действия.
 * PendingChoice.id = СЫРОЙ choice.id (ключ ctx.choices на одно исполнение), а НЕ choiceKey:
 * движок читает ctx.choices[String(p.id)] напрямую, без origin. Топ-уровень + resolution:'auto'.
 */
export function collectInPlayActionChoices(
  mechanics: Record<string, unknown> | null | undefined,
  origin: ChoiceOrigin,
): PendingChoice[] {
  if (!mechanics || typeof mechanics !== 'object') return [];
  const effects = (mechanics as Dict).effects;
  if (!Array.isArray(effects)) return [];
  const raw: Dict[] = [];
  const outcomeKeys = ['result', 'results', 'on_hit', 'on_crit', 'on_miss', 'on_fail', 'on_success'];
  const visitInteraction = (interaction: Dict): void => {
    if (interaction?.kind === 'choice') {
      raw.push(interaction);
      return;
    }
    for (const key of outcomeKeys) {
      const payloads = interaction?.[key];
      if (!Array.isArray(payloads)) continue;
      for (const payload of payloads as Dict[]) {
        if (payload?.kind === 'choice') raw.push(payload);
      }
    }
  };
  for (const effect of effects as Dict[]) {
    visitInteraction(effect);
  }
  return raw
    .filter((ch) => String(ch.context ?? '') === 'in_play')
    .map((ch) => ({ ...choiceToPending(ch, origin), id: String(ch.id ?? 'choice') }));
}
