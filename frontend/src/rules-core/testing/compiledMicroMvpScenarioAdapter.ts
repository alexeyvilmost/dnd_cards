import type {
  CompiledMicroMvpL1Provider,
  CompiledMicroMvpL1Root,
} from '../../canon/microMvpL1Overlay';
import { canonicalStringify } from '../determinism';
import type {
  ActorState,
  RuleActionDefinition,
  RulesCatalog,
  RulesetReference,
} from '../domain';
import type { SpellAccessKind, SpellcastingAccessState } from '../spellcastingAccess';
import type { ScenarioFixtureProvider } from './scenario';
import { PACT_TOME_STATE_CAPABILITY } from '../warlockPacts';
import type { WorldObjectState } from '../worldObjects';

type CompiledDecision = CompiledMicroMvpL1Root['decisions'][number];
type CompiledRuleState = CompiledMicroMvpL1Root['ruleState'];

export interface CompiledScenarioEntitySource {
  id: string;
  cardNumber: string;
}

/**
 * Serializable build facts retained beside an executable scenario actor.
 * These are audit data, not a second mechanics implementation: action
 * mechanics remain exclusively in the compiled RulesCatalog.
 */
export interface CompiledScenarioSource {
  schemaVersion: 1;
  fixtureId: string;
  sourceFixtureId: string;
  stableKey: string;
  ruleset: RulesetReference;
  entities: {
    species: CompiledScenarioEntitySource;
    class: CompiledScenarioEntitySource;
    background: CompiledScenarioEntitySource;
    originFeat: CompiledScenarioEntitySource;
    lineage?: CompiledScenarioEntitySource;
  };
  selectedSpellIds: string[];
  selectedInvocationEffectIds: string[];
  excludedResourceIds: string[];
}

/**
 * ActorState enriched only with canonical compiler output needed by scenario
 * diagnostics and future preparation/rest flows. Unknown JSON-compatible
 * actor extensions are deliberately retained so newly introduced traits do
 * not disappear at this boundary.
 */
export type CompiledMicroMvpScenarioActorState = ActorState & {
  compiledSource: CompiledScenarioSource;
  choices: CompiledDecision[];
  ruleState: CompiledRuleState;
  spellcastingAccess?: SpellcastingAccessState;
  traits?: unknown;
  [key: string]: unknown;
};

export interface CompiledMicroMvpScenarioFixture {
  fixtureId: string;
  actor: CompiledMicroMvpScenarioActorState;
  actions: RuleActionDefinition[];
  /** Source-owned non-creature state produced by compiled rest decisions. */
  objects: WorldObjectState[];
}

export interface CompiledMicroMvpScenarioFixtureProvider extends ScenarioFixtureProvider {
  ruleset: RulesetReference;
  fixtureIds: readonly string[];
  getActor(fixtureId: string): CompiledMicroMvpScenarioActorState | undefined;
  getFixture(fixtureId: string): CompiledMicroMvpScenarioFixture | undefined;
}

