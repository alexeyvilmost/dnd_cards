import {
  createLogicalClock,
  createSequentialIdFactory,
} from '../rules-core/determinism';
import type {
  FamiliarObservableFacts,
  GameCommand,
  RuleActionDefinition,
  SpatialFacts,
  UncommittedRuleEvent,
  WorldState,
} from '../rules-core/domain';
import {
  canonicalTouchSpell,
  familiarActorsOwnedBy,
} from '../rules-core/familiarRuntime';
import { InMemoryRulesSession } from '../rules-core/session';
import type { WorldObjectFacts } from '../rules-core/worldObjects';
import type { PactTomeRestSelection } from '../rules-core/pactTomeWorldAdapter';
import type { SheetCanonicalRuntime } from './sheetCanonicalWorld';
import {
  collectSheetSpellCastOptions,
  requireSheetSpellCastOption,
} from './sheetSpellCastingUi';

export const SHEET_COMPANION_ONLINE_AUTHORITY_REASON =
  'Операции спутника недоступны внутри онлайн-боя: серверная encounter authority ещё не исполняет rules-core команды.';

export class SheetCompanionActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SheetCompanionActionError';
  }
}
export interface SheetCompanionActionContext {
  runtime: SheetCanonicalRuntime;
  /** Any non-empty value means that encounter transport, not this sheet, owns mutations. */
  onlineEncounterId?: string | null;
}

export interface SheetCompanionActionResult {
  command: GameCommand;
  world: WorldState;
  events: readonly UncommittedRuleEvent[];
}

