'use client';

import { useRef, useState } from 'react';
import {
  BadgeCheck,
  Check,
  ChevronDown,
  ChevronRight,
  GraduationCap,
  Pencil,
  ShieldCheck,
  TrendingUp,
  Users,
} from 'lucide-react';
import { Badge, Card, ProgressBar, StatTile, Toast } from '@/components/ui';
import { formatDate, statusClasses } from '@/lib/ui';
import CertificationEditor from '@/components/CertificationEditor';

// The profile's learning record in one place: what this person is doing now,
// what they have finished, and the certificates they hold. Split out of
// EmployeeProfileView because that file is already long and this tab is four
// sections plus an editor.
//
// It replaces the old Learning Plan and Certifications tabs, which showed a flat
// list each and had no way to add anything.

const TIMELINE_KINDS = {
  course: { label: 'Course completed', dot: 'bg-accent-soft', Icon: GraduationCap },
  certification: { label: 'Certification', dot: 'bg-good', Icon: BadgeCheck },
  skill: { label: 'Skill level up', dot: 'bg-warn', Icon: TrendingUp },
  mentoring: { label: 'Mentoring session', dot: 'bg-slate-500', Icon: Users },
};

// Anything expiring within this many days is worth flagging before it lapses.
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
  if (days < 0) return `Expired ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ago`;
  if (days === 0) return 'Expires today';
  return `Expires in ${days} day${days === 1 ? '' : 's'}`;
}

// training_enrollments records one percentage for the whole course, so no module
// can say for itself whether it is done. Ticks are filled up to the share of
// total duration the course progress covers, and the caption under the list says
// exactly that — a hint, never presented as a per-module record.
function modulesWithEstimate(modules, progressPercent) {
  const list = modules || [];
  const total = list.reduce((sum, m) => sum + (Number(m.duration_minutes) || 0), 0);
  const progress = Number(progressPercent) || 0;
  let seen = 0;
  return list.map((m) => {
    // Courses whose modules carry no duration fall back to equal weighting.
    seen += total ? Number(m.duration_minutes) || 0 : 100 / (list.length || 1);
    const share = total ? (seen / total) * 100 : seen;
    return { ...m, likelyDone: share <= progress };
  });
}

