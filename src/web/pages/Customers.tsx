import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { nl } from '../../shared/i18n/nl';
import { ApiError, send } from '../api';
import { ErrorNote, Field, Loading } from '../components';
import { fieldErrors, fmt, fmtDate, useAnnounce, useApi, usePageTitle } from '../lib';
import { useCan } from '../me';

const t = nl.customers;
const PLATFORMS = ['LINKEDIN', 'FACEBOOK', 'INSTAGRAM', 'TIKTOK'] as const;

interface CustomerListItem {
  id: string;
  name: string;
  status: keyof typeof t.statusLabel;
  contactName: string | null;
  contactEmail: string | null;
  allowedPlatforms: string[];
  createdAt: string;
  _count: { submissions: number };
}

export function PlatformPicker({ name, defaultValue }: { name: string; defaultValue: string[] }) {
  return (
    <fieldset className="checkgroup">
      <legend>{t.allowedPlatforms}</legend>
      {PLATFORMS.map((p) => (
        <label key={p} className="checkgroup__item">
          <input type="checkbox" name={name} value={p} defaultChecked={defaultValue.includes(p)} />
          {nl.content.platform[p]}
        </label>
      ))}
    </fieldset>
  );
}

function CustomerCreateForm({ onCreated }: { onCreated: () => void }) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState('');
  const [saving, setSaving] = useState(false);

  // Bij validatiefouten gaat de focus naar het eerste ongeldige veld (WCAG 3.3.1), net als ProspectForm.
  useEffect(() => {
    if (Object.keys(errors).length > 0) {
      document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
    }
  }, [errors]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    setGeneral('');
    const fd = new FormData(e.currentTarget);
    const allowedPlatforms = fd.getAll('allowedPlatforms').map(String);
    try {
      await send('POST', '/customers', {
        name: String(fd.get('name') ?? '').trim(),
        contactName: String(fd.get('contactName') ?? '').trim(),
        contactEmail: String(fd.get('contactEmail') ?? '').trim(),
        allowedPlatforms,
      });
      e.currentTarget.reset();
      onCreated();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'VALIDATION_ERROR') {
        setErrors(fieldErrors(err));
        setGeneral(nl.crm.form.fixErrors);
      } else {
        setGeneral(t.createFailed);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="form">
      {general && <ErrorNote message={general} />}
      <div className="form-grid">
        <Field id="name" label={t.name} required error={errors.name}>
          {(a) => <input {...a} name="name" maxLength={300} />}
        </Field>
        <Field id="contactName" label={t.contactName} error={errors.contactName}>
          {(a) => <input {...a} name="contactName" maxLength={200} />}
        </Field>
        <Field id="contactEmail" label={t.contactEmail} error={errors.contactEmail}>
          {(a) => <input {...a} name="contactEmail" type="email" />}
        </Field>
      </div>
      <PlatformPicker name="allowedPlatforms" defaultValue={['LINKEDIN']} />
      <button className="btn" type="submit" disabled={saving}>
        {t.new}
      </button>
    </form>
  );
}

export function CustomersPage() {
  usePageTitle(t.title);
  const canWrite = useCan('customer.manage');
  const { data, loading, error, reload } = useApi<{ items: CustomerListItem[] }>('/customers');
  return (
    <>
      <h1>{t.title}</h1>
      {canWrite && (
        <details className="card">
          <summary>{t.new}</summary>
          <CustomerCreateForm onCreated={reload} />
        </details>
      )}
      {loading && <Loading />}
      {error && <ErrorNote message={nl.common.error} />}
      {data && data.items.length === 0 && <p className="card">{t.empty}</p>}
      <ul className="cards">
        {data?.items.map((c) => (
          <li key={c.id} className="card">
            <h2>
              <Link to={`/customers/${c.id}`}>{c.name}</Link>
            </h2>
            <p className="muted">
              {t.statusLabel[c.status]}
              {c.contactName ? ` · ${c.contactName}` : ''}
            </p>
            <p className="muted small">
              {c.allowedPlatforms
                .map((p) => nl.content.platform[p as keyof typeof nl.content.platform])
                .join(', ')}
            </p>
          </li>
        ))}
      </ul>
    </>
  );
}

