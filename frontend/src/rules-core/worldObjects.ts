import type { Ability } from './domain';
import type {
  BurningHandsObjectsPolicy,
  DetectMagicWorldPolicy,
  LightWorldPolicy,
  MinorIllusionWorldPolicy,
  ParsedMechanicsTargeting,
} from './worldSpellPolicies';

export type WorldObjectKind = 'environment' | 'item' | 'spell_effect';
export type WorldObjectSize = 'tiny' | 'small' | 'medium' | 'large' | 'huge' | 'gargantuan';
export type MagicSchool =
  | 'abjuration'
  | 'conjuration'
  | 'divination'
  | 'enchantment'
  | 'evocation'
  | 'illusion'
  | 'necromancy'
  | 'transmutation';

export interface IlluminationAttachment {
  id: string;
  sourceActorId: string;
  sourceActionId: string;
  brightRadiusFt: number;
  dimAdditionalRadiusFt: number;
  /** One hour expressed in six-second combat rounds for deterministic expiry. */
  roundsLeft: number;
  color?: string;
}

export interface IllusionState {
  form: 'sound' | 'image';
  description: string;
  spellSaveDc: number;
  studyAbility: Ability;
  studySkill: 'investigation';
  /** Present only for an image; the 2024 spell caps every side at five feet. */
  imageCubeSideFt?: number;
  discernedByActorIds: string[];
  physicallyRevealedToActorIds: string[];
}

export interface MagicalAuraState {
  /** Detect Magic discloses a school only when a spell created the effect. */
  school?: MagicSchool;
  createdBySpell: boolean;
  visible: boolean;
}

/** Explicit physical damage that can be repaired by the Mending cantrip. */
export interface ObjectBreakOrTearState {
  maxDimensionFt: number;
  repaired: boolean;
}

/** Observable food/drink facts used by Purify Food and Drink. */
export interface FoodOrDrinkState {
  kind: 'food' | 'drink';
  magical: boolean;
  poisoned: boolean;
  rotten: boolean;
}

/** A bounded flame target shared by Druidcraft and Prestidigitation. */
export interface FlameState {
  kind: 'candle' | 'torch' | 'campfire';
  lit: boolean;
}

/** One of the three plant targets named by Druidcraft's Bloom option. */
export interface BloomablePlantState {
  kind: 'flower' | 'seed_pod' | 'leaf_bud';
  bloomed: boolean;
}

export interface HazardousSubstanceState {
  kind: 'poison' | 'poisonous_creature' | 'venomous_creature' | 'magical_contagion';
  /** The exact poison, creature, or contagion kind learned by the observer. */
  specificKind: string;
}

export interface DancingLightState {
  groupId: string;
  form: 'individual' | 'medium_humanoid';
  dimRadiusFt: number;
}

export interface PrestidigitationAttachment {
  id: string;
  sourceActorId: string;
  sourceActionId: string;
  kind: 'minor_sensation' | 'magic_mark';
  description: string;
  roundsLeft: number;
}

export interface WorldObjectState {
  id: string;
  name: string;
  kind: WorldObjectKind;
  size: WorldObjectSize;
  /** Immutable content identity for this concrete item instance. */
  itemCardId?: string;
  /** Canonical attunement owner; never accepted as a command-side eligibility claim. */
  attunedToActorId?: string;
  /** Exact holder identity. Both held fields are present together or absent together. */
  heldByActorId?: string;
  heldInHand?: 'main_hand' | 'off_hand';
  ownerActorId?: string;
  carriedByActorId?: string;
  sourceActorId?: string;
  sourceActionId?: string;
  flammable?: boolean;
  unattended?: boolean;
  secured?: boolean;
  ignited?: boolean;
  displacementFt?: number;
  /** Last authoritative actor-to-object distance supplied by board/GM facts. */
  distanceFromSourceFt?: number;
  roundsLeft?: number;
  coveredByOpaqueObject?: boolean;
  illumination?: IlluminationAttachment;
  magicalAura?: MagicalAuraState;
  illusion?: IllusionState;
  breakOrTear?: ObjectBreakOrTearState;
  foodOrDrink?: FoodOrDrinkState;
  flame?: FlameState;
  plant?: BloomablePlantState;
  hazardousSubstance?: HazardousSubstanceState;
  dancingLight?: DancingLightState;
  prestidigitation?: PrestidigitationAttachment[];
  /** Source-relative expiry for effects such as Prestidigitation's Minor Creation. */
  sourceTurnEndingsLeft?: number;
  soiled?: boolean;
  tags?: string[];
}

