import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { authApi } from '../api/authApi';
import { clearApiCache } from '../api/apiCache';
import {
  AUTH_UNAUTHORIZED_EVENT,
  clearPersistedAuthSession,
  persistAuthSession,
  readPersistedAuthToken,
} from '../api/authSession';
import type { User, AuthRequest, RegisterRequest } from '../types';
import { completeOAuth, hasOAuthCallback } from '../auth/oauth';

interface AuthContextType {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  login: (data: AuthRequest) => Promise<void>;
  register: (data: RegisterRequest) => Promise<void>;
  logout: () => void;
  isAuthenticated: boolean;
  oauthError: string | null;
  oauthReturnPath: string | null;
  refreshProfile: () => Promise<User>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [oauthError, setOAuthError] = useState<string | null>(null);
  const [oauthReturnPath, setOAuthReturnPath] = useState<string | null>(null);
  const [oauthCallback] = useState(() => hasOAuthCallback());

  // A persisted token is only a bootstrap candidate.  The server profile is
  // authoritative, so stale JWTs and stale/forged cached users never make the
  // application authenticated even briefly.
  useEffect(() => {
    let active = true;
    let invalidated = false;

    const clearAuthState = () => {
      invalidated = true;
      clearApiCache();
      if (!active) return;
      setToken(null);
      setUser(null);
      setIsLoading(false);
    };

    window.addEventListener(AUTH_UNAUTHORIZED_EVENT, clearAuthState);

    const bootstrap = async () => {
      if (oauthCallback) {
        clearApiCache();
        clearPersistedAuthSession();
        try {
          const result = await completeOAuth();
          if (!active || invalidated) return;
          clearApiCache();
          persistAuthSession(result.token, result.user);
          setToken(result.token);
          setUser(result.user);
          setOAuthReturnPath(result.return_path);
        } catch (error) {
          if (active) setOAuthError(error instanceof Error ? error.message : 'Ошибка входа');
        } finally {
          if (active) setIsLoading(false);
        }
        return;
      }
      const savedToken = readPersistedAuthToken();
      if (!savedToken) {
        clearPersistedAuthSession();
        if (active) setIsLoading(false);
        return;
      }

      try {
        const serverProfile = await authApi.getProfile();
        if (!active || invalidated) return;
        persistAuthSession(savedToken, serverProfile);
        setToken(savedToken);
        setUser(serverProfile);
      } catch {
        clearPersistedAuthSession();
        if (active) {
          setToken(null);
          setUser(null);
        }
      } finally {
        if (active) setIsLoading(false);
      }
    };

    void bootstrap();

    return () => {
      active = false;
      window.removeEventListener(AUTH_UNAUTHORIZED_EVENT, clearAuthState);
    };
  }, [oauthCallback]);

  const login = async (data: AuthRequest) => {
    const response = await authApi.login(data);
    setOAuthError(null);
    setOAuthReturnPath(null);
    clearApiCache();
    setToken(response.token);
    setUser(response.user);

    persistAuthSession(response.token, response.user);
  };

  const register = async (data: RegisterRequest) => {
    await authApi.register(data);
    // После успешной регистрации автоматически входим
    await login({ username: data.username, password: data.password });
  };

  const logout = () => {
    setOAuthError(null);
    setOAuthReturnPath(null);
    clearApiCache();
    setToken(null);
    setUser(null);
    clearPersistedAuthSession();
  };

  const refreshProfile = async () => {
    const profile = await authApi.getProfile();
    const currentToken = readPersistedAuthToken();
    if (currentToken) {
      setUser(profile);
      persistAuthSession(currentToken, profile);
    }
    return profile;
  };

  const value: AuthContextType = {
    user,
    token,
    isLoading,
    login,
    register,
    logout,
    isAuthenticated: !!user && !!token,
    oauthError,
    oauthReturnPath,
    refreshProfile,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth должен использоваться внутри AuthProvider');
  }
  return context;
};

/** Read-only public previews may render outside the app provider in tests. */
export const useOptionalAuth = (): AuthContextType | null => useContext(AuthContext) ?? null;