interface UploadLinkItem {
  id: string;
  campaign: string | null;
  expiresAt: string;
  maxUses: number | null;
  useCount: number;
  revokedAt: string | null;
  createdAt: string;
}
interface BrandProfileItem {
  id: string;
  version: number;
  active: boolean;
  data: Record<string, unknown>;
}
interface CustomerDetail {
  id: string;
  name: string;
  status: keyof typeof t.statusLabel;
  contactName: string | null;
  contactEmail: string | null;
  allowedPlatforms: string[];
  prospect: { id: string; companyName: string } | null;
  brandProfiles: BrandProfileItem[];
  uploadLinks: UploadLinkItem[];
  submissions: { id: string; status: string; topic: string | null; createdAt: string }[];
}

function NewUploadLinkForm({
  customerId,
  onCreated,
}: {
  customerId: string;
  onCreated: () => void;
}) {
  const announce = useAnnounce();
  const [link, setLink] = useState<{ url: string } | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError('');
    const fd = new FormData(e.currentTarget);
    const campaign = String(fd.get('campaign') ?? '').trim();
    const expiresInHours = String(fd.get('expiresInHours') ?? '').trim();
    const maxUses = String(fd.get('maxUses') ?? '').trim();
    try {
      const created = await send<{ url: string }>('POST', `/customers/${customerId}/upload-links`, {
        campaign: campaign || undefined,
        expiresInHours: expiresInHours ? Number(expiresInHours) : undefined,
        maxUses: maxUses ? Number(maxUses) : undefined,
      });
      setLink(created);
      e.currentTarget.reset();
      onCreated();
    } catch {
      setError(nl.common.error);
    } finally {
      setSaving(false);
    }
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      announce(t.copied);
    } catch {
      /* klembord niet beschikbaar; de link staat nog gewoon op het scherm */
    }
  }

  return (
    <div>
      {link && (
        <div className="alert alert--info" role="status">
          <p>{t.linkCreated}</p>
          <p className="pre">{link.url}</p>
          <button type="button" className="btn btn--ghost" onClick={() => void copy()}>
            {t.copyLink}
          </button>
        </div>
      )}
      {error && <ErrorNote message={error} />}
      <form onSubmit={onSubmit} noValidate className="form">
        <div className="form-grid">
          <Field id="campaign" label={t.campaign}>
            {(a) => <input {...a} name="campaign" maxLength={200} />}
          </Field>
          <Field id="expiresInHours" label={t.expiresInHours}>
            {(a) => <input {...a} name="expiresInHours" type="number" min={1} placeholder="72" />}
          </Field>
          <Field id="maxUses" label={t.maxUses}>
            {(a) => <input {...a} name="maxUses" type="number" min={1} />}
          </Field>
        </div>
        <button className="btn" type="submit" disabled={saving}>
          {t.newUploadLink}
        </button>
      </form>
    </div>
  );
}

