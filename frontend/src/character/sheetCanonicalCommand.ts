import type {
  ActionWorldInput,
  GameCommand,
  RuleActionDefinition,
  SpatialFacts,
  WorldState,
} from '../rules-core/domain';
import { migrateWorldState } from '../rules-core/worldMigration';
import type { WorldObjectState } from '../rules-core/worldObjects';

export type SheetSpellCastDeclaration = {
  /** Exact actor-owned grant selected by the UI; never inferred from a card name. */
  grantId: string;
  mode: 'normal' | 'ritual';
  castLevel?: number;
  preferFreeUse?: boolean;
  focusObjectId?: string;
  focusHand?: 'main_hand' | 'off_hand';
};

export interface SheetCanonicalCommandInput {
  /** Explicit UI context. The durable sheet world remains exploration until encounter transport lands. */
  sceneMode: 'exploration' | 'encounter';
  /** Actor identities selected by the user; self spells with actor_targets=false use []. */
  targetIds: string[];
  /** Explicit scenario/board facts for every selected actor target. */
  factsByTarget?: Record<string, SpatialFacts>;
  /** Explicit world-object declaration selected and confirmed in the sheet form. */
  worldInput?: ActionWorldInput;
  /** Scenario objects declared by the user before dispatch; committed only with an accepted action. */
  scenarioObjects?: WorldObjectState[];
  /** Mechanics-owned choices. The UI supplies values, never new rule fields. */
  choices?: Record<string, string | string[]>;
  /** Exact source/payment declaration for every canonical spell. */
  spell?: SheetSpellCastDeclaration;
  /** Pact Blade is the sole non-UseAction command in this bridge slice. */
  pactBlade?: {
    mode: 'conjure';
    weaponCardId: string;
    hand: 'main_hand' | 'off_hand';
  };
}

