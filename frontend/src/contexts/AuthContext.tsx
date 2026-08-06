import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { authApi } from '../api/authApi';
import {
  AUTH_UNAUTHORIZED_EVENT,
  clearPersistedAuthSession,
  persistAuthSession,
  readPersistedAuthTokenForRequest,
} from '../api/authSession';
import type { User, AuthRequest, RegisterRequest } from '../types';

interface AuthContextType {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  login: (data: AuthRequest) => Promise<void>;
  register: (data: RegisterRequest) => Promise<void>;
  logout: () => void;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // A persisted token is only a bootstrap candidate.  The server profile is
  // authoritative, so stale JWTs and stale/forged cached users never make the
  // application authenticated even briefly.
  useEffect(() => {
    let active = true;
    let invalidated = false;

    const clearAuthState = () => {
      invalidated = true;
      if (!active) return;
      setToken(null);
      setUser(null);
      setIsLoading(false);
    };

    window.addEventListener(AUTH_UNAUTHORIZED_EVENT, clearAuthState);

    const bootstrap = async () => {
      const savedToken = readPersistedAuthTokenForRequest();
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
  }, []);

  const login = async (data: AuthRequest) => {
    const response = await authApi.login(data);
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
    setToken(null);
    setUser(null);
    clearPersistedAuthSession();
  };

  const value: AuthContextType = {
    user,
    token,
    isLoading,
    login,
    register,
    logout,
    isAuthenticated: !!user && !!token,
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
