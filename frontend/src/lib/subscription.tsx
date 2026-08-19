import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from './api';
import { useAuth } from './auth';

export type SubStatus = {
  status: string; // trialing | active | canceled | past_due | none
  trial_end_date: string | null;
  trial_days_remaining: number;
  in_trial: boolean;
  current_tier: 'free' | 'pro';
  ai_scan_count_this_month: number;
  ai_limit_free: number;
  job_limit_free: number;
  is_pro: boolean;
  monthly_price_usd: number;
  annual_price_usd: number;
  cancel_at_period_end?: boolean;
};

type Ctx = {
  sub: SubStatus | null;
  refresh: () => Promise<void>;
  showPaywall: (reason?: string) => void;
  hidePaywall: () => void;
  paywallVisible: boolean;
  paywallReason: string | null;
};

const SubContext = createContext<Ctx | null>(null);

export function SubscriptionProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [sub, setSub] = useState<SubStatus | null>(null);
  const [paywallVisible, setPaywallVisible] = useState(false);
  const [paywallReason, setPaywallReason] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!user) { setSub(null); return; }
    try {
      const s = await api.subscriptionStatus();
      setSub(s);
    } catch {}
  }, [user]);

  useEffect(() => { refresh(); }, [refresh]);

  const showPaywall = useCallback((reason?: string) => {
    setPaywallReason(reason || null);
    setPaywallVisible(true);
  }, []);
  const hidePaywall = useCallback(() => setPaywallVisible(false), []);

  return (
    <SubContext.Provider value={{ sub, refresh, showPaywall, hidePaywall, paywallVisible, paywallReason }}>
      {children}
    </SubContext.Provider>
  );
}

export function useSubscription() {
  const ctx = useContext(SubContext);
  if (!ctx) throw new Error('useSubscription outside provider');
  return ctx;
}
