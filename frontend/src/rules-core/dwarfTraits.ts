import { payloadsOf } from '../engine/mechanicsView';

type JsonRecord = Record<string, unknown>;

export const DWARF_SPECIES_CARD = 'RACE-0003' as const;
export const DWARVEN_RESILIENCE_CARD = 'RE-dwarf-2' as const;
export const DWARVEN_TOUGHNESS_CARD = 'RE-dwarf-3' as const;
export const STONECUNNING_CARD = 'RE-dwarf-4' as const;
const STONE_FORMS = ['natural', 'worked'] as const;
const STONE_CONTACTS = ['on_surface', 'touching_surface'] as const;

export type StoneForm = typeof STONE_FORMS[number];
export type SurfaceContact = typeof STONE_CONTACTS[number] | 'none';

/**
 * Explicit board/GM fact used until the map owns surface geometry. `other`
 * deliberately remains representable so the rules core can reject a factual
 * non-stone surface instead of treating an absent field as stone.
 */
export interface StoneworkContactFacts {
  material: 'stone' | 'other';
  stoneForm?: StoneForm;
  contact: SurfaceContact;
}

function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

/** Converts declared fixed durations to six-second combat rounds, fail-closed. */
export function fixedDurationRounds(value: unknown): number | null {
  const duration = record(value);
  if (!duration || !Number.isFinite(duration.amount) || Number(duration.amount) <= 0) return null;
  const amount = Number(duration.amount);
  if (duration.type === 'rounds') {
    return Number.isInteger(amount) ? amount : null;
  }
  if (duration.type === 'minutes') {
    const rounds = amount * 10;
    return Number.isInteger(rounds) ? rounds : null;
  }
  if (duration.type === 'hours') {
    const rounds = amount * 600;
    return Number.isInteger(rounds) ? rounds : null;
  }
  return null;
}

/**
 * Returns a user-facing reason when explicit facts do not satisfy the PHB
 * Stonecunning contact requirement. Natural and worked stone are both legal.
 */
export function stoneworkContactIssue(value: unknown): string | null {
  const facts = record(value);
  if (!facts) return 'Stonecunning requires explicit stone-surface contact facts';
  if (facts.material !== 'stone') return 'Stonecunning requires a stone surface';
  if (!STONE_FORMS.includes(facts.stoneForm as StoneForm)) {
    return 'Stonecunning stone must be natural or worked';
  }
  if (!STONE_CONTACTS.includes(
    facts.contact as Exclude<SurfaceContact, 'none'>,
  )) {
    return 'Stonecunning requires standing on or touching the stone surface';
  }
  return null;
}

export interface EffectiveSenseSource {
  kind: 'build' | 'runtime';
  sourceEntityIds: string[];
  runtimeEffectId?: string;
  roundsLeft?: number;
}

export interface EffectiveSense {
  sense: string;
  range: number;
  sources: EffectiveSenseSource[];
}

export interface SenseRuntimeState {
  activeEffects: readonly {
    id: string;
    mechanics: unknown;
    roundsLeft?: number;
  }[];
}

function stableEntityIds(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((id): id is string => typeof id === 'string' && id.length > 0))].sort()
    : [];
}

/**
 * Shared projection for sheets and tests: active grant_sense effects augment
 * build-time senses without mutating the canonical character build.
 */