export class CompiledMicroMvpScenarioAdapterError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`Compiled micro-MVP scenario adapter rejected its input:\n${problems.join('\n')}`);
    this.name = 'CompiledMicroMvpScenarioAdapterError';
  }
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertJsonCompatible(value: unknown, path: string, seen = new Set<object>()): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${path} contains a non-finite number`);
    return;
  }
  if (typeof value !== 'object') throw new Error(`${path} contains non-JSON ${typeof value}`);
  if (seen.has(value)) throw new Error(`${path} contains a cycle`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== Array.prototype && prototype !== null) {
    throw new Error(`${path} contains a non-JSON object`);
  }
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJsonCompatible(item, `${path}[${index}]`, seen));
  } else {
    for (const [key, item] of Object.entries(value)) {
      // Canonical JSON intentionally applies ordinary JSON object semantics:
      // optional properties materialized as `undefined` are omitted. Undefined
      // array entries are still rejected because JSON would turn them into
      // misleading null values.
      if (item === undefined) continue;
      assertJsonCompatible(item, `${path}.${key}`, seen);
    }
  }
  seen.delete(value);
}

function canonicalClone<T>(value: T, path: string): T {
  assertJsonCompatible(value, path);
  return JSON.parse(canonicalStringify(value)) as T;
}

function nonBlank(value: unknown, path: string, problems: string[]): value is string {
  if (typeof value === 'string' && value.trim().length > 0) return true;
  problems.push(`${path} must be a non-blank string`);
  return false;
}

function uniqueStrings(value: unknown, path: string, problems: string[]): value is string[] {
  if (!Array.isArray(value)) {
    problems.push(`${path} must be an array`);
    return false;
  }
  const strings = value.filter((item): item is string => typeof item === 'string');
  if (strings.length !== value.length || strings.some((item) => !item.trim())) {
    problems.push(`${path} must contain only non-blank strings`);
    return false;
  }
  if (new Set(strings).size !== strings.length) {
    problems.push(`${path} must not contain duplicates`);
    return false;
  }
  return true;
}

function nonEmptyStrings(
  value: unknown,
  path: string,
  problems: string[],
): value is [string, ...string[]] {
  if (!Array.isArray(value) || value.length === 0
    || value.some((item) => typeof item !== 'string' || !item.trim())) {
    problems.push(`${path} must contain at least one non-blank string`);
    return false;
  }
  return true;
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  return canonicalStringify([...left].sort()) === canonicalStringify([...right].sort());
}

function actionActivationMode(action: RuleActionDefinition): string | undefined {
  const activation = action.mechanics.activation;
  return isRecord(activation) && typeof activation.mode === 'string'
    ? activation.mode
    : undefined;
}

function isDirectAction(action: RuleActionDefinition): boolean {
  return actionActivationMode(action) !== 'rest_decision';
}

interface PactTomeCatalogAuthority {
  sourceEntityId: string;
  classEntityId: string;
  selectedCantripActionIds: ReadonlySet<string>;
  selectedRitualActionIds: ReadonlySet<string>;
  selectedActionIds: ReadonlySet<string>;
}

interface CompiledActionOwnership {
  actorOwnedDirectActions: RuleActionDefinition[];
  catalogOnlyRestActions: RuleActionDefinition[];
  catalogOnlyTomeActions: RuleActionDefinition[];
}

function canonicalPactTomeAuthority(
  root: CompiledMicroMvpL1Root,
  actorOwnedActionIds: ReadonlySet<string>,
  problems: string[],
): PactTomeCatalogAuthority | undefined {
  const invocation = root.actor.warlockPacts?.tome;
  if (!invocation) return undefined;

  let valid = true;
  const reject = (problem: string): void => {
    valid = false;
    problems.push(problem);
  };
  const sourceEntityId = invocation.sourceEntityId;
  if (root.matrixCase.klass.card_number !== 'CLASS-warlock') {
    reject('Pact Tome catalog authority requires a compiled Warlock root');
  }
  if (invocation.kind !== 'tome'
    || typeof sourceEntityId !== 'string'
    || !sourceEntityId.trim()
    || invocation.ownerActorId !== root.actor.id
    || invocation.tome.sourceEntityId !== sourceEntityId
    || invocation.tome.ownerActorId !== root.actor.id) {
    reject('Pact Tome catalog authority has foreign owner or invocation-source state');
  }

  const featureSources = root.actor.capabilities.featureSources?.[PACT_TOME_STATE_CAPABILITY];
  const expectedFeatureSources = [
    sourceEntityId,
    'EFF-pact-tome',
    root.matrixCase.klass.id,
    root.matrixCase.klass.card_number,
  ];
  if (!featureSources
    || !Array.isArray(featureSources)
    || featureSources.length === 0
    || featureSources.some((source) => typeof source !== 'string' || !source.trim())
    || new Set(featureSources).size !== featureSources.length
    || !sameStringSet(featureSources, expectedFeatureSources)) {
    reject(`actor capability ${PACT_TOME_STATE_CAPABILITY} does not prove the canonical Tome source`);
  }
  if (!sameStringSet(root.selectedInvocationEffectIds, [sourceEntityId])) {
    reject('Pact Tome catalog authority disagrees with root.selectedInvocationEffectIds');
  }
  const invocationEntities = root.assembled.effects.filter(({ effect }) => (
    effect.id === sourceEntityId && effect.card_number === 'EFF-pact-tome'
  ));
  if (invocationEntities.length !== 1) {
    reject('Pact Tome catalog authority requires exactly one assembled Pact Tome entity');
  }

  const cantripActionIds = invocation.tome.cantripActionIds;
  const ritualActionIds = invocation.tome.ritualActionIds;
  const selectedActionIds = [...cantripActionIds, ...ritualActionIds];
  if (cantripActionIds.length !== 3
    || ritualActionIds.length !== 2
    || selectedActionIds.some((actionId) => typeof actionId !== 'string' || !actionId.trim())
    || new Set(selectedActionIds).size !== 5) {
    reject('Pact Tome state must select exactly three cantrips and two distinct rituals');
  }
  const missingOwnedSelections = selectedActionIds.filter((actionId) => !actorOwnedActionIds.has(actionId));
  if (missingOwnedSelections.length) {
    reject(`Pact Tome selected actions are not actor-owned: ${missingOwnedSelections.join(', ')}`);
  }

  const access = root.actor.spellcastingAccess;
  if (!access) {
    reject('Pact Tome catalog authority requires actor spellcastingAccess');
  } else {
    const bookGrants = access.grants.filter((grant) => (
      grant.sourceId === invocation.tome.bookObjectId
    ));
    if (!sameStringSet(
      bookGrants.map((grant) => grant.grantId),
      invocation.tome.spellGrantIds,
    ) || !sameStringSet(
      bookGrants.map((grant) => grant.actionId),
      selectedActionIds,
    )) {
      reject('Pact Tome state and source-owned Book of Shadows grants disagree');
    }
  }

  return valid ? {
    sourceEntityId,
    classEntityId: root.matrixCase.klass.id,
    selectedCantripActionIds: new Set(cantripActionIds),
    selectedRitualActionIds: new Set(ritualActionIds),
    selectedActionIds: new Set(selectedActionIds),
  } : undefined;
}

/**
 * A Tome alternative is catalog data, not actor state. Its admission therefore
 * requires the complete compiler-owned invocation scope; merely being a spell
 * (or merely sharing one source string) is intentionally insufficient.
 */
function isCanonicalPactTomeCatalogAction(
  action: RuleActionDefinition,
  authority: PactTomeCatalogAuthority,
): boolean {
  if (action.kind !== 'spell'
    || action.spell.sourceClass !== 'CLASS-warlock'
    || typeof action.spell.ritual !== 'boolean'
    || !Array.isArray(action.spell.classListIds)
    || action.spell.classListIds.length === 0
    || action.spell.classListIds.some((classId) => typeof classId !== 'string' || !classId.trim())
    || new Set(action.spell.classListIds).size !== action.spell.classListIds.length) {
    return false;
  }
  const immutableSpellEntityIds = action.sourceEntityIds.filter((sourceId) => (
    sourceId !== authority.sourceEntityId && sourceId !== authority.classEntityId
  ));
  if (immutableSpellEntityIds.length !== 1
    || !sameStringSet(action.sourceEntityIds, [
      immutableSpellEntityIds[0],
      authority.sourceEntityId,
      authority.classEntityId,
    ])
    || action.id !== `${immutableSpellEntityIds[0]}@${authority.sourceEntityId}`) {
    return false;
  }
  return action.spell.level === 0
    || (action.spell.level === 1 && action.spell.ritual === true);
}

function validateCompiledActionOwnership(
  root: CompiledMicroMvpL1Root,
  actions: readonly RuleActionDefinition[],
  problems: string[],
): CompiledActionOwnership {
  const rawActionIds: unknown = root.actor.capabilities?.actionIds;
  uniqueStrings(rawActionIds, 'actor.capabilities.actionIds', problems);
  const actorOwnedActionIds = new Set<string>(
    Array.isArray(rawActionIds)
      ? rawActionIds.filter((actionId): actionId is string => typeof actionId === 'string')
      : [],
  );
  const actionsById = new Map(actions.map((action) => [action.id, action]));
  for (const actionId of actorOwnedActionIds) {
    const action = actionsById.get(actionId);
    if (!action) {
      problems.push(
        'actor direct-action ownership must exactly equal executable root.rulesActions outside '
        + `approved catalog-only actions: actor-owned action ${actionId} is missing`,
      );
    } else if (!isDirectAction(action)) {
      problems.push(`catalog-only rest decision ${actionId} must not be actor-owned`);
    }
  }

  const tomeAuthority = canonicalPactTomeAuthority(root, actorOwnedActionIds, problems);
  const actorOwnedDirectActions: RuleActionDefinition[] = [];
  const catalogOnlyRestActions: RuleActionDefinition[] = [];
  const catalogOnlyTomeActions: RuleActionDefinition[] = [];
  for (const action of actions) {
    if (actorOwnedActionIds.has(action.id)) {
      if (isDirectAction(action)) actorOwnedDirectActions.push(action);
      continue;
    }
    if (!isDirectAction(action)) {
      catalogOnlyRestActions.push(action);
      continue;
    }
    if (tomeAuthority && isCanonicalPactTomeCatalogAction(action, tomeAuthority)) {
      catalogOnlyTomeActions.push(action);
      continue;
    }
    problems.push(
      'actor direct-action ownership must exactly equal executable root.rulesActions outside '
      + `approved catalog-only actions: ${action.id} is an orphan direct action`,
    );
  }

  if (tomeAuthority) {
    const sourceScopedActions = actions.filter((action) => (
      action.sourceEntityIds.includes(tomeAuthority.sourceEntityId)
    ));
    const malformed = sourceScopedActions.filter((action) => (
      !isCanonicalPactTomeCatalogAction(action, tomeAuthority)
    ));
    if (malformed.length) {
      problems.push(`Pact Tome source contains malformed actions: ${malformed.map((action) => action.id).join(', ')}`);
    }
    const actorOwnedTomeActionIds = sourceScopedActions
      .filter((action) => actorOwnedActionIds.has(action.id))
      .map((action) => action.id);
    if (!sameStringSet(actorOwnedTomeActionIds, [...tomeAuthority.selectedActionIds])) {
      problems.push('actor-owned Pact Tome actions must exactly equal the active Book of Shadows selections');
    }
    for (const action of sourceScopedActions) {
      if (tomeAuthority.selectedCantripActionIds.has(action.id) && (
        action.kind !== 'spell' || action.spell.level !== 0
      )) {
        problems.push(`Pact Tome selected cantrip ${action.id} is not a level-0 spell`);
      }
      if (tomeAuthority.selectedRitualActionIds.has(action.id) && (
        action.kind !== 'spell' || action.spell.level !== 1 || action.spell.ritual !== true
      )) {
        problems.push(`Pact Tome selected ritual ${action.id} is not a level-1 Ritual spell`);
      }
    }
  }

  const featureSources = root.actor.capabilities.featureSources;
  for (const action of [...catalogOnlyRestActions, ...catalogOnlyTomeActions]) {
    if (featureSources?.[action.id] !== undefined) {
      problems.push(`catalog-only action ${action.id} must not have actor capability provenance`);
    }
  }

  return { actorOwnedDirectActions, catalogOnlyRestActions, catalogOnlyTomeActions };
}

function validateResourceState(actor: ActorState, problems: string[]): void {
  const current = actor.runtime?.resources;
  const maximum = actor.runtime?.maxResources;
  if (!isRecord(current) || !isRecord(maximum)) {
    problems.push('actor.runtime resources and maxResources must be objects');
    return;
  }
  const currentKeys = Object.keys(current).sort();
  const maximumKeys = Object.keys(maximum).sort();
  if (canonicalStringify(currentKeys) !== canonicalStringify(maximumKeys)) {
    problems.push('actor.runtime resources and maxResources must have identical keys');
  }
  for (const key of new Set([...currentKeys, ...maximumKeys])) {
    const value = current[key];
    const max = maximum[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0
      || typeof max !== 'number' || !Number.isFinite(max) || max < 0) {
      problems.push(`actor.runtime resource ${key} must have finite non-negative current/max values`);
      continue;
    }
    if (value > max) problems.push(`actor.runtime resource ${key} exceeds its maximum`);
  }
}

function validateAction(action: RuleActionDefinition, problems: string[]): void {
  const actionId: string = action.id;
  if (!nonBlank(actionId, 'action.id', problems)) return;
  nonBlank(action.name, `action ${actionId}.name`, problems);
  if (action.kind !== 'spell' && action.kind !== 'nonSpell') {
    problems.push(`action ${actionId} has unsupported kind`);
  }
  uniqueStrings(action.sourceEntityIds, `action ${actionId}.sourceEntityIds`, problems);
  if (!isRecord(action.mechanics)) problems.push(`action ${actionId}.mechanics must be an object`);
  if (action.kind === 'spell') {
    if (!Number.isInteger(action.spell.level) || action.spell.level < 0 || action.spell.level > 9) {
      problems.push(`action ${actionId} has invalid spell level`);
    }
  }
}

function validateSpellcastingAccess(
  actor: ActorState & { spellcastingAccess?: SpellcastingAccessState },
  actionsById: ReadonlyMap<string, RuleActionDefinition>,
  problems: string[],
): void {
  const access = actor.spellcastingAccess;
  if (access === undefined) {
    if ([...actionsById.values()].some((action) => action.kind === 'spell')) {
      problems.push('actor owns spell actions but has no spellcastingAccess state');
    }
    return;
  }
  if (!isRecord(access) || !Array.isArray(access.grants) || !isRecord(access.preparedSources)) {
    problems.push('actor.spellcastingAccess must contain grants and preparedSources');
    return;
  }
  const grantIds: string[] = [];
  for (const [index, grant] of access.grants.entries()) {
    const path = `actor.spellcastingAccess.grants[${index}]`;
    if (!isRecord(grant)) {
      problems.push(`${path} must be an object`);
      continue;
    }
    if (nonBlank(grant.grantId, `${path}.grantId`, problems)) grantIds.push(grant.grantId);
    const actionId = nonBlank(grant.actionId, `${path}.actionId`, problems) ? grant.actionId : '';
    nonBlank(grant.sourceId, `${path}.sourceId`, problems);
    const accessKinds: readonly SpellAccessKind[] = [
      'cantrip', 'known', 'spellbook', 'always_prepared', 'innate', 'ritual_only',
    ];
    if (!accessKinds.includes(grant.access as SpellAccessKind)) {
      problems.push(`${path}.access is invalid`);
    }
    if (grant.access === 'ritual_only' && grant.ritual !== true) {
      problems.push(`${path}.ritual_only access requires ritual provenance`);
    }
    if (!['str', 'dex', 'con', 'int', 'wis', 'cha'].includes(String(grant.spellcastingAbility))) {
      problems.push(`${path}.spellcastingAbility is invalid`);
    }
    if (!Number.isInteger(grant.level) || Number(grant.level) < 0 || Number(grant.level) > 9) {
      problems.push(`${path}.level is invalid`);
    }
    const action = actionsById.get(actionId);
    if (!action || action.kind !== 'spell') {
      problems.push(`${path} references a spell action not owned by the actor`);
    } else if (action.spell.level !== grant.level) {
      problems.push(`${path}.level disagrees with compiled action ${actionId}`);
    }
    if (grant.freeUseResource !== undefined
      && (!nonBlank(grant.freeUseResource, `${path}.freeUseResource`, problems)
        || !(grant.freeUseResource in actor.runtime.maxResources))) {
      problems.push(`${path}.freeUseResource is not declared in actor.runtime.maxResources`);
    }
    if (grant.slotResource !== undefined) {
      // A grant may name a slot family that this actor does not currently
      // possess (Magic Initiate on a non-caster is the L1 example). The access
      // resolver then correctly exposes only its free use. If the character
      // later gains that slot through multiclassing, the same immutable grant
      // can spend it without recompiling the content source.
      nonBlank(grant.slotResource, `${path}.slotResource`, problems);
    }
  }
  if (new Set(grantIds).size !== grantIds.length) {
    problems.push('actor.spellcastingAccess grant IDs must be unique');
  }
  const grantedActionIds = new Set(access.grants.map((grant) => grant.actionId));
  for (const action of actionsById.values()) {
    if (action.kind === 'spell' && !grantedActionIds.has(action.id)) {
      problems.push(`spell action ${action.id} has no actor-owned spellcasting grant`);
    }
  }
  for (const [sourceId, source] of Object.entries(access.preparedSources)) {
    if (source === undefined) continue;
    if (!isRecord(source)) {
      problems.push(`actor.spellcastingAccess.preparedSources.${sourceId} must be an object`);
      continue;
    }
    if (source.sourceId !== sourceId) {
      problems.push(`prepared source ${sourceId} has a mismatched sourceId`);
    }
    if (!Number.isInteger(source.capacity) || Number(source.capacity) < 0) {
      problems.push(`prepared source ${sourceId} has invalid capacity`);
    }
    const availableValid = uniqueStrings(
      source.availableActionIds,
      `prepared source ${sourceId}.availableActionIds`,
      problems,
    );
    const preparedValid = uniqueStrings(
      source.preparedActionIds,
      `prepared source ${sourceId}.preparedActionIds`,
      problems,
    );
    if (preparedValid && source.preparedActionIds.length > Number(source.capacity)) {
      problems.push(`prepared source ${sourceId} exceeds its capacity`);
    }
    if (availableValid && preparedValid
      && source.preparedActionIds.some((actionId) => !source.availableActionIds.includes(actionId))) {
      problems.push(`prepared source ${sourceId} contains a spell outside its available collection`);
    }
    if (availableValid && source.availableActionIds.some((actionId) => (
      !access.grants.some((grant) => grant.sourceId === sourceId && grant.actionId === actionId)
    ))) {
      problems.push(`prepared source ${sourceId} contains an action without a matching grant`);
    }
  }
}

function validateActor(
  root: CompiledMicroMvpL1Root,
  actions: readonly RuleActionDefinition[],
  problems: string[],
): void {
  const actor = root.actor as ActorState & { spellcastingAccess?: SpellcastingAccessState };
  if (actor.id !== root.fixtureId) problems.push('actor.id must equal root.fixtureId');
  if (actor.kind !== 'playerCharacter') problems.push('compiled scenario actor must be a playerCharacter');
  nonBlank(actor.name, 'actor.name', problems);
  nonBlank(actor.controllerId, 'actor.controllerId', problems);
  if (!isRecord(actor.character) || !isRecord(actor.character.abilityMods)) {
    problems.push('actor.character and all ability modifiers are required');
  } else {
    for (const ability of ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const) {
      if (typeof actor.character.abilityMods[ability] !== 'number'
        || !Number.isFinite(actor.character.abilityMods[ability])) {
        problems.push(`actor.character.abilityMods.${ability} must be finite`);
      }
    }
  }
  if (!Number.isInteger(actor.character?.level) || actor.character.level < 1) {
    problems.push('actor.character.level must be a positive integer');
  }
  if (typeof actor.character?.profBonus !== 'number' || !Number.isFinite(actor.character.profBonus)) {
    problems.push('actor.character.profBonus must be finite');
  }
  const hp = actor.runtime?.hp;
  if (!hp || !Number.isFinite(hp.current) || !Number.isFinite(hp.max) || !Number.isFinite(hp.temp)
    || hp.max <= 0 || hp.current < 0 || hp.current > hp.max || hp.temp < 0) {
    problems.push('actor.runtime.hp must contain a valid current/max/temp state');
  }
  validateResourceState(actor, problems);
  if (!isRecord(actor.runtime?.equipment)) problems.push('actor.runtime.equipment must be an object');
  if (!Array.isArray(actor.runtime?.inventory)) problems.push('actor.runtime.inventory must be an array');
  if (!Array.isArray(actor.runtime?.activeEffects)) problems.push('actor.runtime.activeEffects must be an array');

  const ownership = validateCompiledActionOwnership(root, actions, problems);
  const restDecisionActions = ownership.catalogOnlyRestActions;
  for (const action of restDecisionActions) {
    if (action.kind !== 'nonSpell') {
      problems.push(`catalog-only rest decision ${action.id} must be non-spell`);
    }
    const capabilityId = action.restDecision?.capabilityId;
    if (!capabilityId) {
      problems.push(`catalog-only rest decision ${action.id} has no compiled rest policy`);
      continue;
    }
    const provenance = actor.capabilities.featureSources?.[capabilityId];
    if (!provenance) {
      problems.push(
        `catalog-only rest decision ${action.id} is missing ${capabilityId} provenance`,
      );
      continue;
    }
    if (!nonEmptyStrings(
      provenance,
      `actor.capabilities.featureSources.${capabilityId}`,
      problems,
    )) continue;
    const missingSources = action.sourceEntityIds.filter((sourceId) => !provenance.includes(sourceId));
    if (missingSources.length) {
      problems.push(
        `${capabilityId} does not prove catalog action ${action.id}: `
        + `missing ${missingSources.join(', ')}`,
      );
    }
  }
  const actorOwnedActionsById = new Map(
    ownership.actorOwnedDirectActions.map((action) => [action.id, action]),
  );
  validateSpellcastingAccess(actor, actorOwnedActionsById, problems);
}

function validateChoices(root: CompiledMicroMvpL1Root, problems: string[]): void {
  if (root.unresolvedAcquireChoiceIds.length || root.unresolvedRuntimeChoiceIds.length) {
    problems.push('compiled root contains unresolved choices');
  }
  const choiceIds: string[] = [];
  for (const [index, decision] of root.decisions.entries()) {
    const path = `root.decisions[${index}]`;
    if (nonBlank(decision.choiceId, `${path}.choiceId`, problems)) choiceIds.push(decision.choiceId);
    uniqueStrings(decision.optionIds, `${path}.optionIds`, problems);
    if (decision.stage !== 'creation' && decision.stage !== 'rest') problems.push(`${path}.stage is invalid`);
    if (decision.provenance !== 'overlay-policy') problems.push(`${path}.provenance is invalid`);
    const draftSelection = root.draft.resolvedChoices[decision.choiceId];
    if (draftSelection && !sameStringSet(draftSelection, decision.optionIds)) {
      problems.push(`${path} disagrees with draft.resolvedChoices`);
    }
  }
  if (new Set(choiceIds).size !== choiceIds.length) problems.push('root decision IDs must be unique');
  if (root.ruleState.version !== 1) problems.push('root.ruleState has an unsupported schema version');
}

function entitySource(
  value: { id: string; card_number: string },
  path: string,
  problems: string[],
): CompiledScenarioEntitySource {
  nonBlank(value.id, `${path}.id`, problems);
  nonBlank(value.card_number, `${path}.card_number`, problems);
  return { id: value.id, cardNumber: value.card_number };
}

function compiledSource(
  root: CompiledMicroMvpL1Root,
  ruleset: RulesetReference,
  problems: string[],
): CompiledScenarioSource {
  const entities: CompiledScenarioSource['entities'] = {
    species: entitySource(root.matrixCase.species, 'root.matrixCase.species', problems),
    class: entitySource(root.matrixCase.klass, 'root.matrixCase.klass', problems),
    background: entitySource(root.matrixCase.background, 'root.matrixCase.background', problems),
    originFeat: entitySource(root.matrixCase.originFeat, 'root.matrixCase.originFeat', problems),
  };
  const { lineageId, lineageCardNumber } = root.speciesAudit;
  if ((lineageId === undefined) !== (lineageCardNumber === undefined)) {
    problems.push('root.speciesAudit lineage id and card number must appear together');
  } else if (lineageId !== undefined && lineageCardNumber !== undefined) {
    entities.lineage = { id: lineageId, cardNumber: lineageCardNumber };
  }
  uniqueStrings(root.selectedSpellIds, 'root.selectedSpellIds', problems);
  uniqueStrings(root.selectedInvocationEffectIds, 'root.selectedInvocationEffectIds', problems);
  uniqueStrings(root.excludedResourceIds, 'root.excludedResourceIds', problems);
  return {
    schemaVersion: 1,
    fixtureId: root.fixtureId,
    sourceFixtureId: root.sourceFixtureId,
    stableKey: root.stableKey,
    ruleset,
    entities,
    selectedSpellIds: [...root.selectedSpellIds].sort(),
    selectedInvocationEffectIds: [...root.selectedInvocationEffectIds].sort(),
    excludedResourceIds: [...root.excludedResourceIds].sort(),
  };
}

/**
 * Adapt one compiler root without inventing actions, traits, resources, or
 * equipment. Any mismatch between the root's capability list and its actual
 * compiled actions is a hard error.
 */
export function adaptCompiledMicroMvpL1Root(
  root: CompiledMicroMvpL1Root,
  ruleset: RulesetReference,
): CompiledMicroMvpScenarioFixture {
  const problems: string[] = [];
  nonBlank(root.fixtureId, 'root.fixtureId', problems);
  nonBlank(root.sourceFixtureId, 'root.sourceFixtureId', problems);
  nonBlank(root.stableKey, 'root.stableKey', problems);
  if (ruleset.systemId !== 'dnd5e-2024') problems.push('ruleset.systemId must be dnd5e-2024');
  nonBlank(ruleset.releaseId, 'ruleset.releaseId', problems);
  nonBlank(ruleset.contentHash, 'ruleset.contentHash', problems);
  nonBlank(ruleset.errataVersion, 'ruleset.errataVersion', problems);

  const actionIds: string[] = [];
  for (const action of root.rulesActions) {
    validateAction(action, problems);
    actionIds.push(action.id);
  }
  if (new Set(actionIds).size !== actionIds.length) problems.push('root.rulesActions contains duplicate action IDs');
  validateActor(root, root.rulesActions, problems);
  validateChoices(root, problems);
  const source = compiledSource(root, ruleset, problems);

  try {
    assertJsonCompatible(root.actor, 'root.actor');
    assertJsonCompatible(root.decisions, 'root.decisions');
    assertJsonCompatible(root.ruleState, 'root.ruleState');
    assertJsonCompatible(root.rulesActions, 'root.rulesActions');
    assertJsonCompatible(root.initialWorldObjects, 'root.initialWorldObjects');
    assertJsonCompatible(source, 'compiledSource');
  } catch (error) {
    problems.push(error instanceof Error ? error.message : String(error));
  }
  if (problems.length) throw new CompiledMicroMvpScenarioAdapterError(problems);

  const actions = canonicalClone([...root.rulesActions], 'root.rulesActions')
    .sort((left, right) => left.id.localeCompare(right.id));
  const actor = canonicalClone(root.actor, 'root.actor') as CompiledMicroMvpScenarioActorState;
  const objects = canonicalClone([...root.initialWorldObjects], 'root.initialWorldObjects')
    .sort((left, right) => left.id.localeCompare(right.id));
  if (new Set(objects.map((object) => object.id)).size !== objects.length
    || objects.some((object) => !object.id.trim())) {
    throw new CompiledMicroMvpScenarioAdapterError([
      'root.initialWorldObjects must have unique non-blank IDs',
    ]);
  }
  const existingFeatureSources = actor.capabilities.featureSources ?? {};
  const actorOwnedActionIds = new Set(actor.capabilities.actionIds);
  const actorOwnedDirectActions = actions.filter((action) => (
    isDirectAction(action) && actorOwnedActionIds.has(action.id)
  ));
  const actionFeatureSources = Object.fromEntries(actorOwnedDirectActions.map((action) => (
    [action.id, [...action.sourceEntityIds] as [string, ...string[]]]
  ))) as NonNullable<ActorState['capabilities']['featureSources']>;
  for (const [actionId, sources] of Object.entries(actionFeatureSources)) {
    const existing = existingFeatureSources[actionId];
    if (existing && canonicalStringify(existing) !== canonicalStringify(sources)) {
      throw new CompiledMicroMvpScenarioAdapterError([
        `actor capability provenance for ${actionId} disagrees with its compiled action`,
      ]);
    }
  }
  actor.capabilities = {
    actionIds: actorOwnedDirectActions.map((action) => action.id),
    featureSources: canonicalClone({
      ...existingFeatureSources,
      ...actionFeatureSources,
    }, 'actor.capabilities.featureSources'),
  };
  actor.compiledSource = canonicalClone(source, 'compiledSource');
  actor.choices = canonicalClone([...root.decisions], 'root.decisions');
  actor.ruleState = canonicalClone(root.ruleState, 'root.ruleState');

  return {
    fixtureId: root.fixtureId,
    actor,
    actions,
    objects,
  };
}

function parseCanonical<T>(encoded: string): T {
  return JSON.parse(encoded) as T;
}

/**
 * Build an isolated scenario provider from the production compiler result.
 * `fixtureIds` can select the exact roots used by one scenario corpus; every
 * selected root is still validated in full. Both actors and action definitions
 * are returned as fresh canonical JSON values so one scenario cannot mutate
 * the next one's fixtures.
 */
export function createCompiledMicroMvpScenarioFixtureProvider(
  compiled: Pick<
    CompiledMicroMvpL1Provider,
    'catalog' | 'release' | 'roots' | 'ruleset'
  >,
  options: { fixtureIds?: readonly string[] } = {},
): CompiledMicroMvpScenarioFixtureProvider {
  const problems: string[] = [];
  if (compiled.ruleset.systemId !== compiled.release.systemId
    || compiled.ruleset.releaseId !== compiled.release.id
    || compiled.ruleset.contentHash !== compiled.release.contentHash
    || compiled.ruleset.errataVersion !== compiled.release.errataVersion) {
    problems.push('compiled provider ruleset and release metadata disagree');
  }
  const allRootsById = new Map(compiled.roots.map((root) => [root.fixtureId, root]));
  let roots = [...compiled.roots];
  if (options.fixtureIds !== undefined) {
    if (uniqueStrings(options.fixtureIds, 'options.fixtureIds', problems)) {
      roots = options.fixtureIds.flatMap((fixtureId) => {
        const root = allRootsById.get(fixtureId);
        if (!root) {
          problems.push(`requested compiled fixture ${fixtureId} does not exist`);
          return [];
        }
        return [root];
      });
    }
  }
  if (!roots.length) problems.push('compiled provider selection has no roots');
  const rootIds = roots.map((root) => root.fixtureId);
  if (new Set(rootIds).size !== rootIds.length) problems.push('compiled provider has duplicate fixture IDs');
  if (problems.length) throw new CompiledMicroMvpScenarioAdapterError(problems);

  const actorJsonByFixtureId = new Map<string, string>();
  const actionJsonById = new Map<string, string>();
  const actionIdsByFixtureId = new Map<string, string[]>();
  const objectsJsonByFixtureId = new Map<string, string>();
  for (const root of roots) {
    let fixture: CompiledMicroMvpScenarioFixture;
    try {
      fixture = adaptCompiledMicroMvpL1Root(root, compiled.ruleset);
    } catch (error) {
      if (error instanceof CompiledMicroMvpScenarioAdapterError) {
        throw new CompiledMicroMvpScenarioAdapterError(
          error.problems.map((problem) => `${root.stableKey}: ${problem}`),
        );
      }
      throw error;
    }
    actorJsonByFixtureId.set(fixture.fixtureId, canonicalStringify(fixture.actor));
    objectsJsonByFixtureId.set(fixture.fixtureId, canonicalStringify(fixture.objects));
    actionIdsByFixtureId.set(fixture.fixtureId, fixture.actions.map((action) => action.id));
    for (const action of fixture.actions) {
      const encoded = canonicalStringify(action);
      const existing = actionJsonById.get(action.id);
      if (existing !== undefined && existing !== encoded) {
        throw new CompiledMicroMvpScenarioAdapterError([
          `compiled action ${action.id} differs between actor roots`,
        ]);
      }
      const catalogAction = compiled.catalog.getAction(action.id);
      if (!catalogAction || canonicalStringify(catalogAction) !== encoded) {
        throw new CompiledMicroMvpScenarioAdapterError([
          `compiled catalog does not exactly contain compiled action ${action.id}`,
        ]);
      }
      actionJsonById.set(action.id, encoded);
    }
  }

  const catalog: RulesCatalog = {
    getAction: (id) => {
      const encoded = actionJsonById.get(id);
      return encoded === undefined ? undefined : parseCanonical<RuleActionDefinition>(encoded);
    },
    listActions: () => [...actionJsonById.values()]
      .map((encoded) => parseCanonical<RuleActionDefinition>(encoded)),
  };
  const getActor = (fixtureId: string): CompiledMicroMvpScenarioActorState | undefined => {
    const encoded = actorJsonByFixtureId.get(fixtureId);
    return encoded === undefined ? undefined : parseCanonical<CompiledMicroMvpScenarioActorState>(encoded);
  };

  return {
    ruleset: canonicalClone(compiled.ruleset, 'compiled.ruleset'),
    fixtureIds: [...rootIds].sort(),
    catalog,
    getActor,
    getFixture: (fixtureId) => {
      const actor = getActor(fixtureId);
      const actionIds = actionIdsByFixtureId.get(fixtureId);
      const objectsJson = objectsJsonByFixtureId.get(fixtureId);
      if (!actor || !actionIds || objectsJson === undefined) return undefined;
      return {
        fixtureId,
        actor,
        objects: parseCanonical<WorldObjectState[]>(objectsJson),
        actions: actionIds.map((actionId) => {
          const action = catalog.getAction(actionId);
          if (!action) {
            throw new CompiledMicroMvpScenarioAdapterError([
              `isolated catalog lost compiled action ${actionId}`,
            ]);
          }
          return action;
        }),
      };
    },
  };
}
