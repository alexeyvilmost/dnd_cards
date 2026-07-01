import { optionsToChoiceForm } from './blocks';

// Откуда пришёл выбор — для группировки в UI и стабильного id.
export type ChoiceOrigin = {
  kind: 'race' | 'class' | 'background' | 'feat' | 'other';
  id: string;
  name: string;
  featureId?: string;
  featureName?: string;
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
    id: `${origin.kind}:${origin.id}:${origin.featureId || 'base'}:${String(ch.id ?? 'choice')}`,
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
export function collectChoices(
  mechanics: Record<string, unknown> | null | undefined,
  origin: ChoiceOrigin,
): PendingChoice[] {
  if (!mechanics || typeof mechanics !== 'object') return [];
  const effects = (mechanics as Dict).effects;
  if (!Array.isArray(effects)) return [];
  const out: PendingChoice[] = [];
  for (const it of effects as Dict[]) {
    if (it?.kind === 'choice') {
      out.push(choiceToPending(it, origin));
    } else if (it?.resolution === 'auto' && Array.isArray(it.result)) {
      for (const p of it.result as Dict[]) {
        if (p?.kind === 'choice') out.push(choiceToPending(p, origin));
      }
    }
  }
  return out;
}
