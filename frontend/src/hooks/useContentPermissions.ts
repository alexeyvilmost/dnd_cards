import { useEffect, useState } from 'react';
import { apiClient } from '../api/client';
import { useOptionalAuth } from '../contexts/AuthContext';

type Capabilities = { admin: boolean; user_id: string };
const pending = new Map<string, Promise<Capabilities | null>>();

function loadCapabilities(token: string): Promise<Capabilities | null> {
  const existing = pending.get(token);
  if (existing) return existing;
  const request = apiClient.get<Capabilities>('/api/content-capabilities')
    .then(({ data }) => data)
    .catch(() => null)
    .then((value) => { pending.delete(token); return value; });
  pending.set(token, request);
  return request;
}

export function useContentPermissions() {
  const auth = useOptionalAuth();
  const token = auth?.token ?? null;
  const user = auth?.user ?? null;
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [resolvedToken, setResolvedToken] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setCapabilities(null);
    setResolvedToken(null);
    if (token && user) {
      void loadCapabilities(token)
        .then((data) => { if (active && data?.user_id === user.id) setCapabilities(data); })
        .finally(() => { if (active) setResolvedToken(token); });
    }
    return () => { active = false; };
  }, [token, user?.id]);

  const canEdit = (entity: { author?: string | null }) => Boolean(
    capabilities?.admin || (user && entity.author === user.id),
  );
  return {
    admin: capabilities?.admin === true,
    canEdit,
    canCreate: (type: string) => Boolean(token && user && (capabilities?.admin || type === 'cards' || type === 'spells')),
    ready: !token || resolvedToken === token,
  };
}
