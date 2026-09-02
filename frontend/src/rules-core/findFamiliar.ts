import {
  replaceSequenceAttack,
  type AttackSequenceState,
} from './attackSequence';

export const FIND_FAMILIAR_BASE_FORMS = [
  'bat', 'cat', 'frog', 'hawk', 'lizard', 'octopus',
  'owl', 'rat', 'raven', 'spider', 'weasel',
] as const;

export const PACT_CHAIN_SPECIAL_FAMILIAR_FORMS = [
  'imp', 'pseudodragon', 'quasit', 'skeleton', 'slaad_tadpole',
  'sphinx_of_wonder', 'sprite', 'venomous_snake',
] as const;

export const FAMILIAR_SPIRIT_TYPES = ['celestial', 'fey', 'fiend'] as const;
export const PACT_CHAIN_ATTACK_REPLACEMENT_KEY = 'pact-chain:familiar-attack' as const;

/**
 * Normalized, data-owned Find Familiar rules.  PHB values belong to the
 * action's mechanics JSON; the runtime only interprets this validated shape.
 */
export interface FindFamiliarMechanicsPolicy {
  connectionRangeFt: number;
  reappearRangeFt: number;
  ritualCastingAddedSeconds: number;
}

export type FindFamiliarMechanicsPolicyParseResult =
  | { status: 'valid'; policy: FindFamiliarMechanicsPolicy; materialCostResource: string }
  | { status: 'invalid'; issue: string };

export type FindFamiliarBaseForm = typeof FIND_FAMILIAR_BASE_FORMS[number];
export type PactChainSpecialFamiliarForm = typeof PACT_CHAIN_SPECIAL_FAMILIAR_FORMS[number];
export type FamiliarSpiritType = typeof FAMILIAR_SPIRIT_TYPES[number];
export type FamiliarPresence = 'present' | 'pocket_dimension' | 'disappeared_zero_hp';

export interface BaseFindFamiliarPolicy {
  kind: 'base';
  sourceEntityId: string;
}

export interface PactChainFindFamiliarPolicy {
  kind: 'pact_chain';
  sourceEntityId: string;
}

/** Pact of the Chain extends, and never replaces, the spell's normal-form policy. */
export type FindFamiliarExtensionPolicy =
  | BaseFindFamiliarPolicy
  | PactChainFindFamiliarPolicy;

export interface InjectedCr0BeastForm {
  id: string;
  name: string;
  statBlockId: string;
  creatureType: 'beast';
  challengeRating: 0;
}

/** Trusted, ruleset-owned extension data. Runtime state cannot mint this authority itself. */
export interface InjectedFamiliarFormCatalog {
  schemaVersion: 1;
  catalogId: string;
  forms: readonly Readonly<InjectedCr0BeastForm>[];
}

export interface FamiliarValidationContext {
  injectedFormCatalog?: InjectedFamiliarFormCatalog;
}

export interface InjectedFamiliarFormProof {
  catalogId: string;
  formId: string;
  statBlockId: string;
}

export interface ResolvedFamiliarForm {
  id: string;
  name: string;
  statBlockId: string;
  eligibility: 'base_standard' | 'injected_cr0_beast' | 'pact_chain_special';
  /** Present on normal forms because Find Familiar admits only CR 0 Beasts. */
  baseCreatureType?: 'beast';
  challengeRating?: 0;
  /** Checked against a trusted catalog on every persisted-state operation. */
  injectedFormProof?: InjectedFamiliarFormProof;
}

export interface FamiliarInitiativeState {
  mode: 'own';
  d20Roll: number | null;
  modifier: number | null;
  total: number | null;
}

export interface FamiliarSharedSensesState {
  activatedOnOwnerTurn: number;
  expiresAtOwnerTurnStart: number;
  includesFormSpecialSenses: true;
}

export interface FamiliarState {
  schemaVersion: 1;
  actorId: string;
  ownerActorId: string;
  sourceEntityId: string;
  extension: FindFamiliarExtensionPolicy['kind'];
  form: ResolvedFamiliarForm;
  spiritType: FamiliarSpiritType;
  presence: FamiliarPresence;
  initiative: FamiliarInitiativeState;
  reactionAvailable: boolean;
  sharedSenses: FamiliarSharedSensesState | null;
  carriedItemIds: string[];
  wornItemIds: string[];
  allyToOwnerAndAllies: true;
  actsIndependently: true;
  obeysOwnerCommands: true;
  canAttackNormally: false;
}

export type FindFamiliarCastMethod =
  | 'spell_slot'
  | 'ritual'
  | 'pact_chain_magic_action'
  | 'wild_companion_magic_action';

export interface FindFamiliarResources {
  level1SpellSlots: number;
  incenseGp: number;
}

