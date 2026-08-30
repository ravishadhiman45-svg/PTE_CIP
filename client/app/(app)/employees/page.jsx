'use client';

import { useState } from 'react';
import Link from 'next/link';
import useSWR, { mutate } from 'swr';
import { Search, UserPlus, X, Download, Upload, FileSpreadsheet, CheckCircle2 } from 'lucide-react';
import { fetcher, api } from '@/lib/api';
import { PageHeader, Card, Skeleton, ErrorState, EmptyState, Avatar, Toast } from '@/components/ui';
import { useAuth } from '@/components/AuthProvider';

// Roles that can onboard people (mirrors the server-side gate).
const MANAGE_ROLES = ['admin', 'executive', 'department_head'];

// The bulk-import template is generated per user — its Manager dropdown is the
// caller's own subtree — so it comes from the API rather than /public. That also
// means it needs the auth header, which is why this is api.download and not a
// plain <a href>: a navigation cannot carry one.
//
// Offered from two places (the header button and the Bulk Add dialog), each of
// which owns its own busy/error state, so the failure shows where the user
// clicked rather than behind an open modal.
const downloadTemplate = () =>
  api.download('/employees/import-template', 'employee-import-template.xlsx');

function useTemplateDownload() {
  const [downloading, setDownloading] = useState(false);
  const [downloadErr, setDownloadErr] = useState('');

  async function download() {
    setDownloading(true);
    setDownloadErr('');
    try {
      await downloadTemplate();
    } catch (e) {
      setDownloadErr(e.message);
    } finally {
      setDownloading(false);
    }
  }

  return { download, downloading, downloadErr };
}

