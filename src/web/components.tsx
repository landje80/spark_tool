import type { ReactNode } from 'react';
import { nl } from '../shared/i18n/nl';
import type { ProspectStatus } from './lib';

export function StatusBadge({ status }: { status: ProspectStatus }) {
  return <span className={`badge badge--${status.toLowerCase()}`}>{nl.status[status]}</span>;
}

interface FieldProps {
  id: string;
  label: string;
  error?: string;
  required?: boolean;
  hint?: string;
  children: (a: {
    id: string;
    'aria-invalid': boolean;
    'aria-describedby'?: string;
    required?: boolean;
  }) => ReactNode;
}

/** Label + veld + foutmelding; koppelt alles via aria voor schermlezers. */
export function Field({ id, label, error, required, hint, children }: FieldProps) {
  const describedBy =
    [error ? `${id}-err` : '', hint ? `${id}-hint` : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div className="field">
      <label htmlFor={id}>
        {label}
        {required && <span className="req"> ({nl.crm.form.required})</span>}
      </label>
      {children({ id, 'aria-invalid': !!error, 'aria-describedby': describedBy, required })}
      {hint && (
        <p className="hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
      {error && (
        <p className="field-error" id={`${id}-err`}>
          {error}
        </p>
      )}
    </div>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <p className="alert" role="alert">
      {message}
    </p>
  );
}

export function Loading() {
  return (
    <p className="muted" role="status">
      {nl.common.loading}
    </p>
  );
}

export function Flags({
  flags,
}: {
  flags: {
    dueToday: boolean;
    overdue: boolean;
    needsReview: boolean;
    draftReady: boolean;
    blocked: boolean;
  };
}) {
  const t = nl.crm.list;
  const items: [boolean, string, string][] = [
    [flags.blocked, t.flagBlocked, 'flag--blocked'],
    [flags.overdue, t.flagOverdue, 'flag--overdue'],
    [flags.dueToday, t.flagToday, 'flag--today'],
    [flags.draftReady, t.flagDraft, 'flag--draft'],
    [flags.needsReview, t.flagReview, 'flag--review'],
  ];
  return (
    <ul className="flags">
      {items
        .filter(([on]) => on)
        .map(([, label, cls]) => (
          <li key={label} className={`flag ${cls}`}>
            {label}
          </li>
        ))}
    </ul>
  );
}
