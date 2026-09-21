import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { nl } from '../shared/i18n/nl';
import { api, ApiError } from './api';

/** Zet de documenttitel per pagina (WCAG 2.4.2) zodat schermlezers de navigatie horen. */
export function usePageTitle(title: string | undefined): void {
  useEffect(() => {
    if (title) document.title = `${title} – ${nl.common.titleSuffix}`;
  }, [title]);
}

/** Permanente live-regio (in de Shell): meldingen worden betrouwbaar voorgelezen. */
export const AnnounceContext = createContext<(message: string) => void>(() => undefined);
export const useAnnounce = () => useContext(AnnounceContext);

export const TZ = 'Europe/Amsterdam';

export type ProspectStatus =
  | 'NEW'
  | 'IN_REVIEW'
  | 'OUTREACH_PREPARED'
  | 'EMAILED'
  | 'REPLY_RECEIVED'
  | 'REPLY_NOT_INTERESTED'
  | 'CALLED'
  | 'FOLLOW_UP'
  | 'QUALIFIED'
  | 'NOT_INTERESTED'
  | 'CUSTOMER'
  | 'ARCHIVED'
  | 'INVALID'
  | 'DUPLICATE';
export type Province = 'OVERIJSSEL' | 'DRENTHE' | 'GELDERLAND' | 'FLEVOLAND' | 'OTHER';

export interface ListItem {
  id: string;
  companyName: string;
  city: string | null;
  province: Province;
  industry: string | null;
  status: ProspectStatus;
  fitScore: number | null;
  nextActionAt: string | null;
  createdAt: string;
  owner: { id: string; name: string } | null;
  flags: {
    dueToday: boolean;
    overdue: boolean;
    needsReview: boolean;
    draftReady: boolean;
    blocked: boolean;
  };
}
export interface ListResponse {
  total: number;
  page: number;
  pageSize: number;
  items: ListItem[];
}
export interface UserRef {
  id: string;
  name: string;
}

/** Vult {placeholders} in een tekst uit de tekstlaag. */
export function fmt(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(values[k] ?? ''));
}

export function fmtDate(iso: string | null | undefined): string {
  return iso
    ? new Date(iso).toLocaleDateString('nl-NL', {
        timeZone: TZ,
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : '–';
}
export function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('nl-NL', {
    timeZone: TZ,
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}
/** YYYY-MM-DD in de app-tijdzone, voor <input type="date">. */
export function toDateInput(iso: string | null | undefined): string {
  return iso ? new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(iso)) : '';
}

/** Alleen http(s)-links worden klikbaar; voorkomt javascript:-URL's uit bronnen. */
export function safeHref(url: string | null | undefined): string | null {
  return url && /^https?:\/\//i.test(url) ? url : null;
}

export function useApi<T>(path: string | null) {
  const [state, setState] = useState<{ data?: T; error?: ApiError; loading: boolean }>({
    loading: path !== null,
  });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (path === null) return;
    let cancelled = false;
    api<T>(path)
      .then((data) => !cancelled && setState({ data, loading: false }))
      .catch((error: ApiError) => !cancelled && setState({ error, loading: false }));
    return () => {
      cancelled = true;
    };
  }, [path, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}

/** Veldfouten uit een 400-antwoord als { veldnaam: boodschap }. */
export function fieldErrors(err: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  const details = (err as { details?: { path: string; message: string }[] } | null)?.details;
  if (Array.isArray(details)) for (const d of details) out[d.path] = d.message;
  return out;
}
