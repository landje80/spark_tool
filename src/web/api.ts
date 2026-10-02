// Alle URL's zijn relatief aan het basispad (standaard root). Vite levert dit via import.meta.env.BASE_URL.
export const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

export interface Me {
  user: { id: string; role: string; name: string; email: string };
  csrfToken: string;
  permissions: string[];
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

let csrfToken = '';
export function setCsrfToken(token: string): void {
  csrfToken = token;
}

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set('content-type', 'application/json');
  if (csrfToken) headers.set('x-csrf-token', csrfToken);
  const res = await fetch(url, { ...init, headers, credentials: 'same-origin' });
  const body = (await res.json().catch(() => ({}))) as {
    code?: string;
    message?: string;
    details?: unknown;
  };
  if (!res.ok)
    throw new ApiError(res.status, body.code ?? 'INTERNAL', body.message ?? '', body.details);
  return body as T;
}

export const api = <T>(path: string, init?: RequestInit): Promise<T> =>
  request<T>(`${BASE}/api${path}`, init);

export const send = <T>(method: 'POST' | 'PATCH', path: string, body?: unknown): Promise<T> =>
  api<T>(path, { method, body: JSON.stringify(body ?? {}) });

export const logoutRequest = (): Promise<{ redirect: string }> =>
  request(`${BASE}/auth/logout`, { method: 'POST' });
