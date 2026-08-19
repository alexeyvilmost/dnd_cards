import type { ActorState, SpatialFacts } from '../rules-core/domain';
import type { TargetContext } from '../mvp/contracts';

/**
 * A reusable, rules-owned creature supplied by the scene rather than by a
 * CharacterV3 row. Scene targets participate in the canonical world and its
 * decisions, but are intentionally absent from the atomic persistence set.
 */
export interface SheetSceneTargetDefinition {
  id: string;
  name: string;
  description: string;
  armorClass: number;
  hitPoints: number;
  size: number;
  abilityModifiers: ActorState['character']['abilityMods'];
  defaultFacts: Omit<SpatialFacts, 'distanceFt'>;
}

export const TRAINING_DUMMY_TARGET_ID = 'scene-target:training-dummy' as const;

export const TRAINING_DUMMY: SheetSceneTargetDefinition = Object.freeze({
  id: TRAINING_DUMMY_TARGET_ID,
  name: 'Пугало',
  description: 'Тренировочная цель сцены · КЗ 10 · модификаторы спасбросков +0',
  armorClass: 10,
  hitPoints: 100,
  size: 2,
  abilityModifiers: Object.freeze({ str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 }),
  defaultFacts: Object.freeze({
    factsSource: 'scenario',
    boardRevision: 0,
    relation: 'enemy',
    lineOfSight: true,
    cover: 'none',
  }),
});

export function createSheetSceneTargetActor(
  definition: SheetSceneTargetDefinition,
): ActorState {
  return {
    id: definition.id,
    name: definition.name,
    kind: 'monster',
    controllerId: 'system:sheet-scene',
    ac: definition.armorClass,
    capabilities: { actionIds: [] },
    character: {
      abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
      abilityMods: { ...definition.abilityModifiers },
      profBonus: 0,
      level: 1,
      characterSpeed: 0,
      baseSpeed: 0,
      baseSize: definition.size,
      equippedCards: [],
      knownCards: [],
      saveProficiencies: [],
      skillProficiencies: [],
      skillExpertise: [],
      weaponProficiencies: [],
    },
    runtime: {
      hp: { current: definition.hitPoints, max: definition.hitPoints, temp: 0 },
      resources: {},
      maxResources: {},
      equipment: {},
      inventory: [],
      activeEffects: [],
      firedThisTurn: [],
      firedThisRest: [],
    },
    lifecycle: { status: 'alive' },
    passives: [],
    grantedEffects: {},
    masteryEffects: {},
    attackProfile: {
      attacksPerAction: 1,
      size: definition.size,
      reachFt: 5,
      graspingParts: [],
      sourceEntityIds: ['system:dnd5e-2024:sheet-scene-target'],
    },
  };
}

export function buildSheetSceneTargetContext(
  definition: SheetSceneTargetDefinition,
): TargetContext {
  const actor = createSheetSceneTargetActor(definition);
  return {
    id: actor.id,
    size: definition.size,
    ac: definition.armorClass,
    saveMods: { ...definition.abilityModifiers },
    characterContext: actor.character,
    runtimeState: actor.runtime,
    passives: [],
    conditionImmunities: [],
  };
}