export interface WorldObjectFacts {
  factsSource: 'scenario' | 'board' | 'gm_ruling';
  boardRevision: number;
  distanceFt: number;
  lineOfSight: boolean;
  /** Explicit board/GM membership in a declared area; core never derives geometry. */
  inArea?: boolean;
  entirelyInArea?: boolean;
  touched?: boolean;
  /** Explicit bounded volume for spells whose oracle is stated in cubic feet. */
  volumeCubicFt?: number;
}

export interface MagicBlockingLayer {
  material: 'stone' | 'common_metal' | 'lead' | 'wood' | 'dirt' | 'other';
  thicknessInches: number;
}

export type WorldObjectMutationEvent =
  | { type: 'WorldObjectCreated'; object: WorldObjectState }
  | { type: 'WorldObjectRemoved'; objectId: string; reason: string }
  | {
    type: 'WorldObjectPatched';
    objectId: string;
    patch: Partial<WorldObjectState>;
    /** JSON-safe field deletion; `undefined` would disappear from persisted events. */
    unset?: Array<keyof WorldObjectState>;
    reason: string;
  }
  | {
    type: 'WorldObjectObserved';
    objectId: string;
    actorId: string;
    observation: string;
    /** Structured, replay-visible result; observation remains the stable discriminator. */
    details?: Record<string, unknown>;
  };

export interface WorldObjectMutationResult {
  objects: Record<string, WorldObjectState>;
  events: WorldObjectMutationEvent[];
}

function cloneObject(object: WorldObjectState): WorldObjectState {
  return JSON.parse(JSON.stringify(object)) as WorldObjectState;
}

function cloneObjects(objects: Readonly<Record<string, WorldObjectState>>): Record<string, WorldObjectState> {
  return Object.fromEntries(Object.entries(objects).map(([id, object]) => [id, cloneObject(object)]));
}

const REQUIRED_WORLD_OBJECT_KEYS = new Set<keyof WorldObjectState>(['id', 'name', 'kind', 'size']);

function itemInstanceIssue(object: WorldObjectState): string | null {
  if (object.itemCardId !== undefined
    && (object.kind !== 'item' || typeof object.itemCardId !== 'string'
      || !object.itemCardId.trim())) {
    return 'World object itemCardId requires a non-blank item identity';
  }
  if (object.attunedToActorId !== undefined
    && (object.kind !== 'item' || typeof object.attunedToActorId !== 'string'
      || !object.attunedToActorId.trim())) {
    return 'World object attunement requires a non-blank item owner';
  }
  if ((object.heldByActorId === undefined) !== (object.heldInHand === undefined)
    || (object.heldByActorId !== undefined
      && (typeof object.heldByActorId !== 'string' || !object.heldByActorId.trim()
        || !['main_hand', 'off_hand'].includes(object.heldInHand ?? '')
        || object.carriedByActorId !== object.heldByActorId))) {
    return 'World object held identity must match its canonical carrier and hand';
  }
  return null;
}

/** Cross-object canonical item invariants used by live replay and schema-v5 migration. */
export function worldObjectLedgerIssue(
  objects: Readonly<Record<string, WorldObjectState>>,
  actorIds?: ReadonlySet<string>,
): string | null {
  const occupiedHands = new Set<string>();
  for (const object of Object.values(objects)) {
    const itemIssue = itemInstanceIssue(object);
    if (itemIssue) return `${object.id}: ${itemIssue}`;
    if (object.attunedToActorId && actorIds && !actorIds.has(object.attunedToActorId)) {
      return `${object.id}: attunement owner is not a world actor`;
    }
    if (!object.heldByActorId || !object.heldInHand) continue;
    if (actorIds && !actorIds.has(object.heldByActorId)) {
      return `${object.id}: holder is not a world actor`;
    }
    const key = `${object.heldByActorId}\u0000${object.heldInHand}`;
    if (occupiedHands.has(key)) {
      return `${object.id}: canonical held-item hand is already occupied`;
    }
    occupiedHands.add(key);
  }
  return null;
}

