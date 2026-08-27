import {
  defaultAttackProfile,
  type Ability,
  type ActorAttackProfile,
  type ActorState,
  type AttackActionState,
  type GrappleState,
  type PactBladeAttackContinuationProjection,
  type WorldState,
} from './domain';
import type {
  PreparedSpellSource,
  SpellAccessKind,
  SpellGrantAccess,
  SpellcastingAccessState,
} from './spellcastingAccess';
import type { ResourceRestRecovery, RuntimeState } from './legacy/engineAdapter';
import type { WorldObjectKind, WorldObjectSize, WorldObjectState } from './worldObjects';
import type { ActorRuleTraits } from './actorTraits';
import { attackSequenceInvariantHolds } from './attackSequence';
import { runtimeSenseEffectIssue } from './dwarfTraits';
import { getSystemActionDefinition, SYSTEM_ACTION_IDS } from './systemActions';
import {
  PACT_BLADE_STATE_CAPABILITY,
  PACT_CHAIN_SPECIAL_FORMS,
  PACT_CHAIN_STATE_CAPABILITY,
  PACT_TOME_STATE_CAPABILITY,
  pactBladeLifecyclePolicyIssue,
  type PactBladeBondState,
  type PactBladeLifecyclePolicy,
  type PactChainFamiliarState,
  type WarlockPactStates,
} from './warlockPacts';
import { armorOfAgathysEffectIssue } from './armorOfAgathys';
import { familiarActorStateIssue, familiarActorsOwnedBy } from './familiarRuntime';
import {
  pendingProtectionResolutionIssue,
  protectionEffectEntryIssue,
} from './protectionRuntime';

type JsonRecord = Record<string, unknown>;

function record(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as JsonRecord;
}

const WORLD_OBJECT_KINDS = new Set<WorldObjectKind>(['environment', 'item', 'spell_effect']);
const WORLD_OBJECT_SIZES = new Set<WorldObjectSize>([
  'tiny', 'small', 'medium', 'large', 'huge', 'gargantuan',
]);
const ABILITIES = new Set<Ability>(['str', 'dex', 'con', 'int', 'wis', 'cha']);
const SPELL_ACCESS_KINDS = new Set<SpellAccessKind>([
  'cantrip', 'known', 'spellbook', 'always_prepared', 'innate', 'ritual_only',
]);
const ATTACK_ACTION_STATUSES = new Set(['open', 'completed', 'forfeited']);

function positiveInteger(value: unknown, path: string): number {
  if (!Number.isInteger(value) || Number(value) < 1) {
    throw new Error(`${path} must be a positive integer`);
  }
  return Number(value);
}

function positiveFinite(value: unknown, path: string): number {
  if (!Number.isFinite(value) || Number(value) <= 0) {
    throw new Error(`${path} must be a positive number`);
  }
  return Number(value);
}

function normalizeAttackProfile(input: {
  value: unknown;
  actor: Pick<ActorState, 'character'>;
  path: string;
  legacy: boolean;
}): ActorAttackProfile {
  if (input.value === undefined) {
    if (!input.legacy) throw new Error(`${input.path} is required in world schema 4`);
    return defaultAttackProfile(input.actor);
  }
  const raw = record(input.value, input.path);
  const attacksPerAction = positiveInteger(raw.attacksPerAction, `${input.path}.attacksPerAction`);
  if (!Number.isInteger(raw.size) || Number(raw.size) < 0 || Number(raw.size) > 5) {
    throw new Error(`${input.path}.size must be an integer from 0 to 5`);
  }
  const reachFt = positiveFinite(raw.reachFt, `${input.path}.reachFt`);
  const graspingParts = uniqueStringArray(raw.graspingParts, `${input.path}.graspingParts`);
  const sourceEntityIds = uniqueStringArray(raw.sourceEntityIds, `${input.path}.sourceEntityIds`);
  if (!sourceEntityIds.length) throw new Error(`${input.path}.sourceEntityIds cannot be empty`);
  return {
    attacksPerAction,
    size: Number(raw.size),
    reachFt,
    graspingParts,
    sourceEntityIds: sourceEntityIds as [string, ...string[]],
  };
}

function nonBlankString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${path} must be a non-empty string`);
  }
  return value;
}

function uniqueStringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
  const strings = value.map((item, index) => nonBlankString(item, `${path}[${index}]`));
  if (new Set(strings).size !== strings.length) throw new Error(`${path} must contain unique IDs`);
  return [...strings].sort((left, right) => left.localeCompare(right));
}

function validatePendingRuntimeSnapshot(value: unknown, path: string): RuntimeState {
  const runtime = record(value, path);
  const hp = record(runtime.hp, `${path}.hp`);
  const current = nonNegativeInteger(hp.current, `${path}.hp.current`);
  const max = nonNegativeInteger(hp.max, `${path}.hp.max`);
  nonNegativeInteger(hp.temp, `${path}.hp.temp`);
  if (current > max) throw new Error(`${path}.hp.current cannot exceed max`);

  const numericMap = (raw: unknown, label: string): Record<string, number> => {
    const values = record(raw, label);
    return Object.fromEntries(Object.entries(values).map(([key, entry]) => [
      nonBlankString(key, `${label} key`),
      nonNegativeInteger(entry, `${label}.${key}`),
    ]));
  };
  numericMap(runtime.resources, `${path}.resources`);
  numericMap(runtime.maxResources, `${path}.maxResources`);
  const equipment = record(runtime.equipment, `${path}.equipment`);
  for (const [slot, cardId] of Object.entries(equipment)) {
    nonBlankString(slot, `${path}.equipment key`);
    if (cardId !== null) nonBlankString(cardId, `${path}.equipment.${slot}`);
  }
  if (!Array.isArray(runtime.inventory)
    || runtime.inventory.some((raw, index) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return true;
      const entry = raw as JsonRecord;
      try {
        nonBlankString(entry.cardId, `${path}.inventory[${index}].cardId`);
        positiveInteger(entry.qty, `${path}.inventory[${index}].qty`);
        if (entry.containerId !== undefined) {
          nonBlankString(entry.containerId, `${path}.inventory[${index}].containerId`);
        }
        return false;
      } catch {
        return true;
      }
    })) {
    throw new Error(`${path}.inventory is invalid`);
  }
  if (!Array.isArray(runtime.activeEffects)
    || runtime.activeEffects.some((effect) => !effect || typeof effect !== 'object' || Array.isArray(effect))) {
    throw new Error(`${path}.activeEffects must contain objects`);
  }
  if (runtime.firedThisTurn !== undefined) {
    uniqueStringArray(runtime.firedThisTurn, `${path}.firedThisTurn`);
  }
  if (runtime.firedThisRest !== undefined) {
    uniqueStringArray(runtime.firedThisRest, `${path}.firedThisRest`);
  }
  if (runtime.deathSaves !== undefined) record(runtime.deathSaves, `${path}.deathSaves`);
  return runtime as unknown as RuntimeState;
}

function hpAfterExactDamage(hp: RuntimeState['hp'], amount: number): RuntimeState['hp'] {
  let remaining = amount;
  const absorbed = Math.min(hp.temp, remaining);
  remaining -= absorbed;
  return {
    current: Math.max(0, hp.current - remaining),
    max: hp.max,
    temp: hp.temp - absorbed,
  };
}

function optionalResource(value: unknown, path: string): string | undefined {
  return value === undefined ? undefined : nonBlankString(value, path);
}

function exactKeys(value: JsonRecord, expected: readonly string[], path: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${path} must contain exactly ${wanted.join(', ')}`);
  }
}

function normalizeResourceRecovery(input: {
  value: unknown;
  actorPath: string;
  runtime: unknown;
}): Record<string, ResourceRestRecovery | null> | undefined {
  if (input.value === undefined) return undefined;
  const path = `${input.actorPath}.character.resourceRecovery`;
  const declarations = record(input.value, path);
  const runtime = record(input.runtime, `${input.actorPath}.runtime`);
  const resources = record(runtime.resources, `${input.actorPath}.runtime.resources`);
  const maximums = record(runtime.maxResources, `${input.actorPath}.runtime.maxResources`);

  return Object.fromEntries(Object.entries(declarations)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([resource, rawPolicy]) => {
      nonBlankString(resource, `${path} key`);
      if (!(resource in resources) || !(resource in maximums)) {
        throw new Error(`${path}.${resource} must map to an actor resource and maximum`);
      }
      if (rawPolicy === null) return [resource, null];
      const policyPath = `${path}.${resource}`;
      const policy = record(rawPolicy, policyPath);
      exactKeys(policy, ['short_rest', 'long_rest'], policyPath);
      const shortRest = record(policy.short_rest, `${policyPath}.short_rest`);
      const longRest = record(policy.long_rest, `${policyPath}.long_rest`);
      exactKeys(shortRest, ['mode', 'amount'], `${policyPath}.short_rest`);
      exactKeys(longRest, ['mode'], `${policyPath}.long_rest`);
      if (shortRest.mode !== 'fixed'
        || !Number.isSafeInteger(shortRest.amount)
        || Number(shortRest.amount) <= 0) {
        throw new Error(`${policyPath}.short_rest must declare a positive fixed amount`);
      }
      if (longRest.mode !== 'full') {
        throw new Error(`${policyPath}.long_rest must declare full recovery`);
      }
      return [resource, {
        short_rest: { mode: 'fixed', amount: Number(shortRest.amount) },
        long_rest: { mode: 'full' },
      } satisfies ResourceRestRecovery];
    }));
}

