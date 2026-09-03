import { extractDiceFromEvents, type PlannedDie } from '../engine/dicePlan';
import { executeAction } from '../engine/execute';
import { evaluate, type FormulaContext } from '../engine/formula';
import type { ExecuteContext, ExecuteResult, RuntimeState } from '../mvp/contracts';
import { createLogicalClock, createSequentialIdFactory } from '../rules-core/determinism';
import { parseActivationCastTime } from '../rules-core/activationCastTime';
import type {
  ActorState,
  GameCommand,
  PendingResolution,
  RuleActionDefinition,
  UncommittedRuleEvent,
  WorldState,
} from '../rules-core/domain';
import { defaultAttackProfile } from '../rules-core/domain';
import { InMemoryRulesSession } from '../rules-core/session';
import {
  FIND_FAMILIAR_CAST_PATH_CHOICE,
  FIND_FAMILIAR_FORM_CHOICE,
  FIND_FAMILIAR_PRIMITIVE,
  FIND_FAMILIAR_SPIRIT_CHOICE,
  WILD_COMPANION_PRIMITIVE,
  findFamiliarMaterialCost,
} from '../rules-core/familiarRuntime';
import { FAMILIAR_ACTOR_CATALOG } from '../rules-core/familiarActorCatalog';
import { isPactBladeConjurableCard } from '../rules-core/pactBladeRuntime';
import type { PendingChoice } from '../mechanics/collectChoices';
import type { Card } from '../types';
import {
  synchronizeSheetCanonicalRuntime,
  type SheetCanonicalRuntime,
} from './sheetCanonicalWorld';
import {
  buildSheetCanonicalCommand,
  stageSheetScenarioObjects,
  type SheetCanonicalCommandInput,
} from './sheetCanonicalCommand';
import {
  isSheetNoPendingPrimitive,
  isSheetSupportedPrimitive,
  PACT_BLADE_HAND_CHOICE,
  PACT_BLADE_WEAPON_CHOICE,
  sheetPrimitiveDisabledReason,
} from './sheetPrimitiveUi';
import {
  UNARMED_STRIKE_CHOICE_ID,
  UNARMED_STRIKE_PRIMITIVE,
} from './sheetCombatDeclaration';
import {
  collectSheetSpellCastOptions,
  SHEET_SPELL_CAST_CHOICE,
} from './sheetSpellCastingUi';

type Dict = Record<string, unknown>;

export { PACT_BLADE_HAND_CHOICE, PACT_BLADE_WEAPON_CHOICE } from './sheetPrimitiveUi';

const KNOWN_WORLD_PRIMITIVES = new Set([
  'area_object_push',
  'burning_hands_objects',
  'dancing_lights_world',
  'detect_magic_world_sensing',
  'detect_poison_disease_world',
  'druidcraft_world',
  FIND_FAMILIAR_PRIMITIVE,
  WILD_COMPANION_PRIMITIVE,
  'light_world_object',
  'magic_missile',
  'mending_world',
  'minor_illusion_world_object',
  'pact_blade_bond',
  'pact_chain_familiar',
  'pact_tome_book',
  'prestidigitation_world',
  'purify_food_drink_world',
  'temporary_hp_melee_retaliation',
]);

function object(value: unknown): Dict | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Dict
    : null;
}

function primitiveType(mechanics: Dict): string | null {
  if (!Object.prototype.hasOwnProperty.call(mechanics, 'primitive')) return null;
  const primitive = object(mechanics.primitive);
  if (!primitive || typeof primitive.type !== 'string' || !primitive.type.trim()) {
    throw new MalformedSheetPrimitiveError('mechanics.primitive must contain a non-empty type');
  }
  if (!KNOWN_WORLD_PRIMITIVES.has(primitive.type)
    && !isSheetSupportedPrimitive(primitive.type)) {
    throw new UnknownSheetPrimitiveError(primitive.type);
  }
  return primitive.type;
}

export class MalformedSheetPrimitiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MalformedSheetPrimitiveError';
  }
}

export class UnknownSheetPrimitiveError extends Error {
  constructor(readonly primitive: string) {
    super(`Unknown mechanics primitive ${primitive}; action was not paid`);
    this.name = 'UnknownSheetPrimitiveError';
  }
}

export class UnsupportedSheetPrimitiveError extends Error {
  constructor(readonly primitive: string) {
    super(
      sheetPrimitiveDisabledReason(primitive)
        ?? `The real character sheet does not yet support primitive ${primitive}; action was not paid`,
    );
    this.name = 'UnsupportedSheetPrimitiveError';
  }
}

