import type {
  ActiveEffectEntry,
  ConditionImmunityContext,
  EngineEvent,
  RuntimeState,
} from '../mvp/contracts';
import { dropConcentration } from './concentration';
import {
  conditionEffectEntityRef,
  conditionLabel,
  conditionLevel,
  conditionLeaves,
  conditionModifierPayloads,
  conditionRegistryAuthority,
  conditionRule,
  conditionRuntimePayloads,
  conditionStacking,
} from './conditions';
import { payloadsOf } from './mechanicsView';

type Dict = Record<string, unknown>;

const CONDITION_ID = /^[a-z][a-z0-9_-]*$/;
const SOURCE_FACT_PREDICATES = new Set([
  'condition_source_in_line_of_sight',
  'roll_target_is_condition_source',
  'roll_target_is_not_condition_source',
  'roller_is_condition_source',
]);

export interface ManualConditionEffectEntity {
  id: string;
  name: string;
  effect_type?: string | null;
  mechanics?: unknown;
}

export interface ManualEffectApplicationFacts {
  /** Explicit even when empty: callers may not silently omit immunity inputs. */
  conditionImmunities: ConditionImmunityContext[];
  /** Mechanical cause tags, for example `magical` + `sleep`. */
  causeTags: string[];
  /** Runtime id of the creature that caused a relational condition. */
  sourceActorId?: string;
  /** Runtime id of the creature receiving the effect. */
  ownerActorId: string;
}

export type ManualEffectCommand =
  | {
    type: 'ApplyEffect';
    effect: {
      kind: 'condition';
      conditionId: string;
      sourceEntityId: string;
    };
    provenance: string;
    facts: ManualEffectApplicationFacts;
  }
  | {
    type: 'RemoveEffect';
    effectId: string;
    ownerActorId: string;
    provenance: string;
  };

export interface ManualEffectCommandOptions {
  nextId: (prefix: string) => string;
}

export interface ManualEffectCommandResult {
  state: RuntimeState;
  events: EngineEvent[];
}

