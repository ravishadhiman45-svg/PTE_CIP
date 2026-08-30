'use client';

import { useRef, useState } from 'react';
import {
  Award,
  BadgeCheck,
  BookOpen,
  Clock,
  ExternalLink,
  FileText,
  GraduationCap,
  Layers,
  Pencil,
  ShieldCheck,
  TrendingUp,
  Users,
  X,
} from 'lucide-react';
import { Badge, Card, EmptyState, ProgressBar, Toast } from '@/components/ui';
import { formatDate, statusClasses } from '@/lib/ui';
import CertificationEditor from '@/components/CertificationEditor';

// Learning Journey — the record of what this person has done.
//
// The counterpart to the Learning Module page: that one is the work in hand
// (tick modules, plan what is next), this one is the story it leaves behind —
// certificates earned, courses finished, skills that moved, mentoring taken.
// Anything that changes state lives there; everything here is retrospective,
// except the certificate list, which is the one record only the person can keep.

const TIMELINE_KINDS = {
  course: { label: 'Course completed', dot: 'bg-accent-soft', ring: 'ring-accent-soft/30', Icon: GraduationCap },
  certification: { label: 'Certification earned', dot: 'bg-good', ring: 'ring-good/30', Icon: BadgeCheck },
  skill: { label: 'Skill level up', dot: 'bg-warn', ring: 'ring-warn/30', Icon: TrendingUp },
  mentoring: { label: 'Mentoring session', dot: 'bg-slate-500', ring: 'ring-slate-500/30', Icon: Users },
};

// Anything lapsing within this many days is worth flagging before it does.
const EXPIRY_WINDOW_DAYS = 90;