function BrandProfileEditor({
  customerId,
  profiles,
  reload,
}: {
  customerId: string;
  profiles: BrandProfileItem[];
  reload: () => void;
}) {
  const [text, setText] = useState('{}');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const announce = useAnnounce();

  async function create(activate: boolean) {
    setError('');
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      setError(t.invalidJson);
      return;
    }
    setSaving(true);
    try {
      const created = await send<{ version: number }>(
        'POST',
        `/customers/${customerId}/brand-profiles`,
        {
          data,
          activate,
        },
      );
      setText('{}');
      announce(
        fmt(t.version, { version: created.version }) + ' ' + t.newBrandProfile.toLowerCase(),
      );
      reload();
    } catch {
      setError(nl.common.error);
    } finally {
      setSaving(false);
    }
  }

  async function activate(id: string, version: number) {
    setError('');
    try {
      await send('POST', `/customers/${customerId}/brand-profiles/${id}/activate`);
      announce(fmt(t.version, { version }) + ' ' + t.active.toLowerCase());
      reload();
    } catch {
      setError(nl.common.error);
    }
  }

  return (
    <section aria-labelledby="brand-title">
      <h2 id="brand-title">{t.brandProfile}</h2>
      <ul className="plain">
        {profiles.map((p) => (
          <li key={p.id}>
            {fmt(t.version, { version: p.version })}
            {p.active ? (
              ` — ${t.active}`
            ) : (
              <button
                type="button"
                className="btn btn--ghost btn--small"
                onClick={() => void activate(p.id, p.version)}
              >
                {t.activate}
              </button>
            )}
          </li>
        ))}
      </ul>
      {error && <ErrorNote message={error} />}
      <Field id="brandData" label={t.brandProfileData} hint={t.brandProfileHelp}>
        {(a) => (
          <textarea
            {...a}
            rows={5}
            className="pre"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        )}
      </Field>
      <div className="actions">
        <button className="btn" type="button" disabled={saving} onClick={() => void create(true)}>
          {`${t.newBrandProfile} (${t.activate.toLowerCase()})`}
        </button>
        <button
          className="btn btn--ghost"
          type="button"
          disabled={saving}
          onClick={() => void create(false)}
        >
          {t.newBrandProfile}
        </button>
      </div>
    </section>
  );
}

export function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const canWriteLinks = useCan('content.upload_link');
  const canManage = useCan('customer.manage');
  const { data, loading, error, reload } = useApi<CustomerDetail>(id ? `/customers/${id}` : null);
  const announce = useAnnounce();
  const [actionError, setActionError] = useState('');
  usePageTitle(data?.name ?? t.detail);

  async function revoke(linkId: string) {
    if (!window.confirm(t.revokeConfirm)) return;
    setActionError('');
    try {
      await send('POST', `/upload-links/${linkId}/revoke`);
      announce(t.revoked);
      reload();
    } catch {
      setActionError(nl.common.error);
    }
  }

  if (loading) return <Loading />;
  if (error || !data) return <ErrorNote message={nl.common.error} />;

  return (
    <>
      <p>
        <Link to="/customers">← {t.title}</Link>
      </p>
      <h1>{data.name}</h1>
      <p className="muted">{t.statusLabel[data.status]}</p>
      {actionError && <ErrorNote message={actionError} />}
      {data.prospect && (
        <p className="muted small">
          {t.convertedFrom}:{' '}
          <Link to={`/prospects/${data.prospect.id}`}>{data.prospect.companyName}</Link>
        </p>
      )}

      {canWriteLinks && (
        <section aria-labelledby="links-title">
          <h2 id="links-title">{t.uploadLinks}</h2>
          <ul className="plain">
            {data.uploadLinks.map((l) => {
              const expired = new Date(l.expiresAt) <= new Date();
              return (
                <li key={l.id}>
                  {l.campaign ?? '—'} ·{' '}
                  {l.maxUses
                    ? fmt(t.uses, { used: l.useCount, max: l.maxUses })
                    : fmt(t.usesUnlimited, { used: l.useCount })}{' '}
                  · {fmt(t.expiresAt, { date: fmtDate(l.expiresAt) })}
                  {l.revokedAt && ` · ${t.revoked}`}
                  {expired && !l.revokedAt && ` · ${nl.status.ARCHIVED}`}
                  {!l.revokedAt && !expired && (
                    <button
                      type="button"
                      className="btn btn--ghost btn--small"
                      onClick={() => void revoke(l.id)}
                    >
                      {t.revoke}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          <NewUploadLinkForm customerId={data.id} onCreated={reload} />
        </section>
      )}

      {canManage && (
        <BrandProfileEditor customerId={data.id} profiles={data.brandProfiles} reload={reload} />
      )}

      <section aria-labelledby="submissions-title">
        <h2 id="submissions-title">{t.submissions}</h2>
        {data.submissions.length === 0 && <p className="muted">{t.noSubmissions}</p>}
        <ul className="plain">
          {data.submissions.map((s) => (
            <li key={s.id}>
              <Link to={`/content/${s.id}`}>{s.topic ?? s.id}</Link> —{' '}
              {nl.content.submissionStatus[s.status as keyof typeof nl.content.submissionStatus]}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
