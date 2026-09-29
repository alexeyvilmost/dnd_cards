import { ApiRequestError } from '../api/client';
import { CharacterV3AccessError } from './api';
import { commitSheetRuntimeCommand } from './sheetRuntimeCommand';

/** Only a response to the POST itself can prove that its command was rejected. */
function definitiveCommandRejection(error: unknown): boolean {
  const status = error instanceof ApiRequestError || error instanceof CharacterV3AccessError
    ? error.status
    : undefined;
  return status !== undefined && status >= 400 && status < 500
    && status !== 408 && status !== 425 && status !== 429;
}

export async function commitSheetEquipmentRequest(
  input: Parameters<typeof commitSheetRuntimeCommand>[0] & {
    onDefinitiveRejection: () => void;
  },
): ReturnType<typeof commitSheetRuntimeCommand> {
  let rejected = false;
  try {
    return await commitSheetRuntimeCommand({
      ...input,
      commit: async () => {
        try {
          return await input.commit();
        } catch (error) {
          rejected = definitiveCommandRejection(error);
          throw error;
        }
      },
    });
  } catch (error) {
    // Receipt validation and a replay's current-state fetch happen *after* an
    // accepted POST. Their errors cannot prove that it is safe to discard the
    // idempotency key.
    if (rejected) input.onDefinitiveRejection();
    throw error;
  }
}