// Days until expiry, from the 'YYYY-MM-DD' string the API sends. Both sides are
// parsed as UTC midnight so a browser east or west of the server never shifts a
// certificate a day either way.
function daysUntil(dateStr) {
  if (!dateStr) return null;
  const then = Date.parse(`${String(dateStr).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(then)) return null;
  const today = new Date();
  const now = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((then - now) / 86400000);
}

function expiryLabel(days) {
  if (days < 0) return `Expired ${Math.abs(days)}d ago`;
  if (days === 0) return 'Expires today';
  return `${days}d left`;
}

// What kind of file is attached, from the stored url. The upload route only
// accepts PDF/PNG/JPG/WEBP, so the extension is enough — no need to carry a
// mime type through the payload just to pick an icon.
function evidenceKind(url) {
  if (!url) return null;
  const clean = String(url).split('?')[0].toLowerCase();
  if (/\.(png|jpe?g|webp)$/.test(clean)) return 'image';
  if (/\.pdf$/.test(clean)) return 'pdf';
  return 'file';
}

export default function LearningJourneyTab({
  employeeId,
  canEdit,
  stats,
  timeline,
  enrollments,
  certifications,
  onChanged,
}) {
  const [editing, setEditing] = useState(false);
  const [preview, setPreview] = useState(null); // the certificate being viewed large
  // Keyed by id so the same message twice running restarts the popup.
  const [toast, setToast] = useState(null);
  const toastId = useRef(0);

  function notify(text) {
    toastId.current += 1;
    setToast({ id: toastId.current, text });
  }

  const expiring = certifications
    .map((c) => ({ ...c, days: daysUntil(c.expiry_date) }))
    .filter((c) => c.days !== null && c.days <= EXPIRY_WINDOW_DAYS)
    .sort((a, b) => a.days - b.days);

  // Certificate hours are self-entered and courses carry their own duration;
  // both count towards the same total.
  const certHours = certifications.reduce((sum, c) => sum + (Number(c.hours) || 0), 0);
  const totalHours = Math.round((Number(stats.course_hours) || 0) + certHours);
  const orgIssued = certifications.filter((c) => c.source === 'Catalog').length;

  return (
    <div className="space-y-6">
      <StatsStrip
        stats={stats}
        totalHours={totalHours}
        certCount={certifications.length}
        orgIssued={orgIssued}
        expiringCount={expiring.length}
      />

      {expiring.length ? <ExpiryBanner items={expiring} /> : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        {/* Certificates get the wider column: they are the part with pictures,
            and the part the person actually maintains. */}
        <div className="space-y-6 lg:col-span-3">
          <Card>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Award size={16} className="text-good" />
                <h3 className="text-base font-semibold text-white">Certificates</h3>
                <span className="text-xs text-slate-500">{certifications.length}</span>
              </div>
              {canEdit ? (
                <button className="btn-ghost" onClick={() => setEditing((v) => !v)}>
                  <Pencil size={14} /> {editing ? 'Done editing' : 'Manage'}
                </button>
              ) : null}
            </div>

            {editing ? (
              <CertificationEditor
                employeeId={employeeId}
                items={certifications}
                onChanged={onChanged}
                notify={notify}
              />
            ) : certifications.length ? (
              <div className="space-y-3">
                {certifications.map((c) => (
                  <CertificateCard key={c.id} cert={c} onPreview={setPreview} />
                ))}
              </div>
            ) : (
              <EmptyState
                title="No certificates yet"
                hint={canEdit ? 'Use Manage to add one, and attach the certificate itself.' : undefined}
              />
            )}
          </Card>

          <CurrentlyLearning enrollments={enrollments} />
        </div>

        <div className="lg:col-span-2">
          <JourneyTimeline timeline={timeline} />
        </div>
      </div>

      {preview ? <EvidenceLightbox cert={preview} onClose={() => setPreview(null)} /> : null}
      {toast ? <Toast key={toast.id} message={toast.text} onDone={() => setToast(null)} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------

function StatsStrip({ stats, totalHours, certCount, orgIssued, expiringCount }) {
  const tiles = [
    {
      icon: GraduationCap,
      label: 'Courses completed',
      value: stats.courses_completed ?? 0,
      hint: `${stats.courses_in_progress ?? 0} in progress`,
      tone: 'good',
    },
    { icon: Clock, label: 'Learning hours', value: totalHours || '—', hint: 'Courses and certificates', tone: 'accent' },
    {
      icon: Award,
      label: 'Certificates',
      value: certCount,
      hint: `${orgIssued} organisation-issued`,
      tone: 'accent',
    },
    {
      icon: BadgeCheck,
      label: 'Expiring soon',
      value: expiringCount,
      hint: expiringCount ? 'Within 90 days' : 'Nothing lapsing',
      tone: expiringCount ? 'warn' : 'good',
    },
  ];
  const tones = {
    accent: 'bg-accent/15 text-accent-soft',
    good: 'bg-good/15 text-good',
    warn: 'bg-warn/15 text-warn',
  };

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {tiles.map((t) => (
        <div key={t.label} className="card-tight flex items-center gap-3">
          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${tones[t.tone]}`}>
            <t.icon size={17} />
          </span>
          <div className="min-w-0">
            <p className="text-xl font-semibold leading-tight text-white">{t.value}</p>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{t.label}</p>
            <p className="truncate text-xs text-slate-500">{t.hint}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function ExpiryBanner({ items }) {
  return (
    <div className="rounded-xl border border-warn/30 bg-warn/10 p-4">
      <p className="mb-3 text-sm font-semibold text-warn">
        {items.length} certificate{items.length > 1 ? 's' : ''} need attention
      </p>
      <div className="flex flex-wrap gap-2">
        {items.map((c) => (
          <span
            key={c.id}
            className={`chip ${c.days < 0 ? 'bg-bad/15 text-bad' : 'bg-warn/20 text-warn'}`}
          >
            {c.title} · {expiryLabel(c.days)}
          </span>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------

function CertificateCard({ cert, onPreview }) {
  const kind = evidenceKind(cert.evidence_file_url);
  const days = daysUntil(cert.expiry_date);
  const isOrg = cert.source === 'Catalog';

  return (
    <div className="flex gap-4 rounded-xl border border-line bg-ink-900 p-3 transition hover:border-slate-600">
      <EvidenceThumb cert={cert} kind={kind} onPreview={onPreview} />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            {isOrg ? <ShieldCheck size={14} className="shrink-0 text-good" /> : null}
            <p className="truncate text-sm font-semibold text-white">{cert.title}</p>
          </div>
          <Badge className={statusClasses(cert.status)}>{cert.status}</Badge>
        </div>

        <p className="mt-0.5 truncate text-xs text-slate-400">
          {[cert.issuer, cert.institution].filter(Boolean).join(' · ') || '—'}
        </p>

        {cert.technology ? (
          <span className="mt-2 inline-block chip bg-accent/15 text-accent-soft">{cert.technology}</span>
        ) : null}

        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
          {cert.issued_date ? <span>Issued {formatDate(cert.issued_date)}</span> : null}
          {cert.expiry_date ? (
            <span className={days !== null && days <= EXPIRY_WINDOW_DAYS ? 'text-warn' : ''}>
              Expires {formatDate(cert.expiry_date)}
              {days !== null && days <= EXPIRY_WINDOW_DAYS ? ` · ${expiryLabel(days)}` : ''}
            </span>
          ) : (
            <span>No expiry</span>
          )}
          {cert.hours ? <span>{Number(cert.hours)} hrs</span> : null}
          {cert.approved_by ? <span>Approved by {cert.approved_by}</span> : null}
        </div>

        {cert.credential_id || cert.credential_url ? (
          <p className="mt-1.5 text-xs">
            {cert.credential_url ? (
              <a
                href={cert.credential_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-accent-soft hover:underline"
              >
                {cert.credential_id || 'Verify credential'} <ExternalLink size={11} />
              </a>
            ) : (
              <span className="text-slate-500">ID: {cert.credential_id}</span>
            )}
          </p>
        ) : null}

        {cert.notes ? <p className="mt-1.5 text-xs text-slate-500">{cert.notes}</p> : null}
      </div>
    </div>
  );
}

// The preview the certificate file gets on the card. An image shows itself; a
// PDF cannot be thumbnailed without a renderer, so it gets a labelled tile that
// opens the real thing.
function EvidenceThumb({ cert, kind, onPreview }) {
  const base =
    'flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line';

  if (kind === 'image') {
    return (
      <button
        className={`${base} bg-ink-800 transition hover:border-accent-soft`}
        onClick={() => onPreview(cert)}
        title="View certificate"
      >
        <img src={cert.evidence_file_url} alt={cert.title} className="h-full w-full object-cover" />
      </button>
    );
  }

  if (kind) {
    return (
      <button
        className={`${base} flex-col gap-1 bg-ink-800 text-slate-400 transition hover:border-accent-soft hover:text-slate-200`}
        onClick={() => onPreview(cert)}
        title="Open certificate"
      >
        <FileText size={20} />
        <span className="text-[10px] font-medium uppercase tracking-wide">
          {kind === 'pdf' ? 'PDF' : 'File'}
        </span>
      </button>
    );
  }

  return (
    <div className={`${base} flex-col gap-1 border-dashed bg-ink-800/50 text-slate-600`}>
      <Award size={18} />
      <span className="text-[10px]">No file</span>
    </div>
  );
}

// Full-size look at an attached certificate, over the page. Same overlay shape
// the modals in this codebase use: click the scrim to close, stop propagation
// inside, Escape handled by the close button being the only focus target.
function EvidenceLightbox({ cert, onClose }) {
  const kind = evidenceKind(cert.evidence_file_url);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-line bg-ink-800"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line p-4">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white">{cert.title}</p>
            <p className="truncate text-xs text-slate-500">
              {[cert.issuer, cert.issued_date ? `Issued ${formatDate(cert.issued_date)}` : null]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
          <button className="btn-ghost shrink-0" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto bg-ink-900 p-4">
          {kind === 'image' ? (
            <img
              src={cert.evidence_file_url}
              alt={cert.title}
              className="mx-auto max-h-[65vh] w-auto rounded-lg"
            />
          ) : (
            // PDFs render in an iframe where the browser allows it; the link
            // below is the guaranteed way through either way.
            <iframe
              src={cert.evidence_file_url}
              title={cert.title}
              className="h-[65vh] w-full rounded-lg border border-line bg-white"
            />
          )}
        </div>

        <div className="border-t border-line p-3 text-right">
          <a href={cert.evidence_file_url} target="_blank" rel="noreferrer" className="btn-ghost">
            Open in new tab <ExternalLink size={13} />
          </a>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------

// A read-only glance at what is running, because the doing happens on the
// Learning Module page — duplicating the checklist here would give two places
// to tick the same box.
function CurrentlyLearning({ enrollments }) {
  if (!enrollments.length) return null;

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BookOpen size={16} className="text-accent-soft" />
          <h3 className="text-base font-semibold text-white">Currently learning</h3>
        </div>
        <a href="/learning-module" className="text-xs text-accent-soft hover:underline">
          Open Learning Module →
        </a>
      </div>

      <div className="space-y-3">
        {enrollments.map((e) => {
          const modules = e.modules || [];
          const done = modules.filter((m) => m.completed_at).length;
          const pct = Number(e.progress_percent) || 0;
          return (
            <div key={e.id}>
              <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 truncate text-sm text-slate-200">{e.title}</span>
                <span className="shrink-0 text-xs text-slate-500">
                  {modules.length ? (
                    <span className="inline-flex items-center gap-1">
                      <Layers size={11} /> {done}/{modules.length} modules
                    </span>
                  ) : (
                    `${pct}%`
                  )}
                </span>
              </div>
              <ProgressBar value={pct} />
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function JourneyTimeline({ timeline }) {
  return (
    <Card>
      <h3 className="mb-4 text-base font-semibold text-white">Journey</h3>
      {timeline.length ? (
        <div>
          {timeline.map((ev, i) => {
            const kind = TIMELINE_KINDS[ev.kind] || TIMELINE_KINDS.course;
            const year = ev.event_at ? new Date(ev.event_at).getFullYear() : null;
            const prevYear =
              i > 0 && timeline[i - 1].event_at ? new Date(timeline[i - 1].event_at).getFullYear() : null;
            const isLast = i === timeline.length - 1;

            return (
              <div key={`${ev.kind}-${i}`}>
                {year && year !== prevYear ? (
                  <p className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500 first:mt-0">
                    {year}
                  </p>
                ) : null}
                <div className="relative flex gap-3 pb-4">
                  {/* The rail is drawn per entry so it stops at the last one
                      instead of trailing past the end of the list. */}
                  {!isLast ? (
                    <span className="absolute left-[11px] top-6 h-full w-px bg-line" aria-hidden />
                  ) : null}
                  <span
                    className={`relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink-800 ring-4 ${kind.ring}`}
                  >
                    <span className={`flex h-6 w-6 items-center justify-center rounded-full ${kind.dot}/20`}>
                      <kind.Icon size={13} className="text-white" />
                    </span>
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium leading-snug text-white">{ev.title}</p>
                    <p className="text-xs text-slate-500">{kind.label}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {[ev.detail, ev.meta, formatDate(ev.event_at)].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-slate-500">
          Nothing here yet. Completed courses, certificates, skill level-ups and mentoring sessions
          all land on this timeline.
        </p>
      )}
    </Card>
  );
}