function numericResource(recordValue: JsonRecord, resource: string, path: string): number | undefined {
  const value = recordValue[resource];
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || Number(value) < 0) {
    throw new Error(`${path}.${resource} must be a non-negative integer`);
  }
  return Number(value);
}

function normalizeSpellcastingAccess(input: {
  value: unknown;
  actorPath: string;
  actionIds: readonly string[];
  runtime: unknown;
}): SpellcastingAccessState | undefined {
  if (input.value === undefined) return undefined;
  const path = `${input.actorPath}.spellcastingAccess`;
  const access = record(input.value, path);
  if (!Array.isArray(access.grants)) throw new Error(`${path}.grants must be an array`);
  const rawPreparedSources = record(access.preparedSources, `${path}.preparedSources`);
  const runtime = record(input.runtime, `${input.actorPath}.runtime`);
  const resources = record(runtime.resources, `${input.actorPath}.runtime.resources`);
  const maxResources = record(runtime.maxResources, `${input.actorPath}.runtime.maxResources`);
  const ownedActionIds = new Set(input.actionIds);

  const grants: SpellGrantAccess[] = access.grants.map((rawGrant, index) => {
    const grantPath = `${path}.grants[${index}]`;
    const grant = record(rawGrant, grantPath);
    const grantId = nonBlankString(grant.grantId, `${grantPath}.grantId`);
    const actionId = nonBlankString(grant.actionId, `${grantPath}.actionId`);
    const sourceId = nonBlankString(grant.sourceId, `${grantPath}.sourceId`);
    if (!ownedActionIds.has(actionId)) {
      throw new Error(`${grantPath}.actionId is not owned by actor capabilities`);
    }
    if (typeof grant.access !== 'string'
      || !SPELL_ACCESS_KINDS.has(grant.access as SpellAccessKind)) {
      throw new Error(`${grantPath}.access is invalid`);
    }
    const accessKind = grant.access as SpellAccessKind;
    if (!Number.isInteger(grant.level) || Number(grant.level) < 0 || Number(grant.level) > 9) {
      throw new Error(`${grantPath}.level must be an integer from 0 to 9`);
    }
    const level = Number(grant.level);
    if (typeof grant.spellcastingAbility !== 'string'
      || !ABILITIES.has(grant.spellcastingAbility as Ability)) {
      throw new Error(`${grantPath}.spellcastingAbility is invalid`);
    }
    if (grant.ritual !== undefined && typeof grant.ritual !== 'boolean') {
      throw new Error(`${grantPath}.ritual must be boolean when present`);
    }
    const freeUseResource = optionalResource(
      grant.freeUseResource,
      `${grantPath}.freeUseResource`,
    );
    const slotResource = optionalResource(grant.slotResource, `${grantPath}.slotResource`);
    if (accessKind === 'cantrip' && level !== 0) {
      throw new Error(`${grantPath}: cantrip access requires spell level 0`);
    }
    if (accessKind !== 'cantrip' && level === 0) {
      throw new Error(`${grantPath}: level 0 spells require cantrip access`);
    }
    if (level === 0 && (freeUseResource || slotResource)) {
      throw new Error(`${grantPath}: cantrips cannot declare payment resources`);
    }
    if (accessKind === 'ritual_only' && grant.ritual !== true) {
      throw new Error(`${grantPath}: ritual_only access requires ritual=true`);
    }
    if (level > 0 && ['known', 'spellbook', 'always_prepared'].includes(accessKind)
      && !freeUseResource && !slotResource) {
      throw new Error(`${grantPath}: levelled normal casting requires a resource mapping`);
    }

    if (freeUseResource) {
      const current = numericResource(
        resources,
        freeUseResource,
        `${input.actorPath}.runtime.resources`,
      );
      const maximum = numericResource(
        maxResources,
        freeUseResource,
        `${input.actorPath}.runtime.maxResources`,
      );
      if (current === undefined || maximum === undefined || current > maximum) {
        throw new Error(`${grantPath}.freeUseResource must map to a valid actor resource`);
      }
    }
    if (slotResource) {
      const current = numericResource(resources, slotResource, `${input.actorPath}.runtime.resources`);
      const maximum = numericResource(
        maxResources,
        slotResource,
        `${input.actorPath}.runtime.maxResources`,
      );
      if ((current === undefined) !== (maximum === undefined)
        || (current !== undefined && maximum !== undefined && current > maximum)) {
        throw new Error(`${grantPath}.slotResource has an inconsistent actor resource mapping`);
      }
    }
    return {
      grantId,
      actionId,
      sourceId,
      access: accessKind,
      level,
      spellcastingAbility: grant.spellcastingAbility as Ability,
      ...(grant.ritual === true ? { ritual: true } : {}),
      ...(freeUseResource ? { freeUseResource } : {}),
      ...(slotResource ? { slotResource } : {}),
    };
  }).sort((left, right) => left.sourceId.localeCompare(right.sourceId)
    || left.actionId.localeCompare(right.actionId)
    || left.grantId.localeCompare(right.grantId));

  const grantIds = grants.map((grant) => grant.grantId);
  if (new Set(grantIds).size !== grantIds.length) {
    throw new Error(`${path}.grants must have unique grantId values`);
  }
  const provenanceKeys = grants.map((grant) => `${grant.sourceId}\u0000${grant.actionId}`);
  if (new Set(provenanceKeys).size !== provenanceKeys.length) {
    throw new Error(`${path}.grants must have unique sourceId/actionId provenance`);
  }

  const preparedSources: Record<string, PreparedSpellSource | undefined> = {};
  for (const [sourceId, rawSource] of Object.entries(rawPreparedSources)
    .sort(([left], [right]) => left.localeCompare(right))) {
    if (rawSource === undefined) continue;
    nonBlankString(sourceId, `${path}.preparedSources key`);
    const sourcePath = `${path}.preparedSources.${sourceId}`;
    const source = record(rawSource, sourcePath);
    if (source.sourceId !== sourceId) throw new Error(`${sourcePath}.sourceId must match its key`);
    if (!Number.isInteger(source.capacity) || Number(source.capacity) < 0) {
      throw new Error(`${sourcePath}.capacity must be a non-negative integer`);
    }
    const capacity = Number(source.capacity);
    const availableActionIds = uniqueStringArray(
      source.availableActionIds,
      `${sourcePath}.availableActionIds`,
    );
    const preparedActionIds = uniqueStringArray(
      source.preparedActionIds,
      `${sourcePath}.preparedActionIds`,
    );
    if (capacity > availableActionIds.length) {
      throw new Error(`${sourcePath}.capacity exceeds available spells`);
    }
    if (preparedActionIds.length !== capacity) {
      throw new Error(`${sourcePath}.preparedActionIds must exactly fill capacity`);
    }
    if (preparedActionIds.some((actionId) => !availableActionIds.includes(actionId))) {
      throw new Error(`${sourcePath} prepares a spell outside its available collection`);
    }
    const spellbookActionIds = grants.filter((grant) => (
      grant.sourceId === sourceId && grant.access === 'spellbook'
    )).map((grant) => grant.actionId).sort((left, right) => left.localeCompare(right));
    if (!spellbookActionIds.length) {
      throw new Error(`${sourcePath} has no spellbook grants`);
    }
    if (JSON.stringify(availableActionIds) !== JSON.stringify(spellbookActionIds)) {
      throw new Error(`${sourcePath}.availableActionIds must equal its spellbook grants`);
    }
    preparedSources[sourceId] = {
      sourceId,
      capacity,
      availableActionIds,
      preparedActionIds,
    };
  }
  for (const grant of grants) {
    if (grant.access === 'spellbook' && !preparedSources[grant.sourceId]) {
      throw new Error(`${path}: spellbook grant ${grant.grantId} has no prepared source`);
    }
  }
  return { grants, preparedSources };
}

