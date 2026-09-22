import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { nl } from '../../shared/i18n/nl';
import { send } from '../api';
import { ErrorNote, Loading, StatusBadge } from '../components';
import {
  fmt,
  fmtDate,
  fmtDateTime,
  safeHref,
  useApi,
  usePageTitle,
  type ListResponse,
  type ProspectStatus,
  type UserRef,
} from '../lib';
import { useCan } from '../me';
import { PlatformPicker } from './Customers';
import { OutreachSection, type DraftRow, type EmailRow } from './Outreach';
import { ProspectForm } from './ProspectForm';

const tc = nl.convert;

const t = nl.crm.detail;

interface Detail {
  id: string;
  companyName: string;
  website: string | null;
  phone: string | null;
  contactEmail: string | null;
  city: string | null;
  province: keyof typeof nl.province;
  industry: string | null;
  employeesMin: number | null;
  employeesMax: number | null;
  employeesRationale: string | null;
  employeesSourceUrl: string | null;
  fitScore: number | null;
  fitRationale: string | null;
  outreachAngle: string | null;
  status: ProspectStatus;
  ownerId: string | null;
  owner: UserRef | null;
  nextActionAt: string | null;
  notInterestedReason: string | null;
  notes: string | null;
  firstFoundAt: string;
  lastVerifiedAt: string | null;
  allowedTransitions: ProspectStatus[];
  sources: {
    id: string;
    type: string;
    url: string;
    title: string | null;
    checkedAt: string;
    observation: string | null;
    confidence: string;
  }[];
  socials: { id: string; platform: string; url: string; accountName: string | null }[];
  activities: {
    id: string;
    type: keyof typeof nl.activity;
    description: string | null;
    oldValue: string | null;
    newValue: string | null;
    createdAt: string;
    actor: UserRef | null;
  }[];
  tasks: {
    id: string;
    type: keyof typeof nl.taskType;
    status: string;
    dueAt: string | null;
    priority: keyof typeof nl.priority;
    description: string | null;
    assignee: UserRef | null;
  }[];
  drafts: DraftRow[];
  emails: EmailRow[];
}

function Link2({ url, label }: { url: string; label?: string | null }) {
  const href = safeHref(url);
  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {label || url}
    </a>
  ) : (
    <span>{label || url}</span>
  );
}

function StatusPanel({ d, onDone }: { d: Detail; onDone: () => void }) {
  const [status, setStatus] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await send('POST', `/prospects/${d.id}/status`, { status, reason });
      setStatus('');
      setReason('');
      onDone();
    } catch {
      setError(nl.errors.INVALID_TRANSITION);
    }
  }
  if (!d.allowedTransitions.length) return null;
  return (
    <form onSubmit={(e) => void submit(e)} className="inline-form">
      <label>
        {t.statusChoose}
        <select value={status} onChange={(e) => setStatus(e.target.value)} required>
          <option value="" disabled>
            –
          </option>
          {d.allowedTransitions.map((s) => (
            <option key={s} value={s}>
              {nl.status[s]}
            </option>
          ))}
        </select>
      </label>
      <label className="grow">
        {t.statusReason}
        <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} />
      </label>
      <button className="btn" type="submit" disabled={!status}>
        {t.statusApply}
      </button>
      {error && <ErrorNote message={error} />}
    </form>
  );
}