function isRecord(value: unknown): value is Dict {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function requiredString(value: unknown, path: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${path} must be a non-empty string`);
  }
  return value.trim();
}

function normalizeTag(value: string): string {
  return value.trim().toLowerCase().replaceAll('-', '_').replaceAll(' ', '_');
}

function cloneState(state: RuntimeState): RuntimeState {
  return {
    ...state,
    hp: { ...state.hp },
    resources: { ...state.resources },
    maxResources: { ...state.maxResources },
    equipment: { ...state.equipment },
    inventory: state.inventory.map((entry) => ({ ...entry })),
    activeEffects: state.activeEffects.map((entry) => ({
      ...entry,
      mechanics: { ...(entry.mechanics as Dict) },
    })),
  };
}

function assertConditionRule(conditionId: string): void {
  if (!CONDITION_ID.test(conditionId)) {
    throw new Error(`condition id «${conditionId || '?'}» is malformed`);
  }
  const rule = conditionRule(conditionId);
  if (!rule || rule.id !== conditionId || !rule.label.trim() || !Array.isArray(rule.modifiers)) {
    throw new Error(`condition «${conditionId}» has no complete registered mechanics`);
  }
  const stacking = rule.stacking;
  if (stacking && stacking.mode !== 'binary' && stacking.mode !== 'levels') {
    throw new Error(`condition «${conditionId}» has malformed stacking mechanics`);
  }
  if (stacking?.max != null && (!Number.isSafeInteger(stacking.max) || stacking.max <= 0)) {
    throw new Error(`condition «${conditionId}» has malformed stacking maximum`);
  }
  for (const dependency of [...(rule.includes ?? []), ...(rule.leaves ?? [])]) {
    if (!CONDITION_ID.test(dependency) || !conditionRule(dependency)) {
      throw new Error(`condition «${conditionId}» references unknown condition «${dependency}»`);
    }
  }
}

function conditionValueOf(entry: ActiveEffectEntry, path: string): string | null {
  if (!isRecord(entry.mechanics)) throw new Error(`${path}.mechanics must be an object`);
  if (entry.mechanics.kind !== 'condition') {
    if (isRecord(entry.mechanics.condition)) {
      throw new Error(`${path}.mechanics contains an unmaterialized condition entity`);
    }
    return null;
  }
  const value = requiredString(entry.mechanics.value, `${path}.mechanics.value`);
  assertConditionRule(value);
  return value;
}

function validateStateEffects(state: RuntimeState): void {
  if (!Array.isArray(state.activeEffects)) throw new Error('runtime.activeEffects must be an array');
  const ids = new Set<string>();
  state.activeEffects.forEach((entry, index) => {
    if (!isRecord(entry)) throw new Error(`runtime.activeEffects[${index}] must be an object`);
    const id = requiredString(entry.id, `runtime.activeEffects[${index}].id`);
    if (ids.has(id)) throw new Error(`runtime.activeEffects contains duplicate id «${id}»`);
    ids.add(id);
    requiredString(entry.name, `runtime.activeEffects[${index}].name`);
    requiredString(entry.source, `runtime.activeEffects[${index}].source`);
    conditionValueOf(entry, `runtime.activeEffects[${index}]`);
  });
}

function validateImmunities(value: unknown): ConditionImmunityContext[] {
  if (!Array.isArray(value)) {
    throw new Error('facts.conditionImmunities must be an explicit array');
  }
  return value.map((raw, index) => {
    if (!isRecord(raw)) throw new Error(`facts.conditionImmunities[${index}] must be an object`);
    const condition = requiredString(raw.condition, `facts.conditionImmunities[${index}].condition`);
    const sourceEntityIds = raw.sourceEntityIds;
    if (!Array.isArray(sourceEntityIds) || sourceEntityIds.length === 0) {
      throw new Error(`facts.conditionImmunities[${index}].sourceEntityIds must be non-empty`);
    }
    const sources = sourceEntityIds.map((source, sourceIndex) => (
      requiredString(source, `facts.conditionImmunities[${index}].sourceEntityIds[${sourceIndex}]`)
    ));
    const requiredCauseTags = raw.requiredCauseTags;
    if (requiredCauseTags !== undefined && !Array.isArray(requiredCauseTags)) {
      throw new Error(`facts.conditionImmunities[${index}].requiredCauseTags must be an array`);
    }
    const tags = (requiredCauseTags ?? []).map((tag, tagIndex) => (
      requiredString(tag, `facts.conditionImmunities[${index}].requiredCauseTags[${tagIndex}]`)
    ));
    return {
      condition,
      ...(tags.length ? { requiredCauseTags: tags } : {}),
      sourceEntityIds: [...new Set(sources)],
    };
  });
}

function activeConditionImmunities(state: RuntimeState): ConditionImmunityContext[] {
  return state.activeEffects.flatMap((entry) => {
    const condition = conditionValueOf(entry, `runtime.activeEffects[${entry.id}]`);
    const payloads = condition
      ? conditionRuntimePayloads(condition)
      : payloadsOf(entry.mechanics as Record<string, unknown>);
    return payloads.flatMap((payload, payloadIndex) => {
      if (payload.kind !== 'condition_immunity') return [];
      const immuneTo = requiredString(
        payload.condition,
        `condition.${condition}.payloads[${payloadIndex}].condition`,
      );
      const rawTags = payload.requiredCauseTags ?? payload.required_cause_tags;
      if (rawTags !== undefined && !Array.isArray(rawTags)) {
        throw new Error(`condition.${condition}.payloads[${payloadIndex}].requiredCauseTags must be an array`);
      }
      const requiredCauseTags = (rawTags ?? []).map((tag, tagIndex) => (
        requiredString(tag, `condition.${condition}.payloads[${payloadIndex}].requiredCauseTags[${tagIndex}]`)
      ));
      return [{
        condition: immuneTo,
        ...(requiredCauseTags.length ? { requiredCauseTags } : {}),
        sourceEntityIds: [entry.id],
      }];
    });
  });
}

function matchingImmunity(
  conditionId: string,
  causeTags: string[],
  immunities: ConditionImmunityContext[],
): ConditionImmunityContext | undefined {
  const condition = normalizeTag(conditionId);
  const tags = new Set(causeTags.map(normalizeTag));
  return immunities.find((candidate) => (
    normalizeTag(candidate.condition) === condition
      && (candidate.requiredCauseTags ?? []).every((tag) => tags.has(normalizeTag(tag)))
  ));
}

function containsSourcePredicate(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsSourcePredicate);
  if (!isRecord(value)) return false;
  if (SOURCE_FACT_PREDICATES.has(String(value.kind ?? ''))) return true;
  return Object.values(value).some(containsSourcePredicate);
}

/** True when at least one declared primitive needs the exact source actor id. */
export function conditionRequiresSourceActor(conditionId: string): boolean {
  assertConditionRule(conditionId);
  return conditionModifierPayloads(conditionId).some((modifier) => (
    containsSourcePredicate(modifier.when)
  ));
}

/** Strict entity-card adapter used by the mobile catalog. Behavior identity is
 * read only from mechanics.condition.id; names/card numbers are presentation. */
export function conditionIdFromEffectEntity(entity: ManualConditionEffectEntity): string {
  if (conditionRegistryAuthority().mode !== 'database_release') {
    throw new Error('certified database condition authority is unavailable');
  }
  requiredString(entity.id, 'effect.id');
  requiredString(entity.name, 'effect.name');
  if (entity.effect_type !== 'condition') {
    throw new Error('effect.effect_type must be condition');
  }
  if (!isRecord(entity.mechanics)) throw new Error('effect.mechanics must be an object');
  if (!isRecord(entity.mechanics.condition)) {
    throw new Error('effect.mechanics.condition must be an object');
  }
  const conditionId = requiredString(entity.mechanics.condition.id, 'effect.mechanics.condition.id');
  assertConditionRule(conditionId);
  return conditionId;
}

export function applyEffectCommandFromEntity(
  entity: ManualConditionEffectEntity,
  provenance: string,
  facts: ManualEffectApplicationFacts,
): ManualEffectCommand {
  return {
    type: 'ApplyEffect',
    effect: {
      kind: 'condition',
      conditionId: conditionIdFromEffectEntity(entity),
      sourceEntityId: requiredString(entity.id, 'effect.id'),
    },
    provenance: requiredString(provenance, 'provenance'),
    facts,
  };
}

/** Extract data-declared condition-immunity primitives from character passives.
 * Every immunity must retain a stable source id or the surface fails closed. */
export function collectConditionImmunitiesFromPassives(
  passives: Record<string, unknown>[],
): ConditionImmunityContext[] {
  if (!Array.isArray(passives)) throw new Error('passives must be an explicit array');
  const collected: ConditionImmunityContext[] = [];
  passives.forEach((mechanics, passiveIndex) => {
    if (!isRecord(mechanics)) throw new Error(`passives[${passiveIndex}] must be an object`);
    const immunities = payloadsOf(mechanics).filter((payload) => payload.kind === 'condition_immunity');
    if (!immunities.length) return;
    const fallbackSource = typeof mechanics.id === 'string' && mechanics.id.trim()
      ? mechanics.id.trim()
      : null;
    immunities.forEach((payload, payloadIndex) => {
      const condition = requiredString(
        payload.condition,
        `passives[${passiveIndex}].conditionImmunities[${payloadIndex}].condition`,
      );
      const rawSources = payload.sourceEntityIds ?? payload.source_entity_ids;
      const sourceEntityIds = Array.isArray(rawSources)
        ? rawSources.map((source, sourceIndex) => requiredString(
          source,
          `passives[${passiveIndex}].conditionImmunities[${payloadIndex}].sourceEntityIds[${sourceIndex}]`,
        ))
        : fallbackSource ? [fallbackSource] : [];
      if (!sourceEntityIds.length) {
        throw new Error(`passives[${passiveIndex}] condition immunity has no stable source identity`);
      }
      const rawTags = payload.requiredCauseTags ?? payload.required_cause_tags;
      if (rawTags !== undefined && !Array.isArray(rawTags)) {
        throw new Error(`passives[${passiveIndex}] condition immunity cause tags must be an array`);
      }
      const requiredCauseTags = (rawTags ?? []).map((tag, tagIndex) => requiredString(
        tag,
        `passives[${passiveIndex}].conditionImmunities[${payloadIndex}].requiredCauseTags[${tagIndex}]`,
      ));
      collected.push({
        condition,
        ...(requiredCauseTags.length ? { requiredCauseTags } : {}),
        sourceEntityIds: [...new Set(sourceEntityIds)],
      });
    });
  });
  const merged = new Map<string, ConditionImmunityContext>();
  for (const immunity of collected) {
    const tags = [...(immunity.requiredCauseTags ?? [])].map(normalizeTag).sort();
    const key = `${normalizeTag(immunity.condition)}:${tags.join(',')}`;
    const current = merged.get(key);
    merged.set(key, {
      condition: immunity.condition,
      ...(immunity.requiredCauseTags?.length
        ? { requiredCauseTags: [...immunity.requiredCauseTags] }
        : {}),
      sourceEntityIds: [...new Set([
        ...(current?.sourceEntityIds ?? []),
        ...immunity.sourceEntityIds,
      ])],
    });
  }
  return [...merged.values()];
}

function nextUniqueId(
  options: ManualEffectCommandOptions,
  state: RuntimeState,
  prefix: string,
): string {
  if (!options || typeof options.nextId !== 'function') {
    throw new Error('manual effect interpreter requires an explicit nextId generator');
  }
  const id = requiredString(options.nextId(prefix), 'nextId result');
  if (state.activeEffects.some((entry) => entry.id === id)) {
    throw new Error(`nextId returned duplicate active-effect id «${id}»`);
  }
  return id;
}

function conditionDeniesConcentration(conditionId: string): boolean {
  return conditionModifierPayloads(conditionId).some((modifier) => (
    modifier.op === 'deny' && modifier.applies_to.roll === 'concentration'
  ));
}

function applyCondition(
  state: RuntimeState,
  command: Extract<ManualEffectCommand, { type: 'ApplyEffect' }>,
  options: ManualEffectCommandOptions,
): ManualEffectCommandResult {
  const conditionId = requiredString(command.effect.conditionId, 'effect.conditionId');
  assertConditionRule(conditionId);
  requiredString(command.effect.sourceEntityId, 'effect.sourceEntityId');
  const provenance = requiredString(command.provenance, 'provenance');
  if (!isRecord(command.facts)) throw new Error('facts must be an object');
  const ownerActorId = requiredString(command.facts.ownerActorId, 'facts.ownerActorId');
  const causeTags = command.facts.causeTags;
  if (!Array.isArray(causeTags)) throw new Error('facts.causeTags must be an explicit array');
  const normalizedCauseTags = [...new Set(causeTags.map((tag, index) => (
    normalizeTag(requiredString(tag, `facts.causeTags[${index}]`))
  )))];
  const sourceActorId = command.facts.sourceActorId == null
    ? undefined
    : requiredString(command.facts.sourceActorId, 'facts.sourceActorId');
  if (conditionRequiresSourceActor(conditionId) && !sourceActorId) {
    throw new Error(`condition «${conditionId}» requires an explicit source actor id`);
  }
  const immunities = [
    ...validateImmunities(command.facts.conditionImmunities),
    ...activeConditionImmunities(state),
  ];
  const immunity = matchingImmunity(conditionId, normalizedCauseTags, immunities);
  if (immunity) {
    return {
      state: cloneState(state),
      events: [{
        type: 'condition_immune',
        condition: conditionId,
        sourceEntityIds: [...immunity.sourceEntityIds],
      }],
    };
  }

  const stacking = conditionStacking(conditionId);
  const previousLevel = conditionLevel(state, conditionId);
  if (stacking.mode === 'levels' && stacking.max != null && previousLevel >= stacking.max) {
    return {
      state: cloneState(state),
      events: [{
        type: 'narrative',
        text: `${conditionLabel(conditionId)}: достигнут максимальный уровень ${stacking.max}.`,
      }],
    };
  }

  const mechanics: Dict = {
    kind: 'condition',
    value: conditionId,
    op: 'apply',
    cause_tags: normalizedCauseTags,
    source_entity_id: command.effect.sourceEntityId,
    provenance,
    ...(stacking.mode === 'levels' ? { stack_type: 'stack' } : {}),
  };
  const entry: ActiveEffectEntry = {
    id: nextUniqueId(options, state, `condition:${conditionId}`),
    name: conditionLabel(conditionId),
    mechanics,
    expiry: 'manual',
    source: provenance,
    entityRef: { kind: 'effect', id: command.effect.sourceEntityId },
    ownerId: ownerActorId,
    ...(sourceActorId ? { sourceId: sourceActorId } : {}),
  };
  const withoutSame = stacking.mode === 'binary'
    ? state.activeEffects.filter((candidate) => conditionValueOf(
      candidate,
      `runtime.activeEffects[${candidate.id}]`,
    ) !== conditionId)
    : state.activeEffects;
  let next: RuntimeState = {
    ...cloneState(state),
    activeEffects: [...withoutSame.map((candidate) => ({
      ...candidate,
      mechanics: { ...(candidate.mechanics as Dict) },
    })), entry],
  };
  const events: EngineEvent[] = [{ type: 'condition_applied', condition: conditionId }];
  const level = conditionLevel(next, conditionId);
  if (level > previousLevel) {
    const threshold = conditionRule(conditionId)?.thresholds?.find((candidate) => (
      level >= candidate.atLevel && previousLevel < candidate.atLevel
    ));
    if (threshold) {
      events.push({
        type: 'narrative',
        text: `${conditionLabel(conditionId)}: уровень ${level}, порог ${threshold.atLevel} → ${threshold.outcome}.`,
      });
    }
  }
  if (conditionDeniesConcentration(conditionId)) {
    const dropped = dropConcentration(next, 'недееспособность');
    next = dropped.state;
    events.push(...dropped.events);
  }
  return { state: next, events };
}

function removeEffect(
  state: RuntimeState,
  command: Extract<ManualEffectCommand, { type: 'RemoveEffect' }>,
  options: ManualEffectCommandOptions,
): ManualEffectCommandResult {
  const effectId = requiredString(command.effectId, 'effectId');
  const ownerActorId = requiredString(command.ownerActorId, 'ownerActorId');
  const provenance = requiredString(command.provenance, 'provenance');
  const removed = state.activeEffects.find((entry) => entry.id === effectId);
  if (!removed) throw new Error(`active effect «${effectId}» does not exist`);
  if (removed.ownerId && removed.ownerId !== ownerActorId) {
    throw new Error(`active effect «${effectId}» belongs to another actor`);
  }
  if (!isRecord(removed.mechanics)) throw new Error(`active effect «${effectId}» has malformed mechanics`);
  if (removed.mechanics.kind === 'concentration') {
    return dropConcentration(cloneState(state), provenance);
  }

  const removedCondition = conditionValueOf(removed, `active effect «${effectId}»`);
  let next: RuntimeState = {
    ...cloneState(state),
    activeEffects: state.activeEffects
      .filter((entry) => entry.id !== effectId)
      .map((entry) => ({ ...entry, mechanics: { ...(entry.mechanics as Dict) } })),
  };
  const events: EngineEvent[] = [{ type: 'effect_expired', name: removed.name }];
  if (!removedCondition) return { state: next, events };

  const conditionStillPresent = next.activeEffects.some((entry) => (
    conditionValueOf(entry, `runtime.activeEffects[${entry.id}]`) === removedCondition
  ));
  if (conditionStillPresent) return { state: next, events };

  for (const leave of conditionLeaves(removedCondition)) {
    assertConditionRule(leave);
    const leaveEntityRef = conditionEffectEntityRef(leave);
    if (!leaveEntityRef && conditionRegistryAuthority().mode === 'database_release') {
      throw new Error(`condition leave «${leave}» has no effects-library entity`);
    }
    const alreadyPresent = next.activeEffects.some((entry) => (
      conditionValueOf(entry, `runtime.activeEffects[${entry.id}]`) === leave
    ));
    if (alreadyPresent) continue;
    const leaveEntry: ActiveEffectEntry = {
      id: nextUniqueId(options, next, `condition-leave:${leave}`),
      name: conditionLabel(leave),
      mechanics: {
        kind: 'condition',
        value: leave,
        op: 'apply',
        cause_tags: ['condition_leave'],
        source_entity_id: `condition:${leave}`,
        provenance: `condition_leave:${removedCondition}`,
      },
      expiry: 'manual',
      source: `condition_leave:${removedCondition}`,
      ...(leaveEntityRef ? { entityRef: leaveEntityRef } : {}),
      ownerId: ownerActorId,
      ...(removed.sourceId ? { sourceId: removed.sourceId } : {}),
    };
    next = { ...next, activeEffects: [...next.activeEffects, leaveEntry] };
    events.push({ type: 'condition_applied', condition: leave });
    if (conditionDeniesConcentration(leave)) {
      const dropped = dropConcentration(next, 'недееспособность');
      next = dropped.state;
      events.push(...dropped.events);
    }
  }
  return { state: next, events };
}

/** Single data-driven interpreter for manual ApplyEffect/RemoveEffect commands.
 * It mutates no input and performs no persistence/network I/O. */
export function executeManualEffectCommand(
  state: RuntimeState,
  command: ManualEffectCommand,
  options: ManualEffectCommandOptions,
): ManualEffectCommandResult {
  if (!isRecord(state)) throw new Error('runtime state must be an object');
  validateStateEffects(state);
  if (!isRecord(command)) throw new Error('manual effect command must be an object');
  if (command.type === 'ApplyEffect') return applyCondition(state, command, options);
  if (command.type === 'RemoveEffect') return removeEffect(state, command, options);
  throw new Error('unsupported manual effect command');
}

/** Browser-only identity provider. Tests/replays should inject deterministic ids. */
export function nextBrowserManualEffectId(prefix: string): string {
  if (!globalThis.crypto || typeof globalThis.crypto.randomUUID !== 'function') {
    throw new Error('secure randomUUID is unavailable for active-effect identity');
  }
  return `${prefix}:${globalThis.crypto.randomUUID()}`;
}