function normalizeActorTraits(value: unknown, actorPath: string): ActorRuleTraits | undefined {
  if (value === undefined) return undefined;
  const path = `${actorPath}.traits`;
  const traits = record(value, path);
  let conditionImmunities: ActorRuleTraits['conditionImmunities'];
  if (traits.conditionImmunities !== undefined) {
    if (!Array.isArray(traits.conditionImmunities)) {
      throw new Error(`${path}.conditionImmunities must be an array`);
    }
    conditionImmunities = traits.conditionImmunities.map((rawImmunity, index) => {
      const immunityPath = `${path}.conditionImmunities[${index}]`;
      const immunity = record(rawImmunity, immunityPath);
      const sourceEntityIds = uniqueStringArray(
        immunity.sourceEntityIds,
        `${immunityPath}.sourceEntityIds`,
      );
      if (!sourceEntityIds.length) throw new Error(`${immunityPath}.sourceEntityIds cannot be empty`);
      const requiredCauseTags = immunity.requiredCauseTags === undefined
        ? undefined
        : uniqueStringArray(immunity.requiredCauseTags, `${immunityPath}.requiredCauseTags`);
      return {
        condition: nonBlankString(immunity.condition, `${immunityPath}.condition`),
        ...(requiredCauseTags ? { requiredCauseTags } : {}),
        sourceEntityIds: sourceEntityIds as [string, ...string[]],
      };
    }).sort((left, right) => left.condition.localeCompare(right.condition)
      || (left.requiredCauseTags ?? []).join('\u0000')
        .localeCompare((right.requiredCauseTags ?? []).join('\u0000')));
    const keys = conditionImmunities.map((immunity) => (
      `${immunity.condition}\u0000${(immunity.requiredCauseTags ?? []).join('\u0000')}`
    ));
    if (new Set(keys).size !== keys.length) {
      throw new Error(`${path}.conditionImmunities contains duplicate rules`);
    }
  }

  let restProfile: ActorRuleTraits['restProfile'];
  if (traits.restProfile !== undefined) {
    const profilePath = `${path}.restProfile`;
    const profile = record(traits.restProfile, profilePath);
    if (!Number.isFinite(profile.longRestHours)
      || Number(profile.longRestHours) <= 0
      || Number(profile.longRestHours) > 24) {
      throw new Error(`${profilePath}.longRestHours must be greater than 0 and at most 24`);
    }
    if (typeof profile.sleepRequired !== 'boolean') {
      throw new Error(`${profilePath}.sleepRequired must be boolean`);
    }
    const sourceEntityIds = uniqueStringArray(
      profile.sourceEntityIds,
      `${profilePath}.sourceEntityIds`,
    );
    if (!sourceEntityIds.length) throw new Error(`${profilePath}.sourceEntityIds cannot be empty`);
    restProfile = {
      longRestHours: Number(profile.longRestHours),
      sleepRequired: profile.sleepRequired,
      sourceEntityIds: sourceEntityIds as [string, ...string[]],
    };
  }
  return {
    ...(conditionImmunities ? { conditionImmunities } : {}),
    ...(restProfile ? { restProfile } : {}),
  };
}

function nonNegativeInteger(value: unknown, path: string): number {
  if (!Number.isInteger(value) || Number(value) < 0) {
    throw new Error(`${path} must be a non-negative integer`);
  }
  return Number(value);
}

function nonNegativeFinite(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${path} must be a non-negative finite number`);
  }
  return value;
}

function booleanValue(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${path} must be boolean`);
  return value;
}

function requirePactSource(input: {
  featureSources: NonNullable<ActorState['capabilities']['featureSources']>;
  capabilityId: string;
  sourceEntityId: string;
  path: string;
}): void {
  const sources = input.featureSources[input.capabilityId];
  if (!sources?.includes(input.sourceEntityId)) {
    throw new Error(`${input.path}.sourceEntityId is not owned by ${input.capabilityId}`);
  }
}

function normalizePactBladeBond(input: {
  value: unknown;
  path: string;
  actorId: string;
  sourceEntityId: string;
  objects: Readonly<Record<string, WorldObjectState>>;
}): PactBladeBondState {
  const bond = record(input.value, input.path);
  if (bond.sourceEntityId !== input.sourceEntityId) {
    throw new Error(`${input.path}.sourceEntityId must match its invocation`);
  }
  if (bond.warlockActorId !== input.actorId) {
    throw new Error(`${input.path}.warlockActorId must match its owner`);
  }
  const weaponObjectId = nonBlankString(bond.weaponObjectId, `${input.path}.weaponObjectId`);
  const weapon = input.objects[weaponObjectId];
  if (!weapon) throw new Error(`${input.path}.weaponObjectId must exist in world.objects`);
  const weaponCardId = nonBlankString(bond.weaponCardId, `${input.path}.weaponCardId`);
  if (weapon.kind !== 'item' || weapon.itemCardId !== weaponCardId) {
    throw new Error(`${input.path} requires an exact immutable Card-to-item bridge`);
  }
  if (weapon.attunedToActorId !== undefined && weapon.attunedToActorId !== input.actorId) {
    throw new Error(`${input.path}.weaponObjectId is attuned to another actor`);
  }
  const conjured = booleanValue(bond.conjured, `${input.path}.conjured`);
  if (conjured) {
    if (weapon.ownerActorId !== input.actorId
      || weapon.sourceActorId !== input.actorId
      || weapon.sourceActionId !== input.sourceEntityId
      || !weapon.tags?.includes('pact_weapon')) {
      throw new Error(`${input.path}.weaponObjectId is not the source-owned conjured pact weapon`);
    }
  }
  const continuousSeparationSeconds = nonNegativeFinite(
    bond.continuousSeparationSeconds,
    `${input.path}.continuousSeparationSeconds`,
  );
  const lastDistanceBoardRevision = bond.lastDistanceBoardRevision === null
    ? null
    : nonNegativeInteger(
      bond.lastDistanceBoardRevision,
      `${input.path}.lastDistanceBoardRevision`,
    );
  return {
    sourceEntityId: input.sourceEntityId,
    warlockActorId: input.actorId,
    weaponObjectId,
    weaponCardId,
    weaponType: nonBlankString(bond.weaponType, `${input.path}.weaponType`),
    normalDamageType: nonBlankString(bond.normalDamageType, `${input.path}.normalDamageType`),
    conjured,
    bondedAtRevision: nonNegativeInteger(bond.bondedAtRevision, `${input.path}.bondedAtRevision`),
    continuousSeparationSeconds,
    lastDistanceBoardRevision,
  };
}

function normalizePactChainFamiliar(input: {
  value: unknown;
  path: string;
  actorId: string;
  sourceEntityId: string;
}): PactChainFamiliarState {
  const familiar = record(input.value, input.path);
  if (familiar.ownerActorId !== input.actorId) {
    throw new Error(`${input.path}.ownerActorId must match its owner`);
  }
  if (familiar.sourceEntityId !== input.sourceEntityId) {
    throw new Error(`${input.path}.sourceEntityId must match its invocation`);
  }
  const actorId = nonBlankString(familiar.actorId, `${input.path}.actorId`);
  if (actorId === input.actorId) throw new Error(`${input.path}.actorId cannot be its owner`);
  return {
    actorId,
    ownerActorId: input.actorId,
    formId: nonBlankString(familiar.formId, `${input.path}.formId`),
    sourceEntityId: input.sourceEntityId,
    reactionAvailable: booleanValue(
      familiar.reactionAvailable,
      `${input.path}.reactionAvailable`,
    ),
  };
}

