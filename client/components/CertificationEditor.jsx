'use client';

import { useRef, useState } from 'react';
import useSWR from 'swr';
import { Paperclip, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { api, fetcher } from '@/lib/api';
import { ConfirmDialog } from '@/components/ui';
import { formatDate } from '@/lib/ui';

// Add / edit / delete the certificates on a profile. Each row saves on its own.
//
// Deliberately a sibling of ListEditor (ProfileEditModal.jsx) rather than an
// extension of it. ListEditor's contract is "build one JSON payload from the
// field list and PUT/POST it", and two things here break that at once: picking a
// catalogue certificate changes what the title field does, and the evidence file
// needs a second request that can only run once the row has an id — so a save
// has a partial-success state ("details saved, file did not upload") that
// ListEditor's single-request save() has no way to express. The row lifecycle
// below is the same proven shape, copied on purpose.
const CERT_FIELDS = [
  { key: 'title_text', label: 'Certificate title *', placeholder: 'AWS Certified Solutions Architect' },
  { key: 'issuer', label: 'Issuer / provider', placeholder: 'Amazon Web Services' },
  { key: 'technology', label: 'Technology / domain', placeholder: 'Cloud Architecture' },
  { key: 'institution', label: 'Where you did it', placeholder: 'Coursera' },
  { key: 'issued_date', label: 'Issued on', type: 'date' },
  { key: 'expiry_date', label: 'Valid until (blank = no expiry)', type: 'date' },
  { key: 'credential_id', label: 'Credential ID', placeholder: 'AWS-PSXX-1234' },
  { key: 'credential_url', label: 'Credential URL', placeholder: 'https://…' },
  { key: 'hours', label: 'Hours', type: 'number', placeholder: '40' },
  { key: 'notes', label: 'Notes', type: 'textarea', full: true },
];

export default function CertificationEditor({ employeeId, items, onChanged, notify }) {
  const basePath = `/employees/${employeeId}/certifications`;
  const counter = useRef(0);
  const [rows, setRows] = useState(() => items.map((it) => ({ ...it, _key: `saved-${it.id}` })));
  const [busyKey, setBusyKey] = useState(null);
  // The row waiting on a delete confirmation, and separately the one whose
  // attached file is being removed — two different destructive actions.
  const [pending, setPending] = useState(null);
  const [pendingFile, setPendingFile] = useState(null);
  const [err, setErr] = useState('');

  // Only fetched once this editor mounts, i.e. when someone clicks Manage.
  const { data: catalog = [] } = useSWR('/certifications/catalog', fetcher);

  function addRow() {
    counter.current += 1;
    setRows((prev) => [...prev, { _key: `new-${counter.current}`, source: 'Self' }]);
  }

  function edit(key, fieldKey, value) {
    setRows((prev) => prev.map((r) => (r._key === key ? { ...r, [fieldKey]: value } : r)));
  }

  // Picking a catalogue entry is not a plain field: it decides whether the typed
  // title is used at all, so the input is disabled and shows the catalogue title.
  function pickCatalog(key, certificationId) {
    const picked = catalog.find((c) => c.id === certificationId);
    setRows((prev) =>
      prev.map((r) =>
        r._key === key
          ? { ...r, certification_id: certificationId || null, title: picked ? picked.title : r.title }
          : r
      )
    );
  }

  function stageFile(key, file) {
    if (!file) return;
    setErr('');
    setRows((prev) => prev.map((r) => (r._key === key ? { ...r, _file: file } : r)));
  }

  async function save(row) {
    if (!row.certification_id && !String(row.title_text || '').trim()) {
      setErr('Pick a certificate from the catalogue, or type a title');
      return;
    }
    // Captured before the await: the row is replaced by the server copy below,
    // which always has an id, so afterwards there is no telling the two apart.
    const isNew = !row.id;
    setBusyKey(row._key);
    setErr('');
    try {
      const payload = {};
      CERT_FIELDS.forEach((f) => {
        const raw = row[f.key];
        if (f.type === 'number') payload[f.key] = raw === '' || raw == null ? null : Number(raw);
        else payload[f.key] = raw === '' ? null : raw ?? null;
      });
      payload.certification_id = row.certification_id || null;

      let result = row.id ? await api.put(`${basePath}/${row.id}`, payload) : await api.post(basePath, payload);

      // The file needs the row's id, so it can only go up once the row exists.
      // If storage is not configured this throws a 503 — the details are already
      // saved at that point, so say so rather than making the whole save look
      // like it failed.
      if (row._file) {
        try {
          const form = new FormData();
          form.append('file', row._file);
          result = await api.upload(`${basePath}/${result.id}/evidence`, form);
        } catch (e) {
          setErr(`Details saved, but the certificate file did not upload — ${e.message}`);
        }
      }

      setRows((prev) =>
        prev.map((r) => (r._key === row._key ? { ...result, _key: `saved-${result.id}` } : r))
      );
      notify(`Certificate ${isNew ? 'added' : 'saved'}`);
      onChanged();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusyKey(null);
    }
  }

  // A row that was never saved has nothing to delete server-side, so it just
  // disappears — no point asking about it.
  function askRemove(row) {
    if (!row.id) {
      setRows((prev) => prev.filter((r) => r._key !== row._key));
      return;
    }
    setErr('');
    setPending(row);
  }

  async function confirmRemove() {
    const row = pending;
    if (!row) return;
    setBusyKey(row._key);
    setErr('');
    try {
      await api.del(`${basePath}/${row.id}`);
      setRows((prev) => prev.filter((r) => r._key !== row._key));
      setPending(null);
      notify('Certificate deleted');
      onChanged();
    } catch (e) {
      // Close the dialog so the inline error underneath is actually readable.
      setPending(null);
      setErr(e.message);
    } finally {
      setBusyKey(null);
    }
  }

  async function confirmRemoveFile() {
    const row = pendingFile;
    if (!row) return;
    setBusyKey(row._key);
    setErr('');
    try {
      const result = await api.del(`${basePath}/${row.id}/evidence`);
      setRows((prev) =>
        prev.map((r) => (r._key === row._key ? { ...result, _key: r._key, _file: null } : r))
      );
      setPendingFile(null);
      notify('Certificate file removed');
      onChanged();
    } catch (e) {
      setPendingFile(null);
      setErr(e.message);
    } finally {
      setBusyKey(null);
    }
  }

  const pendingLabel = pending ? String(pending.title || pending.title_text || '').trim() : '';

  return (
    <div className="space-y-3">
      {/* Certificate edits do not reset profile verification — see the note on
          the certification routes in server/src/routes/employees.js. */}
      <p className="rounded-lg border border-line bg-ink-900 p-3 text-xs text-slate-400">
        Certificates you add here appear on your CV, marked <span className="text-slate-300">Self-Reported</span>{' '}
        until the organisation issues them through the approvals flow. Your profile stays verified.
      </p>

      {rows.map((row) =>
        // Issued through the approvals flow — shown so the list stays complete,
        // but not editable here. The API refuses these too; this is so nobody
        // has to discover that by hitting a 409.
        row.source === 'Catalog' ? (
          <div key={row._key} className="rounded-lg border border-line bg-ink-900 p-3">
            <div className="flex items-center gap-2">
              <ShieldCheck size={14} className="shrink-0 text-good" />
              <p className="text-sm font-medium text-white">{row.title}</p>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {[
                row.status,
                row.issued_date ? `Issued ${formatDate(row.issued_date)}` : null,
                row.approved_by ? `Approved by ${row.approved_by}` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
            <p className="mt-1 text-xs text-slate-600">
              Issued through the organisation — changes go through the approvals flow.
            </p>
          </div>
        ) : (
          <div key={row._key} className="rounded-lg border border-line bg-ink-900 p-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Labeled label="Company catalogue" className="sm:col-span-2">
                <select
                  className="input"
                  value={row.certification_id || ''}
                  onChange={(e) => pickCatalog(row._key, e.target.value)}
                >
                  <option value="">Not in the catalogue — type the details below</option>
                  {catalog.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                </select>
              </Labeled>

              {CERT_FIELDS.map((f) => {
                // A catalogue pick supplies the title, so typing one as well
                // would only create two names for the same certificate.
                const lockedTitle = f.key === 'title_text' && Boolean(row.certification_id);
                return (
                  <Labeled key={f.key} label={f.label} className={f.full ? 'sm:col-span-2' : ''}>
                    {f.type === 'textarea' ? (
                      <textarea
                        className="input"
                        rows={2}
                        placeholder={f.placeholder}
                        value={row[f.key] || ''}
                        onChange={(e) => edit(row._key, f.key, e.target.value)}
                      />
                    ) : (
                      <input
                        className="input"
                        type={f.type || 'text'}
                        style={f.type === 'date' ? { colorScheme: 'dark' } : undefined}
                        placeholder={f.placeholder}
                        disabled={lockedTitle}
                        value={lockedTitle ? row.title || '' : row[f.key] ?? ''}
                        onChange={(e) => edit(row._key, f.key, e.target.value)}
                      />
                    )}
                  </Labeled>
                );
              })}
            </div>

            <div className="mt-3 border-t border-line pt-3">
              <label className="btn-ghost cursor-pointer">
                <Paperclip size={14} />
                {row._file
                  ? row._file.name
                  : row.evidence_file_url
                    ? 'Replace certificate'
                    : 'Attach certificate'}
                <input
                  type="file"
                  accept="application/pdf,image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => stageFile(row._key, e.target.files && e.target.files[0])}
                />
              </label>
              <p className="mt-1.5 text-xs text-slate-500">PDF, PNG, JPG or WEBP · up to 10 MB</p>
              {row.evidence_file_url ? (
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <a
                    href={row.evidence_file_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-accent-soft hover:underline"
                  >
                    View attached file
                  </a>
                  <button
                    className="btn-ghost text-bad"
                    onClick={() => setPendingFile(row)}
                    disabled={busyKey === row._key}
                  >
                    <Trash2 size={14} /> Remove file
                  </button>
                </div>
              ) : null}
            </div>

            <div className="mt-3 flex items-center justify-end gap-2">
              <button
                className="btn-ghost text-bad"
                onClick={() => askRemove(row)}
                disabled={busyKey === row._key}
              >
                <Trash2 size={14} /> Remove
              </button>
              <button className="btn-primary" onClick={() => save(row)} disabled={busyKey === row._key}>
                {busyKey === row._key ? 'Saving…' : row.id ? 'Save' : 'Add'}
              </button>
            </div>
          </div>
        )
      )}

      {rows.length === 0 ? <p className="text-sm text-slate-500">No certificates added yet.</p> : null}
      {err ? <p className="text-xs text-bad">{err}</p> : null}

      <button className="btn-ghost" onClick={addRow}>
        <Plus size={14} /> Add Certificate
      </button>

      <ConfirmDialog
        open={Boolean(pending)}
        title="Delete this certificate?"
        message={
          pendingLabel
            ? `“${pendingLabel}” will be permanently removed from your profile, along with any certificate file attached to it.`
            : 'This certificate will be permanently removed from your profile, along with any file attached to it.'
        }
        confirmLabel="Delete"
        busyLabel="Deleting…"
        busy={Boolean(pending) && busyKey === pending._key}
        onConfirm={confirmRemove}
        onCancel={() => setPending(null)}
      />

      <ConfirmDialog
        open={Boolean(pendingFile)}
        title="Remove the attached file?"
        message="The certificate stays on your profile — only the uploaded file is deleted."
        confirmLabel="Remove file"
        busyLabel="Removing…"
        busy={Boolean(pendingFile) && busyKey === pendingFile._key}
        onConfirm={confirmRemoveFile}
        onCancel={() => setPendingFile(null)}
      />
    </div>
  );
}

// Copied from ProfileEditModal rather than exported from it: promoting the two
// shared helpers into ui.jsx is worth doing, but not as a side effect of this.
function Labeled({ label, className = '', children }) {
  return (
    <div className={className}>
      <label className="mb-1.5 block text-xs font-medium text-slate-400">{label}</label>
      {children}
    </div>
  );
}
