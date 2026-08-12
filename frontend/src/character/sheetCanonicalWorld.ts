import type { AssembledCharacter } from './assemble';
import type { SheetAction } from './actionSheet';
import type { ForgeCharacter } from './types';
import type { AppliedGrant, CharacterRuleState, RuleSource } from './rules/types';
import type { CharacterContext, RuntimeState } from '../mvp/contracts';
import {
  createWorld,
  type ActorState,
  type RuleActionDefinition,
  type RulesCatalog,
  type RulesetReference,
  type WorldState,
} from '../rules-core/domain';
import { canonicalStringify } from '../rules-core/determinism';
import { migrateWorldState } from '../rules-core/worldMigration';
import { bindWarlockPactDeclaration } from '../rules-core/warlockPactDeclaration';
import {
  conjurePactTome,
  createPactBladeInvocationState,
  createPactChainInvocationState,
  createPactTomeInvocationState,
  type WarlockPactStates,
} from '../rules-core/warlockPacts';
import type { SpellGrantAccess } from '../rules-core/spellcastingAccess';
import { FAMILIAR_ACTOR_CATALOG } from '../rules-core/familiarActorCatalog';
import type { Card, PassiveEffect, Spell } from '../types';
import {
  applySpellCastingOverride,
  declaredSpellCastingOverride,
  projectRuleAction,
  type SpellCastingOverride,
} from '../canon/ruleActionProjection';
import {
  projectSpellcastingAccess,
  type PreparedSourceProjection,
  type SpellGrantProjection,
} from '../canon/spellcastingAccessProjection';
import { freeuseKey } from '../engine/freeuse';
import { preparedSpellSelectionIssues } from '../mechanics/collectChoices';

export const SHEET_CANONICAL_WORLD_KEY = 'canonical_rules_world_v1' as const;
export const SHEET_CANONICAL_WORLD_ENVELOPE_VERSION = 1 as const;

export interface SheetCanonicalWorldEnvelope {
  schemaVersion: typeof SHEET_CANONICAL_WORLD_ENVELOPE_VERSION;
  primaryActorId: string;
  rulesetContentHash: string;
  world: WorldState;
  resourceBindings?: SheetCanonicalResourceBindings;
}

export type SheetCanonicalResourceBindings = Record<string, {
  kind: 'currency';
  currency: 'gold' | 'silver' | 'copper';
}>;

export interface SheetCanonicalPersistenceProjection {
  /** Runtime persisted in the ordinary CharacterV3 columns (bound aliases removed). */
  runtime: RuntimeState;
  /** Currency after applying the exact delta spent through a bound resource. */
  currency?: Record<string, number>;
}

export interface SheetCanonicalRuntime {
  actorId: string;
  world: WorldState;
  actions: readonly RuleActionDefinition[];
  catalog: RulesCatalog;
  cards: readonly Card[];
  resourceBindings: SheetCanonicalResourceBindings;
  /** Rest-time selection compiled from Pact Tome mechanics plus resolved Forge choices. */
  pactTomeSelection?: {
    sourceEntityId: string;
    cantripActionIds: string[];
    ritualActionIds: string[];
  };
  actionFor(sheetAction: SheetAction): RuleActionDefinition;
}

/**
 * A canonical actor carries only immutable Card data it can actually resolve
 * from equipment or inventory. The global catalog belongs to the rules
 * release, not to every WorldState actor snapshot.
 */
export function canonicalActorCards(
  runtime: RuntimeState,
  cards: ReadonlyMap<string, Card>,
): Card[] {
  const ids = new Set([
    ...Object.values(runtime.equipment).filter((id): id is string => typeof id === 'string'),
    ...runtime.inventory.map((row) => row.cardId),
  ]);
  return [...ids]
    .sort()
    .map((id) => cards.get(id))
    .filter((card): card is Card => card != null);
}