function normalizeWarlockPacts(input: {
  value: unknown;
  actorId: string;
  actorPath: string;
  actionIds: readonly string[];
  featureSources: NonNullable<ActorState['capabilities']['featureSources']>;
  spellcastingAccess?: SpellcastingAccessState;
  objects: Readonly<Record<string, WorldObjectState>>;
}): WarlockPactStates | undefined {
  if (input.value === undefined) return undefined;
  const path = `${input.actorPath}.warlockPacts`;
  const rawStates = record(input.value, path);
  const unknownKey = Object.keys(rawStates).find((key) => !['blade', 'chain', 'tome'].includes(key));
  if (unknownKey) throw new Error(`${path}.${unknownKey} is not a supported Pact state`);
  const actionIds = new Set(input.actionIds);
  const states: WarlockPactStates = {};

  if (rawStates.blade !== undefined) {
    const bladePath = `${path}.blade`;
    const blade = record(rawStates.blade, bladePath);
    if (blade.kind !== 'blade') throw new Error(`${bladePath}.kind must be blade`);
    const sourceEntityId = nonBlankString(blade.sourceEntityId, `${bladePath}.sourceEntityId`);
    if (blade.ownerActorId !== input.actorId) {
      throw new Error(`${bladePath}.ownerActorId must match its actor`);
    }
    requirePactSource({
      featureSources: input.featureSources,
      capabilityId: PACT_BLADE_STATE_CAPABILITY,
      sourceEntityId,
      path: bladePath,
    });
    const bondActionId = nonBlankString(blade.bondActionId, `${bladePath}.bondActionId`);
    if (!actionIds.has(bondActionId)) {
      throw new Error(`${bladePath}.bondActionId is not owned by actor capabilities`);
    }
    const lifecyclePolicy = record(blade.lifecyclePolicy, `${bladePath}.lifecyclePolicy`);
    const lifecycleIssue = pactBladeLifecyclePolicyIssue(lifecyclePolicy);
    if (lifecycleIssue) throw new Error(`${bladePath}.lifecyclePolicy: ${lifecycleIssue}`);
    states.blade = {
      kind: 'blade',
      sourceEntityId,
      ownerActorId: input.actorId,
      bondActionId,
      lifecyclePolicy: JSON.parse(JSON.stringify(lifecyclePolicy)) as PactBladeLifecyclePolicy,
      activeBond: blade.activeBond === null
        ? null
        : normalizePactBladeBond({
          value: blade.activeBond,
          path: `${bladePath}.activeBond`,
          actorId: input.actorId,
          sourceEntityId,
          objects: input.objects,
        }),
    };
  }

  if (rawStates.chain !== undefined) {
    const chainPath = `${path}.chain`;
    const chain = record(rawStates.chain, chainPath);
    if (chain.kind !== 'chain') throw new Error(`${chainPath}.kind must be chain`);
    const sourceEntityId = nonBlankString(chain.sourceEntityId, `${chainPath}.sourceEntityId`);
    if (chain.ownerActorId !== input.actorId) {
      throw new Error(`${chainPath}.ownerActorId must match its actor`);
    }
    requirePactSource({
      featureSources: input.featureSources,
      capabilityId: PACT_CHAIN_STATE_CAPABILITY,
      sourceEntityId,
      path: chainPath,
    });
    const templatePath = `${chainPath}.template`;
    const template = record(chain.template, templatePath);
    const findFamiliarActionId = nonBlankString(
      template.findFamiliarActionId,
      `${templatePath}.findFamiliarActionId`,
    );
    if (!actionIds.has(findFamiliarActionId)) {
      throw new Error(`${templatePath}.findFamiliarActionId is not owned by actor capabilities`);
    }
    if (template.normalFormSource !== 'find_familiar_spell') {
      throw new Error(`${templatePath}.normalFormSource must be find_familiar_spell`);
    }
    const specialFormIds = uniqueStringArray(template.specialFormIds, `${templatePath}.specialFormIds`);
    if (JSON.stringify(specialFormIds) !== JSON.stringify([...PACT_CHAIN_SPECIAL_FORMS])) {
      throw new Error(`${templatePath}.specialFormIds must equal the PHB 2024 Pact Chain forms`);
    }
    states.chain = {
      kind: 'chain',
      sourceEntityId,
      ownerActorId: input.actorId,
      template: { findFamiliarActionId, normalFormSource: 'find_familiar_spell', specialFormIds },
      activeFamiliar: chain.activeFamiliar === null
        ? null
        : normalizePactChainFamiliar({
          value: chain.activeFamiliar,
          path: `${chainPath}.activeFamiliar`,
          actorId: input.actorId,
          sourceEntityId,
        }),
    };
  }

  if (rawStates.tome !== undefined) {
    const tomeStatePath = `${path}.tome`;
    const tomeState = record(rawStates.tome, tomeStatePath);
    if (tomeState.kind !== 'tome') throw new Error(`${tomeStatePath}.kind must be tome`);
    const sourceEntityId = nonBlankString(
      tomeState.sourceEntityId,
      `${tomeStatePath}.sourceEntityId`,
    );
    if (tomeState.ownerActorId !== input.actorId) {
      throw new Error(`${tomeStatePath}.ownerActorId must match its actor`);
    }
    requirePactSource({
      featureSources: input.featureSources,
      capabilityId: PACT_TOME_STATE_CAPABILITY,
      sourceEntityId,
      path: tomeStatePath,
    });
    const tomePath = `${tomeStatePath}.tome`;
    const tome = record(tomeState.tome, tomePath);
    if (tome.sourceEntityId !== sourceEntityId || tome.ownerActorId !== input.actorId) {
      throw new Error(`${tomePath} must match its invocation source and owner`);
    }
    const bookObjectId = nonBlankString(tome.bookObjectId, `${tomePath}.bookObjectId`);
    const bookObject = input.objects[bookObjectId];
    if (!bookObject
      || bookObject.kind !== 'item'
      || bookObject.ownerActorId !== input.actorId
      || bookObject.carriedByActorId !== input.actorId
      || bookObject.sourceActorId !== input.actorId
      || bookObject.sourceActionId !== sourceEntityId
      || !bookObject.tags?.includes('book_of_shadows')
      || !bookObject.tags.includes('spellcasting_focus')) {
      throw new Error(`${tomePath}.bookObjectId is not a carried source-owned Book of Shadows focus`);
    }
    const cantripActionIds = uniqueStringArray(
      tome.cantripActionIds,
      `${tomePath}.cantripActionIds`,
    );
    const ritualActionIds = uniqueStringArray(
      tome.ritualActionIds,
      `${tomePath}.ritualActionIds`,
    );
    const spellGrantIds = uniqueStringArray(tome.spellGrantIds, `${tomePath}.spellGrantIds`);
    if (cantripActionIds.length !== 3 || ritualActionIds.length !== 2 || spellGrantIds.length !== 5) {
      throw new Error(`${tomePath} requires exactly three cantrips, two rituals, and five grants`);
    }
    if ([...cantripActionIds, ...ritualActionIds].some((actionId) => !actionIds.has(actionId))) {
      throw new Error(`${tomePath} contains a spell action not owned by actor capabilities`);
    }
    if (new Set([...cantripActionIds, ...ritualActionIds]).size !== 5) {
      throw new Error(`${tomePath} spell selections must be distinct`);
    }
    if (tome.createdAfterRest !== 'short' && tome.createdAfterRest !== 'long') {
      throw new Error(`${tomePath}.createdAfterRest must be short or long`);
    }
    if (!input.spellcastingAccess) {
      throw new Error(`${tomePath} requires actor spellcastingAccess`);
    }
    const grants = input.spellcastingAccess.grants.filter((grant) => (
      spellGrantIds.includes(grant.grantId)
    ));
    const grantsFromBook = input.spellcastingAccess.grants.filter((grant) => (
      grant.sourceId === bookObjectId
    ));
    if (grants.length !== 5 || grantsFromBook.length !== 5
      || grants.some((grant) => grant.sourceId !== bookObjectId)
      || grantsFromBook.some((grant) => !spellGrantIds.includes(grant.grantId))) {
      throw new Error(`${tomePath}.spellGrantIds must exactly own the Book of Shadows grants`);
    }
    for (const grant of grants) {
      if (cantripActionIds.includes(grant.actionId)) {
        if (grant.access !== 'cantrip' || grant.level !== 0 || grant.spellcastingAbility !== 'cha') {
          throw new Error(`${tomePath} has an invalid Book of Shadows cantrip grant`);
        }
      } else if (ritualActionIds.includes(grant.actionId)) {
        if (grant.access !== 'always_prepared'
          || grant.level !== 1
          || grant.ritual !== true
          || grant.spellcastingAbility !== 'cha'
          || !grant.slotResource) {
          throw new Error(`${tomePath} has an invalid prepared Warlock ritual grant`);
        }
      } else {
        throw new Error(`${tomePath} grant points outside its selected spells`);
      }
    }
    states.tome = {
      kind: 'tome',
      sourceEntityId,
      ownerActorId: input.actorId,
      tome: {
        sourceEntityId,
        ownerActorId: input.actorId,
        bookObjectId,
        cantripActionIds,
        ritualActionIds,
        spellGrantIds,
        createdAfterRest: tome.createdAfterRest,
      },
    };
  }

  if (!Object.keys(states).length) throw new Error(`${path} must contain at least one Pact state`);
  return states;
}

