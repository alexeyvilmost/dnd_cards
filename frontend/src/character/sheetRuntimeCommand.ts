import type {
  CharacterRuntimeCommandRequest,
  CharacterRuntimeCommandResponse,
} from './api';
import type { ForgeCharacter } from './types';

export class SheetRuntimeCommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SheetRuntimeCommandError';
  }
}

function expectedCommittedRevisions(
  request: CharacterRuntimeCommandRequest,
): Map<string, number> {
  const expected = new Map<string, number>();
  for (const participant of request.participants) {
    if (expected.has(participant.character_id)) {
      throw new SheetRuntimeCommandError('Runtime command contains a duplicate participant');
    }
    if (!Number.isSafeInteger(participant.expected_runtime_revision)
      || participant.expected_runtime_revision < 0
      || !Number.isSafeInteger(participant.expected_runtime_revision + 1)) {
      throw new SheetRuntimeCommandError(
        'Runtime command contains an invalid expected participant revision',
      );
    }
    expected.set(
      participant.character_id,
      participant.expected_runtime_revision + 1,
    );
  }
  return expected;
}

/**
 * Validate the immutable idempotency receipt.  A replay receipt intentionally
 * contains the postimage of the original commit, so this function proves that
 * commit at expected_runtime_revision + 1 and does not claim the postimage is
 * still the participant's latest state.
 */
export function acceptedRuntimeCommandReceipt(
  request: CharacterRuntimeCommandRequest,
  response: CharacterRuntimeCommandResponse,
): Record<string, ForgeCharacter> {
  if (typeof response.replayed !== 'boolean') {
    throw new SheetRuntimeCommandError(
      'Runtime-command response has an invalid replay marker',
    );
  }
  if (response.command_id !== request.command_id) {
    throw new SheetRuntimeCommandError('Runtime-command response has a different command id');
  }
  const expected = expectedCommittedRevisions(request);
  if (response.participants.length !== expected.size) {
    throw new SheetRuntimeCommandError('Runtime-command response has an incomplete participant set');
  }
  const characters: Record<string, ForgeCharacter> = {};
  for (const participant of response.participants) {
    const revision = expected.get(participant.character_id);
    if (revision === undefined
      || participant.runtime_revision !== revision
      || participant.character.id !== participant.character_id
      || participant.character.runtime_revision !== revision
      || characters[participant.character_id]) {
      throw new SheetRuntimeCommandError(
        'Runtime-command response failed participant CAS validation',
      );
    }
    characters[participant.character_id] = participant.character;
  }
  return characters;
}

/**
 * Return characters safe for a UI update.  A non-replayed response is the
 * transaction's fresh postimage.  A replay first proves the original receipt,
 * then refetches every current participant so a later commit can never be
 * rolled back in the browser by the older receipt snapshot.
 */
export async function currentRuntimeCommandCharacters(input: {
  request: CharacterRuntimeCommandRequest;
  response: CharacterRuntimeCommandResponse;
  loadCurrent: (characterId: string) => Promise<ForgeCharacter>;
}): Promise<Record<string, ForgeCharacter>> {
  const receipt = acceptedRuntimeCommandReceipt(input.request, input.response);
  if (!input.response.replayed) return receipt;

  const expected = expectedCommittedRevisions(input.request);
  const loaded = await Promise.all(
    [...expected.keys()].sort().map((characterId) => input.loadCurrent(characterId)),
  );
  const current: Record<string, ForgeCharacter> = {};
  for (const character of loaded) {
    const committedRevision = expected.get(character.id);
    if (committedRevision === undefined
      || !Number.isSafeInteger(character.runtime_revision)
      || Number(character.runtime_revision) < committedRevision
      || current[character.id]) {
      throw new SheetRuntimeCommandError(
        'Refetched runtime-command participant is older than its committed receipt',
      );
    }
    current[character.id] = character;
  }
  if (Object.keys(current).length !== expected.size) {
    throw new SheetRuntimeCommandError(
      'Refetched runtime-command participants are incomplete',
    );
  }
  return current;
}
