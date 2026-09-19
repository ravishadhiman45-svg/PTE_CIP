"use client";

import { useState, useEffect } from "react";
import {
  X,
  Upload,
  Plus,
  Edit2,
  Trash2,
  Loader2,
  Video,
  Image as ImageIcon,
  FileText,
  Link as LinkIcon,
  ChevronUp,
  ChevronDown,
} from "lucide-react";
import { api, fetcher } from "@/lib/api";
import { Card, Badge, ConfirmDialog } from "@/components/ui";

const CONTENT_TYPES = [
  { value: "video", label: "Video", icon: Video },
  { value: "image", label: "Image", icon: ImageIcon },
  { value: "pdf", label: "PDF", icon: FileText },
  { value: "text", label: "Text/Rich Content", icon: FileText },
  { value: "link", label: "External Link", icon: LinkIcon },
];

export default function CourseEditorModal({
  mode = "create",
  courseId,
  onClose,
  onSuccess,
}) {
  const [step, setStep] = useState(1); // 1: Course Details, 2: Content Management
  const [activeCourseId, setActiveCourseId] = useState(courseId || null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Course details
  const [title, setTitle] = useState("");
  const [shortDescription, setShortDescription] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [instructorName, setInstructorName] = useState("");
  const [durationHours, setDurationHours] = useState("");
  const [difficulty, setDifficulty] = useState("");
  const [thumbnailFile, setThumbnailFile] = useState(null);
  const [thumbnailPreview, setThumbnailPreview] = useState("");

  // Content management
  const [content, setContent] = useState([]);
  const [showAddContent, setShowAddContent] = useState(false);
  const [editingContent, setEditingContent] = useState(null);
  const [deleteContent, setDeleteContent] = useState(null);

  useEffect(() => {
    if (mode === "edit" && activeCourseId) {
      loadCourse();
    }
  }, [mode, activeCourseId]);

  async function loadCourse() {
    setBusy(true);
    try {
      if (!activeCourseId) return;
      const data = await fetcher(`/admin/courses/${activeCourseId}`);
      const { course, content: courseContent } = data;
      setTitle(course.title || "");
      setShortDescription(course.short_description || "");
      setDescription(course.description || "");
      setCategory(course.category || "");
      setInstructorName(course.instructor_name || "");
      setDurationHours(course.duration_hours || "");
      setDifficulty(course.difficulty || "");
      setThumbnailPreview(course.cover_image_url || "");
      setContent(courseContent || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveCourse() {
    if (!title.trim()) {
      setError("Course title is required");
      return;
    }

    setBusy(true);
    setError("");

    try {
      const payload = {
        title: title.trim(),
        short_description: shortDescription.trim() || null,
        description: description.trim() || null,
        category: category.trim() || null,
        instructor_name: instructorName.trim() || null,
        duration_hours: durationHours ? parseFloat(durationHours) : null,
        difficulty: difficulty || null,
      };

      let savedCourse;
      if (mode === "create") {
        savedCourse = await api.post("/admin/courses", payload);
        if (!savedCourse?.id)
          throw new Error("Course was created without an ID");
        setActiveCourseId(savedCourse.id);
      } else {
        savedCourse = await api.patch(
          `/admin/courses/${activeCourseId}`,
          payload,
        );
      }

      // Upload thumbnail if provided
      if (thumbnailFile && savedCourse.id) {
        const formData = new FormData();
        formData.append("file", thumbnailFile);
        await api.upload(
          `/admin/courses/${savedCourse.id}/thumbnail`,
          formData,
        );
      }

      if (mode === "create") {
        // Move to content step for newly created course
        setStep(2);
        // Reload to get the course with ID
        await loadCourse();
      } else {
        onSuccess();
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function handleThumbnailChange(e) {
    const file = e.target.files?.[0];
    if (file) {
      setThumbnailFile(file);
      const reader = new FileReader();
      reader.onloadend = () => setThumbnailPreview(reader.result);
      reader.readAsDataURL(file);
    }
  }

  async function handleMoveContent(index, direction) {
    const newContent = [...content];
    const targetIndex = direction === "up" ? index - 1 : index + 1;

    if (targetIndex < 0 || targetIndex >= newContent.length) return;

    // Swap items
    [newContent[index], newContent[targetIndex]] = [
      newContent[targetIndex],
      newContent[index],
    ];

    // Update display_order
    for (let i = 0; i < newContent.length; i++) {
      newContent[i].display_order = i + 1;
    }

    setContent(newContent);

    // Save to server
    try {
      await api.patch(
        `/admin/courses/${activeCourseId}/content/${newContent[index].id}`,
        {
          display_order: newContent[index].display_order,
        },
      );
      await api.patch(
        `/admin/courses/${activeCourseId}/content/${newContent[targetIndex].id}`,
        {
          display_order: newContent[targetIndex].display_order,
        },
      );
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDeleteContent() {
    if (!deleteContent) return;
    setBusy(true);
    try {
      await api.del(
        `/admin/courses/${activeCourseId}/content/${deleteContent.id}`,
      );
      setContent(content.filter((c) => c.id !== deleteContent.id));
      setDeleteContent(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const canGoToContent =
    mode === "edit" || (mode === "create" && activeCourseId);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-line bg-ink-800 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-ink-800 px-6 py-4">
          <h2 className="text-lg font-semibold text-white">
            {mode === "create" ? "Create New Course" : "Edit Course"}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X size={20} />
          </button>
        </div>

        {/* Step Indicator */}
        {canGoToContent ? (
          <div className="flex border-b border-line">
            <button
              className={`flex-1 px-6 py-3 text-sm font-medium transition ${
                step === 1
                  ? "border-b-2 border-accent-soft text-white"
                  : "text-slate-400 hover:text-slate-200"
              }`}
              onClick={() => setStep(1)}
            >
              Course Details
            </button>
            <button
              className={`flex-1 px-6 py-3 text-sm font-medium transition ${
                step === 2
                  ? "border-b-2 border-accent-soft text-white"
                  : "text-slate-400 hover:text-slate-200"
              }`}
              onClick={() => setStep(2)}
            >
              Content Management
            </button>
          </div>
        ) : null}

        {/* Body */}
        <div className="p-6">
          {error ? (
            <div className="mb-4 rounded-lg bg-bad/10 p-3 text-sm text-bad">
              {error}
            </div>
          ) : null}

          {step === 1 ? (
            <div className="space-y-4">
              <div>
                <label className="label">Course Title *</label>
                <input
                  type="text"
                  className="input"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Introduction to Machine Learning"
                />
              </div>

              <div>
                <label className="label">Short Description</label>
                <input
                  type="text"
                  className="input"
                  value={shortDescription}
                  onChange={(e) => setShortDescription(e.target.value)}
                  placeholder="Brief one-line summary"
                />
              </div>

              <div>
                <label className="label">Full Description</label>
                <textarea
                  className="input min-h-[100px]"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Detailed course description"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Category</label>
                  <input
                    type="text"
                    className="input"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    placeholder="e.g., Technology, Leadership"
                  />
                </div>

                <div>
                  <label className="label">Instructor/Creator</label>
                  <input
                    type="text"
                    className="input"
                    value={instructorName}
                    onChange={(e) => setInstructorName(e.target.value)}
                    placeholder="Instructor name"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Duration (hours)</label>
                  <input
                    type="number"
                    step="0.5"
                    className="input"
                    value={durationHours}
                    onChange={(e) => setDurationHours(e.target.value)}
                    placeholder="e.g., 2.5"
                  />
                </div>

                <div>
                  <label className="label">Difficulty</label>
                  <select
                    className="input"
                    value={difficulty}
                    onChange={(e) => setDifficulty(e.target.value)}
                  >
                    <option value="">Select difficulty</option>
                    <option value="Foundation">Foundation</option>
                    <option value="Intermediate">Intermediate</option>
                    <option value="Advanced">Advanced</option>
                    <option value="Expert">Expert</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="label">Course Thumbnail</label>
                <div className="flex items-center gap-4">
                  {thumbnailPreview ? (
                    <div className="h-24 w-32 overflow-hidden rounded-lg border border-line">
                      <img
                        src={thumbnailPreview}
                        alt="Thumbnail preview"
                        className="h-full w-full object-cover"
                      />
                    </div>
                  ) : null}
                  <label className="btn-secondary cursor-pointer">
                    <Upload size={16} />
                    {thumbnailPreview ? "Change Image" : "Upload Image"}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleThumbnailChange}
                    />
                  </label>
                </div>
              </div>
            </div>
          ) : (
            <ContentManager
              courseId={activeCourseId}
              content={content}
              setContent={setContent}
              onMove={handleMoveContent}
              onDelete={(item) => setDeleteContent(item)}
            />
          )}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-line bg-ink-800 px-6 py-4">
          <button className="btn-ghost" onClick={onClose} disabled={busy}>
            {step === 2 ? "Close" : "Cancel"}
          </button>
          {step === 1 ? (
            <button
              className="btn-primary"
              onClick={handleSaveCourse}
              disabled={busy}
            >
              {busy ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Saving...
                </>
              ) : mode === "create" ? (
                "Create & Add Content"
              ) : (
                "Save Changes"
              )}
            </button>
          ) : null}
        </div>
      </div>

      <ConfirmDialog
        open={Boolean(deleteContent)}
        title="Delete Content Item"
        message={`Delete "${deleteContent?.title}"? This cannot be undone.`}
        confirmLabel="Delete"
        busy={busy}
        onConfirm={handleDeleteContent}
        onCancel={() => setDeleteContent(null)}
      />
    </div>
  );
}

// Content Manager Component
function ContentManager({ courseId, content, setContent, onMove, onDelete }) {
  const [showAdd, setShowAdd] = useState(false);
  const [editItem, setEditItem] = useState(null);

  async function handleAddContent(newItem) {
    setContent([...content, newItem]);
    setShowAdd(false);
  }

  async function handleEditContent(updatedItem) {
    setContent(content.map((c) => (c.id === updatedItem.id ? updatedItem : c)));
    setEditItem(null);
  }

  if (content.length === 0 && !showAdd) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line bg-ink-900/50 py-14">
        <p className="text-sm font-medium text-slate-300">
          No content items yet
        </p>
        <p className="mt-1 text-xs text-slate-500">
          Add videos, PDFs, images, or text lessons
        </p>
        <button className="btn-primary mt-4" onClick={() => setShowAdd(true)}>
          <Plus size={16} />
          Add Content
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {content.map((item, index) => {
        const TypeIcon =
          CONTENT_TYPES.find((t) => t.value === item.content_type)?.icon ||
          FileText;
        return (
          <Card key={item.id} className="p-4">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-line bg-ink-900 text-accent-soft">
                <TypeIcon size={18} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h4 className="text-sm font-medium text-white">
                      {item.title}
                    </h4>
                    {item.description ? (
                      <p className="mt-1 text-xs text-slate-500">
                        {item.description}
                      </p>
                    ) : null}
                  </div>
                  <Badge className="bg-slate-500/15 text-slate-400">
                    {item.content_type}
                  </Badge>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    className="btn-ghost text-xs"
                    onClick={() => setEditItem(item)}
                    disabled={index === 0}
                  >
                    <Edit2 size={12} />
                    Edit
                  </button>
                  {index > 0 ? (
                    <button
                      className="btn-ghost text-xs"
                      onClick={() => onMove(index, "up")}
                    >
                      <ChevronUp size={12} />
                      Up
                    </button>
                  ) : null}
                  {index < content.length - 1 ? (
                    <button
                      className="btn-ghost text-xs"
                      onClick={() => onMove(index, "down")}
                    >
                      <ChevronDown size={12} />
                      Down
                    </button>
                  ) : null}
                  <button
                    className="btn-ghost text-xs text-bad"
                    onClick={() => onDelete(item)}
                  >
                    <Trash2 size={12} />
                    Delete
                  </button>
                </div>
              </div>
            </div>
          </Card>
        );
      })}

      <button className="btn-secondary w-full" onClick={() => setShowAdd(true)}>
        <Plus size={16} />
        Add Content Item
      </button>

      {showAdd ? (
        <ContentItemModal
          courseId={courseId}
          onClose={() => setShowAdd(false)}
          onSuccess={handleAddContent}
        />
      ) : null}

      {editItem ? (
        <ContentItemModal
          courseId={courseId}
          mode="edit"
          item={editItem}
          onClose={() => setEditItem(null)}
          onSuccess={handleEditContent}
        />
      ) : null}
    </div>
  );
}

// Content Item Modal
function ContentItemModal({
  courseId,
  mode = "create",
  item,
  onClose,
  onSuccess,
}) {
  const [contentType, setContentType] = useState(item?.content_type || "video");
  const [title, setTitle] = useState(item?.title || "");
  const [description, setDescription] = useState(item?.description || "");
  const [videoUrl, setVideoUrl] = useState(item?.video_url || "");
  const [externalUrl, setExternalUrl] = useState(item?.external_url || "");
  const [textContent, setTextContent] = useState(item?.text_content || "");
  const [durationMinutes, setDurationMinutes] = useState(
    item?.duration_minutes || "",
  );
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit() {
    if (!title.trim()) {
      setError("Title is required");
      return;
    }

    setBusy(true);
    setError("");

    try {
      const formData = new FormData();
      formData.append("content_type", contentType);
      formData.append("title", title.trim());
      if (description) formData.append("description", description.trim());
      if (videoUrl && contentType === "video")
        formData.append("video_url", videoUrl);
      if (externalUrl && contentType === "link")
        formData.append("external_url", externalUrl);
      if (textContent && contentType === "text")
        formData.append("text_content", textContent);
      if (durationMinutes) formData.append("duration_minutes", durationMinutes);
      if (file) formData.append("file", file);

      let result;
      if (mode === "create") {
        result = await api.upload(
          `/admin/courses/${courseId}/content`,
          formData,
        );
      } else {
        result = await api.patch(
          `/admin/courses/${courseId}/content/${item.id}`,
          {
            title: title.trim(),
            description: description.trim() || null,
            video_url: videoUrl || null,
            external_url: externalUrl || null,
            text_content: textContent || null,
            duration_minutes: durationMinutes
              ? parseInt(durationMinutes)
              : null,
          },
        );
      }

      onSuccess(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-xl border border-line bg-ink-800 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <h3 className="text-base font-semibold text-white">
            {mode === "create" ? "Add Content Item" : "Edit Content Item"}
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4 p-6">
          {error ? (
            <div className="rounded-lg bg-bad/10 p-3 text-sm text-bad">
              {error}
            </div>
          ) : null}

          {mode === "create" ? (
            <div>
              <label className="label">Content Type *</label>
              <select
                className="input"
                value={contentType}
                onChange={(e) => setContentType(e.target.value)}
              >
                {CONTENT_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          <div>
            <label className="label">Title *</label>
            <input
              type="text"
              className="input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Introduction Video"
            />
          </div>

          <div>
            <label className="label">Description</label>
            <textarea
              className="input min-h-[80px]"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description"
            />
          </div>

          {contentType === "video" && mode === "create" ? (
            <>
              <div>
                <label className="label">
                  Video URL (YouTube, Vimeo, etc.)
                </label>
                <input
                  type="url"
                  className="input"
                  value={videoUrl}
                  onChange={(e) => setVideoUrl(e.target.value)}
                  placeholder="https://www.youtube.com/watch?v=..."
                />
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span>OR</span>
              </div>
              <div>
                <label className="label">Upload Video File</label>
                <input
                  type="file"
                  accept="video/*"
                  className="input"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                />
              </div>
            </>
          ) : null}

          {contentType === "image" && mode === "create" ? (
            <div>
              <label className="label">Upload Image *</label>
              <input
                type="file"
                accept="image/*"
                className="input"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
            </div>
          ) : null}

          {contentType === "pdf" && mode === "create" ? (
            <div>
              <label className="label">Upload PDF *</label>
              <input
                type="file"
                accept=".pdf"
                className="input"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
            </div>
          ) : null}

          {contentType === "text" ? (
            <div>
              <label className="label">Text Content</label>
              <textarea
                className="input min-h-[150px]"
                value={textContent}
                onChange={(e) => setTextContent(e.target.value)}
                placeholder="Enter your content here"
              />
            </div>
          ) : null}

          {contentType === "link" ? (
            <div>
              <label className="label">External URL *</label>
              <input
                type="url"
                className="input"
                value={externalUrl}
                onChange={(e) => setExternalUrl(e.target.value)}
                placeholder="https://example.com"
              />
            </div>
          ) : null}

          <div>
            <label className="label">Duration (minutes)</label>
            <input
              type="number"
              className="input"
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(e.target.value)}
              placeholder="e.g., 15"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-line px-6 py-4">
          <button className="btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            className="btn-primary"
            onClick={handleSubmit}
            disabled={busy}
          >
            {busy ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Saving...
              </>
            ) : mode === "create" ? (
              "Add Content"
            ) : (
              "Save Changes"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
