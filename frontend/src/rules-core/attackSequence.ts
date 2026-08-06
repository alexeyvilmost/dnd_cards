export interface AttackSequenceState {
  id: string;
  actorId: string;
  totalAttacks: number;
  attacksRemaining: number;
  entries: AttackSequenceEntry[];
  usedReplacementKeys: string[];
}

interface AttackSequenceEntryBase {
  ordinal: number;
  actionId: string;
  sourceEntityIds: [string, ...string[]];
}

export interface WeaponAttackSequenceEntry extends AttackSequenceEntryBase {
  kind: 'weapon_attack';
  /** Present on the canonical system-action path; absent on legacy callers. */
  weaponCardId?: string;
}

export type UnarmedStrikeOption = 'damage' | 'grapple' | 'shove';

export interface UnarmedStrikeSequenceEntry extends AttackSequenceEntryBase {
  kind: 'unarmed_strike';
  option: UnarmedStrikeOption;
}

export interface AttackReplacementSequenceEntry extends AttackSequenceEntryBase {
  kind: 'replacement';
  replacementKey: string;
}

export type AttackSequenceEntry =
  | WeaponAttackSequenceEntry
  | UnarmedStrikeSequenceEntry
  | AttackReplacementSequenceEntry;

type AttackSequenceEntryInput =
  | Omit<WeaponAttackSequenceEntry, 'ordinal'>
  | Omit<UnarmedStrikeSequenceEntry, 'ordinal'>
  | Omit<AttackReplacementSequenceEntry, 'ordinal'>;

const UNARMED_STRIKE_OPTIONS = new Set<UnarmedStrikeOption>(['damage', 'grapple', 'shove']);
const ATTACK_ENTRY_KINDS = new Set<AttackSequenceEntry['kind']>([
  'weapon_attack', 'unarmed_strike', 'replacement',
]);

