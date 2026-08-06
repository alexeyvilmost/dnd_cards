import type { Ability } from './domain';
import type { SpellGrantAccess } from './spellcastingAccess';
import type { WorldObjectState } from './worldObjects';

export const PACT_BLADE_DAMAGE_TYPES = ['normal', 'necrotic', 'psychic', 'radiant'] as const;
export type PactBladeDamageChoice = typeof PACT_BLADE_DAMAGE_TYPES[number];

export const PACT_BLADE_STATE_CAPABILITY = 'warlock.pact.blade' as const;
export const PACT_CHAIN_STATE_CAPABILITY = 'warlock.pact.chain' as const;
export const PACT_TOME_STATE_CAPABILITY = 'warlock.pact.tome' as const;

/** Normalized lifecycle values copied from the pact_blade_bond declaration. */
export interface PactBladeLifecyclePolicy {
  separationDistanceFt: number;
  continuousSeparationSecondsToEnd: number;
  endOnOwnerDeath: boolean;
}

export function pactBladeLifecyclePolicyIssue(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return 'Pact Blade lifecycle policy must be an object';
  }
  const policy = value as Record<string, unknown>;
  const keys = Object.keys(policy).sort();
  const expected = [
    'continuousSeparationSecondsToEnd',
    'endOnOwnerDeath',
    'separationDistanceFt',
  ];
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    return 'Pact Blade lifecycle policy has missing or unknown fields';
  }
  if (!Number.isFinite(policy.separationDistanceFt)
    || Number(policy.separationDistanceFt) < 0
    || !Number.isFinite(policy.continuousSeparationSecondsToEnd)
    || Number(policy.continuousSeparationSecondsToEnd) <= 0
    || typeof policy.endOnOwnerDeath !== 'boolean') {
    return 'Pact Blade lifecycle policy requires finite distance, positive duration, and death behavior';
  }
  return null;
}

function validPactBladeLifecyclePolicy(
  value: PactBladeLifecyclePolicy,
): PactBladeLifecyclePolicy {
  const issue = pactBladeLifecyclePolicyIssue(value);
  if (issue) throw new Error(issue);
  return { ...value };
}

export interface PactBladeWeaponCandidate {
  objectId: string;
  /** Immutable Card identity of the concrete WorldObject item instance. */
  weaponCardId: string;
  name: string;
  weaponType: string;
  category: 'simple' | 'martial';
  melee: boolean;
  magical: boolean;
  normalDamageType: string;
  attunedToActorId?: string;
  bondedWarlockId?: string;
}

export interface PactBladeBondState {
  sourceEntityId: string;
  warlockActorId: string;
  weaponObjectId: string;
  weaponCardId: string;
  weaponType: string;
  normalDamageType: string;
  conjured: boolean;
  bondedAtRevision: number;
  continuousSeparationSeconds: number;
  /** Last accepted board/GM distance observation; null until first observation. */
  lastDistanceBoardRevision: number | null;
}

/**
 * Durable actor-owned projection of Pact of the Blade. Selecting the
 * invocation grants this capability, but it does not pretend that the player
 * already spent the Bonus Action needed to create a bond.
 */
export interface PactBladeInvocationState {
  kind: 'blade';
  sourceEntityId: string;
  ownerActorId: string;
  bondActionId: string;
  lifecyclePolicy: PactBladeLifecyclePolicy;
  activeBond: PactBladeBondState | null;
}

export interface PactBladeBondResult {
  bond: PactBladeBondState;
  endedPreviousBond?: PactBladeBondState;
  conjuredObject?: WorldObjectState;
}

