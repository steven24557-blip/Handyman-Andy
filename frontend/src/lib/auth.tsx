import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, getToken, setToken } from './api';

type User = { user_id: string; email: string; name: string; picture?: string } | null;

type AuthState = {
  user: User;
  loading: boolean;
  signInDev: (email: string, name?: string) => Promise<void>;
  consumeSessionToken: (token: string) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const token = await getToken();
    if (!token) { setUser(null); setLoading(false); return; }
    try {
      const res = await api.me();
      setUser(res.user);
    } catch (e: any) {
      if (e?.status === 401) await setToken(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const signInDev = useCallback(async (email: string, name?: string) => {
    const res = await api.devLogin(email, name);
    await setToken(res.session_token);
    setUser(res.user);
  }, []);

  const consumeSessionToken = useCallback(async (token: string) => {
    const res = await api.exchangeSession(token);
    await setToken(res.session_token);
    setUser(res.user);
  }, []);

  const signOut = useCallback(async () => {
    try { await api.logout(); } catch {}
    await setToken(null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, signInDev, consumeSessionToken, signOut, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside provider');
  return ctx;
}
