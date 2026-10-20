import { loginPageUrl } from './session';

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

let redirecting = false;
/**
 * Stuurt naar de inlogpagina (met melding en terugkeer naar de huidige pagina) als de sessie is verlopen. Doet
 * niets op de loginpagina zelf en nooit twee keer (meerdere gelijktijdige aanroepen krijgen tegelijk een 401).
 */
export function redirectToLogin(): void {
  if (redirecting || window.location.pathname.startsWith(`${BASE}/login`)) return;
  redirecting = true;
  window.location.assign(loginPageUrl(BASE, window.location.pathname + window.location.search));
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
  // Sessie verlopen (tabblad lang open): naar de inlogpagina in plaats van een foutmelding. De opstartcontrole
  // `/me` is uitgezonderd; de App leidt zelf naar /login als die een 401 geeft.
  if (res.status === 401 && !url.endsWith('/api/me')) redirectToLogin();
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
