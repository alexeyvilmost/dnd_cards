import { ApiRequestError } from '../api/client';

// Constructor errors keep the server's human explanation and give support a
// stable code/request ID without exposing raw SQL diagnostics to players.
export function formatEntityEditorError(error: unknown, fallback: string): string {
  if (error instanceof ApiRequestError) {
    const context = [
      error.field ? `Поле: ${error.field}` : null,
      error.code ? `Код: ${error.code}` : null,
      error.requestId ? `Запрос: ${error.requestId}` : null,
    ].filter(Boolean);
    return context.length ? `${error.message} (${context.join('; ')})` : error.message;
  }
  return error instanceof Error && error.message ? error.message : fallback;
}
