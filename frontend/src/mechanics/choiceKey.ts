// Единый ключ выбора (choice instance-id) — ЕДИНСТВЕННОЕ определение формата.
// Форге пишет draft.resolvedChoices по этому ключу; резолвер (resolveCharacterRules)
// и сборка (assemble) читают выбор по нему же. Раньше формат был продублирован в 4
// местах — любой дрейф ломал сопоставление «что выбрал игрок ↔ что применил движок».

export interface ChoiceKeyOrigin {
  kind: string;
  id: string;
  featureId?: string;
}

/** Префикс источника: `${kind}:${entityId}:${featureId||'base'}`. Совпадает с RuleSource.id. */
export function sourceKey(kind: string, id: string, featureId?: string | null): string {
  return `${kind}:${id}:${featureId || 'base'}`;
}

/** Instance-id выбора: `${sourceKey}:${choiceId}`. choiceId по умолчанию 'choice'. */
export function choiceKey(origin: ChoiceKeyOrigin, choiceId: string | number | null | undefined): string {
  return `${sourceKey(origin.kind, origin.id, origin.featureId)}:${String(choiceId ?? 'choice')}`;
}
