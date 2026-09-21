import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { nl } from '../../shared/i18n/nl';
import { BASE, send } from '../api';
import { ErrorNote, Flags, Loading, StatusBadge } from '../components';
import {
  fmt,
  fmtDate,
  useAnnounce,
  useApi,
  usePageTitle,
  type ListResponse,
  type UserRef,
} from '../lib';
import { useCan } from '../me';

const t = nl.crm.list;
const SORTS: [string, string][] = [
  ['createdAt', t.added],
  ['companyName', t.company],
  ['nextActionAt', t.nextAction],
  ['fitScore', t.score],
  ['status', t.status],
  ['city', t.city],
];

export function ProspectsPage() {
  const [params, setParams] = useSearchParams();
  const canWrite = useCan('prospect.write');
  const canExport = useCan('prospect.export');
  const query = params.toString();
  const { data, error, loading, reload } = useApi<ListResponse>(`/prospects?${query}`);
  const users = useApi<{ users: UserRef[] }>('/users').data?.users ?? [];
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOwner, setBulkOwner] = useState('');
  const [bulkDate, setBulkDate] = useState('');
  const [message, setMessage] = useState('');
  const [bulkError, setBulkError] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const announce = useAnnounce();
  const refocusSearch = useRef(false);
  usePageTitle(t.title);

  // Na 'Toepassen' wordt het formulier opnieuw opgebouwd; zet de focus terug op het zoekveld (WCAG 2.4.3).
  useEffect(() => {
    if (refocusSearch.current) {
      refocusSearch.current = false;
      document.getElementById('prospect-search')?.focus();
    }
  }, [query]);

  useEffect(() => {
    if (data) announce(fmt(t.total, { n: data.total }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.total, query]);

  function applyFilters(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const next = new URLSearchParams();
    for (const [k, v] of fd.entries()) if (typeof v === 'string' && v.trim()) next.set(k, v.trim());
    setSelected(new Set());
    refocusSearch.current = true;
    setParams(next);
  }
  function setPage(p: number) {
    const next = new URLSearchParams(params);
    next.set('page', String(p));
    setParams(next);
  }
  function toggle(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  async function bulk(kind: 'assign' | 'next-action') {
    setBulkError('');
    setMessage('');
    try {
      const ids = [...selected];
      const body =
        kind === 'assign'
          ? { ids, ownerId: bulkOwner || null }
          : { ids, nextActionAt: bulkDate || null };
      const res = await send<{ updated: number }>('POST', `/prospects/bulk/${kind}`, body);
      setMessage(fmt(t.bulkApplied, { n: res.updated }));
      announce(fmt(t.bulkApplied, { n: res.updated }));
      setSelected(new Set());
      reload();
    } catch {
      setBulkError(nl.common.error);
    }
  }

  const items = data?.items ?? [];
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const allOnPage = items.length > 0 && items.every((i) => selected.has(i.id));
  const exportHref = `${BASE}/api/prospects/export.csv?${query.replace(/(^|&)page=\d+/, '')}`;

  return (
    <>
      <div className="page-head">
        <h1>{t.title}</h1>
        {canWrite && (
          <Link className="btn" to="/prospects/new">
            {t.add}
          </Link>
        )}
      </div>

      <form className="card filters" onSubmit={applyFilters} key={query} role="search">
        <div className="filters__row">
          <label className="grow">
            <span className="sr-only">{t.search}</span>
            <input
              id="prospect-search"
              type="search"
              name="q"
              defaultValue={params.get('q') ?? ''}
              placeholder={t.search}
            />
          </label>
          <button
            type="button"
            className="btn btn--ghost filters__toggle"
            aria-expanded={filtersOpen}
            aria-controls="filter-panel"
            onClick={() => setFiltersOpen((o) => !o)}
          >
            {t.filters}
          </button>
          <button className="btn" type="submit" aria-label={t.filtersApply}>
            {t.apply}
          </button>
        </div>
        <div id="filter-panel" className={`filters__panel ${filtersOpen ? 'is-open' : ''}`}>
          <label>
            {t.status}
            <select name="status" defaultValue={params.get('status') ?? ''}>
              <option value="">{t.any}</option>
              {Object.entries(nl.status).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t.owner}
            <select name="ownerId" defaultValue={params.get('ownerId') ?? ''}>
              <option value="">{t.any}</option>
              <option value="none">{t.ownerNone}</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t.province}
            <select name="province" defaultValue={params.get('province') ?? ''}>
              <option value="">{t.any}</option>
              {Object.entries(nl.province).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t.city}
            <input name="city" defaultValue={params.get('city') ?? ''} />
          </label>
          <label>
            {t.industry}
            <input name="industry" defaultValue={params.get('industry') ?? ''} />
          </label>
          <label>
            {t.due}
            <select name="due" defaultValue={params.get('due') ?? ''}>
              <option value="">{t.any}</option>
              <option value="today">{t.dueToday}</option>
              <option value="overdue">{t.dueOverdue}</option>
            </select>
          </label>
          <label>
            {t.outreach}
            <select name="hasOutreach" defaultValue={params.get('hasOutreach') ?? ''}>
              <option value="">{t.any}</option>
              <option value="true">{t.outreachYes}</option>
              <option value="false">{t.outreachNo}</option>
            </select>
          </label>
          <label>
            {t.minScore}
            <input
              name="minScore"
              type="number"
              min={0}
              max={100}
              inputMode="numeric"
              defaultValue={params.get('minScore') ?? ''}
            />
          </label>
          <label>
            {t.sort}
            <select name="sort" defaultValue={params.get('sort') ?? 'createdAt'}>
              {SORTS.map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t.direction}
            <select name="dir" defaultValue={params.get('dir') ?? 'desc'}>
              <option value="desc">{t.sortDesc}</option>
              <option value="asc">{t.sortAsc}</option>
            </select>
          </label>
          <label className="check">
            <input
              type="checkbox"
              name="includeArchived"
              value="true"
              defaultChecked={params.get('includeArchived') === 'true'}
            />
            {t.includeArchived}
          </label>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => setParams(new URLSearchParams())}
          >
            {t.reset}
          </button>
        </div>
      </form>

      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      {bulkError && <ErrorNote message={bulkError} />}

      {canWrite && selected.size > 0 && (
        <div
          className="card bulkbar"
          role="region"
          aria-label={fmt(t.selected, { n: selected.size })}
        >
          <strong role="status">{fmt(t.selected, { n: selected.size })}</strong>
          <label>
            {t.bulkAssign}
            <select value={bulkOwner} onChange={(e) => setBulkOwner(e.target.value)}>
              <option value="">{t.ownerNone}</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
          <button
            className="btn"
            aria-label={t.bulkAssignApply}
            onClick={() => void bulk('assign')}
          >
            {t.apply}
          </button>
          <label>
            {t.bulkDate}
            <input type="date" value={bulkDate} onChange={(e) => setBulkDate(e.target.value)} />
          </label>
          <button
            className="btn"
            aria-label={t.bulkDateApply}
            onClick={() => void bulk('next-action')}
          >
            {t.apply}
          </button>
        </div>
      )}

      {loading && <Loading />}
      {error && <ErrorNote message={nl.common.error} />}
      {data && (
        <>
          <p className="muted result-count">
            {fmt(t.total, { n: data.total })}
            {canExport && (
              <>
                {' · '}
                <a href={exportHref}>{t.export}</a>
              </>
            )}
          </p>
          {items.length === 0 ? (
            <p className="card">{t.empty}</p>
          ) : (
            <>
              {canWrite && (
                <label className="check select-all">
                  <input
                    type="checkbox"
                    checked={allOnPage}
                    onChange={() =>
                      setSelected(allOnPage ? new Set() : new Set(items.map((i) => i.id)))
                    }
                  />
                  {t.selectAll}
                </label>
              )}
              <table className="dtable" role="table">
                <thead role="rowgroup">
                  <tr role="row">
                    {canWrite && (
                      <th scope="col" role="columnheader" className="col-check">
                        <span className="sr-only">{t.selectionColumn}</span>
                      </th>
                    )}
                    <th scope="col" role="columnheader">
                      {t.company}
                    </th>
                    <th scope="col" role="columnheader">
                      {t.status}
                    </th>
                    <th scope="col" role="columnheader">
                      {t.score}
                    </th>
                    <th scope="col" role="columnheader">
                      {t.owner}
                    </th>
                    <th scope="col" role="columnheader">
                      {t.nextAction}
                    </th>
                  </tr>
                </thead>
                <tbody role="rowgroup">
                  {items.map((p) => (
                    <tr
                      role="row"
                      key={p.id}
                      className={[
                        p.flags.blocked && 'row--blocked',
                        p.flags.overdue && 'row--overdue',
                        p.flags.dueToday && 'row--today',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      {canWrite && (
                        <td role="cell" className="col-check">
                          <input
                            type="checkbox"
                            aria-label={fmt(t.selectRow, { name: p.companyName })}
                            checked={selected.has(p.id)}
                            onChange={() => toggle(p.id)}
                          />
                        </td>
                      )}
                      <td role="cell" className="cell-main">
                        <Link to={`/prospects/${p.id}`} className="rowlink">
                          {p.companyName}
                        </Link>
                        <div className="muted small">
                          {[p.city, p.industry].filter(Boolean).join(' · ')}
                        </div>
                        <Flags flags={p.flags} />
                      </td>
                      <td role="cell" data-label={t.status}>
                        <StatusBadge status={p.status} />
                      </td>
                      <td role="cell" data-label={t.score}>
                        {p.fitScore ?? '–'}
                      </td>
                      <td role="cell" data-label={t.owner}>
                        {p.owner?.name ?? '–'}
                      </td>
                      <td role="cell" data-label={t.nextAction}>
                        {fmtDate(p.nextActionAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          <nav className="pager" aria-label={t.pagination}>
            <button
              className="btn btn--ghost"
              aria-disabled={data.page <= 1}
              onClick={() => data.page > 1 && setPage(data.page - 1)}
            >
              {t.prev}
            </button>
            <span>{fmt(t.page, { p: data.page, t: pages })}</span>
            <button
              className="btn btn--ghost"
              aria-disabled={data.page >= pages}
              onClick={() => data.page < pages && setPage(data.page + 1)}
            >
              {t.next}
            </button>
          </nav>
        </>
      )}
    </>
  );
}
