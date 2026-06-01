import { storage } from '@/src/utils/storage';

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;
const TOKEN_KEY = 'andy_session_token';

export async function getToken(): Promise<string | null> {
  return (await storage.secureGet<string>(TOKEN_KEY, '')) || null;
}
export async function setToken(token: string | null) {
  if (token) await storage.secureSet(TOKEN_KEY, token);
  else await storage.secureRemove(TOKEN_KEY);
}

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

async function request<T = any>(path: string, method: Method = 'GET', body?: any, timeoutMs = 90000): Promise<T> {
  const token = await getToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}/api${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    const data = text ? safeJson(text) : {};
    if (!res.ok) {
      const msg = (data && (data.detail || data.message)) || `HTTP ${res.status}`;
      const err: any = new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
      err.status = res.status;
      err.body = data;
      throw err;
    }
    return data as T;
  } finally {
    clearTimeout(t);
  }
}

function safeJson(t: string) { try { return JSON.parse(t); } catch { return { raw: t }; } }

export const api = {
  // Auth
  devLogin: (email: string, name?: string) => request<{ session_token: string; user: any }>('/auth/dev-login', 'POST', { email, name }),
  exchangeSession: (session_token: string) => request<{ session_token: string; user: any }>('/auth/session', 'POST', { session_token }),
  appleLogin: (identity_token: string, full_name?: string, email?: string) =>
    request<{ session_token: string; user: any }>('/auth/apple', 'POST', { identity_token, full_name, email }),
  me: () => request<{ user: any; is_pro: boolean }>('/auth/me'),
  logout: () => request('/auth/logout', 'POST'),
  deleteAccount: () => request('/auth/account', 'DELETE'),

  // Subscription
  subStatus: () => request<any>('/subscription/status'),
  subCheckout: (return_origin: string) => request<{ checkout_url: string; session_id: string }>('/subscription/checkout', 'POST', { return_origin }),
  subCancel: () => request<any>('/subscription/cancel', 'POST'),
  subConfirm: (session_id: string) => request<any>(`/subscription/confirm?session_id=${encodeURIComponent(session_id)}`, 'POST'),
  partsCheckout: (return_origin: string, job_id: string) =>
    request<{ checkout_url: string; session_id: string }>('/checkout/parts', 'POST', { return_origin, job_id }),

  // Jobs
  listJobs: () => request<{ jobs: any[] }>('/jobs'),
  getJob: (id: string) => request<{ job: any }>(`/jobs/${id}`),
  createJob: (payload: any) => request<{ job: any }>('/jobs', 'POST', payload),
  updateJob: (id: string, payload: any) => request<{ job: any }>(`/jobs/${id}`, 'PATCH', payload),
  addPhoto: (id: string, label: string, base64: string) => request<{ photo: any }>(`/jobs/${id}/photos`, 'POST', { label, base64 }),
  deleteJob: (id: string) => request(`/jobs/${id}`, 'DELETE'),

  // AI
  analyzeJob: (image_base64: string, context?: string) => request<any>('/ai/analyze-job', 'POST', { image_base64, context }),
  diagnostic: (image_base64: string, notes?: string) => request<any>('/ai/diagnostic', 'POST', { image_base64, notes }),
  safety: (payload: any) => request<any>('/ai/safety', 'POST', payload),

  // Voice
  greet: (persona: string, pace = 1.0) => request<{ text: string; audio_base64: string; voice: string; persona: string }>('/voice/greet', 'POST', { persona, pace }),
  voiceIntake: (audio_base64: string, mime_type: string) => request<any>('/voice/intake', 'POST', { audio_base64, mime_type }, 120000),

  // Change orders
  addChangeOrder: (job_id: string, payload: any) => request<any>(`/jobs/${job_id}/change-orders`, 'POST', payload),
  signChangeOrder: (job_id: string, co_id: string, signature_svg: string) =>
    request<any>(`/jobs/${job_id}/change-orders/${co_id}/sign`, 'POST', { signature_svg }),

  // Inventory (mock)
  inventory: (job_id: string, lat?: number, lng?: number) => {
    const q = new URLSearchParams();
    if (lat !== undefined) q.set('lat', String(lat));
    if (lng !== undefined) q.set('lng', String(lng));
    const qs = q.toString();
    return request<any>(`/jobs/${job_id}/inventory${qs ? '?' + qs : ''}`);
  },

  // Accounting
  accountingConnect: (provider: 'quickbooks' | 'square', enabled: boolean) =>
    request<any>('/accounting/connect', 'POST', { provider, enabled }),
  accountingPush: (job_id: string) => request<any>(`/jobs/${job_id}/accounting/push`, 'POST'),

  // Markup
  updateMarkup: (global_markup_percent: number) =>
    request<any>('/users/markup', 'POST', { global_markup_percent }),

  // Public
  publicEstimate: (job_id: string) => request<any>(`/public/estimate/${job_id}`),
  publicApprove: (job_id: string, signature_svg: string) =>
    request<any>(`/public/estimate/${job_id}/approve`, 'POST', { signature_svg }),
};
