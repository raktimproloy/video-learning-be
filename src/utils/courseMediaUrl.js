const r2Storage = require('../services/r2StorageService');
const { normalizeExternalImageUrl } = require('./externalMediaUrl');

/**
 * Resolve a public URL for a stored course media key (thumbnail / intro video).
 * Mirrors the logic in courseController.enrichCourseMediaUrls, kept standalone so
 * lightweight endpoints can reuse it without pulling in that controller.
 * @param {string|null|undefined} storedPath
 * @returns {string|null}
 */
function resolveCourseMediaUrl(storedPath) {
    if (!storedPath) return null;
    const apiUrl = process.env.BASE_URL || 'http://localhost:5000';
    const v1Url = `${apiUrl}/v1`;

    const publicUrl = r2Storage.getPublicUrl ? r2Storage.getPublicUrl(storedPath) : null;
    if (publicUrl) return publicUrl;
    if (storedPath.startsWith('teachers/')) {
        return `${v1Url}/courses/media/${encodeURIComponent(storedPath)}`;
    }
    if (storedPath.startsWith('/uploads/')) {
        return `${apiUrl}${storedPath}`;
    }
    return `${apiUrl}${storedPath.startsWith('/') ? '' : '/'}${storedPath}`;
}

/** Best thumbnail URL for a course-like row (stored key first, then external URL). */
function resolveCourseThumbnailUrl({ thumbnail_path, external_thumbnail_url } = {}) {
    return resolveCourseMediaUrl(thumbnail_path) || normalizeExternalImageUrl(external_thumbnail_url);
}

/**
 * Resolve a public URL for a stored profile image key (teacher / student avatar).
 * @param {string|null|undefined} storedPath e.g. "teachers/<id>/avatar/x.jpg" or "students/..."
 * @returns {string|null}
 */
function resolveProfileImageUrl(storedPath) {
    if (!storedPath) return null;
    const apiUrl = process.env.BASE_URL || 'http://localhost:5000';
    const v1Url = `${apiUrl}/v1`;

    const publicUrl = r2Storage.getPublicUrl ? r2Storage.getPublicUrl(storedPath) : null;
    if (publicUrl) return publicUrl;
    if (storedPath.startsWith('teachers/')) {
        return `${v1Url}/teacher/profile/image/${encodeURIComponent(storedPath)}`;
    }
    if (storedPath.startsWith('students/')) {
        return `${v1Url}/student/profile/image/${encodeURIComponent(storedPath)}`;
    }
    if (storedPath.startsWith('/uploads/')) {
        return `${apiUrl}${storedPath}`;
    }
    return `${apiUrl}${storedPath.startsWith('/') ? '' : '/'}${storedPath}`;
}

module.exports = {
    resolveCourseMediaUrl,
    resolveCourseThumbnailUrl,
    resolveProfileImageUrl,
};
