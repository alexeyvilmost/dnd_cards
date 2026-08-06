import { useEffect } from 'react';
import {
  CHARACTER_V3_ACCESS_ERROR_EVENT,
  type CharacterV3AccessErrorDetail,
} from '../character/api';
import { useToast } from '../contexts/ToastContext';

/**
 * Character writes happen from several independent sheet panels.  A central
 * notice keeps 401/403 visible even when a panel treats journal/runtime sync as
 * best-effort and catches the rejected request locally.
 */
export default function CharacterV3AccessNotice() {
  const { showToast } = useToast();

  useEffect(() => {
    const onAccessError = (event: Event) => {
      const detail = (event as CustomEvent<CharacterV3AccessErrorDetail>).detail;
      if (!detail || (detail.status !== 401 && detail.status !== 403)) return;
      showToast({
        type: 'error',
        title: detail.status === 401 ? 'Сессия завершена' : 'Доступ запрещён',
        message: detail.message,
      });
    };

    window.addEventListener(CHARACTER_V3_ACCESS_ERROR_EVENT, onAccessError);
    return () => window.removeEventListener(CHARACTER_V3_ACCESS_ERROR_EVENT, onAccessError);
  }, [showToast]);

  return null;
}
