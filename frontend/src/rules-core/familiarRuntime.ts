import type {
  Ability,
  ActorState,
  RuleActionDefinition,
  WorldState,
} from './domain';
import {
  FAMILIAR_ACTOR_CATALOG,
  canonicalFamiliarCatalogJson,
  getFamiliarActorTemplate,
  materializeFamiliarActor,
  type FamiliarActionDefinition,
} from './familiarActorCatalog';
import {
  familiarStateIssue,
  setFamiliarInitiative,
  type FamiliarState,
} from './findFamiliar';

export const FIND_FAMILIAR_PRIMITIVE = 'find_familiar' as const;
export const FIND_FAMILIAR_MATERIAL_RESOURCE = 'material_incense_gp' as const;
export const FIND_FAMILIAR_FORM_CHOICE = 'find_familiar_form' as const;
export const FIND_FAMILIAR_SPIRIT_CHOICE = 'find_familiar_spirit' as const;
export const FIND_FAMILIAR_CAST_PATH_CHOICE = 'find_familiar_cast_path' as const;

export interface FindFamiliarMaterialCostDeclaration {
  resource: string;
  amount: number;
  binding: { kind: 'currency'; currency: 'gold' | 'silver' | 'copper' };
  recharge: 'never';
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/**
 * Resolve the material price from mechanics only. The primitive names the
 * resource once, while amount, persistence binding, and recharge policy live
 * exclusively on the matching activation.cost entry.
 */
export function findFamiliarMaterialCost(
  action: Pick<RuleActionDefinition, 'mechanics'>,
): FindFamiliarMaterialCostDeclaration | null {
  const primitive = record(action.mechanics.primitive);
  if (primitive?.type !== FIND_FAMILIAR_PRIMITIVE
    || typeof primitive.materialCostResource !== 'string'
    || !primitive.materialCostResource.trim()) return null;
  const activation = record(action.mechanics.activation);
  if (!Array.isArray(activation?.cost)) return null;
  const matching = activation.cost.filter((entry) => (
    record(entry)?.resource === primitive.materialCostResource
  ));
  if (matching.length !== 1) return null;
  const cost = record(matching[0])!;
  const binding = record(cost.binding);
  if (!Number.isInteger(cost.amount) || Number(cost.amount) <= 0
    || cost.recharge !== 'never'
    || binding?.kind !== 'currency'
    || !['gold', 'silver', 'copper'].includes(String(binding.currency ?? ''))) return null;
  return {
    resource: primitive.materialCostResource,
    amount: Number(cost.amount),
    binding: {
      kind: 'currency',
      currency: binding.currency as 'gold' | 'silver' | 'copper',
    },
    recharge: 'never',
  };
}

function same(left: unknown, right: unknown): boolean {
  return canonicalFamiliarCatalogJson(left) === canonicalFamiliarCatalogJson(right);
}

export function familiarActorsOwnedBy(
  world: Pick<WorldState, 'actors'>,
  ownerActorId: string,
): ActorState[] {
  return Object.values(world.actors)
    .filter((actor) => actor.familiarState?.ownerActorId === ownerActorId)
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function requireOwnedFamiliar(
  world: Pick<WorldState, 'actors'>,
  ownerActorId: string,
  familiarActorId: string,
): ActorState | null {
  const actor = world.actors[familiarActorId];
  return actor?.familiarState?.ownerActorId === ownerActorId ? actor : null;
}

export function rollFamiliarInitiative(input: {
  familiar: FamiliarState;
  modifier: number;
  rng: () => number;
}): FamiliarState {
  const dieAware = input.rng as (() => number) & { rollDie?: (sides: number) => number };
  const d20Roll = typeof dieAware.rollDie === 'function'
    ? dieAware.rollDie(20)
    : (() => {
      const random = input.rng();
      if (!Number.isFinite(random) || random < 0 || random >= 1) {
        throw new Error('Familiar Initiative RNG must return a value in [0, 1)');
      }
      return Math.floor(random * 20) + 1;
    })();
  return setFamiliarInitiative({
    familiar: input.familiar,
    familiarActorId: input.familiar.actorId,
    d20Roll,
    modifier: input.modifier,
  });
}

/** Materialize only through the pinned catalog; no runtime command can supply stats. */
export function materializeCanonicalFamiliarActor(input: {
  familiar: FamiliarState;
  owner: ActorState;
  summoningActionId: string;
}): ActorState {
  const template = getFamiliarActorTemplate(input.familiar.form.id);
  const draft = materializeFamiliarActor({
    familiar: input.familiar,
    template,
    ownerControllerId: input.owner.controllerId,
  });
  return {
    ...clone(draft),
    familiarState: clone(input.familiar),
    familiarMetadata: {
      ...clone(draft.familiarMetadata),
      summoningActionId: input.summoningActionId,
      catalogId: FAMILIAR_ACTOR_CATALOG.catalogId,
      catalogContentHash: FAMILIAR_ACTOR_CATALOG.contentHash,
    },
  };
}

/**
 * Validate the complete persisted projection against the pure familiar state
 * and the pinned catalog. Runtime counters may change, but identity/stats and
 * the reaction mirror are exact.
 */
export function familiarActorStateIssue(input: {
  actor: ActorState;
  owner: ActorState | undefined;
}): string | null {
  const { actor, owner } = input;
  if (!actor.familiarState && !actor.familiarMetadata) return null;
  if (!actor.familiarState || !actor.familiarMetadata) {
    return 'Familiar actor requires both canonical state and pinned metadata';
  }
  if (actor.kind !== 'summonedActor') return 'Familiar state requires a summonedActor';
  const stateIssue = familiarStateIssue(actor.familiarState);
  if (stateIssue) return stateIssue;
  if (actor.familiarState.actorId !== actor.id) return 'Familiar state actorId must match its actor';
  if (!owner || owner.id !== actor.familiarState.ownerActorId || owner.id === actor.id) {
    return 'Familiar owner must reference another actor in the same world';
  }
  const metadata = actor.familiarMetadata;
  if (!metadata.summoningActionId
    || metadata.summoningActionId !== metadata.summoningActionId.trim()
    || !owner.capabilities.actionIds.includes(metadata.summoningActionId)) {
    return 'Familiar summoning action must remain actor-owned by its owner';
  }
  if (metadata.catalogId !== FAMILIAR_ACTOR_CATALOG.catalogId
    || metadata.catalogContentHash !== FAMILIAR_ACTOR_CATALOG.contentHash) {
    return 'Familiar metadata does not match the pinned catalog';
  }

  const materializableState = actor.familiarState.presence === 'present'
    ? actor.familiarState
    : { ...actor.familiarState, presence: 'present' as const };
  // familiarStateIssue has already proved that this is a canonical form. A
  // catalog failure here is an internal release-integrity fault, not malformed
  // user state, and must fail the load rather than be softened into a warning.
  const expected = materializeCanonicalFamiliarActor({
    familiar: materializableState,
    owner,
    summoningActionId: metadata.summoningActionId,
  });
  for (const key of [
    'name', 'kind', 'controllerId', 'ac', 'capabilities', 'character',
    'passives', 'attackProfile', 'familiarMetadata',
  ] as const) {
    if (!same(actor[key], expected[key])) return `Familiar actor has forged ${key}`;
  }
  if (!same(actor.runtime.maxResources, expected.runtime.maxResources)) {
    return 'Familiar actor has forged maximum resources';
  }
  if (actor.runtime.hp.max !== expected.runtime.hp.max
    || !Number.isInteger(actor.runtime.hp.current)
    || actor.runtime.hp.current < 0
    || actor.runtime.hp.current > actor.runtime.hp.max) {
    return 'Familiar actor has invalid hit points for its pinned form';
  }
  const reaction = actor.runtime.resources.reaction ?? 0;
  if (reaction !== (actor.familiarState.reactionAvailable ? 1 : 0)) {
    return 'Familiar Reaction resource must mirror canonical familiar state';
  }
  if (actor.familiarState.presence === 'present' && actor.runtime.hp.current < 1) {
    return 'A zero-HP familiar cannot remain present';
  }
  if (actor.familiarState.presence === 'disappeared_zero_hp' && actor.runtime.hp.current !== 0) {
    return 'A familiar disappeared at zero HP must retain zero current HP';
  }

  const chain = owner.warlockPacts?.chain;
  if (actor.familiarState.extension === 'pact_chain') {
    if (!chain
      || chain.ownerActorId !== owner.id
      || chain.sourceEntityId !== actor.familiarState.sourceEntityId
      || chain.template.findFamiliarActionId !== metadata.summoningActionId
      || !chain.activeFamiliar
      || chain.activeFamiliar.actorId !== actor.id
      || chain.activeFamiliar.ownerActorId !== owner.id
      || chain.activeFamiliar.formId !== actor.familiarState.form.id
      || chain.activeFamiliar.sourceEntityId !== actor.familiarState.sourceEntityId
      || chain.activeFamiliar.reactionAvailable !== actor.familiarState.reactionAvailable) {
      return 'Pact Chain familiar projection must exactly mirror canonical familiar state';
    }
  } else if (chain?.activeFamiliar?.actorId === actor.id) {
    return 'A base familiar cannot occupy the Pact Chain projection';
  }
  return null;
}

export function pactChainProjection(familiar: FamiliarState) {
  return {
    actorId: familiar.actorId,
    ownerActorId: familiar.ownerActorId,
    formId: familiar.form.id,
    sourceEntityId: familiar.sourceEntityId,
    reactionAvailable: familiar.reactionAvailable,
  };
}

function familiarAttackAbility(
  actor: ActorState,
  action: FamiliarActionDefinition,
): Ability {
  const preferred: Ability[] = action.attack?.mode === 'ranged'
    ? ['dex', 'str', 'cha', 'wis', 'int', 'con']
    : ['str', 'dex', 'cha', 'wis', 'int', 'con'];
  const requiredModifier = action.attack!.bonus - actor.character.profBonus;
  return preferred.find((ability) => actor.character.abilityMods[ability] === requiredModifier)
    ?? preferred[0];
}

/** Convert one pinned stat-block Attack into the existing deterministic executor format. */
export function familiarAttackRuleAction(
  actor: ActorState,
  familiarActionId: string,
): RuleActionDefinition | null {
  const metadata = actor.familiarMetadata;
  if (!actor.familiarState || !metadata) return null;
  const definition = metadata.actions.find((entry) => entry.id === familiarActionId);
  if (!definition || definition.kind !== 'attack' || !definition.attack) return null;
  const attack = definition.attack;
  const rangeFt = attack.mode === 'melee'
    ? attack.reachFt ?? 5
    : attack.longRangeFt ?? attack.normalRangeFt ?? 0;
  const sourceEntityIds = actor.capabilities.featureSources?.[definition.id];
  if (!sourceEntityIds?.length) return null;
  return {
    id: definition.id,
    name: definition.name,
    kind: 'nonSpell',
    sourceEntityIds: [...sourceEntityIds] as [string, ...string[]],
    targeting: {
      minTargets: 1,
      maxTargets: 1,
      rangeFt,
      requiresLineOfSight: true,
      allowedRelations: ['ally', 'enemy', 'neutral'],
    },
    mechanics: {
      activation: { mode: 'reaction', cost: [] },
      effects: [{
        resolution: 'attack_roll',
        ability: familiarAttackAbility(actor, definition),
        attack_kind: attack.mode === 'melee' ? 'melee' : 'ranged',
        on_hit: attack.damage.map((part) => ({
          kind: 'damage',
          dice: part.formula ?? String(part.average),
          type: part.type,
          ability: 'none',
        })),
      }],
    },
  };
}

export function canonicalTouchSpell(action: RuleActionDefinition): boolean {
  return action.kind === 'spell'
    && action.targeting?.requiresTouch === true
    && action.targeting.rangeFt === 5;
}
