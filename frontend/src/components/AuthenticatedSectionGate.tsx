import type { ReactNode } from 'react';
import { Compass } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { AuthPageFrame } from '../auth/AuthShell';
import GuestSectionPage, { type GuestSection } from '../pages/GuestSectionPage';

export interface AuthenticatedSectionGateProps {
  section: GuestSection;
  children: ReactNode;
}

/** For section entrances only. Detail/editor routes retain ProtectedRoute. */
export function AuthenticatedSectionGate({ section, children }: AuthenticatedSectionGateProps) {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) return <AuthPageFrame>
    <div className="guest-section-loading" role="status" aria-live="polite">
      <Compass size={22} aria-hidden="true" />Проверяем сессию…
    </div>
  </AuthPageFrame>;
  if (!isAuthenticated) return <GuestSectionPage section={section} />;
  return <>{children}</>;
}

export default AuthenticatedSectionGate;