export default function LearningModuleTab({
  employeeId,
  canEdit,
  stats,
  timeline,
  enrollments,
  certifications,
  onChanged,
}) {
  const [editing, setEditing] = useState(false);
  const [openCourse, setOpenCourse] = useState(null);
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
  const validCerts = certifications.filter((c) => c.status === 'Approved').length;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          value={stats.courses_completed ?? 0}
          label="Courses Completed"
          hint={`${stats.courses_in_progress ?? 0} in progress`}
          tone="good"
        />
        <StatTile
          value={stats.courses_in_progress ?? 0}
          label="In Progress"
          hint={enrollments.length ? 'Active enrolments' : 'Nothing running'}
        />
        <StatTile value={totalHours || '—'} label="Learning Hours" hint="Courses and certificates" />
        <StatTile
          value={certifications.length}
          label="Certificates"
          hint={`${validCerts} organisation-issued`}
          tone={expiring.length ? 'warn' : 'good'}
        />
      </div>

      {expiring.length ? (
        <Card>
          <h3 className="mb-3 text-base font-semibold text-white">Expiring Soon</h3>
          <div className="space-y-2">
            {expiring.map((c) => (
              <div
                key={c.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-ink-900 p-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-white">{c.title}</p>
                  <p className="text-xs text-slate-500">
                    {[c.issuer, `Valid to ${formatDate(c.expiry_date)}`].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <Badge className={c.days < 0 ? 'bg-bad/15 text-bad' : 'bg-warn/15 text-warn'}>
                  {expiryLabel(c.days)}
                </Badge>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-base font-semibold text-white">Certifications</h3>
              {canEdit ? (
                <button className="btn-ghost" onClick={() => setEditing((v) => !v)}>
                  <Pencil size={14} /> {editing ? 'Done' : 'Manage certificates'}
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
            ) : (
              // Full-bleed inside the Card so .th/.td keep their own padding.
              <div className="-mx-5 overflow-x-auto">
                <table className="w-full">
                  <thead className="border-b border-line">
                    <tr>
                      <th className="th">Certificate</th>
                      <th className="th">Status</th>
                      <th className="th">Issued</th>
                      <th className="th">Expires</th>
                      <th className="th">Evidence</th>
                      <th className="th">Approved By</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {certifications.map((c) => (
                      <tr key={c.id} className="hover:bg-ink-700/40">
                        <td className="td">
                          <div className="flex items-center gap-2">
                            {/* A second, non-colour cue for "the organisation issued this". */}
                            {c.source === 'Catalog' ? (
                              <ShieldCheck size={14} className="shrink-0 text-good" />
                            ) : null}
                            <span className="text-white">{c.title}</span>
                          </div>
                          <p className="text-xs text-slate-500">
                            {[c.issuer, c.technology, c.institution].filter(Boolean).join(' · ') || '—'}
                          </p>
                          {c.credential_id ? (
                            <p className="text-xs text-slate-500">
                              {c.credential_url ? (
                                <a
                                  href={c.credential_url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-accent-soft hover:underline"
                                >
                                  {c.credential_id}
                                </a>
                              ) : (
                                c.credential_id
                              )}
                            </p>
                          ) : null}
                        </td>
                        <td className="td">
                          <Badge className={statusClasses(c.status)}>{c.status}</Badge>
                        </td>
                        <td className="td">{formatDate(c.issued_date)}</td>
                        <td className="td">{formatDate(c.expiry_date)}</td>
                        <td className="td">
                          {c.evidence_file_url ? (
                            <a
                              href={c.evidence_file_url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-accent-soft hover:underline"
                            >
                              View
                            </a>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="td">{c.approved_by || '—'}</td>
                      </tr>
                    ))}
                    {certifications.length === 0 ? (
                      <tr>
                        <td className="td text-slate-500" colSpan={6}>
                          {canEdit
                            ? 'No certificates yet — use Manage certificates to add one.'
                            : 'No certificates on record.'}
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-base font-semibold text-white">Courses In Progress</h3>
              <a href="/learning-plan" className="text-xs text-accent-soft hover:underline">
                Full Kanban board →
              </a>
            </div>
            {enrollments.length ? (
              <div className="space-y-3">
                {enrollments.map((e) => {
                  const open = openCourse === e.id;
                  const modules = modulesWithEstimate(e.modules, e.progress_percent);
                  return (
                    <div key={e.id} className="rounded-lg border border-line bg-ink-900 p-3">
                      <button
                        className="flex w-full items-center gap-2 text-left"
                        onClick={() => setOpenCourse(open ? null : e.id)}
                      >
                        {open ? (
                          <ChevronDown size={16} className="shrink-0 text-slate-400" />
                        ) : (
                          <ChevronRight size={16} className="shrink-0 text-slate-400" />
                        )}
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-white">
                          {e.title}
                        </span>
                        <Badge className={statusClasses(e.status)}>{e.status}</Badge>
                      </button>
                      <p className="mt-1 pl-6 text-xs text-slate-500">
                        {[e.course_type, e.delivery_mode, e.duration_hours ? `${e.duration_hours} hrs` : null]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                      <div className="mt-2 flex items-center gap-3 pl-6">
                        <div className="flex-1">
                          <ProgressBar value={Number(e.progress_percent) || 0} />
                        </div>
                        <span className="text-xs text-slate-400">
                          {Number(e.progress_percent) || 0}%
                        </span>
                      </div>

                      {open ? (
                        <div className="mt-3 pl-6">
                          {modules.length ? (
                            <>
                              <ul className="space-y-1.5">
                                {modules.map((m) => (
                                  <li key={m.module_order} className="flex items-start gap-2">
                                    <span
                                      className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${
                                        m.likelyDone ? 'bg-good/20 text-good' : 'bg-ink-700 text-slate-600'
                                      }`}
                                    >
                                      <Check size={10} />
                                    </span>
                                    <span className="text-sm text-slate-300">
                                      {m.module_title}
                                      {m.duration_minutes ? (
                                        <span className="text-slate-500"> · {m.duration_minutes} min</span>
                                      ) : null}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                              <p className="mt-2 text-xs text-slate-600">
                                Ticks are estimated from overall course progress — modules are not
                                tracked individually.
                              </p>
                            </>
                          ) : (
                            <p className="text-sm text-slate-500">No modules listed for this course.</p>
                          )}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-slate-500">No courses in progress.</p>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <h3 className="mb-3 text-base font-semibold text-white">Learning Journey</h3>
            {timeline.length ? (
              <div className="space-y-4">
                {timeline.map((ev, i) => {
                  const kind = TIMELINE_KINDS[ev.kind] || TIMELINE_KINDS.course;
                  const year = ev.event_at ? new Date(ev.event_at).getFullYear() : null;
                  const previousYear =
                    i > 0 && timeline[i - 1].event_at
                      ? new Date(timeline[i - 1].event_at).getFullYear()
                      : null;
                  return (
                    <div key={`${ev.kind}-${i}`}>
                      {year && year !== previousYear ? (
                        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                          {year}
                        </p>
                      ) : null}
                      <div className="relative border-l border-line pl-4">
                        <span
                          className={`absolute -left-[4.5px] top-1.5 h-2 w-2 rounded-full ${kind.dot}`}
                        />
                        <div className="flex items-start gap-2">
                          <kind.Icon size={14} className="mt-0.5 shrink-0 text-slate-500" />
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-white">{ev.title}</p>
                            <p className="text-xs text-slate-500">
                              {[ev.detail, ev.meta, formatDate(ev.event_at)].filter(Boolean).join(' · ')}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-slate-500">Nothing on the learning journey yet.</p>
            )}
          </Card>
        </div>
      </div>

      {toast ? <Toast key={toast.id} message={toast.text} onDone={() => setToast(null)} /> : null}
    </div>
  );
}