export default function EmployeesPage() {
  const { user } = useAuth();
  const canManage = (user?.roles || []).some((r) => MANAGE_ROLES.includes(r));

  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [showBulk, setShowBulk] = useState(false);
  const [toast, setToast] = useState('');
  const { download, downloading, downloadErr } = useTemplateDownload();

  const key = `/employees${search ? `?search=${encodeURIComponent(search)}` : ''}`;
  const { data, error, isLoading } = useSWR(key, fetcher);

  // Directory + onboarding is limited to the top-level roles.
  if (!canManage) {
    return (
      <div>
        <PageHeader title="Employees" />
        <EmptyState
          title="Restricted"
          hint="Employee management is available to admins, executives and department heads."
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Employees" subtitle="Directory and onboarding">
        <button className="btn-ghost" onClick={download} disabled={downloading}>
          <Download size={16} /> {downloading ? 'Preparing…' : 'Sample Excel'}
        </button>
        <button className="btn-ghost" onClick={() => setShowBulk(true)}>
          <Upload size={16} /> Bulk Add
        </button>
        <button className="btn-primary" onClick={() => setShowAdd(true)}>
          <UserPlus size={16} /> Add Employee
        </button>
      </PageHeader>

      {downloadErr ? <p className="mb-3 text-xs text-bad">{downloadErr}</p> : null}

      <div className="relative mb-4 max-w-md">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
        <input className="input pl-9" placeholder="Search employees…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <Card className="overflow-x-auto p-0">
        {error ? (
          <div className="p-5"><ErrorState error={error} /></div>
        ) : isLoading || !data ? (
          <div className="space-y-2 p-5">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : data.length ? (
          <table className="w-full min-w-[640px]">
            <thead className="border-b border-line">
              <tr>
                <th className="th">Employee</th>
                <th className="th">Title</th>
                <th className="th">Email</th>
                <th className="th">Job Role</th>
                <th className="th">Department</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.map((e) => (
                <tr key={e.id} className="hover:bg-ink-700/40">
                  <td className="td">
                    <div className="flex items-center gap-2">
                      <Avatar name={e.full_name} src={e.photo_url} size={30} />
                      <Link href={`/employees/${e.id}`} className="font-medium text-white hover:text-accent-soft">
                        {e.full_name}
                      </Link>
                    </div>
                  </td>
                  <td className="td text-slate-400">{e.org_title || '—'}</td>
                  <td className="td text-slate-400">{e.email}</td>
                  <td className="td text-slate-400">{e.job_role || '—'}</td>
                  <td className="td text-slate-400">{e.department || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="p-5"><EmptyState title="No employees match your search" /></div>
        )}
      </Card>

      {showAdd ? (
        <AddEmployeeModal
          onClose={() => setShowAdd(false)}
          onCreated={() => {
            setShowAdd(false);
            mutate(key);
          }}
        />
      ) : null}

      {showBulk ? (
        <BulkAddModal
          onClose={() => setShowBulk(false)}
          onImported={(count) => {
            setShowBulk(false);
            setToast(`${count} employee${count === 1 ? '' : 's'} added`);
            mutate(key);
          }}
        />
      ) : null}

      {toast ? <Toast message={toast} onDone={() => setToast('')} /> : null}
    </div>
  );
}

// Bulk onboarding: pick the filled-in template, upload, and — when the server
// refuses it — show exactly which spreadsheet rows are wrong.
//
// The import is all-or-nothing on the server, so a failure here always means
// nothing was written. That is worth saying plainly on screen: the admin's next
// move is to fix the file and re-upload the whole thing, not to work out which
// rows already made it in.
function BulkAddModal({ onClose, onImported }) {
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [rowErrors, setRowErrors] = useState([]);
  const { download, downloading, downloadErr } = useTemplateDownload();

  function pick(e) {
    const picked = e.target.files && e.target.files[0];
    // Clearing the input is what makes the FIX-AND-RETRY loop work: a file input
    // fires change only when its value actually changes, so re-picking the same
    // path — which is exactly what happens after correcting the rows this dialog
    // just listed — would otherwise do nothing and re-upload the stale pick.
    e.target.value = '';
    if (!picked) return;
    setFile(picked);
    setErr('');
    setRowErrors([]);
  }

  async function upload() {
    if (!file) return;
    setBusy(true);
    setErr('');
    setRowErrors([]);
    try {
      const form = new FormData();
      form.append('file', file);
      const result = await api.upload('/employees/bulk', form);
      onImported(result.created);
    } catch (e) {
      setErr(e.message);
      // The 400 body carries a per-row breakdown; api.js only lifts `error` onto
      // the Error, so read the rest off the response it attached.
      setRowErrors((e.body && e.body.rows) || []);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <Card>
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-base font-semibold text-white">Bulk Add Employees</h3>
            <button onClick={onClose} className="text-slate-500 hover:text-white"><X size={18} /></button>
          </div>

          <ol className="mb-4 space-y-1.5 text-sm text-slate-400">
            <li>
              1. Download the{' '}
              <button
                className="text-accent-soft underline hover:text-white disabled:opacity-60"
                onClick={download}
                disabled={downloading}
              >
                {downloading ? 'preparing the template…' : 'sample Excel template'}
              </button>
              . Its dropdowns already list your departments, teams, job roles and managers.
            </li>
            <li>2. Fill in one row per person. Columns marked <span className="text-white">*</span> are required.</li>
            <li>3. Upload it here. Either every row is added or none is — so a rejected file leaves the directory untouched.</li>
          </ol>

          <div className="rounded-lg border border-dashed border-line p-5 text-center">
            <FileSpreadsheet size={28} className="mx-auto mb-2 text-slate-500" />
            <label className="btn-ghost cursor-pointer">
              {file ? 'Choose a different file' : 'Choose .xlsx file'}
              <input
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="hidden"
                onChange={pick}
              />
            </label>
            <p className="mt-2 text-xs text-slate-500">
              {file ? (
                <span className="inline-flex items-center gap-1 text-slate-300">
                  <CheckCircle2 size={13} className="text-good" /> {file.name}
                </span>
              ) : (
                'Excel workbook (.xlsx) · up to 5 MB · max 500 rows'
              )}
            </p>
          </div>

          {err || downloadErr ? <p className="mt-3 text-xs text-bad">{err || downloadErr}</p> : null}

          {rowErrors.length ? (
            <div className="mt-3 max-h-64 overflow-y-auto rounded-lg border border-line">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-ink-700">
                  <tr>
                    <th className="th">Row</th>
                    <th className="th">Employee</th>
                    <th className="th">What to fix</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rowErrors.map((r) => (
                    <tr key={r.row}>
                      <td className="td font-mono text-slate-400">{r.row}</td>
                      <td className="td text-slate-300">{r.name}</td>
                      <td className="td text-bad">
                        {r.problems.map((p, i) => <div key={i}>{p}</div>)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          <div className="mt-4 flex justify-end gap-2">
            <button className="btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn-primary" onClick={upload} disabled={busy || !file}>
              {busy ? 'Importing…' : 'Upload & Add'}
            </button>
          </div>
        </Card>
      </div>
    </div>
  );
}

function AddEmployeeModal({ onClose, onCreated }) {
  const { data: options } = useSWR('/employees/form-options', fetcher);
  const [form, setForm] = useState({
    employee_code: '',
    full_name: '',
    email: '',
    gender: 'Not Specified',
    grade: '',
    joining_date: '',
    department_id: '',
    team_id: '',
    job_role_id: '',
    manager_id: '',
    location_id: '',
    org_title: '',
    create_login: true,
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  // Teams filtered to the selected department (falls back to all).
  const teams = (options?.teams || []).filter(
    (t) => !form.department_id || t.department_id === form.department_id
  );

  async function save() {
    setSaving(true);
    setErr('');
    try {
      await api.post('/employees', form);
      onCreated();
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <Card>
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-base font-semibold text-white">Add Employee</h3>
            <button onClick={onClose} className="text-slate-500 hover:text-white"><X size={18} /></button>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Employee Code *">
              <input className="input" placeholder="PTE0021" value={form.employee_code} onChange={set('employee_code')} />
            </Field>
            <Field label="Full Name *">
              <input className="input" placeholder="Priya Nair" value={form.full_name} onChange={set('full_name')} />
            </Field>
            <Field label="Email *">
              <input className="input" placeholder="priya.nair@ptecip.local" value={form.email} onChange={set('email')} />
            </Field>
            <Field label="Gender">
              <select className="input" value={form.gender} onChange={set('gender')}>
                {['Not Specified', 'Male', 'Female', 'Other'].map((g) => <option key={g}>{g}</option>)}
              </select>
            </Field>
            <Field label="Grade">
              <input className="input" placeholder="AM / DM / Manager" value={form.grade} onChange={set('grade')} />
            </Field>
            <Field label="Joining Date">
              <input className="input" style={{ colorScheme: 'dark' }} type="date" value={form.joining_date} onChange={set('joining_date')} />
            </Field>
            <Field label="Department">
              <select className="input" value={form.department_id} onChange={(e) => setForm({ ...form, department_id: e.target.value, team_id: '' })}>
                <option value="">Select…</option>
                {(options?.departments || []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </Field>
            <Field label="Team">
              <select className="input" value={form.team_id} onChange={set('team_id')}>
                <option value="">Select…</option>
                {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </Field>
            <Field label="Job Role">
              <select className="input" value={form.job_role_id} onChange={set('job_role_id')}>
                <option value="">Select…</option>
                {(options?.jobRoles || []).map((r) => <option key={r.id} value={r.id}>{r.role_name}</option>)}
              </select>
            </Field>
            {/* Required, and limited to your own subtree: everyone reports to
                someone, and you can only place a hire under yourself or below. */}
            <Field label="Manager *">
              <select className="input" value={form.manager_id} onChange={set('manager_id')}>
                <option value="">Select…</option>
                {(options?.managers || []).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.org_title ? `${m.full_name} — ${m.org_title}` : m.full_name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Hierarchy Title">
              <select className="input" value={form.org_title} onChange={set('org_title')}>
                <option value="">Select…</option>
                {(options?.orgTitles || []).map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Location">
              <select className="input" value={form.location_id} onChange={set('location_id')}>
                <option value="">Select…</option>
                {(options?.locations || []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </Field>
          </div>

          <label className="mt-3 flex items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={form.create_login}
              onChange={(e) => setForm({ ...form, create_login: e.target.checked })}
            />
            Create a login account (Employee persona) for this person
          </label>

          {err ? <p className="mt-3 text-xs text-bad">{err}</p> : null}

          <div className="mt-4 flex justify-end gap-2">
            <button className="btn-ghost" onClick={onClose}>Cancel</button>
            <button
              className="btn-primary"
              onClick={save}
              disabled={saving || !form.employee_code || !form.full_name || !form.email || !form.manager_id}
            >
              {saving ? 'Saving…' : 'Create Employee'}
            </button>
          </div>
        </Card>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-slate-400">{label}</label>
      {children}
    </div>
  );
}