/** Apply one persisted object event; used by the canonical WorldState reducer later. */
export function evolveWorldObjectEvent(
  objects: Readonly<Record<string, WorldObjectState>>,
  event: WorldObjectMutationEvent,
): Record<string, WorldObjectState> {
  const next = cloneObjects(objects);
  if (event.type === 'WorldObjectCreated') {
    if (next[event.object.id]) throw new Error(`World object ${event.object.id} already exists`);
    const issue = itemInstanceIssue(event.object);
    if (issue) throw new Error(issue);
    next[event.object.id] = cloneObject(event.object);
    const ledgerIssue = worldObjectLedgerIssue(next);
    if (ledgerIssue) throw new Error(ledgerIssue);
    return next;
  }
  const current = next[event.objectId];
  if (!current) throw new Error(`Unknown world object ${event.objectId}`);
  if (event.type === 'WorldObjectRemoved') {
    delete next[event.objectId];
    return next;
  }
  if (event.type === 'WorldObjectObserved') return next;
  if (event.patch.id !== undefined && event.patch.id !== event.objectId) {
    throw new Error('A world-object patch cannot change object identity');
  }
  if ((Object.hasOwn(event.patch, 'itemCardId')
      && event.patch.itemCardId !== current.itemCardId)
    || event.unset?.includes('itemCardId')) {
    throw new Error('A world-object patch cannot change or unset immutable itemCardId');
  }
  const patched = { ...current, ...JSON.parse(JSON.stringify(event.patch)) as Partial<WorldObjectState> };
  for (const key of event.unset ?? []) {
    if (REQUIRED_WORLD_OBJECT_KEYS.has(key)) {
      throw new Error(`A world-object patch cannot unset required field ${key}`);
    }
    delete patched[key];
  }
  const issue = itemInstanceIssue(patched);
  if (issue) throw new Error(issue);
  next[event.objectId] = patched;
  const ledgerIssue = worldObjectLedgerIssue(next);
  if (ledgerIssue) throw new Error(ledgerIssue);
  return next;
}

export function foldWorldObjectEvents(
  objects: Readonly<Record<string, WorldObjectState>>,
  events: readonly WorldObjectMutationEvent[],
): Record<string, WorldObjectState> {
  return events.reduce(evolveWorldObjectEvent, cloneObjects(objects));
}

function validFacts(facts: WorldObjectFacts): boolean {
  return Number.isInteger(facts.boardRevision)
    && facts.boardRevision >= 0
    && Number.isFinite(facts.distanceFt)
    && facts.distanceFt >= 0;
}

/** Advance persistent spell-object durations without reading wall-clock time. */
export function advanceWorldObjectRounds(input: {
  objects: Readonly<Record<string, WorldObjectState>>;
  rounds: number;
}): WorldObjectMutationResult {
  if (!Number.isInteger(input.rounds) || input.rounds < 0) {
    throw new Error('World-object time passage requires a non-negative integer round count');
  }
  const objects = cloneObjects(input.objects);
  const events: WorldObjectMutationEvent[] = [];
  if (input.rounds === 0) return { objects, events };

  for (const object of Object.values(objects).sort((left, right) => left.id.localeCompare(right.id))) {
    if (object.roundsLeft !== undefined) {
      if (object.roundsLeft <= input.rounds) {
        delete objects[object.id];
        events.push({
          type: 'WorldObjectRemoved', objectId: object.id, reason: 'duration_expired',
        });
        continue;
      }
      object.roundsLeft -= input.rounds;
      events.push({
        type: 'WorldObjectPatched', objectId: object.id,
        patch: { roundsLeft: object.roundsLeft }, reason: 'duration_advanced',
      });
    }
    if (object.prestidigitation?.length) {
      const remaining = object.prestidigitation
        .filter((attachment) => attachment.roundsLeft > input.rounds)
        .map((attachment) => ({
          ...attachment,
          roundsLeft: attachment.roundsLeft - input.rounds,
        }));
      if (remaining.length !== object.prestidigitation.length) {
        if (remaining.length) object.prestidigitation = remaining;
        else delete object.prestidigitation;
        events.push({
          type: 'WorldObjectPatched',
          objectId: object.id,
          patch: remaining.length ? { prestidigitation: remaining } : {},
          ...(remaining.length ? {} : { unset: ['prestidigitation'] }),
          reason: 'prestidigitation_duration_expired',
        });
      } else {
        object.prestidigitation = remaining;
        events.push({
          type: 'WorldObjectPatched',
          objectId: object.id,
          patch: { prestidigitation: remaining },
          reason: 'prestidigitation_duration_advanced',
        });
      }
    }
    if (!object.illumination) continue;
    if (object.illumination.roundsLeft <= input.rounds) {
      delete object.illumination;
      events.push({
        type: 'WorldObjectPatched', objectId: object.id,
        patch: {}, unset: ['illumination'], reason: 'light_duration_expired',
      });
      continue;
    }
    object.illumination.roundsLeft -= input.rounds;
    events.push({
      type: 'WorldObjectPatched', objectId: object.id,
      patch: { illumination: cloneObject(object).illumination }, reason: 'light_duration_advanced',
    });
  }
  return { objects, events };
}

