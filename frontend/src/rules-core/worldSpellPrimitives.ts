import {
  evolveWorldObjectEvent,
  magicBlockedBy,
  type MagicBlockingLayer,
  type PrestidigitationAttachment,
  type WorldObjectFacts,
  type WorldObjectMutationEvent,
  type WorldObjectMutationResult,
  type WorldObjectSize,
  type WorldObjectState,
} from './worldObjects';
import type {
  DancingLightsWorldPolicy,
  DetectPoisonDiseaseWorldPolicy,
  DruidcraftWorldPolicy,
  MendingWorldPolicy,
  ParsedMechanicsTargeting,
  PrestidigitationWorldPolicy,
  PurifyFoodDrinkWorldPolicy,
} from './worldSpellPolicies';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function stableId(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} requires a stable non-empty id`);
  return normalized;
}

function boundedNumber(value: number, minimum: number, maximum: number, label: string): number {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

function validFacts(facts: WorldObjectFacts): boolean {
  return ['scenario', 'board', 'gm_ruling'].includes(facts.factsSource)
    && Number.isInteger(facts.boardRevision)
    && facts.boardRevision >= 0
    && Number.isFinite(facts.distanceFt)
    && facts.distanceFt >= 0
    && typeof facts.lineOfSight === 'boolean';
}

function requireFacts(
  facts: WorldObjectFacts,
  label: string,
  options: { maxRangeFt?: number; touched?: true; maxVolumeCubicFt?: number } = {},
): void {
  if (!validFacts(facts)) throw new Error(`${label} requires valid explicit world facts`);
  if (options.maxRangeFt !== undefined && facts.distanceFt > options.maxRangeFt) {
    throw new Error(`${label} target is outside ${options.maxRangeFt} feet`);
  }
  if (options.touched && (facts.touched !== true || facts.distanceFt !== 0)) {
    throw new Error(`${label} requires a touched object at distance 0`);
  }
  if (options.maxVolumeCubicFt !== undefined
    && (!Number.isFinite(facts.volumeCubicFt)
      || facts.volumeCubicFt! < 0
      || facts.volumeCubicFt! > options.maxVolumeCubicFt)) {
    throw new Error(`${label} requires volume at most ${options.maxVolumeCubicFt} cubic foot`);
  }
}

function mutationBuilder(initial: Readonly<Record<string, WorldObjectState>>) {
  let objects = clone(initial);
  const events: WorldObjectMutationEvent[] = [];
  return {
    apply(event: WorldObjectMutationEvent): void {
      objects = evolveWorldObjectEvent(objects, event);
      events.push(clone(event));
    },
    result(): WorldObjectMutationResult {
      return { objects, events };
    },
    objects(): Readonly<Record<string, WorldObjectState>> {
      return objects;
    },
  };
}

export interface DancingLightPlacement {
  id: string;
  distanceFromCasterFt: number;
  /** Required for every individual light when more than one remains. */
  withinRequiredSeparation?: boolean;
}

export function createDancingLights(input: {
  objects: Readonly<Record<string, WorldObjectState>>;
  groupId: string;
  sourceActorId: string;
  sourceActionId: string;
  form: 'individual' | 'medium_humanoid';
  placements: readonly DancingLightPlacement[];
  policy: DancingLightsWorldPolicy;
  targeting: ParsedMechanicsTargeting;
}): WorldObjectMutationResult {
  const groupId = stableId(input.groupId, 'Dancing Lights group');
  const sourceActorId = stableId(input.sourceActorId, 'Dancing Lights source actor');
  const sourceActionId = stableId(input.sourceActionId, 'Dancing Lights source action');
  const requiredCount = input.form === 'medium_humanoid'
    ? input.policy.combinedFormObjectCount
    : undefined;
  if (input.placements.length < input.policy.minIndividualLights
    || input.placements.length > input.policy.maxIndividualLights
    || (requiredCount !== undefined && input.placements.length !== requiredCount)) {
    throw new Error(input.form === 'medium_humanoid'
      ? 'Dancing Lights Medium form requires exactly one combined-light object'
      : `Dancing Lights requires ${input.policy.minIndividualLights} to ${input.policy.maxIndividualLights} individual lights`);
  }
  const ids = input.placements.map((placement) => stableId(placement.id, 'Dancing Light'));
  if (new Set(ids).size !== ids.length) throw new Error('Dancing Light ids must be distinct');
  for (const [index, placement] of input.placements.entries()) {
    boundedNumber(
      placement.distanceFromCasterFt,
      0,
      input.targeting.rangeFt,
      `${ids[index]} caster distance`,
    );
    if (input.form === 'individual' && input.placements.length > 1
      && placement.withinRequiredSeparation !== true) {
      throw new Error(`${ids[index]} must be within ${input.policy.requiredSeparationFt} feet of another Dancing Light`);
    }
  }

  const builder = mutationBuilder(input.objects);
  for (const object of Object.values(builder.objects()).sort((left, right) => left.id.localeCompare(right.id))) {
    if (object.dancingLight
      && object.sourceActorId === sourceActorId
      && object.sourceActionId === sourceActionId) {
      builder.apply({
        type: 'WorldObjectRemoved',
        objectId: object.id,
        reason: 'dancing_lights_replaced',
      });
    }
  }
  for (const [index, placement] of input.placements.entries()) {
    const id = ids[index];
    if (builder.objects()[id]) throw new Error(`World object ${id} already exists`);
    const object: WorldObjectState = {
      id,
      name: input.form === 'medium_humanoid' ? 'Dancing Lights form' : `Dancing Light ${index + 1}`,
      kind: 'spell_effect',
      size: input.form === 'medium_humanoid' ? 'medium' : 'tiny',
      sourceActorId,
      sourceActionId,
      distanceFromSourceFt: placement.distanceFromCasterFt,
      roundsLeft: input.policy.durationRounds,
      magicalAura: { school: 'illusion', createdBySpell: true, visible: true },
      dancingLight: { groupId, form: input.form, dimRadiusFt: input.policy.dimRadiusFt },
      tags: ['dancing_lights', `dim_light_${input.policy.dimRadiusFt}_ft`],
    };
    builder.apply({ type: 'WorldObjectCreated', object });
  }
  return builder.result();
}

export interface DancingLightMovementFacts {
  lightId: string;
  movementFt: number;
  distanceFromCasterFt: number;
  withinRequiredSeparation?: boolean;
}

/** Resolve the spell's Bonus Action move from complete post-move board facts. */
export function moveDancingLights(input: {
  objects: Readonly<Record<string, WorldObjectState>>;
  sourceActorId: string;
  groupId: string;
  resultingFacts: readonly DancingLightMovementFacts[];
  policy: DancingLightsWorldPolicy;
  targeting: ParsedMechanicsTargeting;
}): WorldObjectMutationResult {
  const group = Object.values(input.objects)
    .filter((object) => object.sourceActorId === input.sourceActorId
      && object.dancingLight?.groupId === input.groupId)
    .sort((left, right) => left.id.localeCompare(right.id));
  if (!group.length) throw new Error(`Unknown Dancing Lights group ${input.groupId}`);
  const factIds = input.resultingFacts.map((facts) => stableId(facts.lightId, 'Dancing Light movement'));
  if (new Set(factIds).size !== factIds.length
    || factIds.length !== group.length
    || group.some((object) => !factIds.includes(object.id))) {
    throw new Error('Dancing Lights movement requires one distinct post-move fact per light');
  }
  for (const facts of input.resultingFacts) {
    boundedNumber(facts.movementFt, 0, input.policy.maxMoveFt, `${facts.lightId} movement`);
    if (!Number.isFinite(facts.distanceFromCasterFt) || facts.distanceFromCasterFt < 0) {
      throw new Error(`${facts.lightId} caster distance must be non-negative`);
    }
  }
  const byId = new Map(input.resultingFacts.map((facts) => [facts.lightId, facts]));
  const survivors = group.filter((object) => (
    byId.get(object.id)!.distanceFromCasterFt <= input.targeting.rangeFt
  ));
  if (group[0].dancingLight?.form === 'individual' && survivors.length > 1) {
    for (const object of survivors) {
      if (byId.get(object.id)?.withinRequiredSeparation !== true) {
        throw new Error(`${object.id} must remain within ${input.policy.requiredSeparationFt} feet of another Dancing Light`);
      }
    }
  }

  const builder = mutationBuilder(input.objects);
  for (const object of group) {
    const facts = byId.get(object.id)!;
    if (facts.distanceFromCasterFt > input.targeting.rangeFt) {
      builder.apply({
        type: 'WorldObjectRemoved',
        objectId: object.id,
        reason: 'dancing_light_left_spell_range',
      });
      continue;
    }
    builder.apply({
      type: 'WorldObjectPatched',
      objectId: object.id,
      patch: { distanceFromSourceFt: facts.distanceFromCasterFt },
      reason: 'dancing_lights_bonus_action_move',
    });
  }
  return builder.result();
}

export type DruidcraftOption =
  | {
    kind: 'weather_sensor'; id: string; prediction: string; facts: WorldObjectFacts;
  }
  | {
    kind: 'bloom'; objectId: string; facts: WorldObjectFacts;
  }
  | {
    kind: 'sensory_effect'; id: string; description: string; cubeSideFt: number; facts: WorldObjectFacts;
  }
  | {
    kind: 'fire_play'; objectId: string; operation: 'light' | 'snuff'; facts: WorldObjectFacts;
  };

export function resolveDruidcraft(input: {
  objects: Readonly<Record<string, WorldObjectState>>;
  sourceActorId: string;
  sourceActionId: string;
  option: DruidcraftOption;
  policy: DruidcraftWorldPolicy;
  targeting: ParsedMechanicsTargeting;
}): WorldObjectMutationResult {
  stableId(input.sourceActorId, 'Druidcraft source actor');
  stableId(input.sourceActionId, 'Druidcraft source action');
  requireFacts(input.option.facts, 'Druidcraft', { maxRangeFt: input.targeting.rangeFt });
  const builder = mutationBuilder(input.objects);
  switch (input.option.kind) {
    case 'weather_sensor': {
      const id = stableId(input.option.id, 'Druidcraft Weather Sensor');
      const prediction = input.option.prediction.trim();
      if (!prediction) throw new Error('Druidcraft Weather Sensor requires a prediction');
      const object: WorldObjectState = {
        id,
        name: `Прогноз погоды: ${prediction}`,
        kind: 'spell_effect',
        size: 'tiny',
        sourceActorId: input.sourceActorId,
        sourceActionId: input.sourceActionId,
        roundsLeft: input.policy.weatherDurationRounds,
        magicalAura: { school: 'transmutation', createdBySpell: true, visible: true },
        tags: ['druidcraft', 'weather_sensor', `prediction:${prediction}`],
      };
      builder.apply({ type: 'WorldObjectCreated', object });
      break;
    }
    case 'bloom': {
      const target = builder.objects()[input.option.objectId];
      if (!target?.plant) throw new Error('Druidcraft Bloom requires a flower, seed pod, or leaf bud');
      builder.apply({
        type: 'WorldObjectPatched',
        objectId: target.id,
        patch: { plant: { ...target.plant, bloomed: true } },
        reason: 'druidcraft_bloom',
      });
      break;
    }
    case 'sensory_effect': {
      const id = stableId(input.option.id, 'Druidcraft Sensory Effect');
      const description = input.option.description.trim();
      if (!description) throw new Error('Druidcraft Sensory Effect requires a description');
      boundedNumber(
        input.option.cubeSideFt,
        0,
        input.policy.sensoryCubeSideFt,
        'Druidcraft Sensory Effect cube side',
      );
      const object: WorldObjectState = {
        id,
        name: description,
        kind: 'spell_effect',
        size: 'medium',
        sourceActorId: input.sourceActorId,
        sourceActionId: input.sourceActionId,
        magicalAura: { school: 'transmutation', createdBySpell: true, visible: true },
        tags: ['druidcraft', 'instantaneous_sensory_effect'],
      };
      builder.apply({ type: 'WorldObjectCreated', object });
      builder.apply({
        type: 'WorldObjectRemoved', objectId: id, reason: 'instantaneous_effect_completed',
      });
      break;
    }
    case 'fire_play': {
      const target = builder.objects()[input.option.objectId];
      if (!target?.flame) throw new Error('Druidcraft Fire Play requires a candle, torch, or campfire');
      builder.apply({
        type: 'WorldObjectPatched',
        objectId: target.id,
        patch: { flame: { ...target.flame, lit: input.option.operation === 'light' } },
        reason: 'druidcraft_fire_play',
      });
      break;
    }
  }
  return builder.result();
}

export function mendWorldObject(input: {
  objects: Readonly<Record<string, WorldObjectState>>;
  objectId: string;
  facts: WorldObjectFacts;
  policy: MendingWorldPolicy;
  targeting: ParsedMechanicsTargeting;
}): WorldObjectMutationResult {
  requireFacts(input.facts, 'Mending', {
    maxRangeFt: input.targeting.rangeFt,
    ...(input.targeting.requiresTouch ? { touched: true as const } : {}),
  });
  const target = input.objects[input.objectId];
  if (!target?.breakOrTear) throw new Error('Mending requires one explicit break or tear');
  if (target.breakOrTear.repaired) throw new Error('Mending requires an unrepaired break or tear');
  if (!Number.isFinite(target.breakOrTear.maxDimensionFt)
    || target.breakOrTear.maxDimensionFt < 0
    || target.breakOrTear.maxDimensionFt > input.policy.maxBreakDimensionFt) {
    throw new Error(`Mending cannot repair a break or tear larger than ${input.policy.maxBreakDimensionFt} feet`);
  }
  const builder = mutationBuilder(input.objects);
  builder.apply({
    type: 'WorldObjectPatched',
    objectId: target.id,
    patch: { breakOrTear: { ...target.breakOrTear, repaired: true } },
    reason: 'mending_repaired_break_or_tear',
  });
  return builder.result();
}

export interface DetectPoisonAndDiseaseObservation {
  sensed: boolean;
  locationKnown: boolean;
  kind?: string;
}

export function observeDetectPoisonAndDisease(input: {
  object: WorldObjectState;
  facts: WorldObjectFacts;
  blockingLayers: readonly MagicBlockingLayer[];
  policy: DetectPoisonDiseaseWorldPolicy;
  targeting: ParsedMechanicsTargeting;
}): DetectPoisonAndDiseaseObservation {
  const senseRangeFt = input.targeting.area?.radiusFt;
  if (senseRangeFt === undefined) {
    throw new Error('Detect Poison and Disease requires a numeric sensing radius');
  }
  const sensed = validFacts(input.facts)
    && input.facts.distanceFt <= senseRangeFt
    && !magicBlockedBy(input.blockingLayers, input.policy.blockers)
    && input.object.hazardousSubstance !== undefined;
  if (!sensed) return { sensed: false, locationKnown: false };
  return {
    sensed: true,
    locationKnown: true,
    kind: input.object.hazardousSubstance!.specificKind,
  };
}

export function purifyFoodAndDrink(input: {
  objects: Readonly<Record<string, WorldObjectState>>;
  sphereCenterDistanceFt: number;
  factsByObject: Readonly<Record<string, WorldObjectFacts>>;
  policy: PurifyFoodDrinkWorldPolicy;
  targeting: ParsedMechanicsTargeting;
}): WorldObjectMutationResult {
  boundedNumber(
    input.sphereCenterDistanceFt,
    0,
    input.targeting.rangeFt,
    'Purify Food and Drink sphere center',
  );
  const builder = mutationBuilder(input.objects);
  for (const objectId of Object.keys(input.factsByObject).sort()) {
    const target = builder.objects()[objectId];
    if (!target) throw new Error(`Unknown world object ${objectId}`);
    const facts = input.factsByObject[objectId];
    requireFacts(facts, `Purify Food and Drink ${objectId}`);
    if ((input.policy.requireInArea && facts.inArea !== true)
      || !target.foodOrDrink
      || (input.policy.excludeMagical && target.foodOrDrink.magical)) continue;
    if (!target.foodOrDrink.poisoned && !target.foodOrDrink.rotten) continue;
    builder.apply({
      type: 'WorldObjectPatched',
      objectId,
      patch: {
        foodOrDrink: { ...target.foodOrDrink, poisoned: false, rotten: false },
      },
      reason: 'purify_food_and_drink',
    });
  }
  return builder.result();
}

export type PrestidigitationOption =
  | {
    kind: 'sensory_effect'; id: string; description: string; facts: WorldObjectFacts;
  }
  | {
    kind: 'fire_play'; objectId: string; operation: 'light' | 'snuff'; facts: WorldObjectFacts;
  }
  | {
    kind: 'clean_or_soil'; objectId: string; operation: 'clean' | 'soil'; facts: WorldObjectFacts;
  }
  | {
    kind: 'minor_sensation'; objectId: string; id: string; description: string;
    facts: WorldObjectFacts; replaceEffectId?: string;
  }
  | {
    kind: 'magic_mark'; objectId: string; id: string; description: string;
    facts: WorldObjectFacts; replaceEffectId?: string;
  }
  | {
    kind: 'minor_creation'; id: string; description: string; size: WorldObjectSize;
    fitsInHand: boolean; facts: WorldObjectFacts; replaceEffectId?: string;
  };

function activePrestidigitationEffects(
  objects: Readonly<Record<string, WorldObjectState>>,
  sourceActorId: string,
): Array<{ id: string; objectId: string; kind: 'attachment' | 'creation' }> {
  return Object.values(objects).flatMap((object) => {
    const attachments = (object.prestidigitation ?? [])
      .filter((effect) => effect.sourceActorId === sourceActorId)
      .map((effect) => ({ id: effect.id, objectId: object.id, kind: 'attachment' as const }));
    const creation = object.sourceActorId === sourceActorId
      && object.tags?.includes('prestidigitation:minor_creation')
      ? [{ id: object.id, objectId: object.id, kind: 'creation' as const }]
      : [];
    return [...attachments, ...creation];
  }).sort((left, right) => left.id.localeCompare(right.id));
}

function replacePrestidigitationEffect(input: {
  builder: ReturnType<typeof mutationBuilder>;
  sourceActorId: string;
  effectId: string;
}): void {
  const match = activePrestidigitationEffects(
    input.builder.objects(), input.sourceActorId,
  ).find((effect) => effect.id === input.effectId);
  if (!match) throw new Error(`Unknown source-owned Prestidigitation effect ${input.effectId}`);
  if (match.kind === 'creation') {
    input.builder.apply({
      type: 'WorldObjectRemoved', objectId: match.objectId, reason: 'prestidigitation_replaced',
    });
    return;
  }
  const object = input.builder.objects()[match.objectId];
  const remaining = object.prestidigitation!.filter((effect) => effect.id !== match.id);
  input.builder.apply({
    type: 'WorldObjectPatched',
    objectId: match.objectId,
    patch: remaining.length ? { prestidigitation: remaining } : {},
    ...(remaining.length ? {} : { unset: ['prestidigitation'] }),
    reason: 'prestidigitation_replaced',
  });
}

function preparePrestidigitationSlot(input: {
  builder: ReturnType<typeof mutationBuilder>;
  sourceActorId: string;
  replaceEffectId?: string;
  policy: PrestidigitationWorldPolicy;
}): void {
  if (input.replaceEffectId) replacePrestidigitationEffect({
    ...input,
    effectId: input.replaceEffectId,
  });
  if (activePrestidigitationEffects(
    input.builder.objects(), input.sourceActorId,
  ).length >= input.policy.maxActiveEffects) {
    throw new Error(`Prestidigitation permits at most ${input.policy.maxActiveEffects} active non-instantaneous effects`);
  }
}

export function resolvePrestidigitation(input: {
  objects: Readonly<Record<string, WorldObjectState>>;
  sourceActorId: string;
  sourceActionId: string;
  option: PrestidigitationOption;
  policy: PrestidigitationWorldPolicy;
  targeting: ParsedMechanicsTargeting;
}): WorldObjectMutationResult {
  stableId(input.sourceActorId, 'Prestidigitation source actor');
  stableId(input.sourceActionId, 'Prestidigitation source action');
  requireFacts(input.option.facts, 'Prestidigitation', { maxRangeFt: input.targeting.rangeFt });
  const builder = mutationBuilder(input.objects);
  switch (input.option.kind) {
    case 'sensory_effect': {
      const id = stableId(input.option.id, 'Prestidigitation Sensory Effect');
      const description = input.option.description.trim();
      if (!description) throw new Error('Prestidigitation Sensory Effect requires a description');
      const object: WorldObjectState = {
        id,
        name: description,
        kind: 'spell_effect',
        size: 'tiny',
        sourceActorId: input.sourceActorId,
        sourceActionId: input.sourceActionId,
        magicalAura: { school: 'transmutation', createdBySpell: true, visible: true },
        tags: ['prestidigitation', 'instantaneous_sensory_effect'],
      };
      builder.apply({ type: 'WorldObjectCreated', object });
      builder.apply({
        type: 'WorldObjectRemoved', objectId: id, reason: 'instantaneous_effect_completed',
      });
      break;
    }
    case 'fire_play': {
      const target = builder.objects()[input.option.objectId];
      if (!target?.flame) throw new Error('Prestidigitation Fire Play requires a candle, torch, or small campfire');
      builder.apply({
        type: 'WorldObjectPatched',
        objectId: target.id,
        patch: { flame: { ...target.flame, lit: input.option.operation === 'light' } },
        reason: 'prestidigitation_fire_play',
      });
      break;
    }
    case 'clean_or_soil': {
      requireFacts(input.option.facts, 'Prestidigitation Clean or Soil', {
        maxRangeFt: input.targeting.rangeFt,
        maxVolumeCubicFt: input.policy.maxVolumeCubicFt,
      });
      const target = builder.objects()[input.option.objectId];
      if (!target) throw new Error(`Unknown world object ${input.option.objectId}`);
      builder.apply({
        type: 'WorldObjectPatched', objectId: target.id,
        patch: { soiled: input.option.operation === 'soil' },
        reason: 'prestidigitation_clean_or_soil',
      });
      break;
    }
    case 'minor_sensation':
    case 'magic_mark': {
      if (input.option.kind === 'minor_sensation') {
        requireFacts(input.option.facts, 'Prestidigitation Minor Sensation', {
          maxRangeFt: input.targeting.rangeFt,
          maxVolumeCubicFt: input.policy.maxVolumeCubicFt,
        });
      }
      const target = builder.objects()[input.option.objectId];
      if (!target) throw new Error(`Unknown world object ${input.option.objectId}`);
      const id = stableId(input.option.id, 'Prestidigitation effect');
      const description = input.option.description.trim();
      if (!description) throw new Error('Prestidigitation effect requires a description');
      preparePrestidigitationSlot({
        builder, sourceActorId: input.sourceActorId,
        replaceEffectId: input.option.replaceEffectId,
        policy: input.policy,
      });
      if (activePrestidigitationEffects(
        builder.objects(), input.sourceActorId,
      ).some((effect) => effect.id === id)) {
        throw new Error(`Prestidigitation effect ${id} already exists`);
      }
      const currentTarget = builder.objects()[input.option.objectId];
      if (!currentTarget) {
        throw new Error('Prestidigitation replacement removed the selected target object');
      }
      const attachment: PrestidigitationAttachment = {
        id,
        sourceActorId: input.sourceActorId,
        sourceActionId: input.sourceActionId,
        kind: input.option.kind,
        description,
        roundsLeft: input.policy.attachmentDurationRounds,
      };
      builder.apply({
        type: 'WorldObjectPatched', objectId: currentTarget.id,
        patch: { prestidigitation: [...(currentTarget.prestidigitation ?? []), attachment] },
        reason: `prestidigitation_${input.option.kind}`,
      });
      break;
    }
    case 'minor_creation': {
      if (input.option.fitsInHand !== true) {
        throw new Error('Prestidigitation Minor Creation must fit in the caster’s hand');
      }
      const id = stableId(input.option.id, 'Prestidigitation Minor Creation');
      const description = input.option.description.trim();
      if (!description) throw new Error('Prestidigitation Minor Creation requires a description');
      preparePrestidigitationSlot({
        builder, sourceActorId: input.sourceActorId,
        replaceEffectId: input.option.replaceEffectId,
        policy: input.policy,
      });
      if (builder.objects()[id]) throw new Error(`World object ${id} already exists`);
      const object: WorldObjectState = {
        id,
        name: description,
        kind: 'spell_effect',
        size: input.option.size,
        sourceActorId: input.sourceActorId,
        sourceActionId: input.sourceActionId,
        // The cast happens during the current turn: survive this turn ending,
        // then expire at the end of the caster's next turn.
        sourceTurnEndingsLeft: input.policy.creationSourceTurnEndings,
        magicalAura: { school: 'transmutation', createdBySpell: true, visible: true },
        tags: [
          'prestidigitation', 'prestidigitation:minor_creation',
          'nonmagical_trinket_or_illusory_image', 'no_damage', 'no_monetary_worth',
        ],
      };
      builder.apply({ type: 'WorldObjectCreated', object });
      break;
    }
  }
  return builder.result();
}

/** End source-relative objects only at the named actor's turn boundary. */
export function endSourceActorTurnWorldObjects(input: {
  objects: Readonly<Record<string, WorldObjectState>>;
  sourceActorId: string;
}): WorldObjectMutationResult {
  const builder = mutationBuilder(input.objects);
  for (const object of Object.values(builder.objects()).sort((left, right) => left.id.localeCompare(right.id))) {
    if (object.sourceActorId !== input.sourceActorId || object.sourceTurnEndingsLeft === undefined) continue;
    if (!Number.isInteger(object.sourceTurnEndingsLeft) || object.sourceTurnEndingsLeft < 1) {
      throw new Error(`Invalid source-turn expiry on ${object.id}`);
    }
    if (object.sourceTurnEndingsLeft === 1) {
      builder.apply({
        type: 'WorldObjectRemoved', objectId: object.id, reason: 'source_turn_end_expired',
      });
    } else {
      builder.apply({
        type: 'WorldObjectPatched', objectId: object.id,
        patch: { sourceTurnEndingsLeft: object.sourceTurnEndingsLeft - 1 },
        reason: 'source_turn_end_advanced',
      });
    }
  }
  return builder.result();
}
