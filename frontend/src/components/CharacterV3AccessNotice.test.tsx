// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CHARACTER_V3_ACCESS_ERROR_EVENT,
  type CharacterV3AccessErrorDetail,
} from '../character/api';
import CharacterV3AccessNotice from './CharacterV3AccessNotice';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { showToastMock } = vi.hoisted(() => ({ showToastMock: vi.fn() }));

vi.mock('../contexts/ToastContext', () => ({
  useToast: () => ({ showToast: showToastMock }),
}));

describe('CharacterV3AccessNotice', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    showToastMock.mockReset();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(<CharacterV3AccessNotice />));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
  });

  it.each([
    [401, 'Сессия завершена'],
    [403, 'Доступ запрещён'],
  ] as const)('shows a clear %s access error from any CharacterV3 caller', async (status, title) => {
    const detail: CharacterV3AccessErrorDetail = {
      status,
      operation: 'runtime',
      message: status === 401 ? 'Сессия истекла.' : 'Нет прав на изменение.',
    };

    await act(async () => {
      window.dispatchEvent(new CustomEvent(CHARACTER_V3_ACCESS_ERROR_EVENT, { detail }));
    });

    expect(showToastMock).toHaveBeenCalledWith({
      type: 'error',
      title,
      message: detail.message,
    });
  });
});