function normalizeWorldObjects(value: unknown, required: boolean): Record<string, WorldObjectState> {
  if (value === undefined) {
    if (required) throw new Error('world.objects is required in world schema 5');
    return {};
  }
  const rawObjects = record(value, 'world.objects');
  return Object.fromEntries(Object.entries(rawObjects).map(([objectId, rawObject]) => {
    const object = record(rawObject, `world.objects.${objectId}`);
    if (typeof object.id !== 'string' || !object.id || object.id !== objectId) {
      throw new Error(`world.objects.${objectId}.id must match its key`);
    }
    if (typeof object.name !== 'string' || !object.name) {
      throw new Error(`world.objects.${objectId}.name is required`);
    }
    if (typeof object.kind !== 'string' || !WORLD_OBJECT_KINDS.has(object.kind as WorldObjectKind)) {
      throw new Error(`world.objects.${objectId}.kind is invalid`);
    }
    if (typeof object.size !== 'string' || !WORLD_OBJECT_SIZES.has(object.size as WorldObjectSize)) {
      throw new Error(`world.objects.${objectId}.size is invalid`);
    }
    if (object.itemCardId !== undefined) {
      nonBlankString(object.itemCardId, `world.objects.${objectId}.itemCardId`);
      if (object.kind !== 'item') {
        throw new Error(`world.objects.${objectId}.itemCardId requires an item object`);
      }
    }
    if (object.attunedToActorId !== undefined) {
      nonBlankString(object.attunedToActorId, `world.objects.${objectId}.attunedToActorId`);
      if (object.kind !== 'item') {
        throw new Error(`world.objects.${objectId}.attunedToActorId requires an item object`);
      }
    }
    if ((object.heldByActorId === undefined) !== (object.heldInHand === undefined)) {
      throw new Error(`world.objects.${objectId} must persist holder and hand together`);
    }
    if (object.heldByActorId !== undefined) {
      nonBlankString(object.heldByActorId, `world.objects.${objectId}.heldByActorId`);
      if (object.heldInHand !== 'main_hand' && object.heldInHand !== 'off_hand') {
        throw new Error(`world.objects.${objectId}.heldInHand is invalid`);
      }
      if (object.kind !== 'item' || object.carriedByActorId !== object.heldByActorId) {
        throw new Error(`world.objects.${objectId} held identity must match its item carrier`);
      }
    }
    for (const sourceKey of ['sourceActorId', 'sourceActionId'] as const) {
      if (object[sourceKey] !== undefined) {
        nonBlankString(object[sourceKey], `world.objects.${objectId}.${sourceKey}`);
      }
    }
    if (object.roundsLeft !== undefined) {
      positiveInteger(object.roundsLeft, `world.objects.${objectId}.roundsLeft`);
    }
    if (object.sourceTurnEndingsLeft !== undefined) {
      positiveInteger(
        object.sourceTurnEndingsLeft,
        `world.objects.${objectId}.sourceTurnEndingsLeft`,
      );
      if (object.sourceActorId === undefined || object.sourceActionId === undefined) {
        throw new Error(
          `world.objects.${objectId} source-turn duration requires source actor and action IDs`,
        );
      }
    }
    if (object.dancingLight !== undefined) {
      const path = `world.objects.${objectId}.dancingLight`;
      const dancingLight = record(object.dancingLight, path);
      nonBlankString(dancingLight.groupId, `${path}.groupId`);
      if (dancingLight.form !== 'individual' && dancingLight.form !== 'medium_humanoid') {
        throw new Error(`${path}.form is invalid`);
      }
      positiveFinite(dancingLight.dimRadiusFt, `${path}.dimRadiusFt`);
      if (object.kind !== 'spell_effect'
        || object.sourceActorId === undefined
        || object.sourceActionId === undefined) {
        throw new Error(`${path} requires a source-owned spell-effect object`);
      }
      positiveInteger(object.roundsLeft, `world.objects.${objectId}.roundsLeft`);
      if (!Number.isFinite(object.distanceFromSourceFt) || Number(object.distanceFromSourceFt) < 0) {
        throw new Error(`${path} requires a non-negative source distance`);
      }
    }
    if (object.prestidigitation !== undefined) {
      const path = `world.objects.${objectId}.prestidigitation`;
      if (!Array.isArray(object.prestidigitation) || !object.prestidigitation.length) {
        throw new Error(`${path} must be a non-empty array`);
      }
      const ids = new Set<string>();
      object.prestidigitation.forEach((rawAttachment, index) => {
        const attachment = record(rawAttachment, `${path}[${index}]`);
        const id = nonBlankString(attachment.id, `${path}[${index}].id`);
        if (ids.has(id)) throw new Error(`${path} contains duplicate effect ${id}`);
        ids.add(id);
        nonBlankString(attachment.sourceActorId, `${path}[${index}].sourceActorId`);
        nonBlankString(attachment.sourceActionId, `${path}[${index}].sourceActionId`);
        if (attachment.kind !== 'minor_sensation' && attachment.kind !== 'magic_mark') {
          throw new Error(`${path}[${index}].kind is invalid`);
        }
        nonBlankString(attachment.description, `${path}[${index}].description`);
        positiveInteger(attachment.roundsLeft, `${path}[${index}].roundsLeft`);
      });
    }
    return [objectId, JSON.parse(JSON.stringify(object)) as WorldObjectState];
  }));
}

function normalizeAttackActions(input: {
  value: unknown;
  actors: Readonly<Record<string, ActorState>>;
  legacy: boolean;
}): Record<string, AttackActionState> {
  if (input.value === undefined) {
    if (!input.legacy) throw new Error('world.attackActions is required in world schema 4');
    return {};
  }
  const rawActions = record(input.value, 'world.attackActions');
  const openByActor = new Set<string>();
  return Object.fromEntries(Object.entries(rawActions).map(([attackActionId, rawAction]) => {
    const path = `world.attackActions.${attackActionId}`;
    const action = record(rawAction, path);
    if (nonBlankString(action.id, `${path}.id`) !== attackActionId) {
      throw new Error(`${path}.id must match its key`);
    }
    const actorId = nonBlankString(action.actorId, `${path}.actorId`);
    const actor = input.actors[actorId];
    if (!actor) throw new Error(`${path}.actorId must reference a world actor`);
    if (typeof action.status !== 'string' || !ATTACK_ACTION_STATUSES.has(action.status)) {
      throw new Error(`${path}.status is invalid`);
    }
    const sequence = record(action.sequence, `${path}.sequence`) as unknown as AttackActionState['sequence'];
    if (!attackSequenceInvariantHolds(sequence)
      || sequence.id !== attackActionId
      || sequence.actorId !== actorId
      || sequence.totalAttacks !== actor.attackProfile!.attacksPerAction) {
      throw new Error(`${path}.sequence is not a canonical actor Attack budget`);
    }
    if (action.status === 'open') {
      if (openByActor.has(actorId)) throw new Error(`${path}: actor has multiple open Attack actions`);
      openByActor.add(actorId);
    }
    if (action.status === 'completed' && sequence.attacksRemaining !== 0) {
      throw new Error(`${path}: completed Attack action has attacks remaining`);
    }
    const blockedByResolutionId = action.blockedByResolutionId === undefined
      ? undefined
      : nonBlankString(action.blockedByResolutionId, `${path}.blockedByResolutionId`);
    if (blockedByResolutionId && action.status !== 'open') {
      throw new Error(`${path}: only an open Attack action can be blocked`);
    }
    const declaredActionId = action.declaredActionId === undefined
      ? undefined
      : nonBlankString(action.declaredActionId, `${path}.declaredActionId`);
    let declaredActionSourceEntityIds: [string, ...string[]] | undefined;
    if (action.declaredActionSourceEntityIds !== undefined) {
      if (!Array.isArray(action.declaredActionSourceEntityIds)
        || !action.declaredActionSourceEntityIds.length) {
        throw new Error(`${path}.declaredActionSourceEntityIds must be non-empty`);
      }
      const ids = action.declaredActionSourceEntityIds.map((id, index) => (
        nonBlankString(id, `${path}.declaredActionSourceEntityIds[${index}]`)
      ));
      if (new Set(ids).size !== ids.length) {
        throw new Error(`${path}.declaredActionSourceEntityIds must be unique`);
      }
      declaredActionSourceEntityIds = ids as [string, ...string[]];
    }
    if ((declaredActionId === undefined) !== (declaredActionSourceEntityIds === undefined)) {
      throw new Error(`${path} must declare action identity and provenance together`);
    }
    const normalized: AttackActionState = {
      id: attackActionId,
      actorId,
      startedAtRevision: nonNegativeInteger(action.startedAtRevision, `${path}.startedAtRevision`),
      turnKey: nonBlankString(action.turnKey, `${path}.turnKey`),
      status: action.status as AttackActionState['status'],
      sequence: JSON.parse(JSON.stringify(sequence)) as AttackActionState['sequence'],
      ...(declaredActionId && declaredActionSourceEntityIds
        ? { declaredActionId, declaredActionSourceEntityIds }
        : {}),
      ...(blockedByResolutionId ? { blockedByResolutionId } : {}),
    };
    return [attackActionId, normalized];
  }));
}

