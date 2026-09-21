import { useState } from 'react';
import { Link } from 'react-router-dom';
import { nl } from '../../shared/i18n/nl';
import { send } from '../api';
import { ErrorNote, Loading } from '../components';
import { fmt, fmtDate, useApi, usePageTitle, type UserRef } from '../lib';
import { useCan } from '../me';

const t = nl.crm.tasks;

interface TaskRow {
  id: string;
  type: keyof typeof nl.taskType;
  priority: keyof typeof nl.priority;
  status: string;
  dueAt: string | null;
  dueSoon: boolean;
  description: string | null;
  prospect: { id: string; companyName: string } | null;
  assignee: UserRef | null;
}

export function TasksPage() {
  const [mine, setMine] = useState(true);
  const [status, setStatus] = useState<'OPEN' | 'DONE'>('OPEN');
  const canWrite = useCan('prospect.write');
  const [failed, setFailed] = useState(false);
  usePageTitle(t.title);
  const { data, error, loading, reload } = useApi<{ tasks: TaskRow[] }>(
    `/tasks?status=${status}${mine ? '&mine=true' : ''}`,
  );

  async function complete(id: string) {
    setFailed(false);
    try {
      await send('PATCH', `/tasks/${id}`, { status: 'DONE' });
      reload();
    } catch {
      setFailed(true);
    }
  }

  return (
    <>
      <h1>{t.title}</h1>
      <div className="card filters__row">
        <label className="check">
          <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />
          {t.mine}
        </label>
        <label>
          <span className="sr-only">{t.status}</span>
          <select value={status} onChange={(e) => setStatus(e.target.value as 'OPEN' | 'DONE')}>
            <option value="OPEN">{t.open}</option>
            <option value="DONE">{t.done}</option>
          </select>
        </label>
      </div>
      {failed && <ErrorNote message={t.error} />}
      {loading && <Loading />}
      {error && <ErrorNote message={nl.common.error} />}
      {data && data.tasks.length === 0 && <p className="card">{t.empty}</p>}
      {data && data.tasks.length > 0 && (
        <ul className="cards">
          {data.tasks.map((k) => (
            <li key={k.id} className={`card taskcard ${k.dueSoon ? 'row--today' : ''}`}>
              <div>
                <strong>{nl.taskType[k.type]}</strong> · {nl.priority[k.priority]}
                {k.dueSoon && <span className="flag flag--today">{nl.crm.list.flagToday}</span>}
                <div>{k.description}</div>
                {k.prospect && (
                  <div>
                    {t.prospect}:{' '}
                    <Link to={`/prospects/${k.prospect.id}`}>{k.prospect.companyName}</Link>
                  </div>
                )}
                <div className="muted small">
                  {t.due}: {fmtDate(k.dueAt)} · {t.assignee}: {k.assignee?.name ?? '–'}
                </div>
              </div>
              {canWrite && k.status === 'OPEN' && (
                <button
                  className="btn btn--ghost"
                  aria-label={fmt(t.completeNamed, { name: k.description || nl.taskType[k.type] })}
                  onClick={() => void complete(k.id)}
                >
                  {t.complete}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
