export interface FightingStyleEntityReference {
  featEntityId: string;
  featCardNumber: string;
  relatedEffectEntityIds: readonly string[];
  effectEntityId: string;
  effectCardNumber: string;
}

export interface DeclarativeFightingStyleProjectionBinding {
  styleId: string;
  mode: 'passive_modifier' | 'passive_feature' | 'reaction_capability';
  sourceEntityIds: readonly [string, ...string[]];
  capabilityId?: string;
}

/**
 * Bind a feat-owned Fighting Style exclusively from its declared mechanics
 * and relation. Entity UUIDs and card numbers are retained as provenance, not
 * used to select behavior.
 */
export function bindDeclarativeFightingStyleProjection(
  reference: FightingStyleEntityReference & { effectMechanics: unknown },
): DeclarativeFightingStyleProjectionBinding | null {
  if (!reference.relatedEffectEntityIds.includes(reference.effectEntityId)) return null;
  const stableIds = [
    reference.featEntityId,
    reference.featCardNumber,
    reference.effectEntityId,
    reference.effectCardNumber,
  ];
  if (stableIds.some((id) => !id.trim())) return null;
  if (!reference.effectMechanics
    || typeof reference.effectMechanics !== 'object'
    || Array.isArray(reference.effectMechanics)) return null;
  const mechanics = reference.effectMechanics as Record<string, unknown>;
  const declaration = mechanics.fighting_style as Record<string, unknown> | undefined;
  const activation = mechanics.activation as Record<string, unknown> | undefined;
  if (!declaration) return null;
  const styleId = typeof declaration?.id === 'string' ? declaration.id.trim() : '';
  const mode = declaration?.mode;
  if (!styleId || (mode !== 'passive_modifier'
    && mode !== 'passive_feature'
    && mode !== 'reaction_capability')) return null;
  if (mode === 'passive_modifier' || mode === 'passive_feature') {
    const interactions = Array.isArray(mechanics.effects)
      ? mechanics.effects as Record<string, unknown>[]
      : [];
    const resultPayloads = interactions.flatMap((interaction) => (
      Array.isArray(interaction.result)
        ? interaction.result as Record<string, unknown>[]
        : []
    ));
    const hasExecutablePayload = mode === 'passive_modifier'
      ? resultPayloads.some((payload) => payload.kind === 'modifier')
      : resultPayloads.some((payload) => (
        typeof payload.kind === 'string' && payload.kind !== 'narrative'
      ));
    if (activation?.mode !== 'passive'
      || !hasExecutablePayload
      || declaration?.capability_id !== undefined) {
      return null;
    }
    return {
      styleId,
      mode,
      sourceEntityIds: stableIds as [string, ...string[]],
    };
  }
  const capabilityId = typeof declaration.capability_id === 'string'
    ? declaration.capability_id.trim()
    : '';
  const capabilities = Array.isArray(mechanics.capabilities)
    ? mechanics.capabilities as Record<string, unknown>[]
    : [];
  const capability = capabilities.find((candidate) => candidate.id === capabilityId);
  const requirements = capability?.requirements as Record<string, unknown> | undefined;
  const cost = Array.isArray(activation?.cost)
    ? activation.cost as Record<string, unknown>[]
    : [];
  const reactionCost = cost.length === 1 ? cost[0] : undefined;
  if (activation?.mode !== 'reaction'
    || !capabilityId
    || !capability
    || reactionCost?.resource !== 'reaction'
    || (reactionCost.amount !== undefined && reactionCost.amount !== 1)
    || requirements?.resource !== undefined) return null;
  return {
    styleId,
    mode,
    capabilityId,
    sourceEntityIds: stableIds as [string, ...string[]],
  };
}
