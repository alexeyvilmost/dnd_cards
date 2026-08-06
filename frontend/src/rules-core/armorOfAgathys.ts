type JsonRecord = Record<string, unknown>;

export const TEMPORARY_HP_MELEE_RETALIATION_EFFECT_KIND =
  'temporary_hp_melee_retaliation' as const;

export interface ArmorOfAgathysPolicy {
  temporaryHpPerSlot: number;
  retaliationDamagePerSlot: number;
  retaliationDamageType: string;
  retaliationTrigger: 'hit_by_melee_attack_roll';
  durationRounds: number;
  endWhenNoTemporaryHp: true;
  minimumSlotLevel: number;
  maximumSlotLevel: number;
}

export interface ArmorOfAgathysEffectMechanics extends JsonRecord {
  kind: typeof TEMPORARY_HP_MELEE_RETALIATION_EFFECT_KIND;
  actionId: string;
  slotLevel: number;
  temporaryHpPerSlot: number;
  retaliationDamagePerSlot: number;
  retaliationDamage: number;
  retaliationDamageType: string;
  durationRounds: number;
  minimumSlotLevel: number;
  maximumSlotLevel: number;
  endWhenNoTemporaryHp: true;
  trigger: { event: 'hit_by_melee_attack_roll' };
  sourceEntityIds: string[];
}

export interface ArmorOfAgathysEffectEntry {
  id: string;
  name: string;
  mechanics: ArmorOfAgathysEffectMechanics | JsonRecord;
  roundsLeft?: number;
  source: string;
  ownerId?: string;
  sourceId?: string;
}

export interface ArmorOfAgathysRuntimeState {
  hp: { current: number; max: number; temp: number };
  activeEffects: ArmorOfAgathysEffectEntry[];
}

