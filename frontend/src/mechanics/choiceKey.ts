// Единый ключ выбора (choice instance-id) — ЕДИНСТВЕННОЕ определение формата.
// Форге пишет draft.resolvedChoices по этому ключу; резолвер (resolveCharacterRules)
// и сборка (assemble) читают выбор по нему же. Раньше формат был продублирован в 4
// местах — любой дрейф ломал сопоставление «что выбрал игрок ↔ что применил движок».

export interface ChoiceKeyOrigin {
  kind: string;
  id: string;
  featureId?: string;
}

/** featureId с учётом ЭКЗЕМПЛЯРА: `${effectId}#${instanceKey}` для повторных получений
 *  повторяемой черты (ASI/Одарённый) на разных слотах — иначе их вложенные выборы делят
 *  один ключ и сливаются. Без instanceKey — прежний стабильный ключ (совместимость). */
export function instanceFeatureId(effectId: string, instanceKey?: string | null): string {
  return instanceKey ? `${effectId}#${instanceKey}` : effectId;
}

/** Префикс источника: `${kind}:${entityId}:${featureId||'base'}`. Совпадает с RuleSource.id. */
export function sourceKey(kind: string, id: string, featureId?: string | null): string {
  return `${kind}:${id}:${featureId || 'base'}`;
}

/** Instance-id выбора: `${sourceKey}:${choiceId}`. choiceId по умолчанию 'choice'. */
export function choiceKey(origin: ChoiceKeyOrigin, choiceId: string | number | null | undefined): string {
  return `${sourceKey(origin.kind, origin.id, origin.featureId)}:${String(choiceId ?? 'choice')}`;
}
