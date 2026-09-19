"use client";

import { useState } from "react";
import useSWR, { mutate } from "swr";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import {
  Award,
  BookOpen,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  FileText,
  GraduationCap,
  Image as ImageIcon,
  Layers,
  Link as LinkIcon,
  Loader2,
  Maximize2,
  Minimize2,
  User,
  Video,
  X,
} from "lucide-react";
import { fetcher, api } from "@/lib/api";
import {
  PageHeader,
  Skeleton,
  ErrorState,
  ProgressBar,
  Badge,
  Card,
  EmptyState,
} from "@/components/ui";
import { formatDate, statusClasses } from "@/lib/ui";
import { useAuth } from "@/components/AuthProvider";

// Learning Module — where you work through what you are enrolled in.
//
// The profile's Learning Journey tab is the record of what you have already
// done; this page is the doing. Two sections, in the order you use them:
// the module checklists (tick as you go, which drives course progress) and the
// plan board (what you intend to pick up next).

const COLUMNS = ["To Do", "In Progress", "Completed", "Archived"];
const TYPE_ICON = {
  Certification: Award,
  Workshop: GraduationCap,
  Course: BookOpen,
};
const VIEWS = ["My Modules", "Plan Board"];

export default function LearningModulePage() {
  const { user } = useAuth();
  const employeeId = user?.employee_id;
  const key = employeeId ? `/learning-module/${employeeId}` : null;
  const { data, error, isLoading } = useSWR(key, fetcher);
  const { data: dynamicCourses, error: dynamicError } = useSWR(
    "/learning-module/dynamic/published-courses",
    fetcher,
  );
  const [view, setView] = useState("My Modules");
  const [selectedCourse, setSelectedCourse] = useState(null);
  const dynamicKey = "/learning-module/dynamic/published-courses";

  if (error || dynamicError)
    return <ErrorState error={error || dynamicError} />;

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
          <StatsStrip courses={dynamicCourses || []} />

          <div className="mb-5 flex flex-wrap gap-1 border-b border-line">
            {VIEWS.map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`rounded-t-lg px-3 py-2 text-sm transition ${
                  view === v
                    ? "border-b-2 border-accent-soft text-white"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {v}
                <span className="ml-2 text-xs text-slate-500">
                  {v === "My Modules"
                    ? dynamicCourses?.length || 0
                    : Object.values(data.columns).reduce(
                        (n, c) => n + c.length,
                        0,
                      )}
                </span>
              </button>
            ))}
          </div>

          {view === "My Modules" ? (
            <>
              {/* Dynamic admin-created courses */}
              {dynamicCourses && dynamicCourses.length > 0 ? (
                <DynamicCourseList
                  courses={dynamicCourses}
                  onSelectCourse={setSelectedCourse}
                />
              ) : (
                <EmptyState
                  title="No courses available yet"
                  hint="Ask your admin to create and publish courses in the Learning Module."
                />
              )}

              {/* Hide traditional enrolled courses - replaced by dynamic courses */}
              {/* <CourseList courses={data.courses} swrKey={key} /> */}
            </>
          ) : (
            <PlanBoard
              columns={data.columns}
              swrKey={key}
              employeeId={employeeId}
            />
          )}
        </>
      )}

      {selectedCourse ? (
        <DynamicCourseModal
          course={selectedCourse}
          onClose={() => setSelectedCourse(null)}
          onCourseUpdate={(updated) => {
            setSelectedCourse(updated);
            mutate(dynamicKey);
            mutate(key);
          }}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------

function StatsStrip({ courses }) {
  const total = courses.reduce(
    (sum, course) => sum + (course.content_items?.length || 0),
    0,
  );
  const done = courses.reduce(
    (sum, course) =>
      sum +
      (course.content_items || []).filter((item) => item.completed_at).length,
    0,
  );
  const completedCourses = courses.filter(
    (course) =>
      course.content_items?.length > 0 &&
      course.content_items.every((item) => item.completed_at),
  ).length;
  const hoursDone = courses.reduce(
    (sum, course) =>
      course.content_items?.length &&
      course.content_items.every((item) => item.completed_at)
        ? sum + Number(course.duration_hours || 0)
        : sum,
    0,
  );
  const pct = total ? Math.round((done / total) * 100) : 0;

  const tiles = [
    {
      icon: Layers,
      label: "Modules done",
      value: total ? `${done}/${total}` : "—",
      tone: "accent",
    },
    {
      icon: BookOpen,
      label: "Active courses",
      value: courses.length,
      tone: "warn",
    },
    {
      icon: GraduationCap,
      label: "Courses completed",
      value: completedCourses,
      tone: "good",
    },
    {
      icon: Clock,
      label: "Hours completed",
      value: Math.round(hoursDone * 100) / 100,
      tone: "accent",
    },
  ];
  const tones = {
    accent: "bg-accent/15 text-accent-soft",
    good: "bg-good/15 text-good",
    warn: "bg-warn/15 text-warn",
  };

  return (
    <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {tiles.map((t) => (
        <div key={t.label} className="card-tight">
          <div className="flex items-center gap-3">
            <span
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${tones[t.tone]}`}
            >
              <t.icon size={16} />
            </span>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {t.label}
              </p>
              <p className="truncate text-lg font-semibold text-white">
                {t.value}
              </p>
            </div>
          </div>
          {t.label === "Modules done" && total ? (
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
  const active = courses.filter((c) => c.status !== "Completed");
  const done = courses.filter((c) => c.status === "Completed");

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
          active.map((c) => (
            <CourseCard key={c.id} course={c} swrKey={swrKey} />
          ))
        ) : (
          <p className="text-sm text-slate-500">
            Nothing in progress — everything is finished.
          </p>
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
  "from-sky-500/30 to-indigo-500/10",
  "from-emerald-500/30 to-teal-500/10",
  "from-amber-500/30 to-orange-500/10",
  "from-violet-500/30 to-fuchsia-500/10",
  "from-rose-500/30 to-pink-500/10",
  "from-cyan-500/30 to-blue-500/10",
];

function CourseCover({ course, className = "" }) {
  const Icon = TYPE_ICON[course.course_type] || BookOpen;

  if (course.cover_image_url) {
    return (
      <div
        className={`overflow-hidden rounded-lg border border-line bg-ink-900 ${className}`}
      >
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
  const seed = String(course.course_code || course.title || "")
    .split("")
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
  const [open, setOpen] = useState(course.status !== "Completed");
  const [busyModule, setBusyModule] = useState(null);
  const [err, setErr] = useState("");

  const modules = course.modules || [];
  const doneCount = modules.filter((m) => m.completed_at).length;
  const pct = Number(course.progress_percent) || 0;

  async function toggle(module) {
    setBusyModule(module.id);
    setErr("");
    const path = `/learning-module/enrollments/${course.id}/modules/${module.id}`;
    try {
      const updated = module.completed_at
        ? await api.del(path)
        : await api.put(path, {});
      // The route returns the whole course back, so patch it into the cached
      // payload rather than refetching the page for one tick.
      mutate(
        swrKey,
        (prev) =>
          prev
            ? {
                ...prev,
                courses: prev.courses.map((c) =>
                  c.id === updated.id ? updated : c,
                ),
              }
            : prev,
        { revalidate: true },
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
            <span className="text-sm font-semibold text-white">
              {course.title}
            </span>
            <Badge className={statusClasses(course.status)}>
              {course.status}
            </Badge>
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
              .join(" · ")}
          </p>
          <div className="mt-3 flex items-center gap-3">
            <div className="flex-1">
              <ProgressBar
                value={pct}
                color={pct === 100 ? "bg-good" : "bg-accent-soft"}
              />
            </div>
            <span className="shrink-0 text-xs text-slate-400">
              {modules.length
                ? `${doneCount}/${modules.length} modules`
                : `${pct}%`}
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
                            ? "border-good bg-good/20 text-good"
                            : "border-line bg-ink-900 text-transparent hover:border-accent-soft"
                        }`}
                      >
                        {busy ? (
                          <Loader2
                            size={12}
                            className="animate-spin text-slate-400"
                          />
                        ) : (
                          <Check size={13} />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span
                          className={`block text-sm ${
                            isDone
                              ? "text-slate-500 line-through"
                              : "text-slate-200"
                          }`}
                        >
                          {m.module_order}. {m.module_title}
                        </span>
                        {m.module_description ? (
                          <span className="block text-xs text-slate-500">
                            {m.module_description}
                          </span>
                        ) : null}
                        <span className="block text-xs text-slate-600">
                          {[
                            m.duration_minutes
                              ? `${m.duration_minutes} min`
                              : null,
                            isDone
                              ? `Done ${formatDate(m.completed_at)}`
                              : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">
              This course has no modules listed, so progress is tracked as a
              whole.
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
  const [err, setErr] = useState("");

  async function onDragEnd(result) {
    const { source, destination, draggableId } = result;
    if (!destination) return;
    if (
      source.droppableId === destination.droppableId &&
      source.index === destination.index
    )
      return;

    const from = source.droppableId;
    const to = destination.droppableId;
    const before = local;

    // Optimistic move, then reconcile with the server.
    setLocal((prev) => {
      const next = { ...prev, [from]: [...prev[from]], [to]: [...prev[to]] };
      const [moved] = next[from].splice(source.index, 1);
      const updated = { ...moved, status: to };
      if (to === "Completed") updated.progress_percent = 100;
      next[to].splice(destination.index, 0, updated);
      return next;
    });

    try {
      setErr("");
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
      <p className="mb-3 text-xs text-slate-500">
        Drag cards between columns to update status.
      </p>
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
                    snapshot.isDraggingOver
                      ? "border-accent-soft bg-ink-800"
                      : ""
                  }`}
                >
                  <div className="mb-3 flex items-center justify-between px-1">
                    <h3 className="text-sm font-semibold text-white">{col}</h3>
                    <span className="text-xs text-slate-500">
                      {local[col].length}
                    </span>
                  </div>
                  <div className="space-y-3">
                    {local[col].map((item, index) => (
                      <Draggable
                        draggableId={item.id}
                        index={index}
                        key={item.id}
                      >
                        {(prov, snap) => (
                          <div
                            ref={prov.innerRef}
                            {...prov.draggableProps}
                            {...prov.dragHandleProps}
                            className={`rounded-lg border border-line bg-ink-800 p-3 ${
                              snap.isDragging ? "ring-2 ring-accent-soft" : ""
                            }`}
                          >
                            <PlanItem item={item} />
                          </div>
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                    {local[col].length === 0 ? (
                      <p className="px-1 py-6 text-center text-xs text-slate-600">
                        No items
                      </p>
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
      <p className="mb-2 text-sm font-medium text-white">
        {item.title || "Untitled course"}
      </p>
      <div className="space-y-1 text-xs text-slate-400">
        <p className="flex items-center gap-1.5">
          <Icon size={13} /> {item.course_type || "Course"}
          {item.duration_hours ? ` · ${item.duration_hours} hrs` : ""}
        </p>
        {item.mentor_name ? (
          <p className="flex items-center gap-1.5">
            <User size={13} /> Mentor: {item.mentor_name}
          </p>
        ) : null}
        {item.completed_at ? (
          <p>Completed on {formatDate(item.completed_at)}</p>
        ) : null}
      </div>
      {item.status !== "Completed" && item.status !== "Archived" ? (
        <div className="mt-2 flex items-center gap-2">
          <ProgressBar value={item.progress_percent || 0} color="bg-good" />
          <span className="text-xs text-slate-400">
            {item.progress_percent || 0}%
          </span>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------
// Dynamic Course List (admin-created courses)
// ---------------------------------------------------------------

function DynamicCourseList({ courses, onSelectCourse }) {
  if (!courses || courses.length === 0) return null;

  return (
    <div className="mb-6 space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
        Available Courses ({courses.length})
      </h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {courses.map((course) => (
          <div
            key={course.id}
            className="cursor-pointer overflow-hidden rounded-xl border border-line bg-ink-800 transition hover:border-accent-soft"
            onClick={() => onSelectCourse(course)}
          >
            {course.cover_image_url ? (
              <div className="h-40 overflow-hidden border-b border-line bg-ink-900">
                <img
                  src={course.cover_image_url}
                  alt={course.title}
                  className="h-full w-full object-cover"
                />
              </div>
            ) : (
              <div className="flex h-40 items-center justify-center border-b border-line bg-gradient-to-br from-accent/20 to-accent/5">
                <BookOpen size={32} className="text-accent-soft" />
              </div>
            )}
            <div className="p-4">
              <h3 className="font-semibold text-white">{course.title}</h3>
              {course.short_description ? (
                <p className="mt-2 text-sm text-slate-400 line-clamp-2">
                  {course.short_description}
                </p>
              ) : null}
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                {course.category ? (
                  <span className="chip bg-accent/10 text-accent-soft">
                    {course.category}
                  </span>
                ) : null}
                {course.instructor_name ? (
                  <span>by {course.instructor_name}</span>
                ) : null}
                {course.duration_hours ? (
                  <span>{course.duration_hours}hrs</span>
                ) : null}
                {course.content_items?.length ? (
                  <span className="chip bg-slate-500/15 text-slate-400">
                    {course.content_items.length} lessons
                  </span>
                ) : null}
              </div>
              {course.content_items?.length ? (
                <div className="mt-3 flex items-center gap-2">
                  <ProgressBar
                    value={Math.round(
                      (course.content_items.filter((item) => item.completed_at)
                        .length /
                        course.content_items.length) *
                        100,
                    )}
                    color="bg-good"
                  />
                  <span className="shrink-0 text-xs text-slate-500">
                    {
                      course.content_items.filter((item) => item.completed_at)
                        .length
                    }
                    /{course.content_items.length}
                  </span>
                </div>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Dynamic Course Modal (view course content)
function DynamicCourseModal({ course, onClose, onCourseUpdate }) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [progressBusy, setProgressBusy] = useState(false);
  const content = course.content_items || [];
  const currentItem = content[currentIndex];

  async function toggleCurrentProgress() {
    setProgressBusy(true);
    try {
      const path = `/learning-module/dynamic/course/${course.id}/content/${currentItem.id}/progress`;
      await (currentItem.completed_at ? api.del(path) : api.put(path, {}));
      const updated = await api.get(
        `/learning-module/dynamic/course/${course.id}`,
      );
      onCourseUpdate(updated);
    } finally {
      setProgressBusy(false);
    }
  }

  async function completeCourse() {
    setProgressBusy(true);
    try {
      for (const item of content) {
        if (!item.completed_at) {
          await api.put(
            `/learning-module/dynamic/course/${course.id}/content/${item.id}/progress`,
            {},
          );
        }
      }
      const updated = await api.get(
        `/learning-module/dynamic/course/${course.id}`,
      );
      onCourseUpdate(updated);
    } finally {
      setProgressBusy(false);
    }
  }

  if (!currentItem) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
        onClick={onClose}
      >
        <Card className="w-full max-w-2xl" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between border-b border-line pb-4">
            <h2 className="text-xl font-semibold text-white">{course.title}</h2>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-white"
            >
              <X size={20} />
            </button>
          </div>
          <p className="mt-4 text-slate-400">This course has no content yet.</p>
        </Card>
      </div>
    );
  }

  function renderContent(item) {
    switch (item.content_type) {
      case "video":
        if (item.video_url) {
          const youtubeMatch = item.video_url.match(
            /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/,
          );
          if (youtubeMatch) {
            return (
              <div className="aspect-video w-full overflow-hidden rounded-lg bg-black">
                <iframe
                  src={`https://www.youtube.com/embed/${youtubeMatch[1]}`}
                  className="h-full w-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
            );
          }
          return (
            <video controls className="w-full rounded-lg bg-black">
              <source src={item.video_url} />
              Your browser does not support the video tag.
            </video>
          );
        }
        return <p className="text-slate-500">Video not available</p>;

      case "image":
        return item.image_url ? (
          <img
            src={item.image_url}
            alt={item.title}
            className="w-full rounded-lg"
          />
        ) : (
          <p className="text-slate-500">Image not available</p>
        );

      case "pdf":
        return item.pdf_url ? (
          <div className="flex flex-col items-center gap-4">
            <embed
              src={item.pdf_url}
              type="application/pdf"
              className="h-[500px] w-full rounded-lg"
            />
            <a
              href={item.pdf_url}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary"
            >
              Open PDF in New Tab
            </a>
          </div>
        ) : (
          <p className="text-slate-500">PDF not available</p>
        );

      case "text":
        return <TextContent content={item.text_content} />;

      case "link":
        if (item.external_url) {
          // Check if it's a YouTube URL - convert to embed
          const youtubeMatch = item.external_url.match(
            /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/,
          );
          if (youtubeMatch) {
            return (
              <div className="space-y-4">
                <div className="aspect-video w-full overflow-hidden rounded-lg bg-black">
                  <iframe
                    src={`https://www.youtube.com/embed/${youtubeMatch[1]}`}
                    className="h-full w-full"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />
                </div>
                <div className="flex items-center justify-between rounded-lg border border-line bg-ink-900/50 p-3">
                  <p className="text-sm text-slate-400">YouTube Video</p>
                  <a
                    href={item.external_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-secondary text-xs"
                  >
                    <LinkIcon size={14} />
                    Watch on YouTube
                  </a>
                </div>
              </div>
            );
          }

          // Check if it's a Vimeo URL - convert to embed
          const vimeoMatch = item.external_url.match(/vimeo\.com\/(\d+)/);
          if (vimeoMatch) {
            return (
              <div className="space-y-4">
                <div className="aspect-video w-full overflow-hidden rounded-lg bg-black">
                  <iframe
                    src={`https://player.vimeo.com/video/${vimeoMatch[1]}`}
                    className="h-full w-full"
                    allow="autoplay; fullscreen; picture-in-picture"
                    allowFullScreen
                  />
                </div>
                <div className="flex items-center justify-between rounded-lg border border-line bg-ink-900/50 p-3">
                  <p className="text-sm text-slate-400">Vimeo Video</p>
                  <a
                    href={item.external_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-secondary text-xs"
                  >
                    <LinkIcon size={14} />
                    Watch on Vimeo
                  </a>
                </div>
              </div>
            );
          }

          // For other URLs, try iframe embed with fallback
          return (
            <div className="space-y-4">
              <div className="overflow-hidden rounded-lg border border-line bg-white">
                <iframe
                  src={item.external_url}
                  className="h-[600px] w-full"
                  title={item.title}
                  sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
                  loading="lazy"
                  onError={(e) => {
                    // Hide iframe on error and show fallback
                    e.target.style.display = "none";
                    const fallback = e.target.nextElementSibling;
                    if (fallback) fallback.style.display = "flex";
                  }}
                />
                <div className="hidden h-[600px] flex-col items-center justify-center gap-4 bg-ink-900/50 p-8 text-center">
                  <LinkIcon size={48} className="text-slate-600" />
                  <div>
                    <p className="text-sm font-medium text-slate-300">
                      This website cannot be embedded
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Some websites block embedding for security. Click below to
                      open in a new tab.
                    </p>
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-line bg-ink-900/50 p-3">
                <p className="break-all text-sm text-slate-400">
                  {item.external_url}
                </p>
                <a
                  href={item.external_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-secondary shrink-0 text-xs"
                >
                  <LinkIcon size={14} />
                  Open in New Tab
                </a>
              </div>
            </div>
          );
        }
        return <p className="text-slate-500">Link not available</p>;

      default:
        return <p className="text-slate-500">Unsupported content type</p>;
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="flex h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-line bg-ink-800 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-white">{course.title}</h2>
            <p className="text-sm text-slate-400">
              Lesson {currentIndex + 1} of {content.length}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X size={20} />
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          <div className="w-80 overflow-y-auto border-r border-line bg-ink-900/50 p-4">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">
              Course Content
            </h3>
            <div className="space-y-2">
              {content.map((item, index) => {
                const Icon =
                  {
                    video: Video,
                    image: ImageIcon,
                    pdf: FileText,
                    text: FileText,
                    link: LinkIcon,
                  }[item.content_type] || FileText;

                return (
                  <button
                    key={item.id}
                    className={`flex w-full items-start gap-3 rounded-lg p-3 text-left transition ${
                      index === currentIndex
                        ? "bg-accent/20 text-white ring-1 ring-accent-soft"
                        : "text-slate-400 hover:bg-ink-700/40 hover:text-slate-200"
                    }`}
                    onClick={() => setCurrentIndex(index)}
                  >
                    <Icon size={16} className="mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 text-sm font-medium">
                        {item.title}
                        {item.completed_at ? (
                          <Check size={14} className="shrink-0 text-good" />
                        ) : null}
                      </p>
                      {item.duration_minutes ? (
                        <p className="text-xs text-slate-500">
                          {item.duration_minutes} min
                        </p>
                      ) : null}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-6">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-xl font-semibold text-white">
                  {currentItem.title}
                </h3>
                {currentItem.description ? (
                  <p className="mt-2 text-sm text-slate-400">
                    {currentItem.description}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                className="btn-ghost shrink-0"
                title="View content full screen"
                onClick={() => setIsFullscreen(true)}
              >
                <Maximize2 size={16} />
              </button>
            </div>
            {renderContent(currentItem)}
            <div className="mt-5 flex justify-end">
              <button
                type="button"
                className="btn-secondary"
                onClick={toggleCurrentProgress}
                disabled={progressBusy}
              >
                {progressBusy ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : (
                  <Check size={15} />
                )}
                {currentItem.completed_at
                  ? "Mark as not done"
                  : "Mark lesson done"}
              </button>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-line px-6 py-4">
          <button
            className="btn-secondary"
            onClick={() => setCurrentIndex(Math.max(0, currentIndex - 1))}
            disabled={currentIndex === 0}
          >
            <ChevronLeft size={16} />
            Previous
          </button>
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="btn-secondary text-xs"
              onClick={completeCourse}
              disabled={
                progressBusy || content.every((item) => item.completed_at)
              }
            >
              <Check size={14} />
              {content.every((item) => item.completed_at)
                ? "Course completed"
                : "Complete course"}
            </button>
            <span className="text-sm text-slate-500">
              {currentIndex + 1} / {content.length}
            </span>
          </div>
          <button
            className="btn-secondary"
            onClick={() =>
              setCurrentIndex(Math.min(content.length - 1, currentIndex + 1))
            }
            disabled={currentIndex === content.length - 1}
          >
            Next
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
      {isFullscreen ? (
        <div
          className="fixed inset-0 z-[60] flex flex-col bg-ink-950 p-4"
          onClick={() => setIsFullscreen(false)}
        >
          <div
            className="mb-3 flex items-center justify-between"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="truncate text-base font-semibold text-white">
              {currentItem.title}
            </h3>
            <button
              type="button"
              className="btn-ghost"
              title="Exit full screen"
              onClick={() => setIsFullscreen(false)}
            >
              <Minimize2 size={16} />
            </button>
          </div>
          <div
            className="min-h-0 flex-1 overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {renderContent(currentItem)}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TextContent({ content }) {
  const lines = (content || "").split(/\r?\n/);

  return (
    <div className="space-y-3 text-slate-300">
      {lines.map((line, index) => {
        const heading = line.match(/^(#{1,3})\s+(.+)$/);
        if (heading) {
          const Heading =
            heading[1].length === 1
              ? "h2"
              : heading[1].length === 2
                ? "h3"
                : "h4";
          return (
            <Heading key={index} className="font-semibold text-white">
              {heading[2]}
            </Heading>
          );
        }

        if (/^[-*]\s+/.test(line)) {
          return (
            <li key={index} className="ml-5 list-disc">
              {line.replace(/^[-*]\s+/, "")}
            </li>
          );
        }

        return line.trim() ? (
          <p key={index}>{line}</p>
        ) : (
          <div key={index} className="h-1" />
        );
      })}
    </div>
  );
}
