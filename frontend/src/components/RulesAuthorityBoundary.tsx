import { useEffect, useRef, useState, type ReactNode } from 'react';
import { loadConditions, MICRO_MVP_CONDITION_CERTIFICATION_VERSION, type ConditionLoadResult } from '../api/conditionsApi';
import { PINNED_MICRO_MVP_CONDITION_RELEASE_CONTENT_HASH, PINNED_MICRO_MVP_CONDITION_RELEASE_HASH,
  PINNED_MICRO_MVP_CONDITION_RULES_HASH } from '../canon/microMvpL1ReleaseIdentity';

const CONDITION_RELEASE_BINDING = Object.freeze({
  certificationVersion: MICRO_MVP_CONDITION_CERTIFICATION_VERSION,
  rulesHash: PINNED_MICRO_MVP_CONDITION_RULES_HASH,
  releaseContentHash: PINNED_MICRO_MVP_CONDITION_RELEASE_CONTENT_HASH,
  releaseHash: PINNED_MICRO_MVP_CONDITION_RELEASE_HASH,
});

/** Only gameplay routes mount this boundary. Catalog, login and settings do
 * not fetch rules. A fallback fixture can explain a failure, never authorize
 * mounting a screen that can issue game commands. */
export default function RulesAuthorityBoundary({ children }: { children: ReactNode }) {
  const [authority, setAuthority] = useState<ConditionLoadResult | null>(null);
  const pending = useRef<ReturnType<typeof loadConditions> | null>(null);
  useEffect(() => {
    let active = true;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const bootstrap = () => {
      pending.current ??= loadConditions({ timeoutMs: 15_000, expectedRelease: CONDITION_RELEASE_BINDING });
      void pending.current.catch((): ConditionLoadResult => ({ mode: 'offline_fixture', reason: 'Не удалось проверить правила сервера' }))
        .then(result => {
          if (!active) return;
          setAuthority(result);
          if (result.mode !== 'database_release') {
            pending.current = null;
            retry = setTimeout(bootstrap, 5_000);
          }
        });
    };
    bootstrap();
    return () => { active = false; if (retry !== undefined) clearTimeout(retry); };
  }, []);

  if (authority?.mode === 'database_release') return <>{children}</>;
  return <div role="status" aria-live="polite" data-testid={authority ? 'offline-rules-authority' : undefined}
    style={{ padding: '60px 24px', textAlign: 'center', color: '#a59886' }}>
    {authority ? 'Правила сервера пока недоступны. Повторяем подключение автоматически.' : 'Проверяем правила для игрового экрана…'}
  </div>;
}
