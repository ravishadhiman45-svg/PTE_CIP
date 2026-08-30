'use client';

import { useRef, useState } from 'react';
import useSWR, { mutate } from 'swr';
import { BadgeCheck, Clock, Download, Loader2, Pencil, Plus, ShieldCheck, ShieldX, Trash2 } from 'lucide-react';
import { fetcher, api } from '@/lib/api';
import {
  Card,
  Skeleton,
  ErrorState,
  Avatar,
  Badge,
  StatTile,
  ProgressBar,
  ConfirmDialog,
  Toast,
} from '@/components/ui';
import { formatDate, formatMonthYear, durationLabel, LEVEL_TITLES } from '@/lib/ui';
import { useAuth } from '@/components/AuthProvider';
import ProfileEditModal from '@/components/ProfileEditModal';
import SelfSkillModal from '@/components/SelfSkillModal';
import RequestVerificationModal from '@/components/RequestVerificationModal';
import LearningModuleTab from '@/components/LearningModuleTab';

const TABS = ['Summary', 'Skills Passport', 'Learning Module', 'Mentor Notes'];

// Full employee profile UI, driven by an employeeId. Shared by /employees/[id]
// (viewing anyone) and /profile (the logged-in user's own profile).
export default function EmployeeProfileView({ employeeId }) {
  const { user } = useAuth();
  const profileKey = employeeId ? `/employees/${employeeId}/profile` : null;
  const { data, error, isLoading } = useSWR(profileKey, fetcher);
  const [tab, setTab] = useState('Summary');
  const [modal, setModal] = useState(null); // 'edit' | 'skill' | 'verify'
  const [actionError, setActionError] = useState('');
  const [downloading, setDownloading] = useState(false);
  // The skill awaiting delete confirmation, and whether its request is running.
  const [pendingSkill, setPendingSkill] = useState(null);
  const [removingSkill, setRemovingSkill] = useState(false);
  // Keyed by id so the same message twice running restarts the popup.
  const [toast, setToast] = useState(null);
  const toastId = useRef(0);

  const isSelf = Boolean(user && employeeId && user.employee_id === employeeId);
  const canEdit = isSelf || (user?.roles || []).includes('admin');

  const refresh = () => mutate(profileKey);

  // The API answers 404 for anyone outside your subtree — deliberately the same
  // response as a person who does not exist, so probing ids cannot map the org.
  if (error?.status === 404) {
    return (
      <Card>
        <h2 className="text-base font-semibold text-white">Profile not available</h2>
        <p className="mt-1 text-sm text-slate-400">
          You can view your own profile and anyone who reports to you, directly or further down.
        </p>
      </Card>
    );
  }
  if (error) return <ErrorState error={error} />;
  if (isLoading || !data) return <Skeleton className="h-96" />;

  // Defaults keep the view safe if the API is a version behind (node --watch reload).
  const {
    header,
    cv = {},
    experience = [],
    education = [],
    skillsPassport = [],
    recentLearning = [],
    certifications = [],
    learningStats = {},
    enrollments = [],
    learningTimeline = [],
    mentorNotes = [],
    directReports = [],
    managerChain = [],
  } = data;

  const verification = verificationMeta(cv);
  const avgLevel = averageLevel(skillsPassport);
  const years = experienceSpanYears(experience);
  const assessedCount = skillsPassport.filter((s) => s.manager_level || s.mentor_level).length;
  const validCerts = certifications.filter((c) => c.status === 'Approved').length;

  // The PDF is rendered server-side from the same record this page shows, so
  // what downloads always matches what is on screen.
  async function downloadCv() {
    setActionError('');
    setDownloading(true);
    try {
      await api.download(
        `/employees/${employeeId}/cv.pdf`,
        `${(header.full_name || 'employee').replace(/\s+/g, '-')}-CV.pdf`
      );
    } catch (e) {
      setActionError(e.message);
    } finally {
      setDownloading(false);
    }
  }

  async function confirmRemoveSkill() {
    const skill = pendingSkill;
    if (!skill) return;
    setActionError('');
    setRemovingSkill(true);
    try {
      await api.del(`/employees/${employeeId}/skills/${skill.skill_id}`);
      setPendingSkill(null);
      toastId.current += 1;
      setToast({ id: toastId.current, text: `“${skill.skill_name}” removed` });
      refresh();
    } catch (e) {
      // Close the dialog so the error banner above the table is visible.
      setPendingSkill(null);
      setActionError(e.message);
    } finally {
      setRemovingSkill(false);
    }
  }

  return (
    <div>
      {/* Profile header */}
      <Card className="mb-5">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="flex flex-wrap items-center gap-5">
            <Avatar name={header.full_name} src={header.photo_url} size={72} />
            <div className="min-w-[200px]">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-semibold text-white">{header.full_name}</h1>
                {header.org_title ? (
                  <Badge className="border-accent/40 bg-accent/10 text-accent">{header.org_title}</Badge>
                ) : null}
                <Badge className={verification.chipClass}>
                  <verification.Icon size={12} className="mr-1" />
                  {verification.label}
                </Badge>
              </div>
              <p className="text-sm font-medium text-slate-300">
                {cv.headline || [header.job_role, header.team].filter(Boolean).join(' – ') || '—'}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {[header.employee_code, header.department, cv.location_text || header.location]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              <p className="text-xs text-slate-500">
                {[
                  header.manager_name ? `Manager: ${header.manager_name}` : null,
                  header.joining_date ? `Joined ${formatDate(header.joining_date)}` : null,
                  years ? `${years} yrs listed experience` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              {verification.detail ? (
                <p className="mt-1 text-xs text-slate-500">{verification.detail}</p>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap items-start gap-6">
            <div className="flex flex-wrap gap-8 border-l border-line pl-6">
              <Field label="Mentor" value={header.mentor_name} />
              <Field label="Target Role" value={header.target_role} />
            </div>
            {/* Downloading is not an edit — anyone allowed to open this profile
                may take the CV away with them. */}
            <div className="flex flex-wrap gap-2">
              <button className="btn-ghost" onClick={downloadCv} disabled={downloading}>
                {downloading ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Download size={14} />
                )}
                {downloading ? 'Preparing…' : 'Download CV'}
              </button>
              {canEdit ? (
                <>
                  <button className="btn-ghost" onClick={() => setModal('edit')}>
                    <Pencil size={14} /> Edit Profile
                  </button>
                  <button className="btn-ghost" onClick={() => setModal('skill')}>
                    <Plus size={14} /> Add Skill
                  </button>
                  {isSelf ? (
                    <button className="btn-primary" onClick={() => setModal('verify')}>
                      <ShieldCheck size={14} /> Request Verification
                    </button>
                  ) : null}
                </>
              ) : null}
            </div>
          </div>
        </div>
      </Card>

      {/* Where this person sits in the organisation.
          UP is name + title only — the chain above you is never a full record.
          DOWN is everyone directly beneath, each of whom you can open. */}
      {managerChain.length || directReports.length ? (
        <Card className="mb-5">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                Reports up to
              </h3>
              {managerChain.length ? (
                <ol className="space-y-1.5">
                  {managerChain.map((m) => (
                    <li key={m.id} className="flex items-center gap-2.5" style={{ paddingLeft: (m.distance - 1) * 14 }}>
                      <Avatar name={m.full_name} src={m.photo_url} size={24} />
                      <span className="text-sm text-slate-300">{m.full_name}</span>
                      <span className="text-xs text-slate-500">{m.org_title || '—'}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-sm text-slate-500">Top of the organisation.</p>
              )}
            </div>

            <div>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                Direct reports ({directReports.length})
              </h3>
              {directReports.length ? (
                <ul className="space-y-1.5">
                  {directReports.map((r) => (
                    <li key={r.id}>
                      <a
                        href={`/employees/${r.id}`}
                        className="flex items-center gap-2.5 rounded-md px-1 py-0.5 hover:bg-ink-700/50"
                      >
                        <Avatar name={r.full_name} src={r.photo_url} size={24} />
                        <span className="text-sm text-slate-300">{r.full_name}</span>
                        <span className="text-xs text-slate-500">
                          {[r.org_title, r.has_reports ? 'has reports' : null].filter(Boolean).join(' · ')}
                        </span>
                      </a>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-slate-500">No direct reports.</p>
              )}
            </div>
          </div>
        </Card>
      ) : null}

      <div className="mb-5 flex flex-wrap gap-1 border-b border-line">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-t-lg px-3 py-2 text-sm transition ${
              tab === t ? 'border-b-2 border-accent-soft text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {actionError ? (
        <div className="mb-4">
          <ErrorState error={{ message: actionError }} />
        </div>
      ) : null}

      {tab === 'Summary' ? (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              value={avgLevel ? `L${avgLevel}` : '—'}
              label="Capability Level"
              hint={LEVEL_TITLES[avgLevel] || 'Not assessed'}
            />
            <StatTile
              value={years ?? '—'}
              label="Experience"
              hint={experience.length ? `${experience.length} role${experience.length > 1 ? 's' : ''} listed` : 'Nothing listed'}
            />
            <StatTile
              value={skillsPassport.length}
              label="Skills"
              hint={`${assessedCount} assessed by manager/mentor`}
              tone="good"
            />
            <StatTile
              value={validCerts}
              label="Certifications"
              hint={`${certifications.length} on record`}
              tone={validCerts ? 'good' : 'warn'}
            />
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="space-y-6 lg:col-span-2">
              <Card>
                <h3 className="mb-2 text-base font-semibold text-white">Professional Summary</h3>
                {cv.summary ? (
                  <p className="whitespace-pre-line text-sm leading-relaxed text-slate-300">{cv.summary}</p>
                ) : (
                  <p className="text-sm text-slate-500">
                    {canEdit
                      ? 'No summary yet — use Edit Profile to write one.'
                      : 'No summary added yet.'}
                  </p>
                )}
                {cv.phone || cv.linkedin_url || header.email ? (
                  <div className="mt-4 flex flex-wrap gap-6 border-t border-line pt-3">
                    <Field label="Email" value={header.email} />
                    <Field label="Phone" value={cv.phone} />
                    {cv.linkedin_url ? (
                      <div>
                        <p className="text-xs text-slate-500">LinkedIn</p>
                        <a
                          href={cv.linkedin_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-sm font-medium text-accent-soft hover:underline"
                        >
                          View profile
                        </a>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </Card>

              <Card>
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-base font-semibold text-white">Skill Portfolio</h3>
                  <button
                    className="text-xs text-accent-soft hover:underline"
                    onClick={() => setTab('Skills Passport')}
                  >
                    View detailed skills passport →
                  </button>
                </div>
                <div className="space-y-3">
                  {skillsPassport.slice(0, 6).map((s) => (
                    <div key={s.skill_id} className="flex items-center gap-3">
                      <span className="w-40 shrink-0 truncate text-sm text-slate-300">{s.skill_name}</span>
                      <div className="flex-1">
                        <ProgressBar
                          value={(Number(s.effective_level) || 0) * 20}
                          color={levelColor(s.effective_level)}
                        />
                      </div>
                      <span className="w-8 shrink-0 text-right text-xs font-semibold text-white">
                        L{s.effective_level || 0}
                      </span>
                    </div>
                  ))}
                  {skillsPassport.length === 0 ? (
                    <p className="text-sm text-slate-500">
                      {canEdit ? 'No skills yet — use Add Skill to list yours.' : 'No skills assigned yet.'}
                    </p>
                  ) : null}
                </div>
              </Card>
            </div>

            <div className="space-y-6">
              <Card>
                <h3 className="mb-3 text-base font-semibold text-white">Experience Timeline</h3>
                {experience.length ? (
                  <div className="space-y-4">
                    {experience.map((e) => (
                      <div key={e.id} className="relative border-l border-line pl-4">
                        <span className="absolute -left-[4.5px] top-1.5 h-2 w-2 rounded-full bg-accent-soft" />
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-medium text-white">{e.title}</p>
                          {!e.end_date && e.start_date ? (
                            <Badge className="bg-good/15 text-good">Current</Badge>
                          ) : null}
                        </div>
                        <p className="text-xs text-slate-500">
                          {[
                            e.organization,
                            dateRange(e.start_date, e.end_date),
                            durationLabel(e.start_date, e.end_date),
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                        {e.description ? (
                          <p className="mt-1 whitespace-pre-line text-sm text-slate-400">{e.description}</p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">
                    {canEdit ? 'No experience yet — add it from Edit Profile.' : 'No experience listed.'}
                  </p>
                )}
              </Card>

              <Card>
                <h3 className="mb-3 text-base font-semibold text-white">Education</h3>
                {education.length ? (
                  <div className="space-y-3">
                    {education.map((ed) => (
                      <div key={ed.id} className="border-b border-line pb-3 last:border-0 last:pb-0">
                        <p className="text-sm font-medium text-white">{ed.degree}</p>
                        <p className="text-xs text-slate-500">
                          {[ed.institution, ed.field_of_study].filter(Boolean).join(' · ')}
                        </p>
                        <p className="text-xs text-slate-600">
                          {[
                            [ed.start_year, ed.end_year].filter(Boolean).join(' – '),
                            ed.grade ? `Grade ${ed.grade}` : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">
                    {canEdit ? 'No education yet — add it from Edit Profile.' : 'No education listed.'}
                  </p>
                )}
              </Card>

              <Card>
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-base font-semibold text-white">Recent Learning</h3>
                  <button
                    className="text-xs text-accent-soft hover:underline"
                    onClick={() => setTab('Learning Module')}
                  >
                    View all →
                  </button>
                </div>
                <div className="space-y-2">
                  {recentLearning.map((l, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between border-b border-line pb-2 last:border-0 last:pb-0"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm text-slate-200">{l.title}</p>
                        <p className="text-xs text-slate-500">{l.course_type}</p>
                      </div>
                      <span className="shrink-0 pl-2 text-xs text-slate-400">
                        {l.completed_at ? formatDate(l.completed_at) : `${l.progress_percent || 0}%`}
                      </span>
                    </div>
                  ))}
                  {recentLearning.length === 0 ? (
                    <p className="text-sm text-slate-500">No learning records.</p>
                  ) : null}
                </div>
              </Card>
            </div>
          </div>
        </div>
      ) : null}

      {tab === 'Skills Passport' ? (
        <Card className="overflow-x-auto p-0">
          <div className="flex items-center justify-between p-4">
            <div>
              <h3 className="text-base font-semibold text-white">Skills Passport</h3>
              <p className="text-xs text-slate-500">
                Self-declared levels sit alongside manager and mentor assessments.
              </p>
            </div>
            {canEdit ? (
              <button className="btn-ghost" onClick={() => setModal('skill')}>
                <Plus size={14} /> Add Skill
              </button>
            ) : null}
          </div>
          <table className="w-full min-w-[640px]">
            <thead className="border-y border-line">
              <tr>
                <th className="th">Skill</th>
                <th className="th text-center">Self</th>
                <th className="th text-center">Manager</th>
                <th className="th text-center">Mentor</th>
                <th className="th text-center">Effective</th>
                {canEdit ? <th className="th text-right">&nbsp;</th> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {skillsPassport.map((s) => (
                <tr key={s.skill_id} className="hover:bg-ink-700/40">
                  <td className="td text-white">{s.skill_name}</td>
                  <td className="td text-center text-slate-400">{s.self_level ?? '—'}</td>
                  <td className="td text-center text-slate-400">{s.manager_level ?? '—'}</td>
                  <td className="td text-center text-slate-400">{s.mentor_level ?? '—'}</td>
                  <td className="td text-center font-semibold text-white">{s.effective_level}</td>
                  {canEdit ? (
                    <td className="td text-right">
                      <button
                        onClick={() => setPendingSkill(s)}
                        title="Remove from profile"
                        className="text-slate-500 transition hover:text-bad"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))}
              {skillsPassport.length === 0 ? (
                <tr>
                  <td className="td text-slate-500" colSpan={canEdit ? 6 : 5}>
                    No skills assigned yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </Card>
      ) : null}

      {tab === 'Learning Module' ? (
        <LearningModuleTab
          employeeId={employeeId}
          canEdit={canEdit}
          stats={learningStats}
          timeline={learningTimeline}
          enrollments={enrollments}
          certifications={certifications}
          onChanged={refresh}
        />
      ) : null}

      {tab === 'Mentor Notes' ? (
        <div className="space-y-3">
          {mentorNotes.length ? (
            mentorNotes.map((n, i) => (
              <Card key={i}>
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-white">{n.topic}</p>
                  <span className="text-xs text-slate-500">{formatDate(n.session_date)} · {n.mode}</span>
                </div>
                <p className="mt-1 text-sm text-slate-400">{n.notes}</p>
                {n.action_items ? (
                  <p className="mt-2 text-xs text-slate-500">Action: {n.action_items}</p>
                ) : null}
                <p className="mt-2 text-xs text-slate-600">— {n.mentor_name}</p>
              </Card>
            ))
          ) : (
            <Card><p className="text-sm text-slate-500">No mentor notes yet.</p></Card>
          )}
        </div>
      ) : null}

      {modal === 'edit' ? (
        <ProfileEditModal
          employeeId={employeeId}
          header={header}
          cv={cv}
          experience={experience}
          education={education}
          onChanged={refresh}
          onClose={() => setModal(null)}
        />
      ) : null}

      {modal === 'skill' ? (
        <SelfSkillModal
          employeeId={employeeId}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            refresh();
          }}
        />
      ) : null}

      {modal === 'verify' ? (
        <RequestVerificationModal
          onClose={() => setModal(null)}
          onSent={() => {
            setModal(null);
            refresh();
          }}
        />
      ) : null}

      <ConfirmDialog
        open={Boolean(pendingSkill)}
        title="Remove this skill?"
        message={
          pendingSkill
            ? `“${pendingSkill.skill_name}” will be removed from this profile, along with its self, manager and mentor ratings.`
            : ''
        }
        confirmLabel="Remove"
        busyLabel="Removing…"
        busy={removingSkill}
        onConfirm={confirmRemoveSkill}
        onCancel={() => setPendingSkill(null)}
      />

      {toast ? (
        <Toast key={toast.id} message={toast.text} onDone={() => setToast(null)} />
      ) : null}
    </div>
  );
}

function Field({ label, value }) {
  return (
    <div>
      <p className="text-xs text-slate-500">{label}</p>
      <p className="text-sm font-medium text-slate-200">{value || '—'}</p>
    </div>
  );
}

// Chip styling + wording for the four CV verification states.
function verificationMeta(cv = {}) {
  const status = cv.verification_status || 'Draft';
  if (status === 'Verified') {
    return {
      label: 'Profile Verified',
      chipClass: 'bg-good/15 text-good',
      Icon: BadgeCheck,
      detail: cv.verified_by_name
        ? `Verified by ${cv.verified_by_name} · ${formatDate(cv.verified_at)}`
        : null,
    };
  }
  if (status === 'Pending') {
    return {
      label: 'Verification Pending',
      chipClass: 'bg-warn/15 text-warn',
      Icon: Clock,
      detail: cv.pending_with ? `Awaiting review by ${cv.pending_with}` : null,
    };
  }
  if (status === 'Rejected') {
    return {
      label: 'Verification Rejected',
      chipClass: 'bg-bad/15 text-bad',
      Icon: ShieldX,
      detail: cv.verified_by_name ? `Reviewed by ${cv.verified_by_name}` : null,
    };
  }
  return { label: 'Not Verified', chipClass: 'bg-slate-500/15 text-slate-400', Icon: ShieldCheck, detail: null };
}

function averageLevel(passport = []) {
  const levels = passport.map((s) => Number(s.effective_level)).filter((n) => n > 0);
  if (!levels.length) return 0;
  return Math.round(levels.reduce((a, b) => a + b, 0) / levels.length);
}

// Span from the earliest listed start to the latest end (or today if a role is open).
function experienceSpanYears(experience = []) {
  const starts = experience.map((e) => e.start_date).filter(Boolean).sort();
  if (!starts.length) return null;
  const ends = experience.map((e) => e.end_date).filter(Boolean).sort();
  const stillWorking = experience.some((e) => e.start_date && !e.end_date);
  const from = new Date(starts[0]);
  const to = stillWorking || !ends.length ? new Date() : new Date(ends[ends.length - 1]);
  const yrs = (to - from) / (365.25 * 24 * 60 * 60 * 1000);
  return yrs > 0 ? Math.round(yrs * 10) / 10 : null;
}

function dateRange(start, end) {
  if (!start && !end) return '';
  return `${formatMonthYear(start) || '?'} – ${end ? formatMonthYear(end) : 'Present'}`;
}

function levelColor(level) {
  const n = Number(level) || 0;
  if (n >= 4) return 'bg-good';
  if (n >= 3) return 'bg-accent-soft';
  if (n >= 2) return 'bg-warn';
  return 'bg-slate-600';
}
