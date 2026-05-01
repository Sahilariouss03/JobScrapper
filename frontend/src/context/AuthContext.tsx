import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { authApi } from '../api/client';

interface AuthContextType {
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Verify token on mount
  useEffect(() => {
    const token = localStorage.getItem('js_token');
    if (!token) { setIsLoading(false); return; }

    authApi.verify()
      .then(r => setIsAuthenticated(r.data.valid))
      .catch(() => localStorage.removeItem('js_token'))
      .finally(() => setIsLoading(false));
  }, []);

  const login = useCallback(async (password: string) => {
    const { data } = await authApi.login(password);
    localStorage.setItem('js_token', data.token);
    setIsAuthenticated(true);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('js_token');
    setIsAuthenticated(false);
  }, []);

  return (
    <AuthContext.Provider value={{ isAuthenticated, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
