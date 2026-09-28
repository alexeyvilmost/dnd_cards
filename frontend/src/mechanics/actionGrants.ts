import type { ChoiceOrigin } from './collectChoices';
import { choiceKey } from './choiceKey';
type Dict = Record<string, unknown>;

/** S6 «предмет=эффект»: slug'и действий, ВЫДАННЫХ через grant_action (даёт доступ к библиотечному
 *  действию; экономика/поведение — на самой карте действия). Читает value | values, форму effects[]. */
export interface GrantActionChoiceContext {
  resolvedChoices: Readonly<Record<string, readonly string[]>>;
  origin: ChoiceOrigin;
}

export function collectGrantActionSlugs(
  mechanics: Record<string, unknown> | null | undefined,
  level = Infinity,
  choiceContext?: GrantActionChoiceContext,
): string[] {
  if (!mechanics || typeof mechanics !== 'object') return [];
  const effects = mechanics.kind === 'grant_action' ? [mechanics] : mechanics.effects ?? mechanics.interactions;
  if (!Array.isArray(effects)) return [];
  const out = new Set<string>();
  const scan = (p: Dict, depth = 0) => {
    if (!p || depth > 6) return;
    if (p.kind === 'grant_action') {
      // Уровневый гейт (как grant_spell): приём доступен только с нужного уровня персонажа.
      const g = p.level_gate ?? p.min_level;
      if (g != null && !Number.isNaN(Number(g)) && level < Number(g)) return;
      if (typeof p.value === 'string' && p.value) out.add(p.value);
      if (Array.isArray(p.values)) {
        for (const v of p.values) if (typeof v === 'string' && v) out.add(v);
      }
      return;
    }
    if (p.kind === 'choice') {
      if (!choiceContext) return;
      const rawChoiceId = String(p.id ?? 'choice');
      const instanceId = choiceKey(choiceContext.origin, rawChoiceId);
      const selected = choiceContext.resolvedChoices[instanceId]
        ?? choiceContext.resolvedChoices[rawChoiceId]
        ?? [];
      const options = p.options as Dict | undefined;
      const items = Array.isArray(options?.items) ? options.items as Dict[] : [];
      for (const selectedId of selected) {
        const item = items.find((candidate) => String(candidate.id) === selectedId);
        if (!item || !Array.isArray(item.grants)) continue;
        for (const grant of item.grants as Dict[]) scan(grant, depth + 1);
      }
      return;
    }
    if (p.resolution === 'auto' && Array.isArray(p.result)) {
      for (const result of p.result as Dict[]) scan(result, depth + 1);
    }
  };
  for (const it of effects as Dict[]) scan(it);
  return [...out];
}
