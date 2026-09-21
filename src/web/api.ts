// Alle URL's zijn relatief aan het basispad (/tool). Vite levert dit via import.meta.env.BASE_URL.
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
  ) {
    super(message);
  }
}

let csrfToken = '';
export function setCsrfToken(token: string): void {
  csrfToken = token;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set('content-type', 'application/json');
  if (csrfToken) headers.set('x-csrf-token', csrfToken);
  const res = await fetch(`${BASE}/api${path}`, { ...init, headers, credentials: 'same-origin' });
  const body = (await res.json().catch(() => ({}))) as { code?: string; message?: string };
  if (!res.ok) throw new ApiError(res.status, body.code ?? 'INTERNAL', body.message ?? '');
  return body as T;
}