function normalizeGrapples(input: {
  value: unknown;
  actors: Readonly<Record<string, ActorState>>;
  legacy: boolean;
}): Record<string, GrappleState> {
  if (input.value === undefined) {
    if (!input.legacy) throw new Error('world.grapples is required in world schema 4');
    return {};
  }
  const rawGrapples = record(input.value, 'world.grapples');
  const occupiedParts = new Set<string>();
  return Object.fromEntries(Object.entries(rawGrapples).map(([grappleId, rawGrapple]) => {
    const path = `world.grapples.${grappleId}`;
    const grapple = record(rawGrapple, path);
    if (nonBlankString(grapple.id, `${path}.id`) !== grappleId) {
      throw new Error(`${path}.id must match its key`);
    }
    const grapplerActorId = nonBlankString(grapple.grapplerActorId, `${path}.grapplerActorId`);
    const targetActorId = nonBlankString(grapple.targetActorId, `${path}.targetActorId`);
    const grappler = input.actors[grapplerActorId];
    const target = input.actors[targetActorId];
    if (!grappler || !target || grapplerActorId === targetActorId) {
      throw new Error(`${path} must connect two different world actors`);
    }
    const sourcePart = nonBlankString(grapple.sourcePart, `${path}.sourcePart`);
    if (!grappler.attackProfile!.graspingParts.includes(sourcePart)) {
      throw new Error(`${path}.sourcePart is not owned by the grappler profile`);
    }
    const occupiedKey = `${grapplerActorId}\u0000${sourcePart}`;
    if (occupiedParts.has(occupiedKey)) throw new Error(`${path}.sourcePart already maintains a grapple`);
    occupiedParts.add(occupiedKey);
    const sourceEntityIds = uniqueStringArray(grapple.sourceEntityIds, `${path}.sourceEntityIds`);
    if (!sourceEntityIds.length) throw new Error(`${path}.sourceEntityIds cannot be empty`);
    const grappleSource = getSystemActionDefinition(SYSTEM_ACTION_IDS.unarmedGrapple)!;
    if (grappleSource.sourceEntityIds.some((sourceId) => !sourceEntityIds.includes(sourceId))) {
      throw new Error(`${path}.sourceEntityIds must retain ruleset Grapple provenance`);
    }
    if (!target.runtime.activeEffects.some((effect) => (
      effect.id === `grapple:${grappleId}`
      && effect.ownerId === targetActorId
      && effect.sourceId === grapplerActorId
      && (effect.mechanics as JsonRecord).kind === 'condition'
      && (effect.mechanics as JsonRecord).value === 'grappled'
      && (effect.mechanics as JsonRecord).grappleId === grappleId
    ))) {
      throw new Error(`${path} is missing its exact target grapple projection`);
    }
    const normalized: GrappleState = {
      id: grappleId,
      grapplerActorId,
      targetActorId,
      sourcePart,
      escapeDc: positiveInteger(grapple.escapeDc, `${path}.escapeDc`),
      reachFt: positiveFinite(grapple.reachFt, `${path}.reachFt`),
      sourceEntityIds: sourceEntityIds as [string, ...string[]],
      startedAtRevision: nonNegativeInteger(grapple.startedAtRevision, `${path}.startedAtRevision`),
    };
    return [grappleId, normalized];
  }));
}

function normalizeActorLifecycle(input: {
  value: unknown;
  path: string;
  actorId: string;
  schemaVersion: number;
  worldRevision: number;
  rulesetContentHash: string;
}): NonNullable<ActorState['lifecycle']> {
  if (input.value === undefined) {
    if (input.schemaVersion >= 5) {
      throw new Error(`${input.path} is required in world schema 5`);
    }
    return { status: 'alive' };
  }
  const lifecycle = record(input.value, input.path);
  if (lifecycle.status === 'alive') {
    if (lifecycle.adjudication !== undefined) {
      throw new Error(`${input.path}.adjudication is invalid for a living actor`);
    }
    return { status: 'alive' };
  }
  if (lifecycle.status !== 'dead') throw new Error(`${input.path}.status is invalid`);
  const factPath = `${input.path}.adjudication`;
  const fact = record(lifecycle.adjudication, factPath);
  if (fact.type !== 'ActorDeathAdjudicated'
    || fact.provenance !== 'canonical_actor_lifecycle') {
    throw new Error(`${factPath} has non-authoritative lifecycle provenance`);
  }
  const factId = nonBlankString(fact.factId, `${factPath}.factId`);
  const adjudicatedBy = nonBlankString(fact.adjudicatedBy, `${factPath}.adjudicatedBy`);
  if (fact.actorId !== input.actorId) {
    throw new Error(`${factPath}.actorId must match its actor`);
  }
  const observedAtWorldRevision = nonNegativeInteger(
    fact.observedAtWorldRevision,
    `${factPath}.observedAtWorldRevision`,
  );
  if (observedAtWorldRevision >= input.worldRevision) {
    throw new Error(`${factPath} must precede the persisted committed world revision`);
  }
  if (fact.rulesetContentHash !== input.rulesetContentHash) {
    throw new Error(`${factPath}.rulesetContentHash must match the world ruleset`);
  }
  return {
    status: 'dead',
    adjudication: {
      type: 'ActorDeathAdjudicated',
      provenance: 'canonical_actor_lifecycle',
      factId,
      actorId: input.actorId,
      adjudicatedBy,
      observedAtWorldRevision,
      rulesetContentHash: input.rulesetContentHash,
    },
  };
}

function pactBladePendingProjectionIssue(input: {
  pending: JsonRecord;
  actors: Readonly<Record<string, ActorState>>;
  objects: Readonly<Record<string, WorldObjectState>>;
}): string | null {
  if (input.pending.pactBladeProjection === undefined) return null;
  const projection = record(
    input.pending.pactBladeProjection,
    'world.pendingResolution.pactBladeProjection',
  ) as unknown as PactBladeAttackContinuationProjection;
  if (input.pending.actionId !== SYSTEM_ACTION_IDS.weaponAttack
    || (input.pending.attackContinuationKind !== undefined
      && input.pending.attackContinuationKind !== 'weapon_melee'
      && input.pending.attackContinuationKind !== 'weapon_ranged')
    || projection.weaponHand !== 'main' && projection.weaponHand !== 'off'
    || !['str', 'dex', 'cha'].includes(projection.abilityChoice)
    || !['str', 'dex', 'cha'].includes(projection.attackAbility)
    || !['str', 'dex', 'cha'].includes(projection.damageAbility)
    || !['normal', 'necrotic', 'psychic', 'radiant'].includes(projection.damageChoice)
    || typeof projection.weaponObjectId !== 'string' || !projection.weaponObjectId.trim()
    || typeof projection.weaponCardId !== 'string' || !projection.weaponCardId.trim()
    || typeof projection.resolvedDamageType !== 'string' || !projection.resolvedDamageType.trim()) {
    return 'has a malformed Pact Blade attack projection';
  }
  if (input.pending.weaponHand !== projection.weaponHand
    || input.pending.weaponCardId !== projection.weaponCardId) {
    return 'Pact Blade projection diverges from its weapon continuation identity';
  }
  const sourceActorId = input.pending.sourceActorId;
  const source = typeof sourceActorId === 'string' ? input.actors[sourceActorId] : undefined;
  const bond = source?.warlockPacts?.blade?.activeBond;
  const object = input.objects[projection.weaponObjectId];
  const expectedAbility = projection.abilityChoice;
  const expectedDamage = projection.damageChoice === 'normal'
    ? bond?.normalDamageType
    : projection.damageChoice;
  if (!source || source.lifecycle?.status !== 'alive' || !bond
    || bond.weaponObjectId !== projection.weaponObjectId
    || bond.weaponCardId !== projection.weaponCardId
    || object?.itemCardId !== projection.weaponCardId
    || object.heldByActorId !== source.id
    || object.heldInHand !== (projection.weaponHand === 'main' ? 'main_hand' : 'off_hand')
    || projection.attackAbility !== expectedAbility
    || projection.damageAbility !== expectedAbility
    || projection.resolvedDamageType !== expectedDamage) {
    return 'Pact Blade projection diverges from its active held Card/Object bond';
  }
  return null;
}

/**
 * Upgrade persisted local worlds without granting capabilities implicitly.
 * Missing legacy ownership information becomes an empty action set (fail closed).
 */
