import { storage } from '@/src/utils/storage';

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;
const TOKEN_KEY = 'jp_session_token';

export async function getToken(): Promise<string | null> {
  return (await storage.secureGet<string>(TOKEN_KEY, '')) || null;
}

export async function setToken(token: string | null) {
  if (token) await storage.secureSet(TOKEN_KEY, token);
  else await storage.secureRemove(TOKEN_KEY);
}

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

async function request<T = any>(path: string, method: Method = 'GET', body?: any): Promise<T> {
  const token = await getToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? safeJson(text) : {};
  if (!res.ok) {
    const msg = (data && (data.detail || data.message)) || `HTTP ${res.status}`;
    const err: any = new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    err.status = res.status;
    throw err;
  }
  return data as T;
}

function safeJson(t: string) {
  try { return JSON.parse(t); } catch { return { raw: t }; }
}

export const api = {
  // Auth
  devLogin: (email: string, name?: string) =>
    request<{ session_token: string; user: any }>('/auth/dev-login', 'POST', { email, name }),
  exchangeSession: (session_token: string) =>
    request<{ session_token: string; user: any }>('/auth/session', 'POST', { session_token }),
  me: () => request<{ user: any }>('/auth/me'),
  logout: () => request('/auth/logout', 'POST'),

  // Jobs
  listJobs: () => request<{ jobs: any[] }>('/jobs'),
  getJob: (id: string) => request<{ job: any }>(`/jobs/${id}`),
  createJob: (payload: any) => request<{ job: any }>('/jobs', 'POST', payload),
  updateJob: (id: string, payload: any) => request<{ job: any }>(`/jobs/${id}`, 'PATCH', payload),
  addPhoto: (id: string, label: string, base64: string) =>
    request<{ photo: any }>(`/jobs/${id}/photos`, 'POST', { label, base64 }),
  deleteJob: (id: string) => request(`/jobs/${id}`, 'DELETE'),

  // AI
  analyzeJob: (image_base64: string, context?: string) =>
    request<any>('/ai/analyze-job', 'POST', { image_base64, context }),
  diagnostic: (image_base64: string, notes?: string) =>
    request<any>('/ai/diagnostic', 'POST', { image_base64, notes }),
  safety: (payload: { image_base64?: string; location?: string; notes?: string }) =>
    request<any>('/ai/safety', 'POST', payload),

  // Voice
  greet: (persona: string, pace = 1.0) =>
    request<{ text: string; audio_base64: string; voice: string; persona: string }>(
      '/voice/greet', 'POST', { persona, pace },
    ),
};