export interface SheetCompanionControlModel {
  blockedReason: string | null;
  familiar: {
    actorId: string;
    name: string;
    presence: NonNullable<WorldState['actors'][string]['familiarState']>['presence'];
    extension: NonNullable<WorldState['actors'][string]['familiarState']>['extension'];
    reactionAvailable: boolean;
    attackActionIds: string[];
  } | null;
  touchSpells: Array<{
    action: RuleActionDefinition;
    castOptions: ReturnType<typeof collectSheetSpellCastOptions>;
  }>;
  pactBlade: {
    bondActionId: string;
    activeWeaponObjectId: string | null;
    touchableWeaponObjectIds: string[];
    arbitraryUnbindSupported: false;
  } | null;
  pactTome: (NonNullable<SheetCanonicalRuntime['pactTomeSelection']> & {
    activeBookObjectId: string | null;
  }) | null;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function common(
  world: WorldState,
  actorId: string,
  commandId: string,
) {
  if (!actorId.trim() || !commandId.trim()) {
    throw new SheetCompanionActionError('Companion command requires stable actor and command identities');
  }
  return {
    schemaVersion: 1 as const,
    commandId,
    expectedRevision: world.revision,
    rulesetContentHash: world.ruleset.contentHash,
    actorId,
  };
}

function availableContext(input: SheetCompanionActionContext): {
  world: WorldState;
  actorId: string;
} {
  if (input.onlineEncounterId) {
    throw new SheetCompanionActionError(SHEET_COMPANION_ONLINE_AUTHORITY_REASON);
  }
  const { world, actorId } = input.runtime;
  if (!world.actors[actorId]) {
    throw new SheetCompanionActionError(`Canonical sheet world misses actor ${actorId}`);
  }
  if (world.pendingResolution) {
    throw new SheetCompanionActionError('Сначала завершите ожидающее решение rules-core');
  }
  return { world, actorId };
}

function oneOwnedFamiliar(input: SheetCompanionActionContext) {
  const { world, actorId } = availableContext(input);
  const familiars = familiarActorsOwnedBy(world, actorId);
  if (familiars.length !== 1 || !familiars[0].familiarState) {
    throw new SheetCompanionActionError(
      `Операция требует ровно одного канонического фамильяра; найдено ${familiars.length}`,
    );
  }
  return { world, actorId, familiar: familiars[0] };
}

/** UI projection reads only compiled capabilities and persisted lifecycle state. */
export function collectSheetCompanionControls(
  input: SheetCompanionActionContext,
): SheetCompanionControlModel {
  const actor = input.runtime.world.actors[input.runtime.actorId];
  if (!actor) throw new SheetCompanionActionError('Canonical actor is unavailable');
  const familiars = familiarActorsOwnedBy(input.runtime.world, actor.id);
  if (familiars.length > 1) {
    throw new SheetCompanionActionError('Actor owns more than one canonical familiar');
  }
  const familiar = familiars[0];
  const touchSpells = familiar?.familiarState
    ? input.runtime.actions.flatMap((action) => {
      if (!canonicalTouchSpell(action)) return [];
      const castOptions = collectSheetSpellCastOptions({ runtime: input.runtime, action });
      return castOptions.length ? [{ action, castOptions }] : [];
    })
    : [];
  const blade = actor.warlockPacts?.blade;
  const touchableWeaponObjectIds = blade
    ? Object.values(input.runtime.world.objects)
      .filter((object) => object.kind === 'item'
        && typeof object.itemCardId === 'string'
        && object.itemCardId.length > 0
        && object.heldByActorId === actor.id)
      .map((object) => object.id)
      .sort()
    : [];
  const tome = input.runtime.pactTomeSelection;
  return {
    blockedReason: input.onlineEncounterId ? SHEET_COMPANION_ONLINE_AUTHORITY_REASON : null,
    familiar: familiar?.familiarState ? {
      actorId: familiar.id,
      name: familiar.name,
      presence: familiar.familiarState.presence,
      extension: familiar.familiarState.extension,
      reactionAvailable: familiar.familiarState.reactionAvailable,
      attackActionIds: familiar.familiarMetadata?.actions
        .filter((action) => action.kind === 'attack')
        .map((action) => action.id)
        .sort() ?? [],
    } : null,
    touchSpells,
    pactBlade: blade ? {
      bondActionId: blade.bondActionId,
      activeWeaponObjectId: blade.activeBond?.weaponObjectId ?? null,
      touchableWeaponObjectIds,
      arbitraryUnbindSupported: false,
    } : null,
    pactTome: tome ? {
      ...clone(tome),
      activeBookObjectId: actor.warlockPacts?.tome?.tome.bookObjectId ?? null,
    } : null,
  };
}

export function buildDismissFamiliarCommand(input: SheetCompanionActionContext & {
  commandId: string;
  mode: 'temporary' | 'forever';
}): GameCommand {
  const { world, actorId, familiar } = oneOwnedFamiliar(input);
  return {
    ...common(world, actorId, input.commandId),
    type: 'DismissFamiliar',
    familiarActorId: familiar.id,
    mode: input.mode,
  };
}

export function buildReappearFamiliarCommand(input: SheetCompanionActionContext & {
  commandId: string;
  facts: FamiliarObservableFacts & { unoccupiedSpace: boolean };
}): GameCommand {
  const { world, actorId, familiar } = oneOwnedFamiliar(input);
  return {
    ...common(world, actorId, input.commandId),
    type: 'ReappearFamiliar',
    familiarActorId: familiar.id,
    facts: clone(input.facts),
  };
}

export function buildFamiliarSharedSensesCommand(input: SheetCompanionActionContext & {
  commandId: string;
  facts: FamiliarObservableFacts;
}): GameCommand {
  const { world, actorId, familiar } = oneOwnedFamiliar(input);
  return {
    ...common(world, actorId, input.commandId),
    type: 'UseFamiliarSharedSenses',
    familiarActorId: familiar.id,
    facts: clone(input.facts),
  };
}

export function buildPactBladeTouchCommand(input: SheetCompanionActionContext & {
  commandId: string;
  weaponObjectId: string;
  facts: WorldObjectFacts & { touched: boolean };
}): GameCommand {
  const { world, actorId } = availableContext(input);
  const blade = world.actors[actorId].warlockPacts?.blade;
  if (!blade || !world.objects[input.weaponObjectId]) {
    throw new SheetCompanionActionError('Pact Blade touch requires an actor-owned invocation and world item');
  }
  return {
    ...common(world, actorId, input.commandId),
    type: 'BondPactBlade',
    mode: 'touch_existing',
    weaponObjectId: input.weaponObjectId,
    facts: clone(input.facts),
  };
}

export function buildPactBladeDistanceCommand(input: SheetCompanionActionContext & {
  commandId: string;
  facts: {
    factsSource: 'scenario' | 'board' | 'gm_ruling';
    boardRevision: number;
    distanceFt: number;
    elapsedSeconds: number;
  };
}): GameCommand {
  const { world, actorId } = availableContext(input);
  const weaponObjectId = world.actors[actorId].warlockPacts?.blade?.activeBond?.weaponObjectId;
  if (!weaponObjectId) throw new SheetCompanionActionError('Pact Blade has no active bond');
  return {
    ...common(world, actorId, input.commandId),
    type: 'ObservePactBladeDistance',
    weaponObjectId,
    facts: clone(input.facts),
  };
}

export function buildPactTomeRestCommand(input: SheetCompanionActionContext & {
  commandId: string;
  rest: 'short' | 'long';
  bookObjectId: string;
}): GameCommand {
  const { world, actorId } = availableContext(input);
  const selection = input.runtime.pactTomeSelection;
  if (!selection) throw new SheetCompanionActionError('Pact Tome has no mechanics-owned rest selection');
  const pactTome: PactTomeRestSelection = {
    bookObjectId: input.bookObjectId,
    cantripActionIds: [...selection.cantripActionIds],
    ritualActionIds: [...selection.ritualActionIds],
  };
  return input.rest === 'short' ? {
    ...common(world, actorId, input.commandId),
    type: 'TakeShortRest',
    decisions: [],
    pactTome,
  } : {
    ...common(world, actorId, input.commandId),
    type: 'TakeLongRest',
    durationHours: 8,
    pactTome,
  };
}

export function buildFamiliarTouchSpellCommand(input: SheetCompanionActionContext & {
  commandId: string;
  spellActionId: string;
  castOptionId: string;
  targetActorId: string;
  ownerToFamiliarFacts: FamiliarObservableFacts;
  familiarToTargetFacts: SpatialFacts;
  choices?: Record<string, string | string[]>;
}): GameCommand {
  const { world, actorId, familiar } = oneOwnedFamiliar(input);
  const action = input.runtime.catalog.getAction(input.spellActionId);
  if (!action || !canonicalTouchSpell(action)) {
    throw new SheetCompanionActionError(`${input.spellActionId} is not an explicit five-foot Touch spell`);
  }
  if (!world.actors[input.targetActorId]) {
    throw new SheetCompanionActionError(`Touch delivery target ${input.targetActorId} is absent from the world`);
  }
  const option = requireSheetSpellCastOption(
    collectSheetSpellCastOptions({ runtime: input.runtime, action }),
    input.castOptionId,
  );
  return {
    ...common(world, actorId, input.commandId),
    type: 'DeliverTouchSpellThroughFamiliar',
    familiarActorId: familiar.id,
    spellActionId: action.id,
    targetActorId: input.targetActorId,
    ownerToFamiliarFacts: clone(input.ownerToFamiliarFacts),
    familiarToTargetFacts: clone(input.familiarToTargetFacts),
    ...(input.choices ? { choices: clone(input.choices) } : {}),
    spell: {
      baseLevel: action.kind === 'spell' ? action.spell.level : 0,
      grantId: option.declaration.grantId,
      mode: option.declaration.mode,
      ...(option.declaration.preferFreeUse === undefined
        ? {}
        : { preferFreeUse: option.declaration.preferFreeUse }),
    },
  };
}

export function buildPactChainFamiliarAttackCommand(input: SheetCompanionActionContext & {
  commandId: string;
  attackActionId: string;
  familiarActionId: string;
  targetActorId: string;
  facts: SpatialFacts;
}): GameCommand {
  const { world, actorId, familiar } = oneOwnedFamiliar(input);
  if (familiar.familiarState?.extension !== 'pact_chain') {
    throw new SheetCompanionActionError('Only a Pact Chain familiar can replace an owner attack');
  }
  return {
    ...common(world, actorId, input.commandId),
    type: 'PerformPactChainFamiliarAttack',
    attackActionId: input.attackActionId,
    familiarActorId: familiar.id,
    familiarActionId: input.familiarActionId,
    targetActorId: input.targetActorId,
    facts: clone(input.facts),
  };
}

/** Execute one existing rules-core command; this adapter contains no duplicate rule outcome. */
export function executeSheetCompanionCommand(input: SheetCompanionActionContext & {
  command: GameCommand;
  rng: () => number;
}): SheetCompanionActionResult {
  const { world, actorId } = availableContext(input);
  if (input.command.actorId !== actorId
    || input.command.expectedRevision !== world.revision
    || input.command.rulesetContentHash !== world.ruleset.contentHash) {
    throw new SheetCompanionActionError('Companion command does not match the exact sheet world snapshot');
  }
  const session = new InMemoryRulesSession(world, input.runtime.catalog, {
    rng: input.rng,
    clock: createLogicalClock(world.logicalClock),
    nextId: createSequentialIdFactory(`sheet-companion:${input.command.commandId}`),
  });
  const result = session.dispatch(input.command);
  if (result.status === 'rejected') {
    throw new SheetCompanionActionError(`${result.code}: ${result.message}`);
  }
  return {
    command: clone(input.command),
    world: session.getState(),
    events: session.getEvents(),
  };
}