export class SheetCanonicalCommandInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SheetCanonicalCommandInputError';
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function nonBlank(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function assertTargetDeclaration(
  action: RuleActionDefinition,
  input: SheetCanonicalCommandInput,
): void {
  if (input.sceneMode !== 'exploration' && input.sceneMode !== 'encounter') {
    throw new SheetCanonicalCommandInputError('sceneMode must be explicitly declared');
  }
  const targeting = action.targeting;
  if (!targeting) {
    throw new SheetCanonicalCommandInputError(
      `Canonical action ${action.id} has no compiled targeting contract`,
    );
  }
  if (input.targetIds.some((id) => !nonBlank(id))
    || new Set(input.targetIds).size !== input.targetIds.length) {
    throw new SheetCanonicalCommandInputError('targetIds must contain unique non-empty actor identities');
  }
  if (input.targetIds.length < targeting.minTargets
    || input.targetIds.length > targeting.maxTargets) {
    throw new SheetCanonicalCommandInputError(
      `${action.id} requires ${targeting.minTargets}–${targeting.maxTargets} actor targets`,
    );
  }
  const facts = input.factsByTarget ?? {};
  const targetSet = new Set(input.targetIds);
  const factIds = Object.keys(facts);
  if (factIds.some((id) => !targetSet.has(id))) {
    throw new SheetCanonicalCommandInputError('factsByTarget contains facts for an unselected actor');
  }
  if (input.targetIds.some((id) => !facts[id])) {
    throw new SheetCanonicalCommandInputError('Every selected actor requires explicit scenario facts');
  }
  if (!input.targetIds.length && factIds.length) {
    throw new SheetCanonicalCommandInputError('An actor-free action cannot declare actor facts');
  }
}

function spellDeclaration(
  action: RuleActionDefinition,
  declaration: SheetSpellCastDeclaration | undefined,
): Extract<GameCommand, { type: 'UseAction' }>['spell'] | undefined {
  if (action.kind !== 'spell') {
    if (declaration) {
      throw new SheetCanonicalCommandInputError(`${action.id} is not a spell`);
    }
    return undefined;
  }
  if (!declaration || !nonBlank(declaration.grantId)) {
    throw new SheetCanonicalCommandInputError(
      `Canonical spell ${action.id} requires one exact actor-owned grant`,
    );
  }
  if (declaration.mode !== 'normal' && declaration.mode !== 'ritual') {
    throw new SheetCanonicalCommandInputError(`${action.id} has an invalid cast mode`);
  }
  if (declaration.castLevel !== undefined
    && (!Number.isInteger(declaration.castLevel)
      || declaration.castLevel < action.spell.level
      || declaration.castLevel > 9)) {
    throw new SheetCanonicalCommandInputError(`${action.id} has an invalid cast level`);
  }
  return {
    baseLevel: action.spell.level,
    grantId: declaration.grantId,
    mode: declaration.mode,
    ...(declaration.castLevel === undefined ? {} : { castLevel: declaration.castLevel }),
    ...(declaration.preferFreeUse === undefined
      ? {}
      : { preferFreeUse: declaration.preferFreeUse }),
    ...(declaration.focusObjectId ? { focusObjectId: declaration.focusObjectId } : {}),
    ...(declaration.focusHand ? { focusHand: declaration.focusHand } : {}),
  };
}

export function buildSheetCanonicalCommand(input: {
  world: WorldState;
  actorId: string;
  action: RuleActionDefinition;
  primitiveType: string;
  commandId: string;
  declaration: SheetCanonicalCommandInput;
}): GameCommand {
  const { world, actorId, action, primitiveType, commandId, declaration } = input;
  const common = {
    schemaVersion: 1 as const,
    commandId,
    expectedRevision: world.revision,
    rulesetContentHash: world.ruleset.contentHash,
    actorId,
  };
  if (primitiveType === 'pact_blade_bond') {
    if (declaration.sceneMode !== 'exploration' && declaration.sceneMode !== 'encounter') {
      throw new SheetCanonicalCommandInputError('sceneMode must be explicitly declared');
    }
    if (declaration.targetIds.length || Object.keys(declaration.factsByTarget ?? {}).length) {
      throw new SheetCanonicalCommandInputError(
        'Pact Blade is a target-free bond command and cannot accept actor targets or facts',
      );
    }
    if (!declaration.pactBlade
      || declaration.pactBlade.mode !== 'conjure'
      || !nonBlank(declaration.pactBlade.weaponCardId)
      || !['main_hand', 'off_hand'].includes(declaration.pactBlade.hand)) {
      throw new SheetCanonicalCommandInputError('Pact Blade requires an explicit conjure declaration');
    }
    if (declaration.worldInput || declaration.spell) {
      throw new SheetCanonicalCommandInputError('Pact Blade cannot accept spell or world input');
    }
    return {
      ...common,
      type: 'BondPactBlade',
      mode: 'conjure',
      weaponCardId: declaration.pactBlade.weaponCardId,
      hand: declaration.pactBlade.hand,
    };
  }
  if (declaration.pactBlade) {
    throw new SheetCanonicalCommandInputError(
      `${action.id} cannot accept a Pact Blade declaration`,
    );
  }
  assertTargetDeclaration(action, declaration);
  const spell = spellDeclaration(action, declaration.spell);
  return {
    ...common,
    type: 'UseAction',
    actionId: action.id,
    targetIds: [...declaration.targetIds],
    ...(declaration.factsByTarget
      ? { factsByTarget: clone(declaration.factsByTarget) }
      : {}),
    ...(declaration.choices ? { choices: clone(declaration.choices) } : {}),
    ...(spell ? { spell } : {}),
    ...(declaration.worldInput ? { worldInput: clone(declaration.worldInput) } : {}),
  };
}

/** Stage explicit scenario objects without mutating the persisted world on rejection. */
export function stageSheetScenarioObjects(
  worldValue: WorldState,
  scenarioObjects: readonly WorldObjectState[] | undefined,
): WorldState {
  if (!scenarioObjects?.length) return migrateWorldState(clone(worldValue));
  const world = clone(worldValue);
  const seen = new Set<string>();
  for (const scenarioObject of scenarioObjects) {
    if (!nonBlank(scenarioObject.id) || seen.has(scenarioObject.id)) {
      throw new SheetCanonicalCommandInputError(
        'Scenario objects require unique non-empty identities',
      );
    }
    seen.add(scenarioObject.id);
    if (world.objects[scenarioObject.id]) {
      throw new SheetCanonicalCommandInputError(
        `Scenario object ${scenarioObject.id} already exists`,
      );
    }
    world.objects[scenarioObject.id] = clone(scenarioObject);
  }
  return migrateWorldState(world);
}
