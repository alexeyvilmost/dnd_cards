import { useEffect, useState, type ReactNode } from 'react';
import { Navigate, useParams, useSearchParams } from 'react-router-dom';
import { apiClient } from '../api/client';
import { useContentPermissions } from '../hooks/useContentPermissions';

export default function ContentEditorGate({ kind, children }: { kind: string; children: ReactNode }) {
  const { id: pathID } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  const id = pathID || params.get('edit');
  const { admin, canCreate, canEdit, ready } = useContentPermissions();
  const [owned, setOwned] = useState<boolean | null>(null);
  useEffect(() => {
    let active = true;
    setOwned(null);
    if (!ready || admin || !id || !canCreate(kind)) return;
    void apiClient.get<{ author?: string }>(`/api/${kind}/${encodeURIComponent(id)}`)
      .then(({ data }) => { if (active) setOwned(canEdit(data)); })
      .catch(() => { if (active) setOwned(false); });
    return () => { active = false; };
  }, [ready, admin, id, kind, canCreate(kind)]);
  if (!ready) return <div role="status">Проверка прав…</div>;
  if (admin) return <>{children}</>;
  if (!canCreate(kind)) return <Navigate to={kind === 'monsters' ? '/monsters' : `/?type=${kind}`} replace />;
  if (!id) return <>{children}</>;
  if (owned === null) return <div role="status">Проверка авторства…</div>;
  if (!owned) return <Navigate to={`/entity/${kind}/${encodeURIComponent(id)}`} replace />;
  return <>{children}</>;
}