export function illuminationFromObject(object: WorldObjectState): IlluminationAttachment | null {
  if (object.coveredByOpaqueObject || !object.illumination) return null;
  const illuminated = cloneObject({
    id: object.id,
    name: object.name,
    kind: object.kind,
    size: object.size,
    illumination: object.illumination,
  });
  return illuminated.illumination!;
}

/** Attach Light and remove only the previous Light owned by the same caster. */
export function attachLight(input: {
  objects: Readonly<Record<string, WorldObjectState>>;
  targetObjectId: string;
  facts: WorldObjectFacts;
  sourceActorId: string;
  sourceActionId: string;
  attachmentId: string;
  policy: LightWorldPolicy;
  targeting: ParsedMechanicsTargeting;
}): WorldObjectMutationResult {
  const target = input.objects[input.targetObjectId];
  if (!target) throw new Error(`Unknown world object ${input.targetObjectId}`);
  if (!validFacts(input.facts)
    || input.facts.distanceFt > input.targeting.rangeFt
    || (input.targeting.requiresTouch
      && (input.facts.touched !== true || input.facts.distanceFt !== 0))) {
    throw new Error('Light requires explicit object facts within its declared targeting geometry');
  }
  const sizes: WorldObjectSize[] = ['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan'];
  if (sizes.indexOf(target.size) > sizes.indexOf(input.policy.maxObjectSize)) {
    throw new Error(`Light cannot target an object larger than ${input.policy.maxObjectSize}`);
  }
  if (input.policy.excludeCarriedByOther
    && target.carriedByActorId
    && target.carriedByActorId !== input.sourceActorId) {
    throw new Error('Light cannot target an object worn or carried by someone else');
  }

  const objects = cloneObjects(input.objects);
  const events: WorldObjectMutationEvent[] = [];
  const existing = Object.values(objects)
    .filter((object) => object.illumination?.sourceActorId === input.sourceActorId
      && object.illumination.sourceActionId === input.sourceActionId)
    .sort((left, right) => left.id.localeCompare(right.id));
  const replacements = existing.slice(0, Math.max(0, existing.length - input.policy.maxActivePerSource + 1));
  for (const object of replacements) {
    delete object.illumination;
    events.push({
      type: 'WorldObjectPatched',
      objectId: object.id,
      patch: {},
      unset: ['illumination'],
      reason: 'light_replaced',
    });
  }
  const illumination: IlluminationAttachment = {
    id: input.attachmentId,
    sourceActorId: input.sourceActorId,
    sourceActionId: input.sourceActionId,
    brightRadiusFt: input.policy.brightRadiusFt,
    dimAdditionalRadiusFt: input.policy.dimAdditionalRadiusFt,
    roundsLeft: input.policy.durationRounds,
  };
  objects[target.id] = { ...objects[target.id], illumination };
  events.push({
    type: 'WorldObjectPatched',
    objectId: target.id,
    patch: { illumination },
    reason: 'light_attached',
  });
  return { objects, events };
}

/** Burning Hands ignites explicitly included flammable objects that are not worn or carried. */
export function igniteBurningHandsObjects(input: {
  objects: Readonly<Record<string, WorldObjectState>>;
  factsByObject: Readonly<Record<string, WorldObjectFacts | undefined>>;
  policy: BurningHandsObjectsPolicy;
  targeting: ParsedMechanicsTargeting;
}): WorldObjectMutationResult {
  const objects = cloneObjects(input.objects);
  const events: WorldObjectMutationEvent[] = [];
  for (const objectId of Object.keys(input.factsByObject).sort()) {
    const object = objects[objectId];
    const facts = input.factsByObject[objectId];
    const areaSizeFt = input.targeting.area?.sizeFt;
    if (!object || !facts || !validFacts(facts)
      || facts.distanceFt > input.targeting.rangeFt
      || (areaSizeFt !== undefined && facts.distanceFt > areaSizeFt)
      || (input.policy.requireInArea && facts.inArea !== true)) continue;
    if ((input.policy.requireFlammable && !object.flammable)
      || (input.policy.excludeCarried && object.carriedByActorId)
      || object.ignited) continue;
    object.ignited = true;
    events.push({
      type: 'WorldObjectPatched',
      objectId,
      patch: { ignited: true },
      reason: 'burning_hands_ignition',
    });
  }
  return { objects, events };
}

