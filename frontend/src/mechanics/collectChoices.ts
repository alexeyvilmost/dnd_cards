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
  recommended?: string[];
  items?: Array<{ id: string; name: string }>; // для source=subfeature
  origin: ChoiceOrigin;
};

type Dict = Record<string, unknown>;

function choiceToPending(ch: Dict, origin: ChoiceOrigin): PendingChoice {
  const form = optionsToChoiceForm(ch) as Dict;
  const opts = (ch.options || {}) as Dict;
  const items = (opts.items as Array<Dict>) || [];
  return {
    id: choiceKey(origin, ch.id as string | number | undefined),
    prompt: String(ch.prompt ?? 'Выбор'),
    count: Number(ch.count ?? 1),
    source: String(form.source ?? 'skill'),
    filter: form.filter as string | string[] | undefined,
    options: opts,
    recommended: ch.recommended as string[] | undefined,
    items: items.map((it) => ({ id: String(it.id), name: String(it.name) })),
    origin,
  };
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
    } else if (it?.resolution === 'auto' && Array.isArray(it.result)) {
      for (const p of it.result as Dict[]) {
        if (p?.kind === 'choice') visit(p, 0);
      }
    }
  }
  return out;
}