function ActivitySection({
  d,
  onDone,
  canWrite,
}: {
  d: Detail;
  onDone: () => void;
  canWrite: boolean;
}) {
  const [type, setType] = useState<'NOTE' | 'CALL'>('NOTE');
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await send('POST', `/prospects/${d.id}/activities`, { type, description: text });
      setText('');
      onDone();
    } catch {
      setError(nl.common.error);
    }
  }
  return (
    <section className="card" aria-labelledby="h-act">
      <h2 id="h-act">{t.activity}</h2>
      {canWrite && (
        <form onSubmit={(e) => void submit(e)} className="inline-form">
          <label>
            {t.noteType}
            <select value={type} onChange={(e) => setType(e.target.value as 'NOTE' | 'CALL')}>
              <option value="NOTE">{nl.activity.NOTE}</option>
              <option value="CALL">{nl.activity.CALL}</option>
            </select>
          </label>
          <label className="grow">
            {t.noteText}
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={2}
              maxLength={5000}
              required
            />
          </label>
          <button className="btn" type="submit">
            {t.noteAdd}
          </button>
          {error && <ErrorNote message={error} />}
        </form>
      )}
      {d.activities.length === 0 ? (
        <p className="muted">{t.noActivity}</p>
      ) : (
        <ol className="timeline">
          {d.activities.map((a) => (
            <li key={a.id}>
              <div>
                <strong>{nl.activity[a.type]}</strong>{' '}
                <span className="muted small">
                  {fmtDateTime(a.createdAt)} ·{' '}
                  {a.actor ? fmt(t.by, { name: a.actor.name }) : t.system}
                </span>
              </div>
              {a.type === 'STATUS_CHANGED' && a.oldValue && a.newValue && (
                <div>
                  {fmt(t.oldNew, {
                    old: nl.status[a.oldValue as ProspectStatus] ?? a.oldValue,
                    new: nl.status[a.newValue as ProspectStatus] ?? a.newValue,
                  })}
                </div>
              )}
              {a.type === 'FIELD_CHANGED' && a.newValue && a.oldValue !== null && (
                <div>{fmt(t.oldNew, { old: a.oldValue, new: a.newValue })}</div>
              )}
              {a.description && <div className="pre">{a.description}</div>}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function TasksSection({
  d,
  onDone,
  canWrite,
}: {
  d: Detail;
  onDone: () => void;
  canWrite: boolean;
}) {
  const [type, setType] = useState('FOLLOW_UP');
  const [due, setDue] = useState('');
  const [priority, setPriority] = useState('NORMAL');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  async function add(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await send('POST', `/prospects/${d.id}/tasks`, {
        type,
        priority,
        dueAt: due || null,
        description,
      });
      setDescription('');
      setDue('');
      onDone();
    } catch {
      setError(nl.common.error);
    }
  }
  async function complete(id: string) {
    await send('PATCH', `/tasks/${id}`, { status: 'DONE' });
    onDone();
  }
  return (
    <section className="card" aria-labelledby="h-tasks">
      <h2 id="h-tasks">{t.tasks}</h2>
      {d.tasks.length === 0 ? (
        <p className="muted">{t.noTasks}</p>
      ) : (
        <ul className="plain">
          {d.tasks.map((k) => (
            <li key={k.id} className="taskrow">
              <span>
                <strong>{nl.taskType[k.type]}</strong> · {nl.priority[k.priority]} ·{' '}
                {fmtDate(k.dueAt)}
                {k.description ? ` — ${k.description}` : ''}
                {k.assignee ? ` (${k.assignee.name})` : ''}
                {k.status !== 'OPEN' && <span className="muted"> · {nl.crm.tasks.done}</span>}
              </span>
              {canWrite && k.status === 'OPEN' && (
                <button
                  className="btn btn--ghost"
                  aria-label={fmt(nl.crm.tasks.completeNamed, {
                    name: k.description || nl.taskType[k.type],
                  })}
                  onClick={() => void complete(k.id)}
                >
                  {t.taskDone}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canWrite && (
        <form onSubmit={(e) => void add(e)} className="inline-form">
          <label>
            {t.taskType}
            <select value={type} onChange={(e) => setType(e.target.value)}>
              {Object.entries(nl.taskType).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t.taskPriority}
            <select value={priority} onChange={(e) => setPriority(e.target.value)}>
              {Object.entries(nl.priority).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t.taskDue}
            <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </label>
          <label className="grow">
            {t.taskDescription}
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={2000}
            />
          </label>
          <button className="btn" type="submit">
            {t.taskAdd}
          </button>
          {error && <ErrorNote message={error} />}
        </form>
      )}
    </section>
  );
}

function MergeSection({ d, onDone }: { d: Detail; onDone: () => void }) {
  const [q, setQ] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const results = useApi<ListResponse>(
    q.trim().length >= 2
      ? `/prospects?q=${encodeURIComponent(q.trim())}&pageSize=8&includeArchived=true`
      : null,
  ).data;
  async function merge(sourceId: string) {
    setError('');
    try {
      await send('POST', `/prospects/${d.id}/merge`, { sourceId });
      setMessage(t.mergeDone);
      setQ('');
      onDone();
    } catch {
      setError(nl.common.error);
    }
  }
  return (
    <section className="card" aria-labelledby="h-merge">
      <h2 id="h-merge">{t.merge}</h2>
      <p className="muted">{t.mergeHelp}</p>
      <label>
        {t.mergeSearch}
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      {error && <ErrorNote message={error} />}
      <ul className="plain">
        {(results?.items ?? [])
          .filter((r) => r.id !== d.id && r.status !== 'DUPLICATE')
          .map((r) => (
            <li key={r.id} className="taskrow">
              <span>
                {r.companyName} {r.city ? `(${r.city})` : ''}
              </span>
              <button className="btn btn--ghost" onClick={() => void merge(r.id)}>
                {fmt(t.mergeConfirm, { name: r.companyName })}
              </button>
            </li>
          ))}
      </ul>
    </section>
  );
}

function ConvertSection({ d }: { d: Detail }) {
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  async function convert(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError('');
    const allowedPlatforms = new FormData(e.currentTarget).getAll('allowedPlatforms').map(String);
    try {
      const customer = await send<{ id: string }>(
        'POST',
        `/prospects/${d.id}/convert-to-customer`,
        {
          allowedPlatforms,
        },
      );
      navigate(`/customers/${customer.id}`);
    } catch {
      setError(tc.failed);
      setSaving(false);
    }
  }
  return (
    <section className="card" aria-labelledby="h-convert">
      <h2 id="h-convert">{tc.title}</h2>
      <p className="muted">{fmt(tc.intro, { name: d.companyName })}</p>
      {error && <ErrorNote message={error} />}
      <form onSubmit={(e) => void convert(e)} className="form">
        <PlatformPicker name="allowedPlatforms" defaultValue={['LINKEDIN']} />
        <button className="btn" type="submit" disabled={saving}>
          {tc.confirm}
        </button>
      </form>
    </section>
  );
}

export function ProspectDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const canWrite = useCan('prospect.write');
  const canMerge = useCan('prospect.merge');
  const canConvert = useCan('customer.manage');
  const canPrepare = useCan('outreach.prepare');
  const canSend = useCan('outreach.send');
  const {
    data: d,
    error,
    loading,
    reload,
  } = useApi<Detail>(`/prospects/${encodeURIComponent(id)}`);
  const [editing, setEditing] = useState(false);
  usePageTitle(d?.companyName ?? t.data);
  if (loading) return <Loading />;
  if (error || !d)
    return <ErrorNote message={error?.status === 404 ? nl.errors.NOT_FOUND : nl.common.error} />;

  const rows: [string, React.ReactNode][] = [
    [
      nl.crm.form.website,
      d.website ? (
        <Link2
          url={/^https?:\/\//i.test(d.website) ? d.website : `https://${d.website}`}
          label={d.website}
        />
      ) : (
        '–'
      ),
    ],
    [nl.crm.form.city, [d.city, nl.province[d.province]].filter(Boolean).join(', ') || '–'],
    [nl.crm.form.industry, d.industry ?? '–'],
    [nl.crm.form.phone, d.phone ?? '–'],
    [nl.crm.form.contactEmail, d.contactEmail ?? '–'],
    [
      nl.crm.form.employeesMin.replace(' (minimaal)', ''),
      d.employeesMin != null || d.employeesMax != null
        ? `${d.employeesMin ?? '?'} – ${d.employeesMax ?? '?'}`
        : '–',
    ],
    [nl.crm.form.fitScore, d.fitScore ?? '–'],
    [t.owner, d.owner?.name ?? t.unassigned],
    [nl.crm.form.nextActionAt, fmtDate(d.nextActionAt)],
    [nl.crm.list.added, fmtDate(d.firstFoundAt)],
  ];

  return (
    <>
      <p>
        <Link to="/prospects">← {t.back}</Link>
      </p>
      <div className="page-head">
        <h1>{d.companyName}</h1>
        <StatusBadge status={d.status} />
      </div>

      {canWrite && (
        <section className="card" aria-labelledby="h-status">
          <h2 id="h-status">{t.status}</h2>
          <StatusPanel d={d} onDone={reload} />
          {d.status !== 'ARCHIVED' && d.allowedTransitions.includes('ARCHIVED') && (
            <button
              className="btn btn--ghost"
              onClick={() =>
                void send('POST', `/prospects/${d.id}/status`, { status: 'ARCHIVED' }).then(() =>
                  navigate('/prospects'),
                )
              }
            >
              {t.archive}
            </button>
          )}
        </section>
      )}

      <section className="card" aria-labelledby="h-data">
        <div className="page-head">
          <h2 id="h-data">{t.data}</h2>
          {canWrite && (
            <button
              className="btn btn--ghost"
              onClick={() => setEditing((e) => !e)}
              aria-expanded={editing}
            >
              {editing ? t.cancelEdit : t.edit}
            </button>
          )}
        </div>
        {editing ? (
          <ProspectForm
            prospectId={d.id}
            initial={d}
            onSaved={() => {
              setEditing(false);
              reload();
            }}
          />
        ) : (
          <>
            <dl className="dl">
              {rows.map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
            {d.fitRationale && <p className="pre">{d.fitRationale}</p>}
            {d.outreachAngle && <p className="pre">{d.outreachAngle}</p>}
            {d.notInterestedReason && <p className="pre">{d.notInterestedReason}</p>}
            {d.notes && <p className="pre">{d.notes}</p>}
          </>
        )}
      </section>

      <div className="grid-2">
        <section className="card" aria-labelledby="h-src">
          <h2 id="h-src">{t.sources}</h2>
          {d.sources.length === 0 ? (
            <p className="muted">{t.noSources}</p>
          ) : (
            <ul className="plain">
              {d.sources.map((s) => (
                <li key={s.id}>
                  <Link2 url={s.url} label={s.title} />
                  <div className="muted small">{fmt(t.checkedOn, { d: fmtDate(s.checkedAt) })}</div>
                  {s.observation && <div>{s.observation}</div>}
                </li>
              ))}
            </ul>
          )}
          {d.socials.length > 0 && (
            <>
              <h3>{t.socials}</h3>
              <ul className="plain">
                {d.socials.map((s) => (
                  <li key={s.id}>
                    {s.platform}: <Link2 url={s.url} label={s.accountName} />
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>

      <OutreachSection
        prospectId={d.id}
        contactEmail={d.contactEmail}
        drafts={d.drafts}
        emails={d.emails}
        canPrepare={canPrepare}
        canSend={canSend}
        canWrite={canWrite}
        onChange={reload}
      />

      <TasksSection d={d} onDone={reload} canWrite={canWrite} />
      <ActivitySection d={d} onDone={reload} canWrite={canWrite} />
      {canMerge && <MergeSection d={d} onDone={reload} />}
      {canConvert && d.allowedTransitions.includes('CUSTOMER') && <ConvertSection d={d} />}
    </>
  );
}