export interface ForcedObjectPushPolicy {
  distanceFt: number;
  maxObjectDistanceFt: number;
  areaRequirement: 'entirely_in_area';
  excludeSecured: boolean;
  excludeCarried: boolean;
}

/** Apply a data-owned forced-object push policy to an explicit area snapshot. */
export function pushWorldObjects(input: {
  objects: Readonly<Record<string, WorldObjectState>>;
  factsByObject: Readonly<Record<string, WorldObjectFacts | undefined>>;
  policy: ForcedObjectPushPolicy;
}): WorldObjectMutationResult {
  if (!Number.isFinite(input.policy.distanceFt) || input.policy.distanceFt <= 0
    || !Number.isFinite(input.policy.maxObjectDistanceFt)
    || input.policy.maxObjectDistanceFt <= 0
    || input.policy.areaRequirement !== 'entirely_in_area') {
    throw new Error('Forced object push policy is malformed');
  }
  const objects = cloneObjects(input.objects);
  const events: WorldObjectMutationEvent[] = [];
  for (const objectId of Object.keys(input.factsByObject).sort()) {
    const object = objects[objectId];
    const facts = input.factsByObject[objectId];
    if (!object || !facts || !validFacts(facts)
      || facts.entirelyInArea !== true
      || facts.distanceFt > input.policy.maxObjectDistanceFt) continue;
    if ((input.policy.excludeSecured && object.secured === true)
      || (input.policy.excludeCarried && object.carriedByActorId)) continue;
    const displacementFt = (object.displacementFt ?? 0) + input.policy.distanceFt;
    object.displacementFt = displacementFt;
    events.push({
      type: 'WorldObjectPatched',
      objectId,
      patch: { displacementFt },
      reason: 'forced_object_push',
    });
  }
  return { objects, events };
}

export function magicBlockedBy(
  layers: readonly MagicBlockingLayer[],
  policy: DetectMagicWorldPolicy['blockers'],
): boolean {
  return layers.some((layer) => {
    if (!Number.isFinite(layer.thicknessInches) || layer.thicknessInches < 0) return true;
    const threshold = policy[layer.material];
    if (!threshold) return false;
    return threshold.comparison === 'gte'
      ? layer.thicknessInches >= threshold.thresholdInches
      : layer.thicknessInches > threshold.thresholdInches;
  });
}

export interface DetectMagicObservation {
  sensed: boolean;
  auraVisible: boolean;
  school?: MagicSchool;
}

export function observeDetectMagic(input: {
  object: WorldObjectState;
  facts: WorldObjectFacts;
  blockingLayers: readonly MagicBlockingLayer[];
  revealAura: boolean;
  policy: DetectMagicWorldPolicy;
  targeting: ParsedMechanicsTargeting;
}): DetectMagicObservation {
  const senseRangeFt = input.targeting.area?.radiusFt;
  if (senseRangeFt === undefined) throw new Error('Detect Magic requires a numeric sensing radius');
  const aura = input.object.magicalAura;
  const sensed = validFacts(input.facts)
    && input.facts.distanceFt <= senseRangeFt
    && !magicBlockedBy(input.blockingLayers, input.policy.blockers)
    && aura !== undefined;
  if (!sensed) return { sensed: false, auraVisible: false };
  const auraVisible = input.revealAura
    && (!input.policy.auraRequiresLineOfSight || input.facts.lineOfSight)
    && aura?.visible === true;
  return {
    sensed: true,
    auraVisible,
    ...(auraVisible
      && (!input.policy.revealSpellSchoolOnly || aura?.createdBySpell === true)
      && aura.school
      ? { school: aura.school }
      : {}),
  };
}