export function effectiveSenses(input: {
  build: readonly { sense: string; range: number; sourceEntityIds?: readonly string[] }[];
  runtime: SenseRuntimeState;
}): EffectiveSense[] {
  const bySense = new Map<string, EffectiveSense>();
  const add = (sense: string, range: number, source: EffectiveSenseSource): void => {
    if (!sense || !Number.isFinite(range) || range <= 0) return;
    const current = bySense.get(sense);
    if (current) {
      current.range = Math.max(current.range, range);
      current.sources.push(source);
    } else {
      bySense.set(sense, { sense, range, sources: [source] });
    }
  };

  for (const sense of input.build) {
    add(sense.sense, sense.range, {
      kind: 'build',
      sourceEntityIds: stableEntityIds(sense.sourceEntityIds),
    });
  }
  for (const effect of input.runtime.activeEffects) {
    if (effect.roundsLeft != null && effect.roundsLeft <= 0) continue;
    const mechanics = record(effect.mechanics);
    if (!mechanics) continue;
    for (const payload of payloadsOf(mechanics).filter((candidate) => candidate.kind === 'grant_sense')) {
      add(String(payload.sense ?? ''), Number(payload.range), {
        kind: 'runtime',
        sourceEntityIds: stableEntityIds(payload.sourceEntityIds),
        runtimeEffectId: effect.id,
        ...(effect.roundsLeft != null ? { roundsLeft: effect.roundsLeft } : {}),
      });
    }
  }
  return [...bySense.values()].sort((left, right) => left.sense.localeCompare(right.sense));
}

/** Permanent build ownership wins; otherwise expose the longest runtime expiry for UI. */
export function effectiveSenseRoundsLeft(sense: EffectiveSense): number | null {
  if (sense.sources.some((source) => source.kind === 'build')) return null;
  const durations = sense.sources.flatMap((source) => (
    source.kind === 'runtime'
      && Number.isInteger(source.roundsLeft)
      && source.roundsLeft! > 0
      ? [source.roundsLeft!]
      : []
  ));
  return durations.length ? Math.max(...durations) : null;
}

/**
 * Generic checkpoint validation for every runtime `grant_sense` payload.
 * Identity, range, duration, and scope stay in the copied declaration; this
 * validator deliberately never recognizes a named rule from payload shape.
 */
export function runtimeSenseEffectIssue(value: unknown, ownerActorId: string): string | null {
  const effect = record(value);
  const mechanics = record(effect?.mechanics);
  const sense = mechanics
    ? payloadsOf(mechanics).find((payload) => payload.kind === 'grant_sense')
    : undefined;
  if (!mechanics || !sense) return null;
  if (typeof effect?.id !== 'string' || !effect.id.trim()
    || typeof effect.name !== 'string' || !effect.name.trim()
    || typeof effect.source !== 'string' || !effect.source.trim()) {
    return 'Runtime sense effect requires stable effect and source labels';
  }
  if (effect.ownerId !== ownerActorId
    || typeof effect.sourceId !== 'string'
    || !effect.sourceId.trim()) {
    return 'Runtime sense effect must retain its owner and source actor provenance';
  }
  if (typeof sense.sense !== 'string' || !sense.sense.trim()
    || !Number.isFinite(sense.range) || Number(sense.range) <= 0) {
    return 'Runtime sense declaration requires a non-empty sense and positive finite range';
  }
  if (mechanics.senseScope !== undefined) {
    const scope = record(mechanics.senseScope);
    if (!scope || typeof scope.kind !== 'string' || !scope.kind.trim()) {
      return 'Runtime sense scope must retain a generic non-empty kind';
    }
  }
  if (mechanics.duration !== undefined) {
    const declaredRounds = fixedDurationRounds(mechanics.duration);
    if (declaredRounds === null
      || !Number.isInteger(effect.roundsLeft)
      || Number(effect.roundsLeft) < 1
      || Number(effect.roundsLeft) > declaredRounds) {
      return 'Runtime sense remaining duration must not exceed its declared fixed duration';
    }
  } else if (effect.roundsLeft !== undefined) {
    return 'Runtime sense without a fixed duration cannot retain a rounds counter';
  }
  const rawSourceEntityIds = mechanics.sourceEntityIds;
  const sourceEntityIds = stableEntityIds(rawSourceEntityIds);
  if (!Array.isArray(rawSourceEntityIds)
    || sourceEntityIds.length === 0
    || rawSourceEntityIds.some((id) => (
      typeof id !== 'string' || id.trim() !== id || id.length === 0
    ))
    || sourceEntityIds.length !== rawSourceEntityIds.length) {
    return 'Runtime sense effect must retain non-empty, unique sourceEntityIds';
  }
  return null;
}