export class SheetMechanicsPreflightError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SheetMechanicsPreflightError';
  }
}

export class SheetCanonicalCommandRejectedError extends Error {
  constructor(readonly code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = 'SheetCanonicalCommandRejectedError';
  }
}

export interface SheetCanonicalActionContext {
  runtime: SheetCanonicalRuntime;
  action: RuleActionDefinition;
}

export interface SheetActionExecutionInput {
  state: RuntimeState;
  mechanics: Record<string, unknown>;
  context: ExecuteContext;
  canonical?: SheetCanonicalActionContext;
  /** Explicit, user-confirmed canonical command declaration. */
  canonicalInput?: SheetCanonicalCommandInput;
}

export interface SheetActionExecutionResult extends ExecuteResult {
  canonicalWorld?: WorldState;
  ruleEvents?: readonly UncommittedRuleEvent[];
  /** Durable continuation state; callers must never treat a non-null value as completed. */
  pendingResolution: PendingResolution | null;
}

export interface SheetCanonicalActionValidationInput {
  canonical: SheetCanonicalActionContext;
  state: RuntimeState;
  declaration: SheetCanonicalCommandInput;
  /** Complete rules actors selected by the UI but not owned by the source sheet world. */
  targetActors?: readonly ActorState[];
  rng?: () => number;
  /** Stable idempotency key when the accepted world will be persisted atomically. */
  commandId?: string;
  /** The sheet has already collected the target-save dice and may complete the
   * canonical continuation with the injected RNG. Other continuation types
   * remain durable/fail-closed. */
  resolveTargetSaves?: boolean;
}

export interface SheetCanonicalActionDispatchResult extends SheetActionExecutionResult {
  canonicalWorld: WorldState;
}

function formulaContext(context: ExecuteContext, target = false): FormulaContext {
  const character = target ? context.target?.characterContext : context.character;
  return {
    abilityMods: character?.abilityMods,
    profBonus: character?.profBonus,
    selfLevel: character?.level,
    classLevels: character?.classLevels,
    spellcastingMod: character?.spellcastingMod,
    characterSpeed: character?.characterSpeed,
    variables: character?.variables,
    weaponMod: target ? undefined : context.weaponMod,
    rng: () => 0.5,
  };
}

