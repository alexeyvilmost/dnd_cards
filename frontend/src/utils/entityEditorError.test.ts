import { describe, expect, it } from 'vitest';
import { ApiRequestError } from '../api/client';
import { formatEntityEditorError } from './entityEditorError';

describe('formatEntityEditorError', () => {
  it('shows the server explanation with safe diagnostics', () => {
    const error = new ApiRequestError('Поле не заполнено', 422, 'required_field', 'description', 'trace-123');
    expect(formatEntityEditorError(error, 'Ошибка')).toBe(
      'Поле не заполнено (Поле: description; Код: required_field; Запрос: trace-123)',
    );
  });

  it('retains a local validation error and has a fallback', () => {
    expect(formatEntityEditorError(new Error('Исправьте механику'), 'Ошибка')).toBe('Исправьте механику');
    expect(formatEntityEditorError(null, 'Ошибка')).toBe('Ошибка');
  });
});