export interface FindFamiliarCastResult {
  familiar: FamiliarState;
  resources: FindFamiliarResources;
  consumedIncenseGp: number;
  spellSlotsExpended: 0 | 1;
  castingTime: 'one_hour' | 'ritual' | 'magic_action';
  castingDuration:
    | {
      kind: 'timed';
      baseSeconds: number;
      ritualAddedSeconds: number;
      totalSeconds: number;
    }
    | { kind: 'magic_action' };
  created: boolean;
  changedForm: boolean;
}

export interface FamiliarDisappearanceResult {
  familiar: FamiliarState | null;
  droppedItemIds: string[];
  reason: 'zero_hp' | 'temporary_dismissal' | 'forever_dismissal';
}

export interface FamiliarTouchDeliveryResult {
  familiar: FamiliarState;
  delivery: {
    spellActionId: string;
    casterActorId: string;
    deliveryActorId: string;
    range: 'touch';
    reactionSpent: true;
  };
}

export interface PactChainFamiliarAttackResult {
  sequence: AttackSequenceState;
  familiar: FamiliarState;
  attackingActorId: string;
  reactionSpent: true;
}

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function exactKeys(value: JsonRecord, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length
    && actual.every((key, index) => key === wanted[index]);
}

function positiveFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function positiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : null;
}

/** Parse the complete Find Familiar primitive without consulting entity identity. */
export function parseFindFamiliarMechanicsPolicy(
  mechanicsValue: unknown,
): FindFamiliarMechanicsPolicyParseResult {
  const mechanics = record(mechanicsValue);
  const primitive = record(mechanics?.primitive);
  if (!primitive || primitive.type !== 'find_familiar') {
    return { status: 'invalid', issue: 'Find Familiar requires a find_familiar primitive' };
  }
  if (!exactKeys(primitive, ['type', 'materialCostResource', 'policy'])) {
    return { status: 'invalid', issue: 'Find Familiar primitive has missing or unknown fields' };
  }
  const materialCostResource = typeof primitive.materialCostResource === 'string'
    && primitive.materialCostResource.trim() === primitive.materialCostResource
    && primitive.materialCostResource.length > 0
    ? primitive.materialCostResource
    : null;
  const raw = record(primitive.policy);
  if (!materialCostResource || !raw
    || !exactKeys(raw, [
      'connection_range_ft',
      'reappear_range_ft',
      'ritual_casting_added_seconds',
    ])) {
    return { status: 'invalid', issue: 'Find Familiar requires an exact material resource and policy' };
  }
  const connectionRangeFt = positiveFiniteNumber(raw.connection_range_ft);
  const reappearRangeFt = positiveFiniteNumber(raw.reappear_range_ft);
  const ritualCastingAddedSeconds = positiveInteger(raw.ritual_casting_added_seconds);
  if (connectionRangeFt === null || reappearRangeFt === null
    || ritualCastingAddedSeconds === null) {
    return { status: 'invalid', issue: 'Find Familiar policy values must be positive finite ranges and whole seconds' };
  }
  return {
    status: 'valid',
    materialCostResource,
    policy: { connectionRangeFt, reappearRangeFt, ritualCastingAddedSeconds },
  };
}

function validMechanicsPolicy(value: FindFamiliarMechanicsPolicy): FindFamiliarMechanicsPolicy {
  const connectionRangeFt = positiveFiniteNumber(value?.connectionRangeFt);
  const reappearRangeFt = positiveFiniteNumber(value?.reappearRangeFt);
  const ritualCastingAddedSeconds = positiveInteger(value?.ritualCastingAddedSeconds);
  if (connectionRangeFt === null || reappearRangeFt === null
    || ritualCastingAddedSeconds === null) {
    throw new Error('Find Familiar mechanics policy is invalid');
  }
  return { connectionRangeFt, reappearRangeFt, ritualCastingAddedSeconds };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function stableId(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} requires a stable non-empty id`);
  return normalized;
}

function finiteNonNegative(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be finite and non-negative`);
  return value;
}

function nonNegativeInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer`);
  return value;
}

function policySource(policy: FindFamiliarExtensionPolicy): string {
  if (policy.kind !== 'base' && policy.kind !== 'pact_chain') {
    throw new Error('Find Familiar has an unknown extension policy');
  }
  return stableId(policy.sourceEntityId, 'Find Familiar policy source');
}

function titleFromId(id: string): string {
  return id.split('_').map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join(' ');
}

function injectedFormsById(forms: readonly unknown[]): Map<string, InjectedCr0BeastForm> {
  const result = new Map<string, InjectedCr0BeastForm>();
  const reserved = new Set<string>([
    ...FIND_FAMILIAR_BASE_FORMS,
    ...PACT_CHAIN_SPECIAL_FAMILIAR_FORMS,
  ]);
  for (const value of forms) {
    const candidate = record(value);
    if (!candidate || typeof candidate.id !== 'string'
      || typeof candidate.name !== 'string' || typeof candidate.statBlockId !== 'string') {
      throw new Error('Injected familiar form requires stable id, name, and stat block');
    }
    const id = stableId(candidate.id, 'Injected familiar form');
    const name = candidate.name.trim();
    const statBlockId = stableId(candidate.statBlockId, `${id} stat block`);
    if (!name) throw new Error(`${id} requires a non-empty familiar form name`);
    if (candidate.creatureType !== 'beast' || candidate.challengeRating !== 0) {
      throw new Error(`${id} must be a CR 0 Beast`);
    }
    if (reserved.has(id)) throw new Error(`Injected familiar form ${id} collides with a reserved form`);
    if (result.has(id)) throw new Error(`Injected familiar form ${id} is duplicated`);
    result.set(id, {
      id, name, statBlockId, creatureType: 'beast', challengeRating: 0,
    });
  }
  return result;
}

/** Validate a JSON-restored catalog before using it as external rules authority. */
export function injectedFamiliarFormCatalogIssue(value: unknown): string | null {
  const catalog = record(value);
  if (!catalog || catalog.schemaVersion !== 1
    || typeof catalog.catalogId !== 'string'
    || !catalog.catalogId.trim()
    || catalog.catalogId !== catalog.catalogId.trim()) {
    return 'Injected familiar catalog requires schema version 1 and a canonical stable id';
  }
  if (!Array.isArray(catalog.forms)) return 'Injected familiar catalog requires a forms array';
  let normalized: InjectedCr0BeastForm[];
  try {
    normalized = [...injectedFormsById(catalog.forms).values()]
      .sort((left, right) => left.id.localeCompare(right.id));
  } catch {
    return 'Injected familiar catalog contains an invalid form';
  }
  for (const [index, expected] of normalized.entries()) {
    const actual = record(catalog.forms[index]);
    if (!actual
      || actual.id !== expected.id
      || actual.name !== expected.name
      || actual.statBlockId !== expected.statBlockId
      || actual.creatureType !== 'beast'
      || actual.challengeRating !== 0) {
      return 'Injected familiar catalog must be canonical and sorted by form id';
    }
  }
  return null;
}

/** Build a deeply frozen, deterministic extension catalog for a pinned ruleset. */
export function createInjectedFamiliarFormCatalog(input: {
  catalogId: string;
  forms: readonly InjectedCr0BeastForm[];
}): InjectedFamiliarFormCatalog {
  const catalogId = stableId(input.catalogId, 'Injected familiar catalog');
  const forms = [...injectedFormsById(input.forms).values()]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((form) => Object.freeze(form));
  return Object.freeze({
    schemaVersion: 1 as const,
    catalogId,
    forms: Object.freeze(forms),
  });
}

function trustedInjectedCatalog(
  validation: FamiliarValidationContext | undefined,
): InjectedFamiliarFormCatalog | undefined {
  const catalog = validation?.injectedFormCatalog;
  if (!catalog) return undefined;
  const issue = injectedFamiliarFormCatalogIssue(catalog);
  if (issue) throw new Error(issue);
  return catalog;
}

/** Resolve one choice against the closed PHB list plus explicit CR 0 Beast extensions. */
export function resolveFamiliarForm(input: {
  formId: string;
  policy: FindFamiliarExtensionPolicy;
  validation?: FamiliarValidationContext;
}): ResolvedFamiliarForm {
  policySource(input.policy);
  const formId = stableId(input.formId, 'Familiar form');
  const catalog = trustedInjectedCatalog(input.validation);
  const injected = new Map((catalog?.forms ?? []).map((form) => [form.id, form]));
  if ((FIND_FAMILIAR_BASE_FORMS as readonly string[]).includes(formId)) {
    return {
      id: formId,
      name: titleFromId(formId),
      statBlockId: `phb2024.beast.${formId}`,
      eligibility: 'base_standard',
      baseCreatureType: 'beast',
      challengeRating: 0,
    };
  }
  const injectedForm = injected.get(formId);
  if (injectedForm) {
    return {
      id: injectedForm.id,
      name: injectedForm.name,
      statBlockId: injectedForm.statBlockId,
      eligibility: 'injected_cr0_beast',
      baseCreatureType: 'beast',
      challengeRating: 0,
      injectedFormProof: {
        catalogId: catalog!.catalogId,
        formId: injectedForm.id,
        statBlockId: injectedForm.statBlockId,
      },
    };
  }
  if ((PACT_CHAIN_SPECIAL_FAMILIAR_FORMS as readonly string[]).includes(formId)) {
    if (input.policy.kind !== 'pact_chain') {
      throw new Error(`Familiar form ${formId} requires Pact of the Chain`);
    }
    return {
      id: formId,
      name: titleFromId(formId),
      statBlockId: `phb2024.pact_chain.${formId}`,
      eligibility: 'pact_chain_special',
    };
  }
  throw new Error(`Unknown eligible familiar form ${formId}`);
}

function formIssue(
  value: unknown,
  extension: unknown,
  validation: FamiliarValidationContext | undefined,
): string | null {
  const form = record(value);
  if (!form || typeof form.id !== 'string' || !form.id.trim()
    || typeof form.name !== 'string' || !form.name.trim()
    || typeof form.statBlockId !== 'string' || !form.statBlockId.trim()) {
    return 'Familiar form must retain stable identity and stat-block provenance';
  }
  if (form.eligibility === 'base_standard') {
    if (!(FIND_FAMILIAR_BASE_FORMS as readonly string[]).includes(form.id)
      || form.statBlockId !== `phb2024.beast.${form.id}`
      || form.baseCreatureType !== 'beast' || form.challengeRating !== 0
      || form.injectedFormProof !== undefined) {
      return 'Persisted standard familiar form is not a PHB CR 0 Beast';
    }
    return null;
  }
  if (form.eligibility === 'injected_cr0_beast') {
    const reserved = (FIND_FAMILIAR_BASE_FORMS as readonly string[]).includes(form.id)
      || (PACT_CHAIN_SPECIAL_FAMILIAR_FORMS as readonly string[]).includes(form.id);
    if (reserved || form.baseCreatureType !== 'beast' || form.challengeRating !== 0) {
      return 'Persisted injected familiar form is not a CR 0 Beast';
    }
    const catalog = validation?.injectedFormCatalog;
    if (!catalog) return 'Persisted injected familiar form requires a trusted validation catalog';
    const catalogIssue = injectedFamiliarFormCatalogIssue(catalog);
    if (catalogIssue) return catalogIssue;
    const proof = record(form.injectedFormProof);
    const candidate = catalog.forms.find((entry) => entry.id === form.id);
    return proof
      && proof.catalogId === catalog.catalogId
      && proof.formId === form.id
      && proof.statBlockId === form.statBlockId
      && candidate?.name === form.name
      && candidate.statBlockId === form.statBlockId
      && candidate.creatureType === 'beast'
      && candidate.challengeRating === 0
      ? null
      : 'Persisted injected familiar form does not match its trusted catalog proof';
  }
  if (form.eligibility === 'pact_chain_special') {
    return extension === 'pact_chain'
      && (PACT_CHAIN_SPECIAL_FAMILIAR_FORMS as readonly string[]).includes(form.id)
      && form.statBlockId === `phb2024.pact_chain.${form.id}`
      && form.injectedFormProof === undefined
      ? null
      : 'Persisted special familiar form requires Pact of the Chain';
  }
  return 'Persisted familiar form has unknown eligibility';
}

function stableDistinctIds(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.every((id) => typeof id === 'string' && !!id && id === id.trim())
    && new Set(value).size === value.length;
}

/** Validate JSON-restored familiar state before it can act or spend resources. */
export function familiarStateIssue(
  value: unknown,
  validation?: FamiliarValidationContext,
): string | null {
  const state = record(value);
  if (!state || state.schemaVersion !== 1) return 'Familiar state requires schema version 1';
  if (typeof state.actorId !== 'string' || !state.actorId.trim()
    || typeof state.ownerActorId !== 'string' || !state.ownerActorId.trim()
    || typeof state.sourceEntityId !== 'string' || !state.sourceEntityId.trim()
    || state.actorId === state.ownerActorId) {
    return 'Familiar state requires distinct stable actor, owner, and source identities';
  }
  if (state.extension !== 'base' && state.extension !== 'pact_chain') {
    return 'Familiar state has an unknown extension policy';
  }
  const issue = formIssue(state.form, state.extension, validation);
  if (issue) return issue;
  if (!(FAMILIAR_SPIRIT_TYPES as readonly unknown[]).includes(state.spiritType)) {
    return 'Familiar spirit type must be Celestial, Fey, or Fiend';
  }
  if (!['present', 'pocket_dimension', 'disappeared_zero_hp'].includes(String(state.presence))) {
    return 'Familiar presence is invalid';
  }
  const initiative = record(state.initiative);
  const emptyInitiative = initiative?.mode === 'own'
    && initiative.d20Roll === null && initiative.modifier === null && initiative.total === null;
  const rolledInitiative = initiative?.mode === 'own'
    && Number.isInteger(initiative.d20Roll)
    && Number(initiative.d20Roll) >= 1
    && Number(initiative.d20Roll) <= 20
    && Number.isInteger(initiative.modifier)
    && Number.isInteger(initiative.total)
    && Number(initiative.total) === Number(initiative.d20Roll) + Number(initiative.modifier);
  if (!emptyInitiative && !rolledInitiative) return 'Familiar must retain a valid independent Initiative';
  if (typeof state.reactionAvailable !== 'boolean') return 'Familiar Reaction availability is invalid';
  if (state.sharedSenses !== null) {
    const senses = record(state.sharedSenses);
    if (!senses
      || !Number.isInteger(senses.activatedOnOwnerTurn)
      || Number(senses.activatedOnOwnerTurn) < 0
      || senses.expiresAtOwnerTurnStart !== Number(senses.activatedOnOwnerTurn) + 1
      || senses.includesFormSpecialSenses !== true) {
      return 'Familiar shared-senses expiry is invalid';
    }
  }
  const carriedItemIds = state.carriedItemIds;
  const wornItemIds = state.wornItemIds;
  if (!stableDistinctIds(carriedItemIds) || !stableDistinctIds(wornItemIds)
    || carriedItemIds.some((id) => wornItemIds.includes(id))) {
    return 'Familiar equipment IDs must be stable, distinct, and in exactly one location';
  }
  if (state.presence !== 'present'
    && (state.sharedSenses !== null || carriedItemIds.length > 0 || wornItemIds.length > 0)) {
    return 'A non-present familiar cannot retain shared senses or equipment';
  }
  if (state.allyToOwnerAndAllies !== true
    || state.actsIndependently !== true
    || state.obeysOwnerCommands !== true
    || state.canAttackNormally !== false) {
    return 'Familiar combat-role invariants are invalid';
  }
  return null;
}

function validState(
  value: FamiliarState,
  validation?: FamiliarValidationContext,
): FamiliarState {
  const issue = familiarStateIssue(value, validation);
  if (issue) throw new Error(issue);
  return value;
}

function validPolicyForState(
  familiar: FamiliarState,
  policy: FindFamiliarExtensionPolicy,
): string {
  const sourceEntityId = policySource(policy);
  if (familiar.extension !== policy.kind || familiar.sourceEntityId !== sourceEntityId) {
    throw new Error('Familiar is not owned by this extension policy');
  }
  return sourceEntityId;
}

function requireOwner(
  familiar: FamiliarState,
  ownerActorId: string,
  validation?: FamiliarValidationContext,
): string {
  const owner = stableId(ownerActorId, 'Familiar owner');
  if (validState(familiar, validation).ownerActorId !== owner) {
    throw new Error('Familiar is not owned by this actor');
  }
  return owner;
}

function requirePresent(familiar: FamiliarState): void {
  if (familiar.presence !== 'present') throw new Error('Familiar must be present');
}

function initialFamiliar(input: {
  actorId: string;
  ownerActorId: string;
  policy: FindFamiliarExtensionPolicy;
  form: ResolvedFamiliarForm;
  spiritType: FamiliarSpiritType;
}): FamiliarState {
  return {
    schemaVersion: 1,
    actorId: input.actorId,
    ownerActorId: input.ownerActorId,
    sourceEntityId: input.policy.sourceEntityId,
    extension: input.policy.kind,
    form: clone(input.form),
    spiritType: input.spiritType,
    presence: 'present',
    initiative: { mode: 'own', d20Roll: null, modifier: null, total: null },
    reactionAvailable: true,
    sharedSenses: null,
    carriedItemIds: [],
    wornItemIds: [],
    allyToOwnerAndAllies: true,
    actsIndependently: true,
    obeysOwnerCommands: true,
    canAttackNormally: false,
  };
}

/**
 * Resolve material and slot costs, then create one familiar or transform the
 * existing actor. Pact Chain changes casting time and eligible forms only:
 * its 10+ GP incense is still consumed.
 */
export function castFindFamiliar(input: {
  familiarActorId: string;
  ownerActorId: string;
  policy: FindFamiliarExtensionPolicy;
  method: FindFamiliarCastMethod;
  formId: string;
  spiritType: FamiliarSpiritType;
  validation?: FamiliarValidationContext;
  /** Required current projection: callers must explicitly prove there is no existing familiar. */
  existingFamiliar: FamiliarState | null;
  resources: FindFamiliarResources;
  incenseOfferingGp: number;
  materialCostGp: number;
  baseCastingTimeSeconds: number;
  mechanicsPolicy: FindFamiliarMechanicsPolicy;
}): FindFamiliarCastResult {
  const actorId = stableId(input.familiarActorId, 'Familiar actor');
  const ownerActorId = stableId(input.ownerActorId, 'Familiar owner');
  if (actorId === ownerActorId) throw new Error('A familiar cannot be its own owner');
  const sourceEntityId = policySource(input.policy);
  const slots = nonNegativeInteger(input.resources.level1SpellSlots, 'Level-1 spell slots');
  const incense = finiteNonNegative(input.resources.incenseGp, 'Find Familiar incense');
  const offering = finiteNonNegative(input.incenseOfferingGp, 'Find Familiar incense offering');
  const wildCompanion = input.method === 'wild_companion_magic_action';
  const materialCostGp = wildCompanion && input.materialCostGp === 0
    ? 0
    : positiveInteger(input.materialCostGp);
  const baseCastingTimeSeconds = positiveInteger(input.baseCastingTimeSeconds);
  const mechanicsPolicy = validMechanicsPolicy(input.mechanicsPolicy);
  if (materialCostGp === null || baseCastingTimeSeconds === null) {
    throw new Error('Find Familiar requires positive declared material cost and casting time');
  }
  if (offering < materialCostGp || offering > incense) {
    throw new Error(`Find Familiar consumes an available incense offering worth at least ${materialCostGp} GP`);
  }
  if (!(FAMILIAR_SPIRIT_TYPES as readonly string[]).includes(input.spiritType)) {
    throw new Error('Find Familiar requires Celestial, Fey, or Fiend spirit type');
  }
  if (!['spell_slot', 'ritual', 'pact_chain_magic_action', 'wild_companion_magic_action'].includes(input.method)) {
    throw new Error('Find Familiar has an unknown casting method');
  }
  if (input.method === 'pact_chain_magic_action' && input.policy.kind !== 'pact_chain') {
    throw new Error('Only Pact of the Chain grants the Magic-action Find Familiar cast');
  }
  if (input.method === 'wild_companion_magic_action' && input.policy.kind !== 'base') {
    throw new Error('Wild Companion uses the base familiar form policy');
  }
  if (input.method === 'wild_companion_magic_action' && input.spiritType !== 'fey') {
    throw new Error('Wild Companion always summons a Fey spirit');
  }
  const spellSlotsExpended = input.method === 'spell_slot' ? 1 : 0;
  if (spellSlotsExpended && slots < 1) throw new Error('Find Familiar spell-slot cast requires a level-1 slot');
  const form = resolveFamiliarForm({
    formId: input.formId,
    policy: { ...input.policy, sourceEntityId },
    validation: input.validation,
  });

  let familiar: FamiliarState;
  let created = true;
  let changedForm = false;
  if (input.existingFamiliar) {
    const existing = validState(input.existingFamiliar, input.validation);
    if (existing.ownerActorId !== ownerActorId || existing.actorId !== actorId) {
      throw new Error('Recasting Find Familiar must transform the owner’s existing familiar actor');
    }
    if (existing.spiritType !== input.spiritType) {
      throw new Error('Recasting Find Familiar changes form, not the familiar spirit type');
    }
    created = false;
    changedForm = existing.form.id !== form.id;
    familiar = {
      ...clone(existing),
      sourceEntityId,
      extension: input.policy.kind,
      form: clone(form),
      presence: 'present',
    };
  } else {
    familiar = initialFamiliar({
      actorId, ownerActorId, policy: { ...input.policy, sourceEntityId }, form,
      spiritType: input.spiritType,
    });
  }
  validState(familiar, input.validation);
  const castingDuration: FindFamiliarCastResult['castingDuration'] = input.method.endsWith('_magic_action')
    ? { kind: 'magic_action' }
    : input.method === 'ritual'
      ? {
        kind: 'timed',
        baseSeconds: baseCastingTimeSeconds,
        ritualAddedSeconds: mechanicsPolicy.ritualCastingAddedSeconds,
        totalSeconds: baseCastingTimeSeconds + mechanicsPolicy.ritualCastingAddedSeconds,
      }
      : {
        kind: 'timed', baseSeconds: baseCastingTimeSeconds,
        ritualAddedSeconds: 0, totalSeconds: baseCastingTimeSeconds,
      };
  return {
    familiar,
    resources: {
      level1SpellSlots: slots - spellSlotsExpended,
      incenseGp: incense - offering,
    },
    consumedIncenseGp: offering,
    spellSlotsExpended: spellSlotsExpended as 0 | 1,
    castingTime: input.method.endsWith('_magic_action')
      ? 'magic_action'
      : input.method === 'ritual' ? 'ritual' : 'one_hour',
    castingDuration,
    created,
    changedForm,
  };
}

/** Set actor-owned equipment facts without mutating a replay-restored familiar. */
export function setFamiliarEquipment(input: {
  familiar: FamiliarState;
  carriedItemIds: readonly string[];
  wornItemIds: readonly string[];
  validation?: FamiliarValidationContext;
}): FamiliarState {
  validState(input.familiar, input.validation);
  const carriedItemIds = input.carriedItemIds.map((id) => stableId(id, 'Carried familiar item'));
  const wornItemIds = input.wornItemIds.map((id) => stableId(id, 'Worn familiar item'));
  if (new Set(carriedItemIds).size !== carriedItemIds.length
    || new Set(wornItemIds).size !== wornItemIds.length
    || carriedItemIds.some((id) => wornItemIds.includes(id))) {
    throw new Error('Familiar equipment must contain distinct item IDs in exactly one location');
  }
  return {
    ...clone(input.familiar),
    carriedItemIds: [...carriedItemIds].sort(),
    wornItemIds: [...wornItemIds].sort(),
  };
}

function disappear(input: {
  familiar: FamiliarState;
  presence: Exclude<FamiliarPresence, 'present'>;
  reason: FamiliarDisappearanceResult['reason'];
  forever: boolean;
  validation?: FamiliarValidationContext;
}): FamiliarDisappearanceResult {
  const familiar = validState(input.familiar, input.validation);
  requirePresent(familiar);
  const droppedItemIds = [...familiar.carriedItemIds, ...familiar.wornItemIds]
    .sort((left, right) => left.localeCompare(right));
  return {
    familiar: input.forever ? null : {
      ...clone(familiar),
      presence: input.presence,
      sharedSenses: null,
      carriedItemIds: [],
      wornItemIds: [],
    },
    droppedItemIds,
    reason: input.reason,
  };
}

export function familiarDropsToZeroHp(
  familiar: FamiliarState,
  validation?: FamiliarValidationContext,
): FamiliarDisappearanceResult {
  return disappear({
    familiar, presence: 'disappeared_zero_hp', reason: 'zero_hp', forever: false, validation,
  });
}

export function dismissFamiliar(input: {
  familiar: FamiliarState;
  ownerActorId: string;
  mode: 'temporary' | 'forever';
  validation?: FamiliarValidationContext;
}): FamiliarDisappearanceResult {
  requireOwner(input.familiar, input.ownerActorId, input.validation);
  if (input.mode !== 'temporary' && input.mode !== 'forever') {
    throw new Error('Familiar dismissal mode must be temporary or forever');
  }
  return disappear({
    familiar: input.familiar,
    presence: 'pocket_dimension',
    reason: input.mode === 'temporary' ? 'temporary_dismissal' : 'forever_dismissal',
    forever: input.mode === 'forever',
    validation: input.validation,
  });
}

export function reappearFamiliar(input: {
  familiar: FamiliarState;
  ownerActorId: string;
  distanceFt: number;
  unoccupiedSpace: boolean;
  mechanicsPolicy: FindFamiliarMechanicsPolicy;
  validation?: FamiliarValidationContext;
}): FamiliarState {
  requireOwner(input.familiar, input.ownerActorId, input.validation);
  const distance = finiteNonNegative(input.distanceFt, 'Familiar reappearance distance');
  const policy = validMechanicsPolicy(input.mechanicsPolicy);
  if (input.familiar.presence !== 'pocket_dimension') {
    throw new Error('Only a temporarily dismissed familiar can reappear');
  }
  if (distance > policy.reappearRangeFt || input.unoccupiedSpace !== true) {
    throw new Error(`Familiar must reappear in an unoccupied space within ${policy.reappearRangeFt} feet`);
  }
  return { ...clone(input.familiar), presence: 'present' };
}

export function canCommunicateWithFamiliar(input: {
  familiar: FamiliarState;
  ownerActorId: string;
  distanceFt: number;
  mechanicsPolicy: FindFamiliarMechanicsPolicy;
  validation?: FamiliarValidationContext;
}): boolean {
  requireOwner(input.familiar, input.ownerActorId, input.validation);
  const distance = finiteNonNegative(input.distanceFt, 'Familiar telepathy distance');
  const policy = validMechanicsPolicy(input.mechanicsPolicy);
  return input.familiar.presence === 'present' && distance <= policy.connectionRangeFt;
}

export function activateFamiliarSharedSenses(input: {
  familiar: FamiliarState;
  ownerActorId: string;
  distanceFt: number;
  ownerTurn: number;
  mechanicsPolicy: FindFamiliarMechanicsPolicy;
  validation?: FamiliarValidationContext;
}): FamiliarState {
  requireOwner(input.familiar, input.ownerActorId, input.validation);
  requirePresent(input.familiar);
  const distance = finiteNonNegative(input.distanceFt, 'Familiar shared-senses distance');
  const ownerTurn = nonNegativeInteger(input.ownerTurn, 'Owner turn');
  const policy = validMechanicsPolicy(input.mechanicsPolicy);
  if (distance > policy.connectionRangeFt) {
    throw new Error(`Familiar shared senses require the familiar within ${policy.connectionRangeFt} feet`);
  }
  return {
    ...clone(input.familiar),
    sharedSenses: {
      activatedOnOwnerTurn: ownerTurn,
      expiresAtOwnerTurnStart: ownerTurn + 1,
      includesFormSpecialSenses: true,
    },
  };
}

export function familiarSharedSensesActive(input: {
  familiar: FamiliarState;
  ownerActorId: string;
  ownerTurn: number;
  validation?: FamiliarValidationContext;
}): boolean {
  requireOwner(input.familiar, input.ownerActorId, input.validation);
  const ownerTurn = nonNegativeInteger(input.ownerTurn, 'Owner turn');
  return input.familiar.presence === 'present'
    && input.familiar.sharedSenses !== null
    && ownerTurn >= input.familiar.sharedSenses.activatedOnOwnerTurn
    && ownerTurn < input.familiar.sharedSenses.expiresAtOwnerTurnStart;
}

export function startOwnerTurnForFamiliar(input: {
  familiar: FamiliarState;
  ownerActorId: string;
  ownerTurn: number;
  validation?: FamiliarValidationContext;
}): FamiliarState {
  requireOwner(input.familiar, input.ownerActorId, input.validation);
  const ownerTurn = nonNegativeInteger(input.ownerTurn, 'Owner turn');
  if (!input.familiar.sharedSenses
    || ownerTurn < input.familiar.sharedSenses.expiresAtOwnerTurnStart) {
    return clone(input.familiar);
  }
  return { ...clone(input.familiar), sharedSenses: null };
}

export function setFamiliarInitiative(input: {
  familiar: FamiliarState;
  familiarActorId: string;
  d20Roll: number;
  modifier: number;
  validation?: FamiliarValidationContext;
}): FamiliarState {
  validState(input.familiar, input.validation);
  requirePresent(input.familiar);
  if (stableId(input.familiarActorId, 'Familiar Initiative actor') !== input.familiar.actorId) {
    throw new Error('Familiar must roll its own Initiative');
  }
  if (!Number.isInteger(input.d20Roll) || input.d20Roll < 1 || input.d20Roll > 20
    || !Number.isInteger(input.modifier)) {
    throw new Error('Familiar Initiative requires an explicit d20 roll and integer modifier');
  }
  return {
    ...clone(input.familiar),
    initiative: {
      mode: 'own', d20Roll: input.d20Roll, modifier: input.modifier,
      total: input.d20Roll + input.modifier,
    },
  };
}

export function startFamiliarTurn(input: {
  familiar: FamiliarState;
  familiarActorId: string;
  validation?: FamiliarValidationContext;
}): FamiliarState {
  validState(input.familiar, input.validation);
  requirePresent(input.familiar);
  if (stableId(input.familiarActorId, 'Familiar turn actor') !== input.familiar.actorId) {
    throw new Error('Only the familiar’s own turn refreshes its Reaction');
  }
  return { ...clone(input.familiar), reactionAvailable: true };
}

export function canFamiliarUseOrdinaryAction(input: {
  familiar: FamiliarState;
  actionKind: string;
  validation?: FamiliarValidationContext;
}): boolean {
  validState(input.familiar, input.validation);
  const actionKind = stableId(input.actionKind, 'Familiar action kind').toLowerCase();
  return input.familiar.presence === 'present' && actionKind !== 'attack';
}

export function deliverTouchSpellThroughFamiliar(input: {
  familiar: FamiliarState;
  ownerActorId: string;
  distanceFt: number;
  spellActionId: string;
  spellRange: 'touch' | 'other';
  mechanicsPolicy: FindFamiliarMechanicsPolicy;
  validation?: FamiliarValidationContext;
}): FamiliarTouchDeliveryResult {
  const ownerActorId = requireOwner(input.familiar, input.ownerActorId, input.validation);
  requirePresent(input.familiar);
  const distance = finiteNonNegative(input.distanceFt, 'Familiar touch-delivery distance');
  const spellActionId = stableId(input.spellActionId, 'Touch spell action');
  const policy = validMechanicsPolicy(input.mechanicsPolicy);
  if (input.spellRange !== 'touch') throw new Error('Familiar can deliver only a Touch-range spell');
  if (distance > policy.connectionRangeFt) {
    throw new Error(`Familiar touch delivery requires the familiar within ${policy.connectionRangeFt} feet`);
  }
  if (!input.familiar.reactionAvailable) throw new Error('Familiar Reaction is unavailable');
  return {
    familiar: { ...clone(input.familiar), reactionAvailable: false },
    delivery: {
      spellActionId,
      casterActorId: ownerActorId,
      deliveryActorId: input.familiar.actorId,
      range: 'touch',
      reactionSpent: true,
    },
  };
}

/** Replace exactly one owner attack and spend the familiar's one Reaction. */
export function substitutePactChainFamiliarAttack(input: {
  familiar: FamiliarState;
  ownerActorId: string;
  policy: PactChainFindFamiliarPolicy;
  sequence: AttackSequenceState;
  familiarAttackActionId: string;
  validation?: FamiliarValidationContext;
}): PactChainFamiliarAttackResult {
  const ownerActorId = requireOwner(input.familiar, input.ownerActorId, input.validation);
  const sourceEntityId = validPolicyForState(input.familiar, input.policy);
  requirePresent(input.familiar);
  if (input.sequence.actorId !== ownerActorId) {
    throw new Error('Pact Chain can replace only its owner’s Attack-action attack');
  }
  if (!input.familiar.reactionAvailable) throw new Error('Familiar Reaction is unavailable');
  const familiarAttackActionId = stableId(input.familiarAttackActionId, 'Familiar attack action');
  const sequence = replaceSequenceAttack({
    sequence: input.sequence,
    actionId: familiarAttackActionId,
    replacementKey: PACT_CHAIN_ATTACK_REPLACEMENT_KEY,
    sourceEntityIds: [sourceEntityId, input.familiar.form.statBlockId],
  });
  return {
    sequence,
    familiar: { ...clone(input.familiar), reactionAvailable: false },
    attackingActorId: input.familiar.actorId,
    reactionSpent: true,
  };
}