function validateFormula(value: unknown, context: ExecuteContext, label: string, target = false): void {
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new SheetMechanicsPreflightError(`${label} must be a formula string or number`);
  }
  try {
    const normalized = typeof value === 'string' && /^\+\d+(?:\.\d+)?$/.test(value.trim())
      ? value.trim().slice(1)
      : value;
    evaluate(normalized, formulaContext(context, target));
  } catch (error) {
    throw new SheetMechanicsPreflightError(
      `${label} cannot be evaluated: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function validatePayloadFormula(payload: Dict, context: ExecuteContext, target: boolean): void {
  const kind = String(payload.kind ?? '');
  const fields: string[] = [];
  if (['damage', 'healing', 'temp_hp', 'reduce_damage', 'damage_reduction'].includes(kind)) {
    fields.push('dice', 'amount');
  } else if (kind === 'set_value') {
    fields.push('formula', 'value');
  } else if (kind === 'modifier' && ['add', 'set', 'minimum', 'maximum'].includes(String(payload.op ?? ''))) {
    fields.push('value');
  } else if (['resource', 'restore_resource', 'spend_resource'].includes(kind)) {
    fields.push('amount', 'value');
  }
  for (const field of fields) {
    if (payload[field] !== undefined) validateFormula(payload[field], context, `${kind}.${field}`, target);
  }
  for (const key of ['result', 'results', 'on_hit', 'on_crit', 'on_miss', 'on_fail', 'on_success']) {
    const nested = payload[key];
    if (Array.isArray(nested)) nested.forEach((entry) => {
      const row = object(entry);
      if (row) validatePayloadFormula(row, context, target);
    });
  }
  const items = object(payload.options)?.items;
  if (Array.isArray(items)) items.forEach((item) => {
    const grants = object(item)?.grants;
    if (Array.isArray(grants)) grants.forEach((grant) => {
      const row = object(grant);
      if (row) validatePayloadFormula(row, context, target);
    });
  });
}

function collectGrantEffectReferences(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectGrantEffectReferences(entry, out));
    return out;
  }
  const row = object(value);
  if (!row) return out;
  if (row.kind === 'grant_effect') {
    if (typeof row.value === 'string' && row.value) out.add(row.value);
    if (Array.isArray(row.values)) row.values.forEach((entry) => {
      if (typeof entry === 'string' && entry) out.add(entry);
    });
  }
  Object.values(row).forEach((entry) => collectGrantEffectReferences(entry, out));
  return out;
}

/** Validate every dependency that the legacy executor historically skipped after paying. */
export function preflightSheetMechanics(mechanics: Dict, context: ExecuteContext): string | null {
  const primitive = primitiveType(mechanics);
  for (const reference of collectGrantEffectReferences(mechanics)) {
    const grant = context.grantedEffects?.[reference];
    if (!grant || !object(grant.mechanics)) {
      throw new SheetMechanicsPreflightError(
        `grant_effect ${reference} is unresolved; action was not paid`,
      );
    }
  }
  const effects = mechanics.effects;
  if (effects !== undefined && !Array.isArray(effects)) {
    throw new SheetMechanicsPreflightError('mechanics.effects must be an array');
  }
  for (const effect of (effects ?? []) as unknown[]) {
    const row = object(effect);
    if (!row) throw new SheetMechanicsPreflightError('mechanics.effects contains a non-object entry');
    const target = String(row.who ?? 'self') === 'target';
    if (row.resolution === 'save' && row.dc !== undefined) {
      validateFormula(row.dc, context, 'save.dc', false);
    }
    validatePayloadFormula(row, context, target);
  }
  return primitive;
}

function oneChoice(
  choices: ExecuteContext['choices'],
  id: string,
): string {
  const raw = choices?.[id];
  const values = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
  if (values.length !== 1 || !values[0]) {
    throw new SheetMechanicsPreflightError(`Primitive requires exactly one ${id} choice`);
  }
  return values[0];
}

function canonicalInputIssue(
  canonical: SheetCanonicalActionContext | undefined,
  primitive: string,
): SheetCanonicalActionContext {
  if (!canonical) {
    throw new SheetMechanicsPreflightError(
      `${primitive} requires a durable canonical sheet world; action was not paid`,
    );
  }
  const actionPrimitive = primitiveType(canonical.action.mechanics);
  if (actionPrimitive !== primitive) {
    throw new SheetMechanicsPreflightError(
      `Canonical action ${canonical.action.id} does not own primitive ${primitive}`,
    );
  }
  if (canonical.runtime.catalog.getAction(canonical.action.id) !== canonical.action) {
    const catalogAction = canonical.runtime.catalog.getAction(canonical.action.id);
    if (!catalogAction || JSON.stringify(catalogAction) !== JSON.stringify(canonical.action)) {
      throw new SheetMechanicsPreflightError(`Canonical catalog does not own action ${canonical.action.id}`);
    }
  }
  return canonical;
}

function spellGrantForMethod(
  world: WorldState,
  actorId: string,
  actionId: string,
  method: string,
): NonNullable<NonNullable<typeof world.actors[string]['spellcastingAccess']>['grants'][number]> {
  const actor = world.actors[actorId];
  const grants = actor.spellcastingAccess?.grants.filter((grant) => grant.actionId === actionId) ?? [];
  const matches = grants.filter((grant) => {
    if (method === 'pact_chain_magic_action') {
      return actor.warlockPacts?.chain?.template.findFamiliarActionId === actionId
        && grant.access === 'innate';
    }
    if (method === 'ritual') return grant.ritual === true;
    if (method === 'spell_slot') return !!grant.slotResource;
    return false;
  });
  if (matches.length !== 1) {
    throw new SheetMechanicsPreflightError(
      `${actionId} has ${matches.length} canonical spell grants for ${method}; exact source is required`,
    );
  }
  return matches[0];
}

function fnv1a32(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function sheetPrimitiveCommandId(
  actorId: string,
  actionId: string,
  revision: number,
): string {
  return `sheet:${fnv1a32(`${actorId}\u0000${actionId}`)}:${revision}`;
}

function legacyPrimitiveDeclaration(
  input: SheetActionExecutionInput,
  world: WorldState,
  primitive: string,
): SheetCanonicalCommandInput {
  const canonical = canonicalInputIssue(input.canonical, primitive);
  if (primitive === 'pact_blade_bond') {
    const weaponCardId = oneChoice(input.context.choices, PACT_BLADE_WEAPON_CHOICE);
    const hand = oneChoice(input.context.choices, PACT_BLADE_HAND_CHOICE);
    if (hand !== 'main_hand' && hand !== 'off_hand') {
      throw new SheetMechanicsPreflightError(`Invalid Pact Blade hand ${hand}`);
    }
    return {
      sceneMode: world.scene.mode,
      targetIds: [],
      pactBlade: { mode: 'conjure', weaponCardId, hand },
    };
  }
  if (primitive === FIND_FAMILIAR_PRIMITIVE) {
    if (canonical.action.kind !== 'spell') {
      throw new SheetMechanicsPreflightError(`${canonical.action.id} is not a canonical spell`);
    }
    const form = oneChoice(input.context.choices, FIND_FAMILIAR_FORM_CHOICE);
    const spirit = oneChoice(input.context.choices, FIND_FAMILIAR_SPIRIT_CHOICE);
    const method = oneChoice(input.context.choices, FIND_FAMILIAR_CAST_PATH_CHOICE);
    const grant = spellGrantForMethod(
      world,
      canonical.runtime.actorId,
      canonical.action.id,
      method,
    );
    return {
      sceneMode: world.scene.mode,
      targetIds: [],
      choices: {
        [FIND_FAMILIAR_FORM_CHOICE]: form,
        [FIND_FAMILIAR_SPIRIT_CHOICE]: spirit,
        [FIND_FAMILIAR_CAST_PATH_CHOICE]: method,
      },
      spell: {
        grantId: grant.grantId,
        mode: method === 'ritual' ? 'ritual' : 'normal',
        preferFreeUse: false,
      },
    };
  }
  if (primitive === WILD_COMPANION_PRIMITIVE) {
    return {
      sceneMode: world.scene.mode,
      targetIds: [],
      choices: {
        [FIND_FAMILIAR_FORM_CHOICE]: oneChoice(
          input.context.choices,
          FIND_FAMILIAR_FORM_CHOICE,
        ),
      },
    };
  }
  throw new SheetMechanicsPreflightError(
    `${primitive} requires an explicit canonical command declaration`,
  );
}

function primitiveDeclaration(
  input: SheetActionExecutionInput,
  world: WorldState,
  primitive: string,
): SheetCanonicalCommandInput {
  return input.canonicalInput ?? legacyPrimitiveDeclaration(input, world, primitive);
}

function isPactChainActionCast(
  canonical: SheetCanonicalActionContext,
  declaration: SheetCanonicalCommandInput | undefined,
): boolean {
  const actor = canonical.runtime.world.actors[canonical.runtime.actorId];
  const chain = actor?.warlockPacts?.chain;
  if (!actor || !chain
    || chain.template.findFamiliarActionId !== canonical.action.id
    || !canonical.action.sourceEntityIds.includes(chain.sourceEntityId)) return false;
  if (!declaration) {
    return actor.spellcastingAccess?.grants.some((grant) => (
      grant.actionId === canonical.action.id
      && grant.access === 'innate'
    )) === true;
  }
  const grant = actor.spellcastingAccess?.grants.find((candidate) => (
    candidate.grantId === declaration.spell?.grantId
  ));
  return declaration.spell?.mode === 'normal'
    && declaration.choices?.[FIND_FAMILIAR_CAST_PATH_CHOICE] === 'pact_chain_magic_action'
    && grant?.actionId === canonical.action.id
    && grant.access === 'innate';
}

/** Pure pre-payment timing projection shared by the sheet disabled state and dispatch path. */
export function sheetPrimitiveCastTimingIssue(
  canonical: SheetCanonicalActionContext,
  sceneMode: SheetCanonicalCommandInput['sceneMode'],
  declaration?: SheetCanonicalCommandInput,
): string | null {
  const parsed = parseActivationCastTime(canonical.action.mechanics);
  if (parsed.status === 'invalid') {
    return `${canonical.action.name}: некорректное activation.cast_time (${parsed.issue})`;
  }
  if (sceneMode !== 'encounter' || parsed.status !== 'valid' || parsed.policy.atomicInEncounter) {
    return null;
  }
  const primitive = primitiveType(canonical.action.mechanics);
  if (primitive === FIND_FAMILIAR_PRIMITIVE && isPactChainActionCast(canonical, declaration)) {
    return null;
  }
  return `${canonical.action.name} требует ${parsed.policy.seconds} сек. и не может завершиться одним действием в бою`;
}

function assertSheetPrimitiveCastTiming(
  canonical: SheetCanonicalActionContext,
  declaration: SheetCanonicalCommandInput,
): void {
  const issue = sheetPrimitiveCastTimingIssue(canonical, declaration.sceneMode, declaration);
  if (issue) throw new SheetMechanicsPreflightError(`${issue}; ресурсы не списаны`);
}

function primitiveCommand(
  input: SheetActionExecutionInput,
  world: WorldState,
  primitive: string,
  declaration: SheetCanonicalCommandInput,
): GameCommand {
  const canonical = canonicalInputIssue(input.canonical, primitive);
  return buildSheetCanonicalCommand({
    world,
    actorId: canonical.runtime.actorId,
    action: canonical.action,
    primitiveType: primitive,
    commandId: sheetPrimitiveCommandId(
      canonical.runtime.actorId,
      canonical.action.id,
      world.revision,
    ),
    declaration,
  });
}

function engineEvents(
  events: readonly UncommittedRuleEvent[],
  action?: RuleActionDefinition,
  world?: WorldState,
): ExecuteResult['events'] {
  const createdObjectNames = new Map<string, string>();
  for (const event of events) {
    if (event.payload.type !== 'WorldObjectMutationRecorded') continue;
    const mutation = event.payload.event;
    if (mutation.type === 'WorldObjectCreated') {
      createdObjectNames.set(mutation.object.id, mutation.object.name);
    }
  }
  return events.flatMap((event): ExecuteResult['events'] => {
    if (event.payload.type === 'EngineEventRecorded') return [event.payload.event];
    if (event.payload.type !== 'WorldObjectMutationRecorded' || !action) return [];
    const mutation = event.payload.event;
    if (mutation.type === 'WorldObjectCreated') {
      if (mutation.object.illusion) {
        const illusion = mutation.object.illusion;
        const form = illusion.form === 'sound' ? 'звук' : 'изображение';
        return [{
          type: 'narrative',
          text: `${action.name}: создана иллюзия «${illusion.description}» (${form}). `
            + `Изучение: Интеллект (Расследование) против СЛ ${illusion.spellSaveDc}.`,
        }];
      }
      return [{ type: 'narrative', text: `${action.name}: создан объект «${mutation.object.name}»` }];
    }
    const object = world?.objects[mutation.objectId];
    const name = object?.name ?? createdObjectNames.get(mutation.objectId);
    if (mutation.type === 'WorldObjectRemoved') {
      if (mutation.reason === 'instantaneous_effect_completed') {
        return [{
          type: 'narrative',
          text: name
            ? `${action.name}: мгновенный эффект «${name}» завершён`
            : `${action.name}: мгновенный эффект завершён`,
        }];
      }
      return [{
        type: 'narrative',
        text: name
          ? `${action.name}: объект «${name}» удалён`
          : `${action.name}: объект удалён`,
      }];
    }
    if (mutation.type === 'WorldObjectObserved') {
      return [{
        type: 'narrative',
        text: name
          ? `${action.name}: зафиксировано наблюдение для «${name}»`
          : `${action.name}: наблюдение зафиксировано`,
      }];
    }
    return [{
      type: 'narrative',
      text: name
        ? `${action.name}: объект «${name}» изменён`
        : `${action.name}: объект изменён`,
    }];
  });
}

function executeCanonicalPrimitive(
  input: SheetActionExecutionInput,
  primitive: string,
): SheetActionExecutionResult {
  const canonical = canonicalInputIssue(input.canonical, primitive);
  const synchronized = synchronizeSheetCanonicalRuntime(
    canonical.runtime.world,
    canonical.runtime.actorId,
    input.state,
    Object.keys(canonical.runtime.resourceBindings),
  );
  const declaration = primitiveDeclaration(input, synchronized, primitive);
  assertSheetPrimitiveCastTiming(canonical, declaration);
  const world = stageSheetScenarioObjects(synchronized, declaration.scenarioObjects);
  const command = primitiveCommand(input, world, primitive, declaration);
  const session = new InMemoryRulesSession(world, canonical.runtime.catalog, {
    rng: input.context.rng,
    clock: createLogicalClock(world.logicalClock),
    nextId: input.context.nextId
      ?? createSequentialIdFactory(`sheet-${canonical.runtime.actorId}-${world.revision}`),
  });
  const result = session.dispatch(command);
  if (result.status === 'rejected') {
    throw new SheetCanonicalCommandRejectedError(result.code, result.message);
  }
  const pendingResolution = session.getState().pendingResolution;
  const actor = session.getState().actors[canonical.runtime.actorId];
  if (!actor) throw new SheetMechanicsPreflightError('Canonical action removed its owning actor');
  return {
    state: actor.runtime,
    events: engineEvents(session.getEvents(), canonical.action, session.getState()),
    canonicalWorld: session.getState(),
    ruleEvents: session.getEvents(),
    pendingResolution,
  };
}

/** Execute an ordinary canonical action against a detached, complete actor set. */
export function executeSheetCanonicalAction(
  input: SheetCanonicalActionValidationInput,
): SheetCanonicalActionDispatchResult {
  const synchronized = synchronizeSheetCanonicalRuntime(
    input.canonical.runtime.world,
    input.canonical.runtime.actorId,
    input.state,
    Object.keys(input.canonical.runtime.resourceBindings),
  );
  let world = stageSheetScenarioObjects(
    synchronized,
    input.declaration.scenarioObjects,
  );
  const actors = { ...world.actors };
  const suppliedActorIds = new Set<string>();
  for (const rawActor of input.targetActors ?? []) {
    if (rawActor.id === input.canonical.runtime.actorId) {
      throw new SheetMechanicsPreflightError('A target actor cannot replace the acting sheet actor');
    }
    if (suppliedActorIds.has(rawActor.id)) {
      throw new SheetMechanicsPreflightError(`Canonical target actor ${rawActor.id} is supplied twice`);
    }
    suppliedActorIds.add(rawActor.id);
    // An ordinary sheet world may retain a prior cross-sheet concentration
    // participant. Replace that cached actor with the freshly loaded server
    // snapshot before evaluating either the new action or concentration cleanup.
    const actor = JSON.parse(JSON.stringify(rawActor)) as ActorState;
    actors[rawActor.id] = {
      ...actor,
      lifecycle: actor.lifecycle ?? { status: 'alive' },
      attackProfile: actor.attackProfile ?? defaultAttackProfile(actor),
    };
  }
  world = { ...world, actors };
  const primitive = primitiveType(input.canonical.action.mechanics) ?? '';
  const command = buildSheetCanonicalCommand({
    world,
    actorId: input.canonical.runtime.actorId,
    action: input.canonical.action,
    primitiveType: primitive,
    commandId: input.commandId ?? sheetPrimitiveCommandId(
      input.canonical.runtime.actorId,
      input.canonical.action.id,
      world.revision,
    ),
    declaration: input.declaration,
  });
  const session = new InMemoryRulesSession(world, input.canonical.runtime.catalog, {
    rng: input.rng ?? (() => 0.5),
    clock: createLogicalClock(world.logicalClock),
    nextId: createSequentialIdFactory(
      `sheet-validation-${input.canonical.runtime.actorId}-${world.revision}`,
    ),
  });
  const result = session.dispatch(command);
  if (result.status === 'rejected') {
    throw new SheetCanonicalCommandRejectedError(result.code, result.message);
  }
  if (input.resolveTargetSaves) {
    const resumedResolutionIds = new Set<string>();
    let pending = session.getState().pendingResolution;
    let resolutionIndex = 0;
    while (pending?.type === 'target_save') {
      if (resumedResolutionIds.has(pending.id)) {
        throw new SheetMechanicsPreflightError(
          `Canonical target-save continuation ${pending.id} did not advance`,
        );
      }
      resumedResolutionIds.add(pending.id);
      const resolved = session.dispatch({
        schemaVersion: 1,
        type: 'ResolveDecision',
        commandId: `${command.commandId}:target-save:${resolutionIndex}`,
        expectedRevision: session.getState().revision,
        rulesetContentHash: command.rulesetContentHash,
        actorId: pending.targetActorId,
        resolutionId: pending.id,
        requestId: pending.request.id,
        response: { kind: 'roll', roll: { mode: 'system' } },
      });
      if (resolved.status === 'rejected') {
        throw new SheetCanonicalCommandRejectedError(resolved.code, resolved.message);
      }
      pending = session.getState().pendingResolution;
      resolutionIndex += 1;
    }
  }
  const canonicalWorld = session.getState();
  const actor = canonicalWorld.actors[input.canonical.runtime.actorId];
  if (!actor) throw new SheetMechanicsPreflightError('Canonical action removed its owning actor');
  return {
    state: actor.runtime,
    events: engineEvents(session.getEvents(), input.canonical.action, canonicalWorld),
    canonicalWorld,
    ruleEvents: session.getEvents(),
    pendingResolution: canonicalWorld.pendingResolution,
  };
}

/**
 * Runs an ordinary canonical action in a detached world as a pre-payment
 * legality check. The accepted world is deliberately discarded by this
 * wrapper; callers that own persistence use executeSheetCanonicalAction after
 * the user confirms the action.
 */
export function validateSheetCanonicalAction(
  input: SheetCanonicalActionValidationInput,
): WorldState {
  return executeSheetCanonicalAction(input).canonicalWorld;
}

/**
 * Pure orchestration boundary used by the real sheet. Rules remain in the
 * mechanics payload and engine primitives; callers own dialogs, target lookup,
 * persistence, and the explicitly injected RNG/id environment.
 */
export function executeSheetAction(
  input: SheetActionExecutionInput,
): SheetActionExecutionResult {
  const primitive = preflightSheetMechanics(input.mechanics, input.context);
  if (primitive) {
    if (!isSheetNoPendingPrimitive(primitive)) {
      throw new UnsupportedSheetPrimitiveError(primitive);
    }
    return executeCanonicalPrimitive(input, primitive);
  }
  const context = input.canonical?.action.name
    ? { ...input.context, actionName: input.canonical.action.name }
    : input.context;
  return { ...executeAction(input.state, input.mechanics, context), pendingResolution: null };
}

/** Deterministic planning pass for the sheet's dice dialog. */
export function planSheetActionDice(
  input: SheetActionExecutionInput & { skipTargetSave?: boolean },
): PlannedDie[] {
  const primitive = preflightSheetMechanics(input.mechanics, input.context);
  if (primitive) {
    if (!isSheetNoPendingPrimitive(primitive)) {
      throw new UnsupportedSheetPrimitiveError(primitive);
    }
    const canonical = canonicalInputIssue(input.canonical, primitive);
    const synchronized = synchronizeSheetCanonicalRuntime(
      canonical.runtime.world,
      canonical.runtime.actorId,
      input.state,
      Object.keys(canonical.runtime.resourceBindings),
    );
    const declaration = primitiveDeclaration(input, synchronized, primitive);
    assertSheetPrimitiveCastTiming(canonical, declaration);
    const world = stageSheetScenarioObjects(synchronized, declaration.scenarioObjects);
    primitiveCommand(input, world, primitive, declaration);
    return [];
  }
  const result = executeSheetAction(input);
  return extractDiceFromEvents(result.events, input.skipTargetSave ?? false);
}

function choice(
  id: string,
  prompt: string,
  items: Array<{ id: string; name: string }>,
  recommended?: string[],
): PendingChoice {
  return {
    id,
    prompt,
    count: 1,
    source: 'item',
    items,
    options: { source: 'item', items },
    ...(recommended?.length ? { recommended } : {}),
    origin: { kind: 'other', id: 'canonical-sheet-primitive', name: 'Правила D&D 2024' },
    context: 'in_play',
  };
}

/** Data-independent UI projection: choices name identities, rules-core validates them. */
export function collectSheetPrimitiveChoices(
  canonical: SheetCanonicalActionContext | undefined,
  sceneMode: SheetCanonicalCommandInput['sceneMode'] = 'exploration',
): PendingChoice[] {
  if (!canonical) return [];
  const primitive = primitiveType(canonical.action.mechanics);
  if (!primitive) return [];
  if (!isSheetSupportedPrimitive(primitive)) {
    throw new UnsupportedSheetPrimitiveError(primitive);
  }
  const actor = canonical.runtime.world.actors[canonical.runtime.actorId];
  if (!actor) throw new SheetMechanicsPreflightError('Canonical actor is unavailable');
  if (primitive === 'pact_blade_bond') {
    const weapons = canonical.runtime.cards
      .filter((card): card is Card => isPactBladeConjurableCard(card))
      .map((card) => ({ id: card.id, name: card.name }))
      .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
    if (!weapons.length) {
      throw new SheetMechanicsPreflightError(
        'Pact Blade needs an immutable Simple or Martial Melee weapon Card in the rules catalog',
      );
    }
    const hands = (['main_hand', 'off_hand'] as const)
      .filter((hand) => !actor.runtime.equipment[hand])
      .map((hand) => ({ id: hand, name: hand === 'main_hand' ? 'Основная рука' : 'Вторая рука' }));
    if (!hands.length) throw new SheetMechanicsPreflightError('Pact Blade requires a free hand');
    return [
      choice(PACT_BLADE_WEAPON_CHOICE, 'Какое оружие призвать?', weapons, [weapons[0].id]),
      choice(PACT_BLADE_HAND_CHOICE, 'В какой руке появится оружие?', hands, [hands[0].id]),
    ];
  }
  if (primitive === WILD_COMPANION_PRIMITIVE) {
    const forms = FAMILIAR_ACTOR_CATALOG.forms
      .filter((form) => form.eligibility === 'base_standard')
      .map((form) => ({ id: form.formId, name: form.name }));
    return [choice(
      FIND_FAMILIAR_FORM_CHOICE,
      'Форма дикого спутника',
      forms,
      forms[0] ? [forms[0].id] : undefined,
    )];
  }
  if (primitive === UNARMED_STRIKE_PRIMITIVE) {
    return [choice(
      UNARMED_STRIKE_CHOICE_ID,
      'Вариант безоружного удара',
      [
        { id: 'damage', name: 'Нанести урон' },
        { id: 'grapple', name: 'Схватить' },
        { id: 'shove', name: 'Толкнуть' },
      ],
      ['damage'],
    )];
  }
  let castOptions = canonical.action.kind === 'spell'
    ? collectSheetSpellCastOptions({ runtime: canonical.runtime, action: canonical.action })
    : [];
  const castTime = parseActivationCastTime(canonical.action.mechanics);
  if (sceneMode === 'encounter' && castTime.status === 'valid'
    && !castTime.policy.atomicInEncounter) {
    if (primitive !== FIND_FAMILIAR_PRIMITIVE) {
      throw new SheetMechanicsPreflightError(
        `${canonical.action.name} требует ${castTime.policy.seconds} сек. и недоступно в бою`,
      );
    }
    castOptions = castOptions.filter((option) => isPactChainActionCast(canonical, {
      sceneMode,
      targetIds: [],
      spell: option.declaration,
      choices: { [FIND_FAMILIAR_CAST_PATH_CHOICE]: 'pact_chain_magic_action' },
    }));
  }
  if (canonical.action.kind === 'spell' && !castOptions.length) {
    throw new SheetMechanicsPreflightError(
      `${canonical.action.id} has no currently payable source-scoped cast`,
    );
  }
  const castChoice = castOptions.length
    ? [choice(
      SHEET_SPELL_CAST_CHOICE,
      'Источник и способ сотворения',
      castOptions.map((option) => ({ id: option.id, name: option.label })),
      [castOptions[0].id],
    )]
    : [];
  if (primitive === 'temporary_hp_melee_retaliation') {
    return [
      choice('temporary_hp', 'Какие временные хиты оставить?', [
        { id: 'take_spell', name: 'Принять временные хиты заклинания' },
        { id: 'keep_current', name: 'Сохранить текущие временные хиты' },
      ], ['take_spell']),
      ...castChoice,
    ];
  }
  if (primitive !== FIND_FAMILIAR_PRIMITIVE) return castChoice;
  const materialCost = findFamiliarMaterialCost(canonical.action);
  if (!materialCost) {
    throw new SheetMechanicsPreflightError(
      'Find Familiar has no valid mechanics-owned material activation cost',
    );
  }
  if ((actor.runtime.resources[materialCost.resource] ?? 0) < materialCost.amount
    || actor.character.resourceRecharge?.[materialCost.resource] !== materialCost.recharge) {
    throw new SheetMechanicsPreflightError(
      `Find Familiar requires ${materialCost.amount} ${materialCost.binding.currency} in ${materialCost.resource}`,
    );
  }
  const chain = actor.warlockPacts?.chain?.template.findFamiliarActionId === canonical.action.id;
  const forms = FAMILIAR_ACTOR_CATALOG.forms
    .filter((form) => form.eligibility === 'base_standard' || chain)
    .map((form) => ({ id: form.formId, name: form.name }));
  return [
    choice(FIND_FAMILIAR_FORM_CHOICE, 'Форма фамильяра', forms, [forms[0].id]),
    choice(FIND_FAMILIAR_SPIRIT_CHOICE, 'Тип духа', [
      { id: 'celestial', name: 'Небожитель' },
      { id: 'fey', name: 'Фея' },
      { id: 'fiend', name: 'Исчадие' },
    ], ['fey']),
    ...castChoice,
  ];
}

export class UnsupportedSheetPendingResolutionError extends Error {
  constructor(readonly pendingType: PendingResolution['type']) {
    super(
      `The compatible character sheet cannot resume canonical pending resolution ${pendingType}`,
    );
    this.name = 'UnsupportedSheetPendingResolutionError';
  }
}

/**
 * The legacy-compatible sheet has no durable canonical continuation store yet.
 * A parity projection may therefore consume only a fully resolved WorldState;
 * treating a continuation as a completed action would lose target decisions.
 */
export function assertSheetParityHasNoPendingResolution(
  pending: PendingResolution | null,
): void {
  if (pending) throw new UnsupportedSheetPendingResolutionError(pending.type);
}