export function createMinorIllusion(input: {
  objects: Readonly<Record<string, WorldObjectState>>;
  id: string;
  sourceActorId: string;
  sourceActionId: string;
  form: 'sound' | 'image';
  description: string;
  spellSaveDc: number;
  imageCubeSideFt?: number;
  policy: MinorIllusionWorldPolicy;
}): WorldObjectMutationResult {
  if (input.objects[input.id]) throw new Error(`World object ${input.id} already exists`);
  if (!input.description.trim()) throw new Error('Minor Illusion description is required');
  if (!Number.isInteger(input.spellSaveDc) || input.spellSaveDc < 1) {
    throw new Error('Minor Illusion requires a positive integer spell save DC');
  }
  if (input.form === 'image'
    && (!Number.isFinite(input.imageCubeSideFt)
      || input.imageCubeSideFt! <= 0
      || input.imageCubeSideFt! > input.policy.imageMaxCubeSideFt)) {
    throw new Error(`Minor Illusion image requires an explicit cube side up to ${input.policy.imageMaxCubeSideFt} feet`);
  }
  const objects = cloneObjects(input.objects);
  const events: WorldObjectMutationEvent[] = [];
  const existingIllusions = Object.values(objects)
    .filter((existing) => existing.illusion
      && existing.sourceActorId === input.sourceActorId
      && existing.sourceActionId === input.sourceActionId)
    .sort((left, right) => left.id.localeCompare(right.id));
  const replacements = existingIllusions.slice(
    0,
    Math.max(0, existingIllusions.length - input.policy.maxActivePerSource + 1),
  );
  for (const existing of replacements) {
    delete objects[existing.id];
    events.push({
      type: 'WorldObjectRemoved',
      objectId: existing.id,
      reason: 'minor_illusion_replaced',
    });
  }
  const object: WorldObjectState = {
    id: input.id,
    name: 'Minor Illusion',
    kind: 'spell_effect',
    size: 'medium',
    sourceActorId: input.sourceActorId,
    sourceActionId: input.sourceActionId,
    roundsLeft: input.policy.durationRounds,
    magicalAura: { school: 'illusion', createdBySpell: true, visible: true },
    illusion: {
      form: input.form,
      description: input.description.trim(),
      spellSaveDc: input.spellSaveDc,
      studyAbility: input.policy.studyAbility,
      studySkill: input.policy.studySkill,
      ...(input.form === 'image' ? { imageCubeSideFt: input.imageCubeSideFt } : {}),
      discernedByActorIds: [],
      physicallyRevealedToActorIds: [],
    },
  };
  return {
    objects: { ...objects, [input.id]: object },
    events: [...events, { type: 'WorldObjectCreated', object: cloneObject(object) }],
  };
}

function addObserver(values: readonly string[], actorId: string): string[] {
  return [...new Set([...values, actorId])].sort((left, right) => left.localeCompare(right));
}

export function studyMinorIllusion(input: {
  objects: Readonly<Record<string, WorldObjectState>>;
  objectId: string;
  actorId: string;
  checkTotal: number;
}): WorldObjectMutationResult {
  const object = input.objects[input.objectId];
  if (!object?.illusion) throw new Error(`${input.objectId} is not an illusion`);
  const objects = cloneObjects(input.objects);
  const events: WorldObjectMutationEvent[] = [];
  if (input.checkTotal >= object.illusion.spellSaveDc) {
    const discernedByActorIds = addObserver(object.illusion.discernedByActorIds, input.actorId);
    objects[input.objectId].illusion = { ...objects[input.objectId].illusion!, discernedByActorIds };
    events.push({
      type: 'WorldObjectPatched',
      objectId: input.objectId,
      patch: { illusion: objects[input.objectId].illusion },
      reason: 'minor_illusion_studied',
    });
    events.push({
      type: 'WorldObjectObserved',
      objectId: input.objectId,
      actorId: input.actorId,
      observation: 'illusion_discerned',
    });
  }
  return { objects, events };
}

export function physicallyRevealMinorIllusion(input: {
  objects: Readonly<Record<string, WorldObjectState>>;
  objectId: string;
  actorId: string;
}): WorldObjectMutationResult {
  const object = input.objects[input.objectId];
  if (!object?.illusion) throw new Error(`${input.objectId} is not an illusion`);
  if (object.illusion.form !== 'image') {
    throw new Error(`${input.objectId} is a sound illusion and cannot be physically revealed`);
  }
  const objects = cloneObjects(input.objects);
  const physicallyRevealedToActorIds = addObserver(
    object.illusion.physicallyRevealedToActorIds,
    input.actorId,
  );
  objects[input.objectId].illusion = { ...objects[input.objectId].illusion!, physicallyRevealedToActorIds };
  return {
    objects,
    events: [
      {
        type: 'WorldObjectPatched',
        objectId: input.objectId,
        patch: { illusion: objects[input.objectId].illusion },
        reason: 'minor_illusion_physical_interaction',
      },
      {
        type: 'WorldObjectObserved',
        objectId: input.objectId,
        actorId: input.actorId,
        observation: 'illusion_physically_revealed',
      },
    ],
  };
}
