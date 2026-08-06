import type { Ability } from './domain';
import type { JsonObject, RuleActionDefinition } from './domain';
import {
  resolveSpellAccess,
  type RejectedSpellAccess,
  type ResolvedSpellAccess,
  type SpellAccessKind,
  type SpellCastMode,
  type SpellcastingAccessState,
} from './spellcastingAccess';

export type SpellRuleActionDefinition = Extract<RuleActionDefinition, { kind: 'spell' }>;

export interface SpellExecutionDeclaration {
  /** Required when the actor owns the same spell through several sources. */
  grantId?: string;
  mode?: SpellCastMode;
  /** Set to false when the player deliberately wants to preserve a free use. */
  preferFreeUse?: boolean;
}

export interface PrepareSpellExecutionInput {
  action: SpellRuleActionDefinition;
  accessState: SpellcastingAccessState;
  resources: Readonly<Record<string, number>>;
  declaration?: SpellExecutionDeclaration;
}

export interface SpellExecutionProvenance {
  grantId: string;
  sourceId: string;
  access: SpellAccessKind;
  spellcastingAbility: Ability;
  mode: SpellCastMode;
}

export interface PreparedSpellExecution {
  status: 'ready';
  /** A detached action whose activation cost is safe to pass to the executor. */
  executableAction: SpellRuleActionDefinition;
  payment: ResolvedSpellAccess['payment'];
  provenance: SpellExecutionProvenance;
}

export type SpellExecutionDefinitionFailureCode =
  | 'MalformedSpellActivation'
  | 'MalformedSpellActivationCost'
  | 'SpellGrantLevelMismatch'
  | 'MalformedResolvedSpellPayment';

export type SpellExecutionFailureCode =
  | RejectedSpellAccess['code']
  | SpellExecutionDefinitionFailureCode;

export type SpellExecutionAccessError = RejectedSpellAccess & {
  stage: 'access';
};

export interface SpellExecutionDefinitionError {
  status: 'rejected';
  stage: 'action_definition';
  code: SpellExecutionDefinitionFailureCode;
  message: string;
}

export type RejectedSpellExecution =
  | SpellExecutionAccessError
  | SpellExecutionDefinitionError;

export type SpellExecutionResult = PreparedSpellExecution | RejectedSpellExecution;

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cloneJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneJson);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [key, cloneJson(nested)]),
  );
}

function accessError(error: RejectedSpellAccess): SpellExecutionAccessError {
  return { ...error, stage: 'access' };
}

function definitionError(
  code: SpellExecutionDefinitionFailureCode,
  message: string,
): SpellExecutionDefinitionError {
  return { status: 'rejected', stage: 'action_definition', code, message };
}

function paymentResources(state: SpellcastingAccessState, actionId: string): Set<string> {
  const resources = new Set<string>();
  for (const grant of state.grants) {
    if (grant.actionId !== actionId) continue;
    if (grant.slotResource) resources.add(grant.slotResource);
    if (grant.freeUseResource) resources.add(grant.freeUseResource);
  }
  return resources;
}

function isSlotResource(resource: string): boolean {
  return resource === 'spell_slot'
    || /^(?:spell_slot|pact_slot|warlock_spell_slot)_\d+$/.test(resource);
}

function canonicalActivationCost(input: {
  action: SpellRuleActionDefinition;
  accessState: SpellcastingAccessState;
  payment: ResolvedSpellAccess['payment'];
}): JsonRecord[] | SpellExecutionDefinitionError {
  const rawActivation = input.action.mechanics.activation;
  if (rawActivation !== undefined && !isRecord(rawActivation)) {
    return definitionError(
      'MalformedSpellActivation',
      `Spell action ${input.action.id} has a malformed activation object`,
    );
  }
  const rawCost = rawActivation?.cost;
  if (rawCost !== undefined && !Array.isArray(rawCost)) {
    return definitionError(
      'MalformedSpellActivationCost',
      `Spell action ${input.action.id} has a malformed activation cost`,
    );
  }
  if (Array.isArray(rawCost) && rawCost.some((entry) => !isRecord(entry))) {
    return definitionError(
      'MalformedSpellActivationCost',
      `Spell action ${input.action.id} has a non-object activation cost entry`,
    );
  }

  const sourcePayments = paymentResources(input.accessState, input.action.id);
  const preserved = (rawCost ?? [])
    .filter((entry): entry is JsonRecord => isRecord(entry))
    .filter((entry) => {
      const resource = typeof entry.resource === 'string' ? entry.resource : '';
      return !isSlotResource(resource) && !sourcePayments.has(resource);
    })
    .map((entry) => cloneJson(entry) as JsonRecord);

  if (input.payment.kind === 'none') return preserved;
  if (!input.payment.resource) {
    return definitionError(
      'MalformedResolvedSpellPayment',
      `Resolved ${input.payment.kind} payment for ${input.action.id} has no resource`,
    );
  }
  return [...preserved, { resource: input.payment.resource, amount: 1 }];
}

function detachedAction(
  action: SpellRuleActionDefinition,
  activationCost: JsonRecord[],
): SpellRuleActionDefinition {
  const mechanics = cloneJson(action.mechanics) as JsonObject;
  const activation = isRecord(mechanics.activation) ? mechanics.activation : {};
  mechanics.activation = { ...activation, cost: activationCost };
  return {
    ...action,
    sourceEntityIds: [...action.sourceEntityIds] as [string, ...string[]],
    mechanics,
    ...(action.targeting
      ? {
        targeting: {
          ...action.targeting,
          allowedRelations: [...action.targeting.allowedRelations],
        },
      }
      : {}),
    spell: {
      ...action.spell,
      ...(action.spell.components ? { components: { ...action.spell.components } } : {}),
    },
  };
}

/**
 * Resolve an actor-owned spell source and derive the exact mechanics executed
 * for this cast. The catalog action and actor spell-access state remain
 * untouched; source-specific ability and payment are returned as provenance.
 */
export function prepareSpellExecution(input: PrepareSpellExecutionInput): SpellExecutionResult {
  const declaration = input.declaration ?? {};
  const resolution = resolveSpellAccess({
    state: input.accessState,
    actionId: input.action.id,
    resources: input.resources,
    ...(declaration.grantId !== undefined ? { grantId: declaration.grantId } : {}),
    ...(declaration.mode !== undefined ? { mode: declaration.mode } : {}),
    ...(declaration.preferFreeUse !== undefined
      ? { preferFreeUse: declaration.preferFreeUse }
      : {}),
  });
  if (resolution.status === 'rejected') return accessError(resolution);
  if (resolution.grant.level !== input.action.spell.level) {
    return definitionError(
      'SpellGrantLevelMismatch',
      `Grant ${resolution.grant.grantId} has level ${resolution.grant.level}, but ${input.action.id} has level ${input.action.spell.level}`,
    );
  }

  const cost = canonicalActivationCost({
    action: input.action,
    accessState: input.accessState,
    payment: resolution.payment,
  });
  if (!Array.isArray(cost)) return cost;

  return {
    status: 'ready',
    executableAction: detachedAction(input.action, cost),
    payment: { ...resolution.payment },
    provenance: {
      grantId: resolution.grant.grantId,
      sourceId: resolution.grant.sourceId,
      access: resolution.grant.access,
      spellcastingAbility: resolution.grant.spellcastingAbility,
      mode: declaration.mode ?? 'normal',
    },
  };
}