export function createPactBladeBond(input: {
  sourceEntityId: string;
  warlockActorId: string;
  worldRevision: number;
  candidate: PactBladeWeaponCandidate;
  previousBond?: PactBladeBondState;
  conjure: boolean;
  touched: boolean;
}): PactBladeBondResult {
  if (!input.candidate.objectId.trim() || !input.candidate.weaponCardId.trim()) {
    throw new Error('Pact of the Blade requires a WorldObject and immutable weapon Card identity');
  }
  if (!['simple', 'martial'].includes(input.candidate.category)
    || (input.conjure && !input.candidate.melee)) {
    throw new Error('Pact of the Blade requires a Simple or Martial Melee weapon');
  }
  if (!input.conjure && (!input.candidate.magical || input.touched !== true)) {
    throw new Error('Bonding an existing pact weapon requires a touched magic weapon');
  }
  if (input.candidate.attunedToActorId && input.candidate.attunedToActorId !== input.warlockActorId) {
    throw new Error('Pact weapon is attuned to another creature');
  }
  if (input.candidate.bondedWarlockId && input.candidate.bondedWarlockId !== input.warlockActorId) {
    throw new Error('Pact weapon is bonded to another Warlock');
  }
  const bond: PactBladeBondState = {
    sourceEntityId: input.sourceEntityId,
    warlockActorId: input.warlockActorId,
    weaponObjectId: input.candidate.objectId,
    weaponCardId: input.candidate.weaponCardId,
    weaponType: input.candidate.weaponType,
    normalDamageType: input.candidate.normalDamageType,
    conjured: input.conjure,
    bondedAtRevision: input.worldRevision,
    continuousSeparationSeconds: 0,
    lastDistanceBoardRevision: null,
  };
  return {
    bond,
    ...(input.previousBond ? { endedPreviousBond: { ...input.previousBond } } : {}),
    ...(input.conjure ? {
      conjuredObject: {
        id: input.candidate.objectId,
        name: input.candidate.name,
        kind: 'item',
        size: 'small',
        ownerActorId: input.warlockActorId,
        carriedByActorId: input.warlockActorId,
        sourceActorId: input.warlockActorId,
        sourceActionId: input.sourceEntityId,
        magicalAura: { school: 'conjuration', createdBySpell: false, visible: true },
        tags: [
          'weapon', input.candidate.category, 'melee', input.candidate.weaponType,
          'pact_weapon', 'spellcasting_focus',
        ].sort(),
      },
    } : {}),
  };
}

export interface PactBladeAttackProjection {
  attackAbility: Ability;
  damageAbility: Ability;
  damageType: string;
  proficient: true;
  spellcastingFocus: true;
}

/** Damage type is chosen for each attack; it is not persisted as part of the bond. */
export function pactBladeAttackProjection(input: {
  bond: PactBladeBondState;
  weaponObjectId: string;
  useCharisma: boolean;
  ordinaryAbility: 'str' | 'dex';
  damageType: PactBladeDamageChoice;
}): PactBladeAttackProjection {
  if (input.bond.weaponObjectId !== input.weaponObjectId) throw new Error('Weapon is not the active pact weapon');
  return {
    attackAbility: input.useCharisma ? 'cha' : input.ordinaryAbility,
    damageAbility: input.useCharisma ? 'cha' : input.ordinaryAbility,
    damageType: input.damageType === 'normal' ? input.bond.normalDamageType : input.damageType,
    proficient: true,
    spellcastingFocus: true,
  };
}

/** Returns null exactly when the declared continuous-separation duration ends the bond. */
export function advancePactBladeDistance(
  bond: PactBladeBondState,
  lifecyclePolicy: PactBladeLifecyclePolicy,
  distanceFt: number,
  elapsedSeconds: number,
  boardRevision?: number,
): PactBladeBondState | null {
  const policy = validPactBladeLifecyclePolicy(lifecyclePolicy);
  if (!Number.isFinite(distanceFt) || distanceFt < 0
    || !Number.isFinite(elapsedSeconds) || elapsedSeconds < 0
    || (boardRevision !== undefined && (!Number.isInteger(boardRevision) || boardRevision < 0))) {
    throw new Error('Pact Blade distance lifecycle requires non-negative explicit facts');
  }
  if (boardRevision !== undefined && bond.lastDistanceBoardRevision !== null
    && boardRevision < bond.lastDistanceBoardRevision) {
    throw new Error('Pact Blade distance board revision is stale');
  }
  const continuousSeparationSeconds = distanceFt > policy.separationDistanceFt
    ? bond.continuousSeparationSeconds + elapsedSeconds
    : 0;
  return continuousSeparationSeconds >= policy.continuousSeparationSecondsToEnd ? null : {
    ...bond,
    continuousSeparationSeconds,
    ...(boardRevision !== undefined ? { lastDistanceBoardRevision: boardRevision } : {}),
  };
}

export interface PactTomeSpellOption {
  actionId: string;
  level: number;
  ritual: boolean;
}

export interface PactTomeState {
  sourceEntityId: string;
  ownerActorId: string;
  bookObjectId: string;
  cantripActionIds: string[];
  ritualActionIds: string[];
  spellGrantIds: string[];
  createdAfterRest: 'short' | 'long';
}

/** The book exists because the compiled fixture includes an explicit rest selection. */
export interface PactTomeInvocationState {
  kind: 'tome';
  sourceEntityId: string;
  ownerActorId: string;
  tome: PactTomeState;
}

export interface PactTomeResult {
  tome: PactTomeState;
  grants: SpellGrantAccess[];
  bookObject: WorldObjectState;
  replacedBookObjectId?: string;
}

function distinctExact(values: readonly string[], count: number, label: string): void {
  if (values.length !== count || new Set(values).size !== count) {
    throw new Error(`${label} requires exactly ${count} distinct selections`);
  }
}