function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function stable(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} requires a stable id`);
  return normalized;
}

function canonicalSources(sourceEntityIds: readonly string[]): string[] {
  const result = [...new Set(sourceEntityIds.map((id) => id.trim()).filter(Boolean))].sort();
  if (result.length === 0) throw new Error('Retaliation provenance must not be empty');
  return result;
}

export function temporaryHpMeleeRetaliationPolicyFromMechanics(
  value: unknown,
): ArmorOfAgathysPolicy | null {
  const primitive = record(value);
  if (primitive?.type !== 'temporary_hp_melee_retaliation'
    || !Number.isInteger(primitive.temporary_hp_per_slot)
    || Number(primitive.temporary_hp_per_slot) < 1
    || !Number.isInteger(primitive.retaliation_damage_per_slot)
    || Number(primitive.retaliation_damage_per_slot) < 1
    || typeof primitive.retaliation_damage_type !== 'string'
    || !primitive.retaliation_damage_type.trim()
    || primitive.retaliation_trigger !== 'hit_by_melee_attack_roll'
    || !Number.isInteger(primitive.duration_rounds)
    || Number(primitive.duration_rounds) < 1
    || primitive.end_when_no_temporary_hp !== true
    || !Number.isInteger(primitive.minimum_slot_level)
    || Number(primitive.minimum_slot_level) < 1
    || !Number.isInteger(primitive.maximum_slot_level)
    || Number(primitive.maximum_slot_level) < Number(primitive.minimum_slot_level)) return null;
  return {
    temporaryHpPerSlot: Number(primitive.temporary_hp_per_slot),
    retaliationDamagePerSlot: Number(primitive.retaliation_damage_per_slot),
    retaliationDamageType: primitive.retaliation_damage_type,
    retaliationTrigger: 'hit_by_melee_attack_roll',
    durationRounds: Number(primitive.duration_rounds),
    endWhenNoTemporaryHp: true,
    minimumSlotLevel: Number(primitive.minimum_slot_level),
    maximumSlotLevel: Number(primitive.maximum_slot_level),
  };
}

export function armorOfAgathysValues(slotLevel: number, policy: ArmorOfAgathysPolicy): {
  temporaryHp: number;
  retaliationDamage: number;
} {
  if (!Number.isInteger(slotLevel)
    || slotLevel < policy.minimumSlotLevel
    || slotLevel > policy.maximumSlotLevel) {
    throw new Error(
      `Slot-scaled retaliation requires a spell-slot level from `
        + `${policy.minimumSlotLevel} to ${policy.maximumSlotLevel}`,
    );
  }
  return {
    temporaryHp: slotLevel * policy.temporaryHpPerSlot,
    retaliationDamage: slotLevel * policy.retaliationDamagePerSlot,
  };
}

export function createArmorOfAgathysEffect(input: {
  id: string;
  actorId: string;
  actionId: string;
  name: string;
  slotLevel: number;
  policy: ArmorOfAgathysPolicy;
  sourceEntityIds: readonly string[];
}): ArmorOfAgathysEffectEntry {
  const id = stable(input.id, 'Temporary HP retaliation effect');
  const actorId = stable(input.actorId, 'Temporary HP retaliation actor');
  const actionId = stable(input.actionId, 'Temporary HP retaliation action');
  const name = stable(input.name, 'Slot-scaled retaliation effect name');
  const { retaliationDamage } = armorOfAgathysValues(input.slotLevel, input.policy);
  return {
    id,
    name,
    mechanics: {
      kind: TEMPORARY_HP_MELEE_RETALIATION_EFFECT_KIND,
      actionId,
      slotLevel: input.slotLevel,
      temporaryHpPerSlot: input.policy.temporaryHpPerSlot,
      retaliationDamagePerSlot: input.policy.retaliationDamagePerSlot,
      retaliationDamage,
      retaliationDamageType: input.policy.retaliationDamageType,
      durationRounds: input.policy.durationRounds,
      minimumSlotLevel: input.policy.minimumSlotLevel,
      maximumSlotLevel: input.policy.maximumSlotLevel,
      endWhenNoTemporaryHp: input.policy.endWhenNoTemporaryHp,
      trigger: { event: input.policy.retaliationTrigger },
      sourceEntityIds: canonicalSources(input.sourceEntityIds),
    },
    roundsLeft: input.policy.durationRounds,
    source: name,
    ownerId: actorId,
    sourceId: actorId,
  };
}

export type TemporaryHpChoice = 'take_spell' | 'keep_current';

/**
 * Applies the general Temporary Hit Point replacement choice and replaces the
 * caster's previous copy from the same source action. A cast that leaves the actor at zero
 * Temporary HP ends immediately and therefore stores no retaliation effect.
 */
export function applyArmorOfAgathysCast<T extends ArmorOfAgathysRuntimeState>(input: {
  state: T;
  effect: ArmorOfAgathysEffectEntry;
  temporaryHpChoice: TemporaryHpChoice;
}): T {
  if (!['take_spell', 'keep_current'].includes(input.temporaryHpChoice)) {
    throw new Error('Temporary HP retaliation requires an explicit Temporary HP choice');
  }
  if (!Number.isInteger(input.state.hp.temp) || input.state.hp.temp < 0) {
    throw new Error('Temporary HP retaliation requires a non-negative integer Temporary HP state');
  }
  const issue = armorOfAgathysEffectIssue(input.effect, input.effect.ownerId ?? '');
  if (issue) throw new Error(issue);
  const mechanics = input.effect.mechanics as ArmorOfAgathysEffectMechanics;
  const granted = mechanics.slotLevel * mechanics.temporaryHpPerSlot;
  const temp = input.temporaryHpChoice === 'take_spell' ? granted : input.state.hp.temp;
  const activeEffects = input.state.activeEffects.filter((effect) => {
    const candidate = record(effect.mechanics);
    return !(candidate?.kind === TEMPORARY_HP_MELEE_RETALIATION_EFFECT_KIND
      && effect.ownerId === input.effect.ownerId
      && candidate.actionId === mechanics.actionId);
  });
  if (temp > 0) activeEffects.push(JSON.parse(JSON.stringify(input.effect)) as ArmorOfAgathysEffectEntry);
  return {
    ...input.state,
    hp: { ...input.state.hp, temp },
    activeEffects,
  };
}

export interface ArmorOfAgathysMeleeHitFacts {
  defenderActorId: string;
  attackerActorId: string;
  hit: boolean;
  attackRollKind: 'melee' | 'ranged' | 'none';
  temporaryHpBeforeHit: number;
}

export interface TemporaryHpMeleeRetaliation {
  effectId: string;
  sourceActionId: string;
  damageType: string;
  amount: number;
  sourceEntityIds: string[];
}

/** Returns every independently declared retaliation that existed at the hit trigger. */
export function temporaryHpMeleeRetaliations(input: {
  effects: readonly ArmorOfAgathysEffectEntry[];
  facts: ArmorOfAgathysMeleeHitFacts;
}): TemporaryHpMeleeRetaliation[] {
  if (!input.facts.hit
    || input.facts.attackRollKind !== 'melee'
    || input.facts.attackerActorId === input.facts.defenderActorId
    || !Number.isInteger(input.facts.temporaryHpBeforeHit)
    || input.facts.temporaryHpBeforeHit <= 0) return [];
  return input.effects.flatMap((effect) => {
    if (record(effect.mechanics)?.kind !== TEMPORARY_HP_MELEE_RETALIATION_EFFECT_KIND) return [];
    if (armorOfAgathysEffectIssue(effect, input.facts.defenderActorId)) return [];
    const mechanics = effect.mechanics as ArmorOfAgathysEffectMechanics;
    return [{
      effectId: effect.id,
      sourceActionId: mechanics.actionId,
      damageType: mechanics.retaliationDamageType,
      amount: mechanics.retaliationDamage,
      sourceEntityIds: [...mechanics.sourceEntityIds],
    }];
  }).sort((left, right) => left.effectId.localeCompare(right.effectId));
}

/** Ends the spell after hit damage (or any other event) removes all Temporary HP. */
export function endArmorOfAgathysWithoutTemporaryHp<T extends ArmorOfAgathysRuntimeState>(state: T): T {
  if (state.hp.temp > 0) return state;
  const activeEffects = state.activeEffects.filter((effect) => (
    record(effect.mechanics)?.kind !== TEMPORARY_HP_MELEE_RETALIATION_EFFECT_KIND
  ));
  if (activeEffects.length === state.activeEffects.length) return state;
  return { ...state, activeEffects };
}

/** Validate persisted spell state before it can become a retaliation source. */
export function armorOfAgathysEffectIssue(value: unknown, ownerActorId: string): string | null {
  const effect = record(value);
  const mechanics = record(effect?.mechanics);
  if (mechanics?.kind !== TEMPORARY_HP_MELEE_RETALIATION_EFFECT_KIND) return null;
  if (typeof effect?.id !== 'string' || !effect.id.trim()
    || typeof effect.name !== 'string' || !effect.name.trim()
    || typeof effect.source !== 'string' || !effect.source.trim()) {
    return 'Temporary HP retaliation effect must retain its stable identity';
  }
  if (!ownerActorId || effect?.ownerId !== ownerActorId || effect.sourceId !== ownerActorId) {
    return 'Temporary HP retaliation effect must retain its owner and source actor';
  }
  if (!Number.isInteger(mechanics.durationRounds)
    || Number(mechanics.durationRounds) < 1
    || !Number.isInteger(effect.roundsLeft)
    || Number(effect.roundsLeft) < 1
    || Number(effect.roundsLeft) > Number(mechanics.durationRounds)) {
    return 'Temporary HP retaliation duration exceeds its declared policy';
  }
  const slotLevel = Number(mechanics.slotLevel);
  if (!Number.isInteger(mechanics.minimumSlotLevel) || Number(mechanics.minimumSlotLevel) < 1
    || !Number.isInteger(mechanics.maximumSlotLevel)
    || Number(mechanics.maximumSlotLevel) < Number(mechanics.minimumSlotLevel)
    || !Number.isInteger(slotLevel)
    || slotLevel < Number(mechanics.minimumSlotLevel)
    || slotLevel > Number(mechanics.maximumSlotLevel)
    || !Number.isInteger(mechanics.temporaryHpPerSlot)
    || Number(mechanics.temporaryHpPerSlot) < 1
    || !Number.isInteger(mechanics.retaliationDamagePerSlot)
    || Number(mechanics.retaliationDamagePerSlot) < 1
    || mechanics.retaliationDamage !== slotLevel * Number(mechanics.retaliationDamagePerSlot)
    || typeof mechanics.retaliationDamageType !== 'string'
    || !mechanics.retaliationDamageType.trim()) {
    return 'Temporary HP retaliation values are inconsistent with its declared policy';
  }
  if (typeof mechanics.actionId !== 'string' || !mechanics.actionId.trim()) {
    return 'Temporary HP retaliation effect must retain its source action';
  }
  const trigger = record(mechanics.trigger);
  if (mechanics.endWhenNoTemporaryHp !== true || trigger?.event !== 'hit_by_melee_attack_roll') {
    return 'Temporary HP retaliation effect has invalid trigger or end semantics';
  }
  const rawSources = mechanics.sourceEntityIds;
  const sources = Array.isArray(rawSources)
    ? rawSources.filter((id): id is string => typeof id === 'string' && !!id.trim())
    : [];
  if (!Array.isArray(rawSources)
    || sources.length !== rawSources.length
    || sources.length === 0
    || sources.some((id) => id !== id.trim())
    || sources.length !== new Set(sources).size
    || JSON.stringify(sources) !== JSON.stringify([...sources].sort())) {
    return 'Temporary HP retaliation effect must retain non-empty, unique, stable provenance';
  }
  return null;
}
