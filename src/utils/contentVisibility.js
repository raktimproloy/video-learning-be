/**
 * Notes/assignments are JSONB items with optional isPublic (default false).
 * Private items must never leak content/file paths to non-enrolled viewers.
 */

function isItemPublic(item) {
  if (!item || typeof item !== 'object') return false;
  return item.isPublic === true || item.is_public === true;
}

function sanitizeNote(note, fullAccess) {
  if (!note || typeof note !== 'object') return null;
  const isPublic = isItemPublic(note);
  if (fullAccess || isPublic) {
    const { file: _f, fileUrl: _u, ...rest } = note;
    return { ...rest, isPublic };
  }
  return {
    id: note.id,
    title: (note.title && String(note.title).trim()) || note.fileName || 'Note',
    type: note.type || 'text',
    isPublic: false,
    accessLocked: true,
  };
}

function sanitizeAssignment(assignment, fullAccess) {
  if (!assignment || typeof assignment !== 'object') return null;
  const isPublic = isItemPublic(assignment);
  if (fullAccess || isPublic) {
    const { file: _f, fileUrl: _u, ...rest } = assignment;
    return { ...rest, isPublic, isRequired: !!assignment.isRequired };
  }
  return {
    id: assignment.id,
    title: (assignment.title && String(assignment.title).trim()) || 'Assignment',
    type: assignment.type || 'text',
    isRequired: !!assignment.isRequired,
    isPublic: false,
    accessLocked: true,
  };
}

function sanitizeNotes(notes, fullAccess) {
  if (!Array.isArray(notes)) return [];
  return notes.map((n) => sanitizeNote(n, fullAccess)).filter(Boolean);
}

function sanitizeAssignments(assignments, fullAccess) {
  if (!Array.isArray(assignments)) return [];
  return assignments.map((a) => sanitizeAssignment(a, fullAccess)).filter(Boolean);
}

/**
 * Student-facing exam list item. Never includes questions/answers.
 * Private + not enrolled → title only (accessLocked).
 */
function sanitizeExamForStudentList(exam, fullAccess) {
  if (!exam) return null;
  const isPublic = exam.is_public === true || exam.isPublic === true;
  const isRequired = exam.is_required === true || exam.isRequired === true;
  const base = {
    id: exam.id,
    title: exam.title,
    is_public: isPublic,
    is_required: isRequired,
    isPublic,
    isRequired,
    status: exam.status,
    lesson_id: exam.lesson_id || null,
    video_id: exam.video_id || null,
    course_id: exam.course_id,
    created_at: exam.created_at,
    updated_at: exam.updated_at,
  };
  if (fullAccess || isPublic) {
    return {
      ...base,
      description: exam.description,
      time_limit_minutes: exam.time_limit_minutes,
      total_marks: exam.total_marks,
      questions: [],
      grading_bands: Array.isArray(exam.grading_bands) ? exam.grading_bands : [],
      accessLocked: false,
    };
  }
  return {
    ...base,
    description: null,
    time_limit_minutes: null,
    total_marks: null,
    questions: [],
    grading_bands: [],
    accessLocked: true,
  };
}

module.exports = {
  isItemPublic,
  sanitizeNote,
  sanitizeAssignment,
  sanitizeNotes,
  sanitizeAssignments,
  sanitizeExamForStudentList,
};