export function conjurePactTome(input: {
  sourceEntityId: string;
  ownerActorId: string;
  bookObjectId: string;
  rest: 'short' | 'long';
  cantripActionIds: readonly string[];
  ritualActionIds: readonly string[];
  options: readonly PactTomeSpellOption[];
  alreadyPreparedActionIds: readonly string[];
  /** The actor's level-1 Pact Magic resource (currently spell_slot_1). */
  slotResource: string;
  previousTome?: PactTomeState;
}): PactTomeResult {
  const sourceEntityId = requiredId(input.sourceEntityId, 'Pact Tome sourceEntityId');
  const ownerActorId = requiredId(input.ownerActorId, 'Pact Tome ownerActorId');
  const bookObjectId = requiredId(input.bookObjectId, 'Pact Tome bookObjectId');
  const slotResource = requiredId(input.slotResource, 'Pact Tome slot resource');
  if (!['short', 'long'].includes(input.rest)) throw new Error('Pact Tome requires a completed rest');
  distinctExact(input.cantripActionIds, 3, 'Pact Tome cantrips');
  distinctExact(input.ritualActionIds, 2, 'Pact Tome rituals');
  const optionIds = input.options.map((option) => requiredId(option.actionId, 'Pact Tome option'));
  if (new Set(optionIds).size !== optionIds.length) {
    throw new Error('Pact Tome spell options must have distinct action IDs');
  }
  const byId = new Map(input.options.map((option) => [option.actionId, option]));
  const alreadyPrepared = new Set(input.alreadyPreparedActionIds);
  for (const actionId of input.cantripActionIds) {
    if (byId.get(actionId)?.level !== 0) throw new Error(`${actionId} is not an eligible cantrip`);
    if (alreadyPrepared.has(actionId)) throw new Error(`${actionId} is already prepared`);
  }
  for (const actionId of input.ritualActionIds) {
    const option = byId.get(actionId);
    if (!option || option.level !== 1 || option.ritual !== true) {
      throw new Error(`${actionId} is not an eligible level-1 ritual`);
    }
    if (alreadyPrepared.has(actionId)) throw new Error(`${actionId} is already prepared`);
  }
  const grants = [
    ...input.cantripActionIds.map((actionId): SpellGrantAccess => ({
      grantId: `spell-grant:${bookObjectId}:${actionId}`,
      actionId,
      sourceId: bookObjectId,
      access: 'cantrip',
      level: 0,
      spellcastingAbility: 'cha',
    })),
    ...input.ritualActionIds.map((actionId): SpellGrantAccess => ({
      grantId: `spell-grant:${bookObjectId}:${actionId}`,
      actionId,
      sourceId: bookObjectId,
      access: 'always_prepared',
      level: 1,
      spellcastingAbility: 'cha',
      ritual: true,
      slotResource,
    })),
  ].sort((left, right) => left.grantId.localeCompare(right.grantId));
  const tome: PactTomeState = {
    sourceEntityId,
    ownerActorId,
    bookObjectId,
    cantripActionIds: [...input.cantripActionIds].sort(),
    ritualActionIds: [...input.ritualActionIds].sort(),
    spellGrantIds: grants.map((grant) => grant.grantId),
    createdAfterRest: input.rest,
  };
  if (input.previousTome
    && (input.previousTome.ownerActorId !== ownerActorId
      || input.previousTome.sourceEntityId !== sourceEntityId)) {
    throw new Error('Pact Tome can replace only the same actor’s source-owned book');
  }
  return {
    tome,
    grants,
    bookObject: {
      id: bookObjectId,
      name: 'Book of Shadows',
      kind: 'item',
      size: 'small',
      ownerActorId,
      carriedByActorId: ownerActorId,
      sourceActorId: ownerActorId,
      sourceActionId: sourceEntityId,
      magicalAura: { school: 'conjuration', createdBySpell: false, visible: true },
      tags: ['book_of_shadows', 'spellcasting_focus'],
    },
    ...(input.previousTome ? { replacedBookObjectId: input.previousTome.bookObjectId } : {}),
  };
}

export const PACT_CHAIN_SPECIAL_FORMS = [
  'imp', 'pseudodragon', 'quasit', 'skeleton', 'slaad_tadpole',
  'sphinx_of_wonder', 'sprite', 'venomous_snake',
] as const;

export interface PactChainFamiliarTemplateState {
  /** Source-scoped at-will Find Familiar action granted by the invocation. */
  findFamiliarActionId: string;
  /** Normal forms are resolved from the immutable Find Familiar definition. */
  normalFormSource: 'find_familiar_spell';
  specialFormIds: string[];
}

export interface PactChainFamiliarState {
  actorId: string;
  ownerActorId: string;
  formId: string;
  sourceEntityId: string;
  reactionAvailable: boolean;
}