export function migrateWorldState(value: unknown): WorldState {
  const world = record(value, 'world');
  const schemaVersion = Number(world.schemaVersion);
  if (schemaVersion !== 1 && schemaVersion !== 2 && schemaVersion !== 3
    && schemaVersion !== 4 && schemaVersion !== 5) {
    throw new Error(`Unsupported world schema ${String(world.schemaVersion)}`);
  }
  const legacy = schemaVersion < 4;
  if (typeof world.id !== 'string' || !world.id) throw new Error('world.id is required');
  const actorsRecord = record(world.actors, 'world.actors');
  for (const [actorId, rawActor] of Object.entries(actorsRecord)) {
    record(rawActor, `world.actors.${actorId}`);
  }
  const worldRevision = nonNegativeInteger(world.revision, 'world.revision');
  const ruleset = record(world.ruleset, 'world.ruleset');
  const rulesetContentHash = nonBlankString(ruleset.contentHash, 'world.ruleset.contentHash');
  const objects = normalizeWorldObjects(world.objects, schemaVersion >= 5);
  if (schemaVersion >= 5) record(world.concentrations, 'world.concentrations');
  const actors = Object.fromEntries(Object.entries(actorsRecord).map(([actorId, rawActor]) => {
    const actor = record(rawActor, `world.actors.${actorId}`);
    if (actor.id !== actorId) throw new Error(`world.actors.${actorId}.id must match its key`);
    const capabilities = actor.capabilities && typeof actor.capabilities === 'object'
      ? actor.capabilities as JsonRecord
      : {};
    const actionIds = Array.isArray(capabilities.actionIds)
      ? capabilities.actionIds.filter((id): id is string => typeof id === 'string')
      : [];
    const rawFeatureSources = capabilities.featureSources && typeof capabilities.featureSources === 'object'
      && !Array.isArray(capabilities.featureSources)
      ? capabilities.featureSources as JsonRecord
      : {};
    const featureSources = Object.fromEntries(Object.entries(rawFeatureSources).flatMap(([id, sources]) => {
      if (!Array.isArray(sources)) return [];
      const normalized = [...new Set(sources.filter((source): source is string => (
        typeof source === 'string' && source.length > 0
      )))];
      return normalized.length ? [[id, normalized as [string, ...string[]]]] : [];
    })) as NonNullable<ActorState['capabilities']['featureSources']>;
    const normalizedSpellcastingAccess = normalizeSpellcastingAccess({
      value: actor.spellcastingAccess,
      actorPath: `world.actors.${actorId}`,
      actionIds,
      runtime: actor.runtime,
    });
    const normalizedTraits = normalizeActorTraits(actor.traits, `world.actors.${actorId}`);
    const normalizedWarlockPacts = normalizeWarlockPacts({
      value: actor.warlockPacts,
      actorId,
      actorPath: `world.actors.${actorId}`,
      actionIds,
      featureSources,
      spellcastingAccess: normalizedSpellcastingAccess,
      objects,
    });
    const runtime = record(actor.runtime, `world.actors.${actorId}.runtime`);
    const character = record(actor.character, `world.actors.${actorId}.character`);
    const normalizedResourceRecovery = normalizeResourceRecovery({
      value: character.resourceRecovery,
      actorPath: `world.actors.${actorId}`,
      runtime,
    });
    if (!Array.isArray(runtime.activeEffects)) {
      throw new Error(`world.actors.${actorId}.runtime.activeEffects must be an array`);
    }
    runtime.activeEffects.forEach((effect, index) => {
      const issue = runtimeSenseEffectIssue(effect, actorId);
      if (issue) throw new Error(`world.actors.${actorId}.runtime.activeEffects[${index}]: ${issue}`);
      const armorIssue = armorOfAgathysEffectIssue(effect, actorId);
      if (armorIssue) {
        throw new Error(`world.actors.${actorId}.runtime.activeEffects[${index}]: ${armorIssue}`);
      }
      const mechanics = effect && typeof effect === 'object'
        ? (effect as JsonRecord).mechanics as JsonRecord | undefined
        : undefined;
      if (mechanics?.kind === 'temporary_hp_melee_retaliation') {
        const actionId = nonBlankString(
          mechanics.actionId,
          `world.actors.${actorId}.runtime.activeEffects[${index}].mechanics.actionId`,
        );
        if (!actionIds.includes(actionId)) {
          throw new Error(
            `world.actors.${actorId}.runtime.activeEffects[${index}] source action is not actor-owned`,
          );
        }
        const hp = record(runtime.hp, `world.actors.${actorId}.runtime.hp`);
        if (!Number.isInteger(hp.temp) || Number(hp.temp) < 1) {
          throw new Error(
            `world.actors.${actorId}.runtime.activeEffects[${index}] requires positive Temporary HP`,
          );
        }
      }
    });
    const retaliationGroups = runtime.activeEffects.flatMap((effect) => (
      effect && typeof effect === 'object'
      && ((effect as JsonRecord).mechanics as JsonRecord | undefined)?.kind === 'temporary_hp_melee_retaliation'
        ? [((effect as JsonRecord).mechanics as JsonRecord).actionId]
        : []
    ));
    if (new Set(retaliationGroups).size !== retaliationGroups.length) {
      throw new Error(
        `world.actors.${actorId}.runtime.activeEffects has multiple retaliations for one source action`,
      );
    }
    const normalizedAttackProfile = normalizeAttackProfile({
      value: actor.attackProfile,
      actor: actor as unknown as Pick<ActorState, 'character'>,
      path: `world.actors.${actorId}.attackProfile`,
      legacy,
    });
    const normalizedActor = {
      ...actor,
      character: {
        ...character,
        ...(normalizedResourceRecovery !== undefined
          ? { resourceRecovery: normalizedResourceRecovery }
          : {}),
      },
      capabilities: {
        actionIds: [...new Set(actionIds)].sort(),
        ...(featureSources && Object.keys(featureSources).length ? { featureSources } : {}),
      },
      ...(normalizedSpellcastingAccess ? { spellcastingAccess: normalizedSpellcastingAccess } : {}),
      ...(normalizedTraits ? { traits: normalizedTraits } : {}),
      ...(normalizedWarlockPacts ? { warlockPacts: normalizedWarlockPacts } : {}),
      lifecycle: normalizeActorLifecycle({
        value: actor.lifecycle,
        path: `world.actors.${actorId}.lifecycle`,
        actorId,
        schemaVersion,
        worldRevision,
        rulesetContentHash,
      }),
      attackProfile: normalizedAttackProfile,
    } as unknown as ActorState;
    if (!normalizedSpellcastingAccess) delete normalizedActor.spellcastingAccess;
    if (!normalizedTraits) delete normalizedActor.traits;
    if (!normalizedWarlockPacts) delete normalizedActor.warlockPacts;
    if (normalizedResourceRecovery === undefined) delete normalizedActor.character.resourceRecovery;
    return [actorId, normalizedActor];
  }));
  const heldSlots = new Set<string>();
  for (const object of Object.values(objects)) {
    if (object.attunedToActorId && !actors[object.attunedToActorId]) {
      throw new Error(`world.objects.${object.id}.attunedToActorId must reference a world actor`);
    }
    if (object.heldByActorId) {
      if (!actors[object.heldByActorId]) {
        throw new Error(`world.objects.${object.id}.heldByActorId must reference a world actor`);
      }
      const heldSlot = `${object.heldByActorId}\u0000${object.heldInHand}`;
      if (heldSlots.has(heldSlot)) {
        throw new Error(`world.objects.${object.id} duplicates a canonical held-item slot`);
      }
      heldSlots.add(heldSlot);
    }
  }
  const bondedObjectIds = new Set<string>();
  for (const [actorId, actor] of Object.entries(actors)) {
    const bond = actor.warlockPacts?.blade?.activeBond;
    if (!bond) continue;
    if (bondedObjectIds.has(bond.weaponObjectId)) {
      throw new Error(`world.actors.${actorId}.warlockPacts.blade bonds an already bonded item`);
    }
    bondedObjectIds.add(bond.weaponObjectId);
  }
  for (const [ownerActorId, owner] of Object.entries(actors)) {
    const familiarId = owner.warlockPacts?.chain?.activeFamiliar?.actorId;
    if (!familiarId) continue;
    const familiarActor = actors[familiarId];
    if (!familiarActor || familiarActor.kind !== 'summonedActor') {
      throw new Error(
        `world.actors.${ownerActorId}.warlockPacts.chain.activeFamiliar.actorId`
        + ' must reference a summonedActor in the same world',
      );
    }
  }
  for (const [actorId, actor] of Object.entries(actors)) {
    if (actor.familiarState === undefined && actor.familiarMetadata === undefined) continue;
    const ownerId = actor.familiarState?.ownerActorId;
    const owner = ownerId ? actors[ownerId] : undefined;
    const issue = familiarActorStateIssue({ actor, owner });
    if (issue) throw new Error(`world.actors.${actorId}: ${issue}`);
  }
  for (const ownerActorId of Object.keys(actors)) {
    const owned = familiarActorsOwnedBy({ actors }, ownerActorId);
    if (owned.length > 1) {
      throw new Error(`world.actors.${ownerActorId} owns multiple canonical familiar actors`);
    }
  }
  const protectionEffectIds = new Set<string>();
  for (const [actorId, actor] of Object.entries(actors)) {
    for (const effect of actor.runtime.activeEffects) {
      const issue = protectionEffectEntryIssue(effect, actor, { actors });
      if (issue) throw new Error(`world.actors.${actorId}.runtime.activeEffects: ${issue}`);
      if ((effect.mechanics as JsonRecord).kind !== 'fighting_style_protection_2024') continue;
      if (protectionEffectIds.has(effect.id)) {
        throw new Error(`Protection effect id ${effect.id} is duplicated in world actors`);
      }
      protectionEffectIds.add(effect.id);
    }
  }
  const dancingGroups = new Map<string, WorldObjectState[]>();
  for (const object of Object.values(objects)) {
    if (object.dancingLight) {
      const source = actors[object.sourceActorId!];
      if (!source || !source.capabilities.actionIds.includes(object.sourceActionId!)) {
        throw new Error(
          `world.objects.${object.id}.dancingLight must retain an actor-owned source action`,
        );
      }
      const key = `${object.sourceActorId}\u0000${object.sourceActionId}\u0000${object.dancingLight.groupId}`;
      dancingGroups.set(key, [...(dancingGroups.get(key) ?? []), object]);
    }
    for (const [index, attachment] of (object.prestidigitation ?? []).entries()) {
      const source = actors[attachment.sourceActorId];
      if (!source || !source.capabilities.actionIds.includes(attachment.sourceActionId)) {
        throw new Error(
          `world.objects.${object.id}.prestidigitation[${index}] must retain an actor-owned source action`,
        );
      }
    }
  }
  for (const [key, group] of dancingGroups) {
    const [sourceActorId, sourceActionId] = key.split('\u0000');
    const forms = new Set(group.map((object) => object.dancingLight!.form));
    const expectedCount = group[0].dancingLight!.form === 'medium_humanoid' ? 1 : undefined;
    if (forms.size !== 1 || group.length > 4 || (expectedCount !== undefined && group.length !== 1)) {
      throw new Error(`Dancing Lights group ${group[0].dancingLight!.groupId} has invalid persisted membership`);
    }
    const concentration = world.concentrations && typeof world.concentrations === 'object'
      ? (world.concentrations as JsonRecord)[sourceActorId] as JsonRecord | undefined
      : undefined;
    if (!concentration
      || concentration.actionId !== sourceActionId
      || typeof concentration.id !== 'string'
      || !concentration.id) {
      throw new Error(
        `Dancing Lights group ${group[0].dancingLight!.groupId} requires its exact active concentration`,
      );
    }
  }
  const attackActions = normalizeAttackActions({ value: world.attackActions, actors, legacy });
  const grapples = normalizeGrapples({ value: world.grapples, actors, legacy });
  if (!legacy) {
    const pending = world.pendingResolution === null
      ? null
      : record(world.pendingResolution, 'world.pendingResolution');
    if (pending?.type === 'protection_reaction') {
      const issue = pendingProtectionResolutionIssue(pending, { actors });
      if (issue) throw new Error(`world.pendingResolution: ${issue}`);
      const pactIssue = pactBladePendingProjectionIssue({ pending, actors, objects });
      if (pactIssue) throw new Error(`world.pendingResolution: ${pactIssue}`);
    }
    if (pending?.type === 'attack_reaction') {
      const weaponHand = pending.weaponHand;
      const weaponCardId = pending.weaponCardId;
      if ((weaponHand === undefined) !== (weaponCardId === undefined)
        || (weaponHand !== undefined && weaponHand !== 'main' && weaponHand !== 'off')
        || (weaponCardId !== undefined
          && (typeof weaponCardId !== 'string' || !weaponCardId.trim()))) {
        throw new Error('world.pendingResolution has an invalid weapon continuation identity');
      }
      const pactIssue = pactBladePendingProjectionIssue({ pending, actors, objects });
      if (pactIssue) throw new Error(`world.pendingResolution: ${pactIssue}`);
      if (weaponHand && weaponCardId && pending.pactBladeProjection === undefined) {
        const sourceActorId = nonBlankString(
          pending.sourceActorId,
          'world.pendingResolution.sourceActorId',
        );
        const source = actors[sourceActorId];
        const slot = weaponHand === 'main' ? 'main_hand' : 'off_hand';
        const card = source && [
          ...(source.character.knownCards ?? []),
          ...(source.character.equippedCards ?? []),
        ].find((candidate) => candidate.id === weaponCardId);
        if (!source || !card || card.type !== 'weapon' || source.runtime.equipment[slot] !== card.id) {
          throw new Error('world.pendingResolution weapon must match the source equipped Card');
        }
      }
    }
    if (pending?.type === 'damage_reaction') {
      const sourceActorId = nonBlankString(
        pending.sourceActorId,
        'world.pendingResolution.sourceActorId',
      );
      const targetActorId = nonBlankString(
        pending.targetActorId,
        'world.pendingResolution.targetActorId',
      );
      const actionId = nonBlankString(
        pending.actionId,
        'world.pendingResolution.actionId',
      );
      if (!actors[sourceActorId] || !actors[targetActorId] || sourceActorId === targetActorId) {
        throw new Error('world.pendingResolution damage continuation actors are invalid');
      }
      const action = record(pending.action, 'world.pendingResolution.action');
      if (action.id !== actionId) {
        throw new Error('world.pendingResolution action must match its exact damage continuation');
      }
      if (!Array.isArray(pending.damage) || pending.damage.length === 0
        || pending.damage.some((packet) => {
          if (!packet || typeof packet !== 'object' || Array.isArray(packet)) return true;
          const value = packet as JsonRecord;
          return !Number.isInteger(value.amount) || Number(value.amount) <= 0
            || typeof value.damageType !== 'string' || !value.damageType.trim();
        })) {
        throw new Error('world.pendingResolution damage must contain positive exact packets');
      }
      const request = record(pending.request, 'world.pendingResolution.request');
      const trigger = record(request.trigger, 'world.pendingResolution.request.trigger');
      const packets = pending.damage as JsonRecord[];
      const amount = packets.reduce((sum, packet) => (
        sum + Number(packet.amount)
      ), 0);
      const damageTypes = [...new Set(packets.map((packet) => String(packet.damageType)))]
        .sort((left, right) => left.localeCompare(right));
      const triggerDamageTypes = uniqueStringArray(
        trigger.damageTypes,
        'world.pendingResolution.request.trigger.damageTypes',
      );
      if (request.type !== 'reaction' || request.actorId !== targetActorId
        || trigger.type !== 'damage_taken'
        || trigger.sourceActorId !== sourceActorId
        || trigger.actionId !== actionId
        || trigger.amount !== amount
        || JSON.stringify(triggerDamageTypes) !== JSON.stringify(damageTypes)) {
        throw new Error('world.pendingResolution damage reaction request is inconsistent');
      }
      if (!Array.isArray(request.options) || request.options.length === 0) {
        throw new Error('world.pendingResolution damage reaction must retain offered options');
      }
      const optionIds = request.options.map((rawOption, index) => {
        const option = record(rawOption, `world.pendingResolution.request.options[${index}]`);
        nonBlankString(option.label, `world.pendingResolution.request.options[${index}].label`);
        return nonBlankString(option.actionId, `world.pendingResolution.request.options[${index}].actionId`);
      });
      if (new Set(optionIds).size !== optionIds.length) {
        throw new Error('world.pendingResolution damage reaction options must be unique');
      }
      const targetBefore = validatePendingRuntimeSnapshot(
        pending.targetRuntimeBeforeDamage,
        'world.pendingResolution.targetRuntimeBeforeDamage',
      );
      validatePendingRuntimeSnapshot(
        pending.sourceRuntimeAfter,
        'world.pendingResolution.sourceRuntimeAfter',
      );
      const targetAfter = validatePendingRuntimeSnapshot(
        pending.targetRuntimeAfter,
        'world.pendingResolution.targetRuntimeAfter',
      );
      const expectedHp = hpAfterExactDamage(targetBefore.hp, amount);
      if (targetAfter.hp.current !== expectedHp.current
        || targetAfter.hp.max !== expectedHp.max
        || targetAfter.hp.temp !== expectedHp.temp) {
        throw new Error('world.pendingResolution target HP must match its exact held damage');
      }
      if (!Array.isArray(pending.preDamageTargetEvents)
        || !Array.isArray(pending.attackEvents)
        || !Array.isArray(pending.retaliationEvents)
        || !Array.isArray(pending.followUps)) {
        throw new Error('world.pendingResolution damage continuation arrays are invalid');
      }
      uniqueStringArray(
        pending.retaliationSourceEntityIds,
        'world.pendingResolution.retaliationSourceEntityIds',
      );
      uniqueStringArray(pending.obligationIds, 'world.pendingResolution.obligationIds');
      const eventDamage = (pending.attackEvents as JsonRecord[]).flatMap((rawEvent) => (
        rawEvent && typeof rawEvent === 'object' && !Array.isArray(rawEvent)
          && rawEvent.type === 'damage' && Number(rawEvent.amount) > 0
          ? [{ amount: Math.floor(Number(rawEvent.amount)), damageType: rawEvent.damageType }]
          : []
      ));
      const exactDamage = packets.map((packet) => ({
        amount: Number(packet.amount),
        damageType: packet.damageType,
      }));
      if (JSON.stringify(eventDamage) !== JSON.stringify(exactDamage)) {
        throw new Error('world.pendingResolution damage packets must match held engine events');
      }
    }
    for (const [attackActionId, attackAction] of Object.entries(attackActions)) {
      if (!attackAction.blockedByResolutionId) continue;
      if (!pending
        || pending.id !== attackAction.blockedByResolutionId
        || pending.attackActionId !== attackActionId) {
        throw new Error(
          `world.attackActions.${attackActionId}.blockedByResolutionId must match the active resolution`,
        );
      }
    }
    if (pending?.attackActionId !== undefined) {
      const attackActionId = nonBlankString(
        pending.attackActionId,
        'world.pendingResolution.attackActionId',
      );
      if (attackActions[attackActionId]?.blockedByResolutionId !== pending.id) {
        throw new Error('world.pendingResolution.attackActionId must reference its blocked Attack action');
      }
    }
  }
  if (!legacy) {
    for (const [actorId, actor] of Object.entries(actors)) {
      for (const effect of actor.runtime.activeEffects) {
        if (!effect.id.startsWith('grapple:')) continue;
        const grappleId = effect.id.slice('grapple:'.length);
        if (!grapples[grappleId] || grapples[grappleId].targetActorId !== actorId) {
          throw new Error(`world.actors.${actorId}.runtime.activeEffects contains an orphan grapple projection`);
        }
      }
    }
  }
  return {
    ...(world as unknown as WorldState),
    schemaVersion: 5,
    actors,
    objects,
    concentrations: world.concentrations && typeof world.concentrations === 'object'
      ? world.concentrations as WorldState['concentrations']
      : {},
    attackActions,
    grapples,
  };
}