function nonBlank(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** Runtime integrity guard for JSON-restored and otherwise untrusted sequence snapshots. */
export function attackSequenceInvariantHolds(state: AttackSequenceState): boolean {
  if (!nonBlank(state.id) || !nonBlank(state.actorId)) return false;
  if (!Number.isInteger(state.totalAttacks) || state.totalAttacks < 1) return false;
  if (!Number.isInteger(state.attacksRemaining)
    || state.attacksRemaining < 0
    || state.attacksRemaining > state.totalAttacks) return false;
  if (!Array.isArray(state.entries) || !Array.isArray(state.usedReplacementKeys)) return false;
  if (state.entries.length !== state.totalAttacks - state.attacksRemaining) return false;
  if (state.entries.some((entry, index) => (
    entry.ordinal !== index + 1
    || !ATTACK_ENTRY_KINDS.has(entry.kind)
    || !nonBlank(entry.actionId)
    || !Array.isArray(entry.sourceEntityIds)
    || !entry.sourceEntityIds.length
    || entry.sourceEntityIds.some((sourceId) => !nonBlank(sourceId))
    || new Set(entry.sourceEntityIds).size !== entry.sourceEntityIds.length
    || (entry.kind === 'weapon_attack'
      && entry.weaponCardId !== undefined
      && !nonBlank(entry.weaponCardId))
    || (entry.kind === 'replacement' && !nonBlank(entry.replacementKey))
    || (entry.kind === 'unarmed_strike' && !UNARMED_STRIKE_OPTIONS.has(entry.option))
  ))) return false;
  if (state.usedReplacementKeys.some((key) => !nonBlank(key))) return false;
  const replacementKeys = [...new Set(state.entries.flatMap((entry) => (
    entry.kind === 'replacement' ? [entry.replacementKey] : []
  )))].sort();
  return JSON.stringify(replacementKeys) === JSON.stringify(state.usedReplacementKeys);
}

export function beginAttackSequence(input: {
  id: string;
  actorId: string;
  totalAttacks: number;
}): AttackSequenceState {
  if (!nonBlank(input.id) || !nonBlank(input.actorId)) {
    throw new Error('Attack action requires stable sequence and actor IDs');
  }
  if (!Number.isInteger(input.totalAttacks) || input.totalAttacks < 1) {
    throw new Error('Attack action requires a positive integer attack count');
  }
  return {
    id: input.id,
    actorId: input.actorId,
    totalAttacks: input.totalAttacks,
    attacksRemaining: input.totalAttacks,
    entries: [],
    usedReplacementKeys: [],
  };
}

function appendEntry(
  state: AttackSequenceState,
  entry: AttackSequenceEntryInput,
): AttackSequenceState {
  if (!attackSequenceInvariantHolds(state)) throw new Error('Invalid attack sequence state');
  if (state.attacksRemaining < 1) throw new Error('Attack sequence has no remaining attacks');
  if (!nonBlank(entry.actionId)
    || !entry.sourceEntityIds.length
    || entry.sourceEntityIds.some((sourceId) => !nonBlank(sourceId))
    || new Set(entry.sourceEntityIds).size !== entry.sourceEntityIds.length) {
    throw new Error('Attack sequence entry requires stable action and source IDs');
  }
  return {
    ...state,
    attacksRemaining: state.attacksRemaining - 1,
    entries: [...state.entries, {
      ...entry,
      ordinal: state.entries.length + 1,
      sourceEntityIds: [...entry.sourceEntityIds],
    } as AttackSequenceEntry],
    usedReplacementKeys: [...state.usedReplacementKeys],
  };
}

export function performSequenceAttack(input: {
  sequence: AttackSequenceState;
  actionId: string;
  sourceEntityIds: [string, ...string[]];
  /** Optional for backwards compatibility; canonical system entries always set it. */
  weaponCardId?: string;
}): AttackSequenceState {
  if (input.weaponCardId !== undefined && !nonBlank(input.weaponCardId)) {
    throw new Error('Weapon attack requires a stable weapon Card ID');
  }
  return appendEntry(input.sequence, {
    kind: 'weapon_attack',
    actionId: input.actionId,
    sourceEntityIds: [...input.sourceEntityIds],
    ...(input.weaponCardId === undefined ? {} : { weaponCardId: input.weaponCardId }),
  });
}

/** Strongly typed canonical system-action entry; legacy performSequenceAttack stays valid. */
export function performWeaponSequenceAttack(input: {
  sequence: AttackSequenceState;
  actionId: string;
  weaponCardId: string;
  sourceEntityIds: [string, ...string[]];
}): AttackSequenceState {
  return performSequenceAttack(input);
}

export function performUnarmedStrike(input: {
  sequence: AttackSequenceState;
  actionId: string;
  option: UnarmedStrikeOption;
  sourceEntityIds: [string, ...string[]];
}): AttackSequenceState {
  if (!UNARMED_STRIKE_OPTIONS.has(input.option)) {
    throw new Error(`Unsupported Unarmed Strike option ${String(input.option)}`);
  }
  return appendEntry(input.sequence, {
    kind: 'unarmed_strike',
    actionId: input.actionId,
    option: input.option,
    sourceEntityIds: [...input.sourceEntityIds],
  });
}

/**
 * Replace exactly one attack, while leaving the Attack action and its remaining
 * attacks intact. `oncePerSequence` models singular rules such as Breath
 * Weapon and Pact of the Chain without hard-coding either feature here.
 */
export function replaceSequenceAttack(input: {
  sequence: AttackSequenceState;
  actionId: string;
  replacementKey: string;
  sourceEntityIds: [string, ...string[]];
  oncePerSequence?: boolean;
}): AttackSequenceState {
  if (!attackSequenceInvariantHolds(input.sequence)) throw new Error('Invalid attack sequence state');
  if (!nonBlank(input.replacementKey)) throw new Error('Attack replacement requires a stable key');
  if (input.oncePerSequence !== false
    && input.sequence.usedReplacementKeys.includes(input.replacementKey)) {
    throw new Error(`Attack replacement ${input.replacementKey} was already used in this Attack action`);
  }
  const next = appendEntry(input.sequence, {
    kind: 'replacement',
    actionId: input.actionId,
    replacementKey: input.replacementKey,
    sourceEntityIds: [...input.sourceEntityIds],
  });
  return {
    ...next,
    usedReplacementKeys: [...new Set([
      ...next.usedReplacementKeys,
      input.replacementKey,
    ])].sort(),
  };
}

export function attackSequenceComplete(state: AttackSequenceState): boolean {
  return attackSequenceInvariantHolds(state) && state.attacksRemaining === 0;
}