/**
 * Selecting Pact of the Chain grants a summon template. A familiar actor is
 * created only after the spell command resolves, so initial compiled roots
 * intentionally retain `activeFamiliar: null`.
 */
export interface PactChainInvocationState {
  kind: 'chain';
  sourceEntityId: string;
  ownerActorId: string;
  template: PactChainFamiliarTemplateState;
  activeFamiliar: PactChainFamiliarState | null;
}

/** A Warlock can eventually own several pact invocations at once. */
export interface WarlockPactStates {
  blade?: PactBladeInvocationState;
  chain?: PactChainInvocationState;
  tome?: PactTomeInvocationState;
}

function requiredId(value: string, label: string): string {
  if (!value.trim()) throw new Error(`${label} is required`);
  return value;
}

export function createPactBladeInvocationState(input: {
  sourceEntityId: string;
  ownerActorId: string;
  bondActionId: string;
  lifecyclePolicy: PactBladeLifecyclePolicy;
}): PactBladeInvocationState {
  return {
    kind: 'blade',
    sourceEntityId: requiredId(input.sourceEntityId, 'Pact Blade sourceEntityId'),
    ownerActorId: requiredId(input.ownerActorId, 'Pact Blade ownerActorId'),
    bondActionId: requiredId(input.bondActionId, 'Pact Blade bondActionId'),
    lifecyclePolicy: validPactBladeLifecyclePolicy(input.lifecyclePolicy),
    activeBond: null,
  };
}

export function createPactChainInvocationState(input: {
  sourceEntityId: string;
  ownerActorId: string;
  findFamiliarActionId: string;
}): PactChainInvocationState {
  return {
    kind: 'chain',
    sourceEntityId: requiredId(input.sourceEntityId, 'Pact Chain sourceEntityId'),
    ownerActorId: requiredId(input.ownerActorId, 'Pact Chain ownerActorId'),
    template: {
      findFamiliarActionId: requiredId(
        input.findFamiliarActionId,
        'Pact Chain findFamiliarActionId',
      ),
      normalFormSource: 'find_familiar_spell',
      specialFormIds: [...PACT_CHAIN_SPECIAL_FORMS],
    },
    activeFamiliar: null,
  };
}

export function createPactTomeInvocationState(input: {
  sourceEntityId: string;
  ownerActorId: string;
  tome: PactTomeState;
}): PactTomeInvocationState {
  const sourceEntityId = requiredId(input.sourceEntityId, 'Pact Tome sourceEntityId');
  const ownerActorId = requiredId(input.ownerActorId, 'Pact Tome ownerActorId');
  if (input.tome.sourceEntityId !== sourceEntityId || input.tome.ownerActorId !== ownerActorId) {
    throw new Error('Pact Tome state must be owned by the same source and actor');
  }
  return {
    kind: 'tome',
    sourceEntityId,
    ownerActorId,
    tome: {
      ...input.tome,
      cantripActionIds: [...input.tome.cantripActionIds],
      ritualActionIds: [...input.tome.ritualActionIds],
      spellGrantIds: [...input.tome.spellGrantIds],
    },
  };
}

export function summonPactChainFamiliar(input: {
  actorId: string;
  ownerActorId: string;
  formId: string;
  sourceEntityId: string;
  normalFormIds: readonly string[];
  previousFamiliar?: PactChainFamiliarState;
}): { familiar: PactChainFamiliarState; replacedActorId?: string } {
  const legal = new Set([...input.normalFormIds, ...PACT_CHAIN_SPECIAL_FORMS]);
  if (!legal.has(input.formId)) throw new Error(`Illegal Pact Chain familiar form ${input.formId}`);
  return {
    familiar: {
      actorId: input.actorId,
      ownerActorId: input.ownerActorId,
      formId: input.formId,
      sourceEntityId: input.sourceEntityId,
      reactionAvailable: true,
    },
    ...(input.previousFamiliar ? { replacedActorId: input.previousFamiliar.actorId } : {}),
  };
}

export function substitutePactChainAttack(input: {
  familiar: PactChainFamiliarState;
  ownerActorId: string;
  attacksRemaining: number;
}): { attacksRemaining: number; familiar: PactChainFamiliarState } {
  if (input.familiar.ownerActorId !== input.ownerActorId) throw new Error('Familiar is not owned by this Warlock');
  if (!Number.isInteger(input.attacksRemaining) || input.attacksRemaining < 1) {
    throw new Error('Pact Chain substitution requires one remaining Attack-action attack');
  }
  if (!input.familiar.reactionAvailable) throw new Error('Familiar Reaction is unavailable');
  return {
    attacksRemaining: input.attacksRemaining - 1,
    familiar: { ...input.familiar, reactionAvailable: false },
  };
}
