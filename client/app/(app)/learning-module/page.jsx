'use client';

import { useState } from 'react';
import useSWR, { mutate } from 'swr';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import {
  Award,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  GraduationCap,
  Layers,
  Loader2,
  User,
} from 'lucide-react';
import { fetcher, api } from '@/lib/api';
import { PageHeader, Skeleton, ErrorState, ProgressBar, Badge, Card, EmptyState } from '@/components/ui';
import { formatDate, statusClasses } from '@/lib/ui';
import { useAuth } from '@/components/AuthProvider';

// Learning Module — where you work through what you are enrolled in.
//
// The profile's Learning Journey tab is the record of what you have already
// done; this page is the doing. Two sections, in the order you use them:
// the module checklists (tick as you go, which drives course progress) and the
// plan board (what you intend to pick up next).

const COLUMNS = ['To Do', 'In Progress', 'Completed', 'Archived'];
const TYPE_ICON = { Certification: Award, Workshop: GraduationCap, Course: BookOpen };
const VIEWS = ['My Modules', 'Plan Board'];

export default function LearningModulePage() {
  const { user } = useAuth();
  const employeeId = user?.employee_id;
  const key = employeeId ? `/learning-module/${employeeId}` : null;
  const { data, error, isLoading } = useSWR(key, fetcher);
  const [view, setView] = useState('My Modules');

  if (error) return <ErrorState error={error} />;

  return (
    <div>
      <PageHeader
        title="Learning Module"
        subtitle="Work through your courses module by module, and plan what comes next"
      />

      {isLoading || !data ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-20" />
            ))}
          </div>
          <Skeleton className="h-64" />
        </div>
      ) : (
        <>
          <StatsStrip stats={data.stats} />

          <div className="mb-5 flex flex-wrap gap-1 border-b border-line">
            {VIEWS.map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`rounded-t-lg px-3 py-2 text-sm transition ${
                  view === v
                    ? 'border-b-2 border-accent-soft text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {v}
                <span className="ml-2 text-xs text-slate-500">
                  {v === 'My Modules'
                    ? data.courses.length
                    : Object.values(data.columns).reduce((n, c) => n + c.length, 0)}
                </span>
              </button>
            ))}
          </div>

          {view === 'My Modules' ? (
            <CourseList courses={data.courses} swrKey={key} />
          ) : (
            <PlanBoard columns={data.columns} swrKey={key} employeeId={employeeId} />
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------

function StatsStrip({ stats }) {
  const done = Number(stats.modules_done) || 0;
  const total = Number(stats.modules_total) || 0;
  const pct = total ? Math.round((done / total) * 100) : 0;

  const tiles = [
    { icon: Layers, label: 'Modules done', value: total ? `${done}/${total}` : '—', tone: 'accent' },
    { icon: BookOpen, label: 'Active courses', value: stats.active_courses ?? 0, tone: 'warn' },
    { icon: GraduationCap, label: 'Courses completed', value: stats.completed_courses ?? 0, tone: 'good' },
    { icon: Clock, label: 'Hours completed', value: Math.round(Number(stats.hours_done) || 0), tone: 'accent' },
  ];
  const tones = {
    accent: 'bg-accent/15 text-accent-soft',
    good: 'bg-good/15 text-good',
    warn: 'bg-warn/15 text-warn',
  };

  return (
    <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {tiles.map((t) => (
        <div key={t.label} className="card-tight">
          <div className="flex items-center gap-3">
            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${tones[t.tone]}`}>
              <t.icon size={16} />
            </span>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{t.label}</p>
              <p className="truncate text-lg font-semibold text-white">{t.value}</p>
            </div>
          </div>
          {t.label === 'Modules done' && total ? (
            <div className="mt-3">
              <ProgressBar value={pct} color="bg-accent-soft" />
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------

function CourseList({ courses, swrKey }) {
  const active = courses.filter((c) => c.status !== 'Completed');
  const done = courses.filter((c) => c.status === 'Completed');

  if (courses.length === 0) {
    return (
      <EmptyState
        title="You are not enrolled in anything yet"
        hint="Browse the catalogue from Training, or ask your manager to nominate you."
      />
    );
  }

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
          In progress ({active.length})
        </h2>
        {active.length ? (
          active.map((c) => <CourseCard key={c.id} course={c} swrKey={swrKey} />)
        ) : (
          <p className="text-sm text-slate-500">Nothing in progress — everything is finished.</p>
        )}
      </section>

      {done.length ? (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
            Completed ({done.length})
          </h2>
          {done.map((c) => (
            <CourseCard key={c.id} course={c} swrKey={swrKey} />
          ))}
        </section>
      ) : null}
    </div>
  );
}

// Cover art for a course. A real image when the catalogue has one; otherwise
// generated art rather than an empty grey box — deterministic, so the same
// course always looks the same and people recognise it by colour in a list.
const COVER_GRADIENTS = [
  'from-sky-500/30 to-indigo-500/10',
  'from-emerald-500/30 to-teal-500/10',
  'from-amber-500/30 to-orange-500/10',
  'from-violet-500/30 to-fuchsia-500/10',
  'from-rose-500/30 to-pink-500/10',
  'from-cyan-500/30 to-blue-500/10',
];

function CourseCover({ course, className = '' }) {
  const Icon = TYPE_ICON[course.course_type] || BookOpen;

  if (course.cover_image_url) {
    return (
      <div className={`overflow-hidden rounded-lg border border-line bg-ink-900 ${className}`}>
        <img
          src={course.cover_image_url}
          alt=""
          className="h-full w-full object-cover"
        />
      </div>
    );
  }

  // Sum of the code's characters — stable across reloads and good enough to
  // spread a catalogue of this size across the palette.
  const seed = String(course.course_code || course.title || '')
    .split('')
    .reduce((n, ch) => n + ch.charCodeAt(0), 0);
  const gradient = COVER_GRADIENTS[seed % COVER_GRADIENTS.length];

  return (
    <div
      className={`relative flex flex-col items-center justify-center gap-1 overflow-hidden rounded-lg border border-line bg-gradient-to-br ${gradient} ${className}`}
    >
      <Icon size={22} className="text-white/80" />
      <span className="px-1 text-center text-[9px] font-semibold uppercase tracking-wide text-white/60">
        {course.course_code || course.course_type}
      </span>
    </div>
  );
}

function CourseCard({ course, swrKey }) {
  // Completed courses start collapsed — they are reference, not work in hand.
  const [open, setOpen] = useState(course.status !== 'Completed');
  const [busyModule, setBusyModule] = useState(null);
  const [err, setErr] = useState('');

  const modules = course.modules || [];
  const doneCount = modules.filter((m) => m.completed_at).length;
  const pct = Number(course.progress_percent) || 0;

  async function toggle(module) {
    setBusyModule(module.id);
    setErr('');
    const path = `/learning-module/enrollments/${course.id}/modules/${module.id}`;
    try {
      const updated = module.completed_at ? await api.del(path) : await api.put(path, {});
      // The route returns the whole course back, so patch it into the cached
      // payload rather than refetching the page for one tick.
      mutate(
        swrKey,
        (prev) =>
          prev ? { ...prev, courses: prev.courses.map((c) => (c.id === updated.id ? updated : c)) } : prev,
        { revalidate: true }
      );
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusyModule(null);
    }
  }

  return (
    <Card className="p-0">
      <button
        className="flex w-full items-start gap-3 p-4 text-left"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? (
          <ChevronDown size={16} className="mt-1 shrink-0 text-slate-400" />
        ) : (
          <ChevronRight size={16} className="mt-1 shrink-0 text-slate-400" />
        )}
        <CourseCover course={course} className="h-[68px] w-[92px] shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-white">{course.title}</span>
            <Badge className={statusClasses(course.status)}>{course.status}</Badge>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {[
              course.course_code,
              course.delivery_mode,
              course.duration_hours ? `${course.duration_hours} hrs` : null,
              course.difficulty,
              course.owner_sme ? `SME: ${course.owner_sme}` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          <div className="mt-3 flex items-center gap-3">
            <div className="flex-1">
              <ProgressBar value={pct} color={pct === 100 ? 'bg-good' : 'bg-accent-soft'} />
            </div>
            <span className="shrink-0 text-xs text-slate-400">
              {modules.length ? `${doneCount}/${modules.length} modules` : `${pct}%`}
            </span>
          </div>
        </div>
      </button>

      {open ? (
        <div className="border-t border-line p-4">
          {course.description ? (
            <p className="mb-3 text-sm text-slate-400">{course.description}</p>
          ) : null}

          {modules.length ? (
            <ul className="space-y-1">
              {modules.map((m) => {
                const isDone = Boolean(m.completed_at);
                const busy = busyModule === m.id;
                return (
                  <li key={m.id}>
                    <button
                      className="flex w-full items-start gap-3 rounded-lg p-2 text-left transition hover:bg-ink-700/40 disabled:opacity-60"
                      onClick={() => toggle(m)}
                      disabled={busy}
                    >
                      <span
                        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition ${
                          isDone
                            ? 'border-good bg-good/20 text-good'
                            : 'border-line bg-ink-900 text-transparent hover:border-accent-soft'
                        }`}
                      >
                        {busy ? (
                          <Loader2 size={12} className="animate-spin text-slate-400" />
                        ) : (
                          <Check size={13} />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span
                          className={`block text-sm ${
                            isDone ? 'text-slate-500 line-through' : 'text-slate-200'
                          }`}
                        >
                          {m.module_order}. {m.module_title}
                        </span>
                        {m.module_description ? (
                          <span className="block text-xs text-slate-500">{m.module_description}</span>
                        ) : null}
                        <span className="block text-xs text-slate-600">
                          {[
                            m.duration_minutes ? `${m.duration_minutes} min` : null,
                            isDone ? `Done ${formatDate(m.completed_at)}` : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">
              This course has no modules listed, so progress is tracked as a whole.
            </p>
          )}

          {course.skills && course.skills.length ? (
            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3">
              <span className="text-xs text-slate-500">Builds:</span>
              {course.skills.map((s) => (
                <Badge key={s} className="bg-accent/15 text-accent-soft">
                  {s}
                </Badge>
              ))}
            </div>
          ) : null}

          {err ? <p className="mt-2 text-xs text-bad">{err}</p> : null}
        </div>
      ) : null}
    </Card>
  );
}

// ---------------------------------------------------------------

function PlanBoard({ columns, swrKey, employeeId }) {
  const [local, setLocal] = useState(columns);
  const [err, setErr] = useState('');

  async function onDragEnd(result) {
    const { source, destination, draggableId } = result;
    if (!destination) return;
    if (source.droppableId === destination.droppableId && source.index === destination.index) return;

    const from = source.droppableId;
    const to = destination.droppableId;
    const before = local;

    // Optimistic move, then reconcile with the server.
    setLocal((prev) => {
      const next = { ...prev, [from]: [...prev[from]], [to]: [...prev[to]] };
      const [moved] = next[from].splice(source.index, 1);
      const updated = { ...moved, status: to };
      if (to === 'Completed') updated.progress_percent = 100;
      next[to].splice(destination.index, 0, updated);
      return next;
    });

    try {
      setErr('');
      await api.patch(`/learning-plan/items/${draggableId}`, { status: to });
      mutate(swrKey);
    } catch (e) {
      setLocal(before);
      setErr(e.message);
    }
  }

  const empty = Object.values(local).every((c) => c.length === 0);
  if (empty) {
    return (
      <EmptyState
        title="Your plan board is empty"
        hint="Items appear here when you or your manager add courses to your learning plan."
      />
    );
  }

  return (
    <>
      <p className="mb-3 text-xs text-slate-500">Drag cards between columns to update status.</p>
      {err ? <p className="mb-3 text-xs text-bad">{err}</p> : null}
      <DragDropContext onDragEnd={onDragEnd}>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {COLUMNS.map((col) => (
            <Droppable droppableId={col} key={col}>
              {(provided, snapshot) => (
                <div
                  ref={provided.innerRef}
                  {...provided.droppableProps}
                  className={`rounded-xl border border-line bg-ink-900/60 p-3 transition ${
                    snapshot.isDraggingOver ? 'border-accent-soft bg-ink-800' : ''
                  }`}
                >
                  <div className="mb-3 flex items-center justify-between px-1">
                    <h3 className="text-sm font-semibold text-white">{col}</h3>
                    <span className="text-xs text-slate-500">{local[col].length}</span>
                  </div>
                  <div className="space-y-3">
                    {local[col].map((item, index) => (
                      <Draggable draggableId={item.id} index={index} key={item.id}>
                        {(prov, snap) => (
                          <div
                            ref={prov.innerRef}
                            {...prov.draggableProps}
                            {...prov.dragHandleProps}
                            className={`rounded-lg border border-line bg-ink-800 p-3 ${
                              snap.isDragging ? 'ring-2 ring-accent-soft' : ''
                            }`}
                          >
                            <PlanItem item={item} />
                          </div>
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                    {local[col].length === 0 ? (
                      <p className="px-1 py-6 text-center text-xs text-slate-600">No items</p>
                    ) : null}
                  </div>
                </div>
              )}
            </Droppable>
          ))}
        </div>
      </DragDropContext>
    </>
  );
}

function PlanItem({ item }) {
  const Icon = TYPE_ICON[item.course_type] || BookOpen;
  return (
    <div>
      <p className="mb-2 text-sm font-medium text-white">{item.title || 'Untitled course'}</p>
      <div className="space-y-1 text-xs text-slate-400">
        <p className="flex items-center gap-1.5">
          <Icon size={13} /> {item.course_type || 'Course'}
          {item.duration_hours ? ` · ${item.duration_hours} hrs` : ''}
        </p>
        {item.mentor_name ? (
          <p className="flex items-center gap-1.5">
            <User size={13} /> Mentor: {item.mentor_name}
          </p>
        ) : null}
        {item.completed_at ? <p>Completed on {formatDate(item.completed_at)}</p> : null}
      </div>
      {item.status !== 'Completed' && item.status !== 'Archived' ? (
        <div className="mt-2 flex items-center gap-2">
          <ProgressBar value={item.progress_percent || 0} color="bg-good" />
          <span className="text-xs text-slate-400">{item.progress_percent || 0}%</span>
        </div>
      ) : null}
    </div>
  );
}
