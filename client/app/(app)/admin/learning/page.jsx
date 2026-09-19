'use client';

import { useState } from 'react';
import useSWR, { mutate } from 'swr';
import {
  Plus,
  Edit2,
  Trash2,
  Eye,
  EyeOff,
  BookOpen,
  FileText,
  Loader2,
} from 'lucide-react';
import { fetcher, api } from '@/lib/api';
import {
  PageHeader,
  Card,
  Skeleton,
  ErrorState,
  Badge,
  EmptyState,
  ConfirmDialog,
  Toast,
} from '@/components/ui';
import { formatDate, statusClasses } from '@/lib/ui';
import CourseEditorModal from '@/components/CourseEditorModal';

export default function AdminLearningPage() {
  const { data, error, isLoading } = useSWR('/admin/courses', fetcher);
  const [editCourse, setEditCourse] = useState(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');

  async function handleDelete() {
    if (!deleteConfirm) return;
    setBusy(true);
    try {
      await api.del(`/admin/courses/${deleteConfirm.id}`);
      mutate('/admin/courses');
      setToast('Course deleted successfully');
      setDeleteConfirm(null);
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handlePublishToggle(course) {
    setBusy(true);
    try {
      await api.patch(`/admin/courses/${course.id}/publish`, {
        publish: course.status !== 'Published',
      });
      mutate('/admin/courses');
      setToast(
        course.status === 'Published'
          ? 'Course unpublished - now Draft'
          : 'Course published successfully'
      );
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(false);
    }
  }

  function handleCreateSuccess() {
    mutate('/admin/courses');
    setShowCreateModal(false);
    setToast('Course created successfully');
  }

  function handleEditSuccess() {
    mutate('/admin/courses');
    setEditCourse(null);
    setToast('Course updated successfully');
  }

  if (error) return <ErrorState error={error} />;

  return (
    <div>
      <PageHeader
        title="Learning Course Management"
        subtitle="Create and manage courses that appear in the Learning Module"
      >
        <button className="btn-primary" onClick={() => setShowCreateModal(true)}>
          <Plus size={16} />
          Create Course
        </button>
      </PageHeader>

      {isLoading || !data ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      ) : data.length === 0 ? (
        <EmptyState
          title="No courses yet"
          hint="Create your first course to get started. It will appear in the Learning Module once published."
        />
      ) : (
        <div className="space-y-3">
          {data.map((course) => (
            <Card key={course.id} className="p-0">
              <div className="flex items-start gap-4 p-4">
                {course.cover_image_url ? (
                  <div className="h-24 w-32 shrink-0 overflow-hidden rounded-lg border border-line bg-ink-900">
                    <img
                      src={course.cover_image_url}
                      alt={course.title}
                      className="h-full w-full object-cover"
                    />
                  </div>
                ) : (
                  <div className="flex h-24 w-32 shrink-0 items-center justify-center rounded-lg border border-line bg-gradient-to-br from-accent/20 to-accent/5">
                    <BookOpen size={24} className="text-accent-soft" />
                  </div>
                )}

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="text-base font-semibold text-white">{course.title}</h3>
                      <p className="mt-1 text-sm text-slate-400">
                        {[
                          course.course_code,
                          course.category,
                          course.instructor_name,
                          course.duration_hours ? `${course.duration_hours}hrs` : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                      {course.short_description ? (
                        <p className="mt-2 text-sm text-slate-500">{course.short_description}</p>
                      ) : null}
                    </div>
                    <Badge className={statusClasses(course.status)}>{course.status}</Badge>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <span className="chip bg-slate-500/15 text-slate-400">
                      <FileText size={12} />
                      {course.content_count || 0} content items
                    </span>
                    <span className="text-xs text-slate-600">
                      Created {formatDate(course.created_at)}
                    </span>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      className="btn-secondary text-xs"
                      onClick={() => setEditCourse(course)}
                      disabled={busy}
                    >
                      <Edit2 size={14} />
                      Edit
                    </button>
                    <button
                      className={`text-xs ${
                        course.status === 'Published'
                          ? 'btn-ghost'
                          : 'inline-flex items-center gap-1.5 rounded-lg border border-good/30 bg-good/10 px-3 py-2 font-medium text-good transition hover:bg-good/20'
                      }`}
                      onClick={() => handlePublishToggle(course)}
                      disabled={busy}
                    >
                      {busy ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : course.status === 'Published' ? (
                        <>
                          <EyeOff size={14} />
                          Unpublish
                        </>
                      ) : (
                        <>
                          <Eye size={14} />
                          Publish
                        </>
                      )}
                    </button>
                    <button
                      className="btn-ghost text-xs text-bad"
                      onClick={() => setDeleteConfirm(course)}
                      disabled={busy}
                    >
                      <Trash2 size={14} />
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {showCreateModal ? (
        <CourseEditorModal
          mode="create"
          onClose={() => setShowCreateModal(false)}
          onSuccess={handleCreateSuccess}
        />
      ) : null}

      {editCourse ? (
        <CourseEditorModal
          mode="edit"
          courseId={editCourse.id}
          onClose={() => setEditCourse(null)}
          onSuccess={handleEditSuccess}
        />
      ) : null}

      <ConfirmDialog
        open={Boolean(deleteConfirm)}
        title="Delete Course"
        message={`Are you sure you want to delete "${deleteConfirm?.title}"? This will remove all content and cannot be undone.`}
        confirmLabel="Delete"
        busy={busy}
        onConfirm={handleDelete}
        onCancel={() => setDeleteConfirm(null)}
      />

      {toast ? <Toast key={toast} message={toast} onDone={() => setToast('')} /> : null}
    </div>
  );
}
