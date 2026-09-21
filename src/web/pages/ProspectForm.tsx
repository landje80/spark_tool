import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { nl } from '../../shared/i18n/nl';
import { ApiError, send } from '../api';
import { ErrorNote, Field } from '../components';
import { fieldErrors, toDateInput, useApi, usePageTitle, type UserRef } from '../lib';

const t = nl.crm.form;

export interface ProspectFormValues {
  companyName?: string;
  website?: string | null;
  phone?: string | null;
  contactEmail?: string | null;
  city?: string | null;
  province?: string;
  industry?: string | null;
  employeesMin?: number | null;
  employeesMax?: number | null;
  fitScore?: number | null;
  ownerId?: string | null;
  nextActionAt?: string | null;
  notes?: string | null;
}

interface DuplicateInfo {
  blocking: boolean;
  matches: {
    prospectId: string;
    reason: string;
    prospect?: { companyName: string; city: string | null };
  }[];
}

const str = (fd: FormData, k: string): string => String(fd.get(k) ?? '').trim();
const num = (fd: FormData, k: string): number | null =>
  str(fd, k) === '' ? null : Number(str(fd, k));

/** Formulier voor aanmaken (POST) en bewerken (PATCH, alleen gewijzigde velden gaan mee). */
export function ProspectForm({
  initial,
  prospectId,
  onSaved,
}: {
  initial?: ProspectFormValues;
  prospectId?: string;
  onSaved?: () => void;
}) {
  const navigate = useNavigate();
  const users = useApi<{ users: UserRef[] }>('/users').data?.users ?? [];
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState('');
  const [duplicate, setDuplicate] = useState<DuplicateInfo | null>(null);
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState<FormData | null>(null);

  // Bij validatiefouten gaat de focus naar het eerste ongeldige veld (WCAG 3.3.1).
  useEffect(() => {
    if (Object.keys(errors).length > 0) {
      document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
    }
  }, [errors]);

  async function submit(fd: FormData, confirmDuplicate: boolean) {
    setSaving(true);
    setErrors({});
    setGeneral('');
    const body: Record<string, unknown> = {
      companyName: str(fd, 'companyName'),
      website: str(fd, 'website'),
      phone: str(fd, 'phone'),
      contactEmail: str(fd, 'contactEmail'),
      city: str(fd, 'city'),
      province: str(fd, 'province') || 'OTHER',
      industry: str(fd, 'industry'),
      employeesMin: num(fd, 'employeesMin'),
      employeesMax: num(fd, 'employeesMax'),
      fitScore: num(fd, 'fitScore'),
      ownerId: str(fd, 'ownerId') || null,
      nextActionAt: str(fd, 'nextActionAt') || null,
      notes: str(fd, 'notes'),
    };
    try {
      if (prospectId) {
        await send('PATCH', `/prospects/${prospectId}`, body);
        onSaved?.();
      } else {
        const created = await send<{ id: string }>('POST', '/prospects', {
          ...body,
          confirmDuplicate,
        });
        navigate(`/prospects/${created.id}`);
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === 'CONFLICT' && !prospectId) {
        setDuplicate(err.details as DuplicateInfo);
        setPending(fd);
      } else if (err instanceof ApiError && err.code === 'VALIDATION_ERROR') {
        setErrors(fieldErrors(err));
        setGeneral(t.fixErrors);
      } else {
        setGeneral(nl.common.error);
      }
    } finally {
      setSaving(false);
    }
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setDuplicate(null);
    void submit(new FormData(e.currentTarget), false);
  }

  const v = initial ?? {};
  return (
    <form onSubmit={onSubmit} noValidate className="form">
      {general && <ErrorNote message={general} />}
      {duplicate && (
        <section className="alert alert--warn" role="alert" aria-labelledby="dup-title">
          <h2 id="dup-title">{t.duplicateTitle}</h2>
          <ul className="plain">
            {duplicate.matches.map((m) => (
              <li key={m.prospectId}>
                <Link to={`/prospects/${m.prospectId}`}>
                  {m.prospect?.companyName ?? m.prospectId}
                </Link>
                {m.prospect?.city ? ` (${m.prospect.city})` : ''} — {m.reason}
              </li>
            ))}
          </ul>
          {duplicate.blocking ? (
            <p>{t.duplicateBlocking}</p>
          ) : (
            <button
              type="button"
              className="btn"
              disabled={saving}
              onClick={() => pending && void submit(pending, true)}
            >
              {t.duplicateConfirm}
            </button>
          )}
        </section>
      )}
      <div className="form-grid">
        <Field id="companyName" label={t.companyName} required error={errors.companyName}>
          {(a) => (
            <input
              {...a}
              name="companyName"
              defaultValue={v.companyName ?? ''}
              maxLength={300}
              autoComplete="organization"
            />
          )}
        </Field>
        <Field id="website" label={t.website} error={errors.website}>
          {(a) => (
            <input
              {...a}
              name="website"
              type="text"
              inputMode="url"
              defaultValue={v.website ?? ''}
              placeholder="voorbeeld.nl"
            />
          )}
        </Field>
        <Field id="city" label={t.city} error={errors.city}>
          {(a) => <input {...a} name="city" defaultValue={v.city ?? ''} />}
        </Field>
        <Field id="province" label={t.province} error={errors.province}>
          {(a) => (
            <select {...a} name="province" defaultValue={v.province ?? 'OTHER'}>
              {Object.entries(nl.province).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field id="industry" label={t.industry} error={errors.industry}>
          {(a) => <input {...a} name="industry" defaultValue={v.industry ?? ''} />}
        </Field>
        <Field id="phone" label={t.phone} error={errors.phone}>
          {(a) => (
            <input {...a} name="phone" type="tel" defaultValue={v.phone ?? ''} autoComplete="off" />
          )}
        </Field>
        <Field id="contactEmail" label={t.contactEmail} error={errors.contactEmail}>
          {(a) => (
            <input
              {...a}
              name="contactEmail"
              type="email"
              defaultValue={v.contactEmail ?? ''}
              autoComplete="off"
            />
          )}
        </Field>
        <Field id="employeesMin" label={t.employeesMin} error={errors.employeesMin}>
          {(a) => (
            <input
              {...a}
              name="employeesMin"
              type="number"
              min={0}
              inputMode="numeric"
              defaultValue={v.employeesMin ?? ''}
            />
          )}
        </Field>
        <Field id="employeesMax" label={t.employeesMax} error={errors.employeesMax}>
          {(a) => (
            <input
              {...a}
              name="employeesMax"
              type="number"
              min={0}
              inputMode="numeric"
              defaultValue={v.employeesMax ?? ''}
            />
          )}
        </Field>
        <Field id="fitScore" label={t.fitScore} error={errors.fitScore}>
          {(a) => (
            <input
              {...a}
              name="fitScore"
              type="number"
              min={0}
              max={100}
              inputMode="numeric"
              defaultValue={v.fitScore ?? ''}
            />
          )}
        </Field>
        <Field id="ownerId" label={t.owner} error={errors.ownerId}>
          {(a) => (
            <select {...a} name="ownerId" defaultValue={v.ownerId ?? ''}>
              <option value="">{nl.crm.list.ownerNone}</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field id="nextActionAt" label={t.nextActionAt} error={errors.nextActionAt}>
          {(a) => (
            <input
              {...a}
              name="nextActionAt"
              type="date"
              defaultValue={toDateInput(v.nextActionAt)}
            />
          )}
        </Field>
      </div>
      <Field id="notes" label={t.notes} error={errors.notes}>
        {(a) => <textarea {...a} name="notes" rows={4} defaultValue={v.notes ?? ''} />}
      </Field>
      <button className="btn" type="submit" disabled={saving}>
        {saving ? t.saving : t.save}
      </button>
    </form>
  );
}

export function NewProspectPage() {
  usePageTitle(t.titleNew);
  return (
    <>
      <h1>{t.titleNew}</h1>
      <div className="card">
        <ProspectForm />
      </div>
    </>
  );
}