export class SheetCanonicalWorldError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SheetCanonicalWorldError';
  }
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function fnv1a32(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a32:${hash.toString(16).padStart(8, '0')}`;
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonBlank(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function stableIds(values: readonly unknown[]): [string, ...string[]] {
  const ids = [...new Set(values.filter(nonBlank))];
  if (!ids.length) throw new SheetCanonicalWorldError('Canonical action has no immutable source entity');
  return ids as [string, ...string[]];
}

function persistedResourceBindings(
  turnState: Record<string, unknown> | null | undefined,
): SheetCanonicalResourceBindings {
  const envelope = object(turnState?.[SHEET_CANONICAL_WORLD_KEY]);
  const raw = envelope?.resourceBindings;
  if (raw === undefined) return {};
  const record = object(raw);
  if (!record) throw new SheetCanonicalWorldError('Canonical resourceBindings must be an object');
  const bindings: SheetCanonicalResourceBindings = {};
  for (const [resource, value] of Object.entries(record)) {
    const binding = object(value);
    if (!resource || binding?.kind !== 'currency'
      || !['gold', 'silver', 'copper'].includes(String(binding.currency ?? ''))) {
      throw new SheetCanonicalWorldError(`Canonical resource binding ${resource || '<empty>'} is invalid`);
    }
    bindings[resource] = {
      kind: 'currency',
      currency: binding.currency as 'gold' | 'silver' | 'copper',
    };
  }
  return bindings;
}

function declaredResourceBindings(
  actions: readonly RuleActionDefinition[],
): SheetCanonicalResourceBindings {
  const result: SheetCanonicalResourceBindings = {};
  for (const action of actions) {
    const activation = object(action.mechanics.activation);
    if (!Array.isArray(activation?.cost)) continue;
    for (const rawCost of activation.cost) {
      const cost = object(rawCost);
      const binding = object(cost?.binding);
      if (!binding) continue;
      const resource = cost?.resource;
      if (!nonBlank(resource)
        || binding.kind !== 'currency'
        || !['gold', 'silver', 'copper'].includes(String(binding.currency ?? ''))
        || cost?.recharge !== 'never'
        || !Number.isInteger(cost?.amount)
        || Number(cost.amount) <= 0) {
        throw new SheetCanonicalWorldError(
          `Action ${action.id} has an invalid persistent activation-cost binding`,
        );
      }
      const next = {
        kind: 'currency' as const,
        currency: binding.currency as 'gold' | 'silver' | 'copper',
      };
      const previous = result[resource];
      if (previous && canonicalStringify(previous) !== canonicalStringify(next)) {
        throw new SheetCanonicalWorldError(
          `Resource ${resource} has incompatible persistent bindings`,
        );
      }
      result[resource] = next;
    }
  }
  return result;
}

/**
 * Convert canonical resource aliases back to their CharacterV3 source of
 * truth.  `material_incense_gp`, for example, may explicitly bind to gold;
 * the canonical handler spends the alias, while this projection persists the
 * same delta against currency and never leaves two independently spendable
 * ledgers behind.
 */
export function projectSheetCanonicalPersistence(input: {
  runtime: RuntimeState;
  currency: Record<string, number> | null | undefined;
  resourceBindings: SheetCanonicalResourceBindings;
}): SheetCanonicalPersistenceProjection {
  const runtime = cloneJson(input.runtime);
  const bindingEntries = Object.entries(input.resourceBindings);
  if (!bindingEntries.length) return { runtime };
  const currency = { ...(input.currency ?? {}) };
  for (const [resource, binding] of bindingEntries) {
    const sourceAmount = currency[binding.currency];
    const remaining = runtime.resources[resource];
    const maximum = runtime.maxResources[resource];
    if (!Number.isFinite(sourceAmount) || sourceAmount < 0
      || !Number.isInteger(remaining) || remaining < 0
      || !Number.isInteger(maximum) || maximum < remaining) {
      throw new SheetCanonicalWorldError(
        `Canonical resource binding ${resource} has invalid currency/runtime values`,
      );
    }
    // Currency can contain fractional GP.  The familiar primitive consumes
    // whole GP, so its alias exposes the whole-GP portion and preserves change.
    const exposed = Math.floor(sourceAmount);
    if (remaining > exposed || maximum !== exposed) {
      throw new SheetCanonicalWorldError(
        `Canonical resource binding ${resource} diverged from ${binding.currency}`,
      );
    }
    currency[binding.currency] = sourceAmount - (exposed - remaining);
    delete runtime.resources[resource];
    delete runtime.maxResources[resource];
  }
  return { runtime, currency };
}

function primitiveType(mechanics: Record<string, unknown>): string | undefined {
  const primitive = object(mechanics.primitive);
  return nonBlank(primitive?.type) ? primitive.type : undefined;
}

function spellMatchesReference(spell: Spell, reference: string): boolean {
  return spell.id === reference || spell.card_number === reference;
}

type PactBinding = {
  effect: PassiveEffect;
  originId: string;
  declaration: NonNullable<ReturnType<typeof bindWarlockPactDeclaration>>;
  tomeSelections?: { cantrips: string[]; rituals: string[] };
};

function selectedChoice(
  assembled: AssembledCharacter,
  resolvedChoices: Record<string, string[]> | null | undefined,
  effectId: string,
  rawChoiceId: string,
): string[] {
  const choice = assembled.pendingChoices.find((candidate) => (
    candidate.origin.featureId?.split('#')[0] === effectId
      && candidate.id.endsWith(`:${rawChoiceId}`)
  ));
  if (!choice) {
    throw new SheetCanonicalWorldError(
      `Pact Tome is missing declared choice ${rawChoiceId} for source ${effectId}`,
    );
  }
  return [...(resolvedChoices?.[choice.id] ?? [])];
}

function pactBindings(
  assembled: AssembledCharacter,
  resolvedChoices: Record<string, string[]> | null | undefined,
): PactBinding[] {
  const bindings: PactBinding[] = [];
  const seen = new Set<string>();
  for (const { effect, origin } of assembled.effects) {
    const primitive = object(effect.mechanics?.primitive);
    if (!primitive || !String(primitive.type ?? '').startsWith('pact_')) continue;
    const declaration = bindWarlockPactDeclaration(effect.mechanics);
    if (!declaration) {
      throw new SheetCanonicalWorldError(
        `${effect.id} declares a Pact primitive but its mechanics contract is invalid`,
      );
    }
    if (seen.has(declaration.kind)) {
      throw new SheetCanonicalWorldError(`Several ${declaration.kind} Pact declarations are active`);
    }
    seen.add(declaration.kind);
    bindings.push({
      effect,
      originId: origin.id,
      declaration,
      ...(declaration.kind === 'tome' ? {
        tomeSelections: {
          cantrips: selectedChoice(
            assembled,
            resolvedChoices,
            effect.id,
            declaration.cantripChoiceId,
          ),
          rituals: selectedChoice(
            assembled,
            resolvedChoices,
            effect.id,
            declaration.ritualChoiceId,
          ),
        },
      } : {}),
    });
  }
  return bindings;
}


type SpellGrantBinding = {
  grant: AppliedGrant;
  source: RuleSource;
  sourceMechanics: Record<string, unknown>;
  sourceEntityIds: string[];
  sourceId: string;
  grantScopeId: string;
  sourceClass?: string;
  castingOverride?: SpellCastingOverride;
};

type CompiledSheetAction = {
  sheet: SheetAction;
  action: RuleActionDefinition;
  spellGrant?: SpellGrantBinding;
};

function exactSpellGrant(
  spell: Spell,
  ruleState: Pick<CharacterRuleState, 'appliedGrants'>,
): AppliedGrant {
  const matches = ruleState.appliedGrants.filter((grant) => (
    grant.kind === 'spell' && spellMatchesReference(spell, grant.value)
  ));
  if (matches.length !== 1) {
    throw new SheetCanonicalWorldError(
      `${spell.card_number || spell.id} requires exactly one applied grant; got ${matches.length}`,
    );
  }
  return matches[0];
}

function sourceFeature(input: {
  source: RuleSource;
  assembled: AssembledCharacter;
}): { mechanics: Record<string, unknown>; cardNumber?: string; originId: string } {
  const effectMatches = input.assembled.effects.filter(({ effect }) => (
    effect.id === input.source.featureEntityId
  ));
  const actionMatches = input.assembled.actions.filter(({ action }) => (
    action.id === input.source.featureEntityId
  ));
  if (effectMatches.length + actionMatches.length !== 1) {
    throw new SheetCanonicalWorldError(
      `Spell grant ${input.source.id} requires exactly one mechanics source; got ${effectMatches.length + actionMatches.length}`,
    );
  }
  const match = effectMatches[0]
    ? { entity: effectMatches[0].effect, origin: effectMatches[0].origin }
    : { entity: actionMatches[0].action, origin: actionMatches[0].origin };
  if (input.source.originEntityId && match.origin.id !== input.source.originEntityId) {
    throw new SheetCanonicalWorldError(`Spell grant ${input.source.id} has stale origin provenance`);
  }
  return {
    mechanics: cloneJson(match.entity.mechanics ?? {}),
    cardNumber: match.entity.card_number,
    originId: match.origin.id,
  };
}

function spellGrantBinding(input: {
  spell: Spell;
  grant: AppliedGrant;
  assembled: AssembledCharacter;
}): SpellGrantBinding {
  const feature = sourceFeature({ source: input.grant.source, assembled: input.assembled });
  const castingOverride = declaredSpellCastingOverride(feature.mechanics, input.spell);
  const classId = input.assembled.klass?.id;
  const classCard = input.assembled.klass?.card_number;
  const sameClassOrigin = input.grant.source.type === 'class'
    && !!classId
    && input.grant.source.originEntityId === classId;
  const invocationOwned = sameClassOrigin && (
    castingOverride !== undefined
      || String(object(feature.mechanics.primitive)?.type ?? '').startsWith('pact_')
  );

  if (sameClassOrigin && !classCard) {
    throw new SheetCanonicalWorldError('Class spell grant requires a stable class card_number');
  }
  if (sameClassOrigin && invocationOwned) {
    if (!input.grant.source.featureEntityId || !feature.cardNumber) {
      throw new SheetCanonicalWorldError(`Invocation spell grant ${input.grant.source.id} is unscoped`);
    }
    return {
      grant: input.grant,
      source: input.grant.source,
      sourceMechanics: feature.mechanics,
      sourceEntityIds: [input.grant.source.featureEntityId, classId!],
      sourceId: feature.cardNumber,
      grantScopeId: input.grant.source.featureEntityId,
      sourceClass: classCard,
      ...(castingOverride ? { castingOverride } : {}),
    };
  }
  if (sameClassOrigin) {
    return {
      grant: input.grant,
      source: input.grant.source,
      sourceMechanics: feature.mechanics,
      sourceEntityIds: [classId!],
      sourceId: classCard!,
      grantScopeId: classCard!,
      sourceClass: classCard!,
      ...(castingOverride ? { castingOverride } : {}),
    };
  }
  if (input.grant.source.type === 'feat') {
    const feat = input.assembled.feats.find((candidate) => (
      candidate.id === input.grant.source.originEntityId
    ));
    if (!feat || !input.grant.source.featureEntityId) {
      throw new SheetCanonicalWorldError(`Feat spell grant ${input.grant.source.id} is unscoped`);
    }
    return {
      grant: input.grant,
      source: input.grant.source,
      sourceMechanics: feature.mechanics,
      sourceEntityIds: [feat.id, input.grant.source.featureEntityId],
      sourceId: feat.card_number || feat.id,
      grantScopeId: feat.id,
      ...(castingOverride ? { castingOverride } : {}),
    };
  }
  if (input.grant.source.type === 'species') {
    const originId = input.grant.source.originEntityId ?? feature.originId;
    const baseSpeciesId = input.assembled.race?.id;
    return {
      grant: input.grant,
      source: input.grant.source,
      sourceMechanics: feature.mechanics,
      sourceEntityIds: stableIds([originId, baseSpeciesId]),
      sourceId: originId,
      grantScopeId: originId,
      ...(castingOverride ? { castingOverride } : {}),
    };
  }
  const scope = input.grant.source.featureEntityId ?? input.grant.source.originEntityId;
  if (!scope) throw new SheetCanonicalWorldError(`Spell grant ${input.grant.source.id} is unscoped`);
  return {
    grant: input.grant,
    source: input.grant.source,
    sourceMechanics: feature.mechanics,
    sourceEntityIds: [scope],
    sourceId: feature.cardNumber || scope,
    grantScopeId: scope,
    ...(castingOverride ? { castingOverride } : {}),
  };
}

function ruleAction(input: {
  sheet: SheetAction;
  assembled: AssembledCharacter;
  ruleState: Pick<CharacterRuleState, 'appliedGrants'>;
}): CompiledSheetAction {
  if (input.sheet.spellRef) {
    const grant = exactSpellGrant(input.sheet.spellRef, input.ruleState);
    const binding = spellGrantBinding({
      spell: input.sheet.spellRef,
      grant,
      assembled: input.assembled,
    });
    const spell = applySpellCastingOverride(input.sheet.spellRef, binding.castingOverride);
    return {
      sheet: input.sheet,
      spellGrant: binding,
      action: projectRuleAction(spell, {
        sourceEntityIds: binding.sourceEntityIds,
        sourceClass: binding.sourceClass,
        grantScopeId: binding.grantScopeId,
      }),
    };
  }

  // Non-spell sheet actions keep their existing synthetic/item adapters. Raw
  // DB actions/effects use their immutable mechanics card through the shared
  // projector so the sheet and release compiler cannot drift.
  const entity = input.sheet.actionRef ?? input.sheet.effectRef;
  if (entity) {
    const originIds = (input.sheet.sourceEntityIds ?? []).filter((id) => (
      id !== entity.id && id !== entity.card_number
    ));
    if (originIds.length > 1) {
      throw new SheetCanonicalWorldError(
        `Action ${entity.id} has ambiguous immutable grant origins: ${originIds.length}`,
      );
    }
    return {
      sheet: input.sheet,
      // Contextual costs (for example equipped_weapon_ammo) have already
      // resolved against the sheet's selected equipment. Project that bound
      // mechanics through the same canonical compiler; the immutable entity
      // still owns identity, display data, and provenance.
      action: projectRuleAction({
        ...entity,
        mechanics: cloneJson(input.sheet.mechanics),
      } as never, {
        sourceEntityIds: originIds,
        ...(originIds[0] ? { grantScopeId: originIds[0] } : {}),
      }),
    };
  }
  const mechanics = cloneJson(input.sheet.mechanics);
  const primitive = primitiveType(mechanics);
  const targetingDeclaration = object(mechanics.targeting);
  if (primitive && !targetingDeclaration) {
    throw new SheetCanonicalWorldError(
      `Primitive ${primitive} on ${input.sheet.id} requires explicit mechanics.targeting`,
    );
  }
  return {
    sheet: input.sheet,
    action: {
      id: input.sheet.id,
      name: input.sheet.name,
      mechanics,
      sourceEntityIds: stableIds(input.sheet.sourceEntityIds ?? []),
      kind: 'nonSpell',
    },
  };
}

function accessForGrant(grant: AppliedGrant, spell: Spell, override?: SpellCastingOverride) {
  const label = grant.label?.trim().toLowerCase();
  if (label === 'cantrip') {
    if (spell.level !== 0) throw new SheetCanonicalWorldError(`${grant.id}: cantrip grant has level ${spell.level}`);
    return 'cantrip' as const;
  }
  if (label === 'known') return 'known' as const;
  if (label === 'prepared' || label === 'always_prepared') return 'always_prepared' as const;
  if (label === 'spellbook') return 'spellbook' as const;
  if (spell.level === 0) return 'cantrip' as const;
  if (override?.removeCostResources.includes('spell_slot')) return 'innate' as const;
  throw new SheetCanonicalWorldError(`${grant.id}: levelled spell grant requires an explicit access label`);
}

function declaredSlotResource(action: RuleActionDefinition): string | undefined {
  if (action.kind !== 'spell' || action.spell.level === 0) return undefined;
  const activation = object(action.mechanics.activation);
  const costs = Array.isArray(activation?.cost) ? activation.cost : [];
  const resources = [...new Set(costs.flatMap((value) => {
    const resource = object(value)?.resource;
    if (resource === 'spell_slot') return [`spell_slot_${action.spell.level}`];
    return typeof resource === 'string'
      && /^(?:spell_slot|pact_slot|warlock_spell_slot)_\d+$/.test(resource)
      ? [resource]
      : [];
  }))];
  if (resources.length > 1) {
    throw new SheetCanonicalWorldError(`${action.id}: ambiguous spell-slot resources`);
  }
  return resources[0];
}

function preparedSourceProjections(input: {
  assembled: AssembledCharacter;
  resolvedChoices: Record<string, string[]> | null | undefined;
  compiled: readonly CompiledSheetAction[];
  grants: readonly SpellGrantProjection[];
}): PreparedSourceProjection[] {
  const spellbookGrants = input.grants.filter((grant) => grant.access === 'spellbook');
  if (!spellbookGrants.length) return [];
  const choices = input.assembled.pendingChoices.filter((choice) => choice.source === 'prepared_spell');
  if (choices.length !== 1) {
    throw new SheetCanonicalWorldError(
      'Книга заклинаний требует явного выбора подготовленных заклинаний. Откройте редактирование персонажа и заполните этот выбор.',
    );
  }
  const choice = choices[0];
  const selected = input.resolvedChoices?.[choice.id] ?? [];
  const issues = preparedSpellSelectionIssues(choice, selected);
  if (issues.length) {
    throw new SheetCanonicalWorldError(
      `Выбор «${choice.prompt}» некорректен: ${issues.join('; ')}. Откройте редактирование персонажа и исправьте подготовленные заклинания.`,
    );
  }
  const sourceIds = [...new Set(spellbookGrants.map((grant) => grant.sourceId))];
  if (sourceIds.length !== 1) {
    throw new SheetCanonicalWorldError('Prepared spell choice has ambiguous spellbook sources');
  }
  const actionForReference = (reference: string): string => {
    const matches = input.compiled.filter(({ sheet, action, spellGrant }) => (
      action.kind === 'spell'
        && !!sheet.spellRef
        && spellMatchesReference(sheet.spellRef, reference)
        && spellGrant?.sourceId === sourceIds[0]
    ));
    if (matches.length !== 1) {
      throw new SheetCanonicalWorldError(`Prepared spell ${reference} has ${matches.length} source actions`);
    }
    return matches[0].action.id;
  };
  return [{
    sourceId: sourceIds[0],
    capacity: choice.count,
    availableActionIds: (choice.allowedOptionIds ?? []).map(actionForReference),
    preparedActionIds: selected.map(actionForReference),
  }];
}

function baseSpellAccess(input: {
  compiled: readonly CompiledSheetAction[];
  assembled: AssembledCharacter;
  resolvedChoices: Record<string, string[]> | null | undefined;
  tomeActionIds: ReadonlySet<string>;
}): ReturnType<typeof projectSpellcastingAccess> {
  const grants: SpellGrantProjection[] = input.compiled.flatMap(({ sheet, action, spellGrant }) => {
    if (action.kind !== 'spell' || !sheet.spellRef || !spellGrant
      || input.tomeActionIds.has(action.id)) return [];
    const ability = spellGrant.grant.spellcastingAbility;
    if (!ability) {
      throw new SheetCanonicalWorldError(`${spellGrant.grant.id}: spellcasting ability is missing`);
    }
    const access = accessForGrant(spellGrant.grant, sheet.spellRef, spellGrant.castingOverride);
    const slotResource = declaredSlotResource(action);
    return [{
      action,
      sourceId: spellGrant.sourceId,
      access,
      spellcastingAbility: ability,
      ...(sheet.spellRef.ritual === true
        && (access === 'spellbook' || access === 'always_prepared')
        ? { ritual: true }
        : {}),
      ...(spellGrant.grant.freeuse
        ? { freeUseResource: freeuseKey(spellGrant.grant.value) }
        : {}),
      ...(slotResource ? { slotResource } : {}),
    }];
  });
  return projectSpellcastingAccess({
    grants,
    preparedSources: preparedSourceProjections({
      assembled: input.assembled,
      resolvedChoices: input.resolvedChoices,
      compiled: input.compiled,
      grants,
    }),
  });
}

function matchingAction(
  compiled: readonly CompiledSheetAction[],
  predicate: (sheet: SheetAction, action: RuleActionDefinition) => boolean,
  label: string,
): RuleActionDefinition {
  const matches = compiled.flatMap(({ sheet, action }) => (
    predicate(sheet, action) ? [action] : []
  ));
  if (matches.length !== 1) {
    throw new SheetCanonicalWorldError(`${label} requires exactly one compiled action; got ${matches.length}`);
  }
  return matches[0];
}

function selectedTomeActions(input: {
  binding: PactBinding;
  compiled: readonly CompiledSheetAction[];
}): { cantrips: RuleActionDefinition[]; rituals: RuleActionDefinition[] } {
  const select = (references: readonly string[], label: string) => references.map((reference) => (
    matchingAction(
      input.compiled,
      (sheet, action) => action.kind === 'spell'
        && !!sheet.spellRef
        && spellMatchesReference(sheet.spellRef, reference),
      `${label} ${reference}`,
    )
  ));
  return {
    cantrips: select(input.binding.tomeSelections?.cantrips ?? [], 'Pact Tome cantrip'),
    rituals: select(input.binding.tomeSelections?.rituals ?? [], 'Pact Tome ritual'),
  };
}

function assertPersistedPactsMatch(
  persisted: WarlockPactStates | undefined,
  expected: WarlockPactStates | undefined,
): void {
  for (const kind of ['blade', 'chain', 'tome'] as const) {
    const left = persisted?.[kind];
    const right = expected?.[kind];
    if (!!left !== !!right || (left && right && left.sourceEntityId !== right.sourceEntityId)) {
      throw new SheetCanonicalWorldError(
        `Persisted canonical ${kind} state does not match the current mechanics-owned source`,
      );
    }
    const leftBlade = persisted?.blade;
    const rightBlade = expected?.blade;
    if (kind === 'blade' && leftBlade && rightBlade
      && leftBlade.bondActionId !== rightBlade.bondActionId) {
      throw new SheetCanonicalWorldError('Persisted Pact Blade action no longer matches current content');
    }
    const leftChain = persisted?.chain;
    const rightChain = expected?.chain;
    if (kind === 'chain' && leftChain && rightChain
      && leftChain.template.findFamiliarActionId !== rightChain.template.findFamiliarActionId) {
      throw new SheetCanonicalWorldError('Persisted Pact Chain spell no longer matches current content');
    }
    const leftTome = persisted?.tome;
    const rightTome = expected?.tome;
    if (kind === 'tome' && leftTome && rightTome
      && canonicalStringify({
        cantrips: leftTome.tome.cantripActionIds,
        rituals: leftTome.tome.ritualActionIds,
      }) !== canonicalStringify({
        cantrips: rightTome.tome.cantripActionIds,
        rituals: rightTome.tome.ritualActionIds,
      })) {
      throw new SheetCanonicalWorldError('Persisted Pact Tome choices no longer match current content');
    }
  }
}

export function readSheetCanonicalWorld(
  turnState: Record<string, unknown> | null | undefined,
  expectedActorId: string,
  expectedRulesetContentHash: string,
): WorldState | null {
  const raw = turnState?.[SHEET_CANONICAL_WORLD_KEY];
  if (raw === undefined) return null;
  const envelope = object(raw);
  if (envelope?.schemaVersion !== SHEET_CANONICAL_WORLD_ENVELOPE_VERSION
    || envelope.primaryActorId !== expectedActorId
    || envelope.rulesetContentHash !== expectedRulesetContentHash
    || !object(envelope.world)) {
    throw new SheetCanonicalWorldError('Persisted canonical sheet world envelope is malformed or stale');
  }
  persistedResourceBindings(turnState);
  const world = migrateWorldState(envelope.world);
  if (!world.actors[expectedActorId]
    || world.ruleset.contentHash !== expectedRulesetContentHash) {
    throw new SheetCanonicalWorldError('Persisted canonical sheet world has the wrong actor or ruleset');
  }
  return world;
}

export function writeSheetCanonicalWorld(
  turnState: Record<string, unknown> | null | undefined,
  primaryActorId: string,
  worldValue: WorldState,
  resourceBindings: SheetCanonicalResourceBindings = {},
): Record<string, unknown> {
  const world = migrateWorldState(cloneJson(worldValue));
  if (!world.actors[primaryActorId]) {
    throw new SheetCanonicalWorldError(`Canonical world misses primary actor ${primaryActorId}`);
  }
  const envelope: SheetCanonicalWorldEnvelope = {
    schemaVersion: SHEET_CANONICAL_WORLD_ENVELOPE_VERSION,
    primaryActorId,
    rulesetContentHash: world.ruleset.contentHash,
    world,
    ...(Object.keys(resourceBindings).length ? { resourceBindings: cloneJson(resourceBindings) } : {}),
  };
  return { ...(turnState ?? {}), [SHEET_CANONICAL_WORLD_KEY]: envelope };
}

export function synchronizeSheetCanonicalRuntime(
  worldValue: WorldState,
  actorId: string,
  runtime: RuntimeState,
  preserveResourceKeys: readonly string[] = [],
): WorldState {
  const world = cloneJson(worldValue);
  const actor = world.actors[actorId];
  if (!actor) throw new SheetCanonicalWorldError(`Canonical world misses actor ${actorId}`);
  const nextRuntime = cloneJson(runtime);
  for (const key of preserveResourceKeys) {
    if (!Object.prototype.hasOwnProperty.call(nextRuntime.resources, key)
      && Object.prototype.hasOwnProperty.call(actor.runtime.resources, key)) {
      nextRuntime.resources[key] = actor.runtime.resources[key];
    }
    if (!Object.prototype.hasOwnProperty.call(nextRuntime.maxResources, key)
      && Object.prototype.hasOwnProperty.call(actor.runtime.maxResources, key)) {
      nextRuntime.maxResources[key] = actor.runtime.maxResources[key];
    }
  }
  actor.runtime = nextRuntime;
  return migrateWorldState(world);
}

export function buildSheetCanonicalRuntime(input: {
  character: Pick<ForgeCharacter,
    'id' | 'name' | 'system_id' | 'ruleset_version' | 'turn_state' | 'resolved_choices'
      | 'currency' | 'resources' | 'max_resources'>;
  assembled: AssembledCharacter;
  ruleState: Pick<CharacterRuleState, 'appliedGrants'>;
  sheetActions: readonly SheetAction[];
  runtime: RuntimeState;
  characterContext: CharacterContext;
  passives?: Record<string, unknown>[];
  grantedEffects?: ActorState['grantedEffects'];
  masteryEffects?: ActorState['masteryEffects'];
  cards?: readonly Card[];
  ac?: number;
}): SheetCanonicalRuntime {
  const actorId = input.character.id;
  const bindings = pactBindings(input.assembled, input.character.resolved_choices);
  const compiled = input.sheetActions.map((sheet) => ruleAction({
    sheet,
    assembled: input.assembled,
    ruleState: input.ruleState,
  }));
  const actions = compiled.map(({ action }) => action);
  const actionById = new Map<string, RuleActionDefinition>();
  for (const action of actions) {
    const previous = actionById.get(action.id);
    if (previous && canonicalStringify(previous) !== canonicalStringify(action)) {
      throw new SheetCanonicalWorldError(`Several incompatible sheet actions use id ${action.id}`);
    }
    actionById.set(action.id, action);
  }
  const uniqueActions = [...actionById.values()]
    .sort((left, right) => left.id.localeCompare(right.id));
  const storedResourceBindings = persistedResourceBindings(input.character.turn_state);
  const resourceBindings = declaredResourceBindings(uniqueActions);
  if (canonicalStringify(storedResourceBindings) !== canonicalStringify(resourceBindings)
    && Object.keys(storedResourceBindings).length) {
    throw new SheetCanonicalWorldError(
      'Persisted canonical resource bindings do not match current activation-cost declarations',
    );
  }
  const runtime = cloneJson(input.runtime);
  const characterContext = cloneJson(input.characterContext);
  for (const [resource, binding] of Object.entries(resourceBindings)) {
    const sourceAmount = input.character.currency?.[binding.currency];
    if (!Number.isFinite(sourceAmount) || Number(sourceAmount) < 0) {
      throw new SheetCanonicalWorldError(
        `Persistent resource ${resource} requires non-negative ${binding.currency} currency`,
      );
    }
    const amount = Math.floor(Number(sourceAmount));
    runtime.resources[resource] = amount;
    runtime.maxResources[resource] = amount;
    characterContext.resourceRecharge = {
      ...(characterContext.resourceRecharge ?? {}),
      [resource]: 'never',
    };
  }
  const cardById = new Map<string, Card>();
  for (const card of input.cards ?? []) {
    const previous = cardById.get(card.id);
    if (previous && canonicalStringify(previous) !== canonicalStringify(card)) {
      throw new SheetCanonicalWorldError(`Several incompatible Cards use id ${card.id}`);
    }
    cardById.set(card.id, cloneJson(card));
  }
  const cards = [...cardById.values()].sort((left, right) => left.id.localeCompare(right.id));
  const catalog: RulesCatalog = {
    getAction: (id) => actionById.get(id),
    listActions: () => uniqueActions,
    getCard: (id) => cardById.get(id),
  };

  const pacts: WarlockPactStates = {};
  const featureSources: Record<string, [string, ...string[]]> = {};
  const initialObjects = [];
  const tomeActionIds = new Set<string>();
  const deferredTomes: Array<{
    binding: PactBinding;
    selected: ReturnType<typeof selectedTomeActions>;
  }> = [];

  for (const binding of bindings) {
    const sources = stableIds([
      binding.effect.id,
      binding.effect.card_number,
      binding.originId,
      input.assembled.klass?.id,
      input.assembled.klass?.card_number,
    ]);
    featureSources[binding.declaration.capabilityId] = sources;
    if (binding.declaration.kind === 'blade') {
      const action = matchingAction(
        compiled,
        (sheet, candidate) => sheet.effectRef?.id === binding.effect.id
          && primitiveType(candidate.mechanics) === binding.declaration.primitiveType,
        'Pact Blade',
      );
      pacts.blade = createPactBladeInvocationState({
        sourceEntityId: binding.effect.id,
        ownerActorId: actorId,
        bondActionId: action.id,
        lifecyclePolicy: binding.declaration.lifecyclePolicy,
      });
    } else if (binding.declaration.kind === 'chain') {
      const grantedSpell = binding.declaration.grantedSpell;
      const action = matchingAction(
        compiled,
        (sheet, candidate) => candidate.kind === 'spell'
          && primitiveType(candidate.mechanics) === 'find_familiar'
          && !!sheet.spellRef
          && spellMatchesReference(sheet.spellRef, grantedSpell),
        'Pact Chain Find Familiar',
      );
      pacts.chain = createPactChainInvocationState({
        sourceEntityId: binding.effect.id,
        ownerActorId: actorId,
        findFamiliarActionId: action.id,
      });
    } else {
      const selected = selectedTomeActions({
        binding,
        compiled,
      });
      selected.cantrips.forEach((action) => tomeActionIds.add(action.id));
      selected.rituals.forEach((action) => tomeActionIds.add(action.id));
      deferredTomes.push({ binding, selected });
    }
  }

  const baseSpellcastingAccess = baseSpellAccess({
    compiled,
    assembled: input.assembled,
    resolvedChoices: input.character.resolved_choices,
    tomeActionIds,
  });
  const spellGrants: SpellGrantAccess[] = [...baseSpellcastingAccess.grants];
  for (const { binding, selected } of deferredTomes) {
    if (binding.declaration.kind !== 'tome') continue;
    const bookObjectId = `${actorId}:book-of-shadows:${binding.effect.id}`;
    const result = conjurePactTome({
      sourceEntityId: binding.effect.id,
      ownerActorId: actorId,
      bookObjectId,
      rest: 'long',
      cantripActionIds: selected.cantrips.map((action) => action.id),
      ritualActionIds: selected.rituals.map((action) => action.id),
      options: [
        ...selected.cantrips.map((action) => ({ actionId: action.id, level: 0, ritual: false })),
        ...selected.rituals.map((action) => ({ actionId: action.id, level: 1, ritual: true })),
      ],
      alreadyPreparedActionIds: spellGrants.map((grant) => grant.actionId),
      slotResource: binding.declaration.slotResource,
    });
    pacts.tome = createPactTomeInvocationState({
      sourceEntityId: binding.effect.id,
      ownerActorId: actorId,
      tome: result.tome,
    });
    spellGrants.push(...result.grants);
    initialObjects.push(result.bookObject);
  }

  const contentFingerprint = fnv1a32(canonicalStringify({
    systemId: input.character.system_id,
    rulesetVersion: input.character.ruleset_version,
    actions: uniqueActions,
    pacts: bindings.map((binding) => ({
      sourceEntityIds: stableIds([
        binding.effect.id,
        binding.effect.card_number,
        binding.originId,
      ]),
      declaration: binding.declaration,
      choices: binding.tomeSelections ? {
        cantrips: [...binding.tomeSelections.cantrips].sort(),
        rituals: [...binding.tomeSelections.rituals].sort(),
      } : undefined,
      mechanics: binding.effect.mechanics,
    })).sort((left, right) => (
      left.declaration.capabilityId.localeCompare(right.declaration.capabilityId)
    )),
    cards: cards.map((card) => ({
      id: card.id,
      cardNumber: card.card_number,
      name: card.name,
      type: card.type,
      weaponType: card.weapon_type,
      damageType: card.damage_type,
      properties: card.properties,
      tags: card.tags,
      enchantBonus: card.enchant_bonus,
      attunement: card.attunement,
      requiresAttunement: card.requires_attunement,
      slot: card.slot,
      mechanics: card.mechanics,
      battleProfile: card.battle_profile,
    })),
    grantedEffects: input.grantedEffects,
    masteryEffects: input.masteryEffects,
    familiarCatalog: uniqueActions.some((action) => (
      primitiveType(action.mechanics) === 'find_familiar'
    )) ? {
      id: FAMILIAR_ACTOR_CATALOG.catalogId,
      contentHash: FAMILIAR_ACTOR_CATALOG.contentHash,
    } : undefined,
  }));
  const ruleset: RulesetReference = {
    systemId: 'dnd5e-2024',
    releaseId: `sheet:${input.character.ruleset_version || '2024'}:canonical-v1`,
    contentHash: `sheet:${input.character.system_id}:${input.character.ruleset_version}:${contentFingerprint}`,
    errataVersion: input.character.ruleset_version || '2024',
  };
  const actorCharacterContext: CharacterContext = {
    ...characterContext,
    knownCards: cards.map(cloneJson),
  };
  const actor: ActorState = {
    id: actorId,
    name: input.character.name,
    kind: 'playerCharacter',
    controllerId: `character-sheet:${actorId}`,
    ...(input.ac != null ? { ac: input.ac } : {}),
    capabilities: {
      actionIds: uniqueActions.map((action) => action.id).sort(),
      ...(Object.keys(featureSources).length ? { featureSources } : {}),
    },
    character: actorCharacterContext,
    runtime: cloneJson(runtime),
    ...(input.passives?.length ? { passives: cloneJson(input.passives) } : {}),
    ...(input.grantedEffects ? { grantedEffects: cloneJson(input.grantedEffects) } : {}),
    ...(input.masteryEffects ? { masteryEffects: cloneJson(input.masteryEffects) } : {}),
    ...(spellGrants.length ? {
      spellcastingAccess: {
        grants: spellGrants.sort((left, right) => left.grantId.localeCompare(right.grantId)),
        preparedSources: baseSpellcastingAccess.preparedSources,
      },
    } : {}),
    ...(Object.keys(pacts).length ? { warlockPacts: pacts } : {}),
  };
  const fresh = migrateWorldState(createWorld({
    id: `character-sheet:${actorId}:world`,
    ruleset,
    actors: [actor],
    objects: initialObjects,
  }));
  const persisted = readSheetCanonicalWorld(
    input.character.turn_state,
    actorId,
    ruleset.contentHash,
  );
  let world = fresh;
  if (persisted) {
    assertPersistedPactsMatch(persisted.actors[actorId].warlockPacts, actor.warlockPacts);
    const hydrated = cloneJson(persisted);
    hydrated.actors[actorId] = {
      ...hydrated.actors[actorId],
      name: actor.name,
      ac: actor.ac,
      capabilities: actor.capabilities,
      character: actor.character,
      runtime: actor.runtime,
      passives: actor.passives,
      grantedEffects: actor.grantedEffects,
      masteryEffects: actor.masteryEffects,
      // Grants depend on the live spellcasting ability and available resource
      // namespaces.  Persisted world actors retain lifecycle state (familiar,
      // blade bond, objects), but never retain an obsolete access projection.
      spellcastingAccess: actor.spellcastingAccess,
    };
    world = migrateWorldState(hydrated);
  }

  return {
    actorId,
    world,
    actions: uniqueActions,
    catalog,
    cards,
    resourceBindings,
    ...(deferredTomes[0] ? {
      pactTomeSelection: {
        sourceEntityId: deferredTomes[0].binding.effect.id,
        cantripActionIds: deferredTomes[0].selected.cantrips.map((action) => action.id).sort(),
        ritualActionIds: deferredTomes[0].selected.rituals.map((action) => action.id).sort(),
      },
    } : {}),
    actionFor: (sheetAction) => {
      const matches = compiled.filter(({ sheet }) => sheet === sheetAction || sheet.id === sheetAction.id);
      if (matches.length !== 1) {
        throw new SheetCanonicalWorldError(
          `Expected one canonical action for sheet action ${sheetAction.id}; got ${matches.length}`,
        );
      }
      return matches[0].action;
    },
  };
}
