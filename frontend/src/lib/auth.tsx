import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, getToken, setToken } from './api';

type User = { user_id: string; email: string; name: string; picture?: string } | null;

type AuthState = {
  user: User;
  loading: boolean;
  signInDev: (email: string, secret: string, name?: string) => Promise<void>;
  signInWithEmail: (identifier: string, password: string) => Promise<void>;
  signUpWithEmail: (email: string, password: string, username?: string, accepted_terms?: boolean) => Promise<{ email_verification_sent: boolean; email: string }>;
  /** Exchange a one-time Emergent `session_id` (from the OAuth redirect) for
   *  our own bearer via `POST /api/auth/session`. Do NOT pass a session_token. */
  consumeSessionId: (sessionId: string) => Promise<void>;
  /** Install a session that the backend already returned (Apple, dev, etc.). */
  installSession: (payload: { session_token: string; user: any }) => Promise<void>;
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

  const installSession = useCallback(async (payload: { session_token: string; user: any }) => {
    await setToken(payload.session_token);
    setUser(payload.user);
  }, []);

  const signInDev = useCallback(async (email: string, secret: string, name?: string) => {
    const res = await api.devLogin(email, secret, name);
    await installSession(res);
  }, [installSession]);

  const signInWithEmail = useCallback(async (identifier: string, password: string) => {
    const res = await api.emailLogin(identifier, password);
    await installSession(res);
  }, [installSession]);

  const signUpWithEmail = useCallback(async (
    email: string, password: string, username?: string, accepted_terms?: boolean,
  ) => {
    const res = await api.signup(email, password, username, accepted_terms);
    return { email_verification_sent: res.email_verification_sent, email: res.email };
  }, []);

  const consumeSessionId = useCallback(async (sessionId: string) => {
    const res = await api.exchangeSession(sessionId);
    await installSession(res);
  }, [installSession]);

  const signOut = useCallback(async () => {
    try { await api.logout(); } catch {}
    await setToken(null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{
      user, loading,
      signInDev, signInWithEmail, signUpWithEmail,
      consumeSessionId, installSession, signOut, refresh,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside provider');
  return ctx;
}
