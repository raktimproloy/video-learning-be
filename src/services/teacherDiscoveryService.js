const db = require('../../db');
const adminCategoryService = require('./adminCategoryService');
const cache = require('../utils/ttlCache');
const { hasColumn } = require('../utils/dbSchemaCache');

function clampInt(value, { min, max, fallback }) {
  const n = parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * Public best-teachers listing.
 *
 * Goals:
 * - Fast: single query + cached for anonymous traffic
 * - Stable order: rating desc, then course_count, then student_count, then review_count, then created_at, then id
 * - Category derived from teacher's active courses:
 *   - academic: teacher has any course under Academic category tree (or legacy slug)
 *   - skill: teacher has any course under Skill-based category tree (or legacy slug)
 *   - both: teacher has both
 */
class TeacherDiscoveryService {
  async _getTopCategoryIds() {
    const [academicIds, skillIds] = await Promise.all([
      cache.getOrSet('public:catIds:academic', 10 * 60 * 1000, async () => {
        return await adminCategoryService.getCategoryAndDescendantIds('academic');
      }),
      cache.getOrSet('public:catIds:skill-based', 10 * 60 * 1000, async () => {
        return await adminCategoryService.getCategoryAndDescendantIds('skill-based');
      }),
    ]);
    return {
      academicIds: Array.isArray(academicIds) ? academicIds : [],
      skillIds: Array.isArray(skillIds) ? skillIds : [],
    };
  }

  /**
   * @param {{ limit?: number, cursor?: number, category?: 'academic'|'skill'|'both'|'' }} options
   */
  async listBestTeachers(options = {}) {
    const limit = clampInt(options.limit, { min: 1, max: 50, fallback: 20 });
    const cursor = clampInt(options.cursor, { min: 0, max: 1_000_000_000, fallback: 0 });
    const category = String(options.category || '').trim().toLowerCase();

    const { academicIds, skillIds } = await this._getTopCategoryIds();

    // Filters: match frontend behavior:
    // - category=academic => teachers with academic OR both
    // - category=skill => teachers with skill OR both
    // - category=both => teachers with both only
    // A user is considered a teacher if either:
    // - users.role = 'teacher' (legacy / explicit)
    // - OR they have a teacher_profiles row (join-as-teacher flow)
    const where = [`(u.role = 'teacher' OR tp.user_id IS NOT NULL)`];
    const params = [];
    const hasIsVerified = await hasColumn('teacher_profiles', 'is_verified');
    const verifiedSelect = hasIsVerified ? `COALESCE(tp.is_verified, false)` : `false`;

    // category ids arrays (uuid[]) for course classification
    params.push(academicIds.map(String));
    const academicParamIndex = params.length;
    params.push(skillIds.map(String));
    const skillParamIndex = params.length;

    // pagination
    params.push(limit + 1);
    const limitParamIndex = params.length;
    params.push(cursor);
    const offsetParamIndex = params.length;

    let categoryFilterSql = '';
    if (category === 'both') {
      categoryFilterSql = `AND (has_academic AND has_skill)`;
    } else if (category === 'academic') {
      categoryFilterSql = `AND has_academic`;
    } else if (category === 'skill' || category === 'skill-based') {
      categoryFilterSql = `AND has_skill`;
    }

    // Note: We only count ACTIVE courses for category + course_count + student_count.
    // This prevents drafts/inactive from affecting ranking.
    const sql = `
      WITH course_flags AS (
        SELECT
          c.teacher_id,
          BOOL_OR(
            c.status = 'active'
            AND (
              c.admin_category_id = ANY($${academicParamIndex}::uuid[])
              OR c.main_category_id = ANY($${academicParamIndex}::uuid[])
              OR c.sub_category_id = ANY($${academicParamIndex}::uuid[])
              OR LOWER(REPLACE(TRIM(COALESCE(c.category, '')), ' ', '-')) = 'academic'
            )
          ) AS has_academic,
          BOOL_OR(
            c.status = 'active'
            AND (
              c.admin_category_id = ANY($${skillParamIndex}::uuid[])
              OR c.main_category_id = ANY($${skillParamIndex}::uuid[])
              OR c.sub_category_id = ANY($${skillParamIndex}::uuid[])
              OR LOWER(REPLACE(TRIM(COALESCE(c.category, '')), ' ', '-')) IN ('skill-based', 'skill')
            )
          ) AS has_skill
        FROM courses c
        GROUP BY c.teacher_id
      ),
      teacher_stats AS (
        SELECT
          u.id,
          u.email,
          u.created_at,
          COALESCE(tp.name, u.email) AS name,
          tp.profile_image_path,
          tp.institute_name,
          ${verifiedSelect} AS verified,
          COALESCE(cf.has_academic, false) AS has_academic,
          COALESCE(cf.has_skill, false) AS has_skill,
          (SELECT COUNT(*)::int FROM courses c WHERE c.teacher_id = u.id AND c.status = 'active') AS course_count,
          (SELECT COUNT(DISTINCT ce.user_id)::int
             FROM course_enrollments ce
             JOIN courses c ON ce.course_id = c.id
            WHERE c.teacher_id = u.id AND c.status = 'active'
          ) AS student_count,
          (SELECT COALESCE(AVG(tr.rating), 0)::float FROM teacher_reviews tr WHERE tr.teacher_id = u.id) AS rating,
          (SELECT COUNT(*)::int FROM teacher_reviews tr WHERE tr.teacher_id = u.id) AS review_count
        FROM users u
        LEFT JOIN teacher_profiles tp ON u.id = tp.user_id
        LEFT JOIN course_flags cf ON cf.teacher_id = u.id
        WHERE ${where.join(' AND ')}
      )
      SELECT
        id,
        name,
        email,
        profile_image_path,
        institute_name,
        verified,
        rating,
        review_count,
        course_count,
        student_count,
        CASE
          WHEN has_academic AND has_skill THEN 'both'
          WHEN has_academic THEN 'academic'
          WHEN has_skill THEN 'skill'
          ELSE NULL
        END AS category
      FROM teacher_stats
      WHERE 1=1
        ${categoryFilterSql}
      ORDER BY
        rating DESC,
        course_count DESC,
        student_count DESC,
        review_count DESC,
        created_at DESC,
        id DESC
      LIMIT $${limitParamIndex}::integer
      OFFSET $${offsetParamIndex}::integer
    `;

    const result = await db.query(sql, params);
    const rows = Array.isArray(result.rows) ? result.rows : [];

    const pageRows = rows.slice(0, limit);
    const hasMore = rows.length > limit;
    const nextCursor = hasMore ? cursor + limit : null;

    const teachers = pageRows.map((r) => ({
      id: r.id,
      name: r.name,
      instituteName: r.institute_name || null,
      profileImagePath: r.profile_image_path || null,
      verified: !!r.verified,
      rating: Number(r.rating) || 0,
      reviewCount: Number(r.review_count) || 0,
      courseCount: Number(r.course_count) || 0,
      totalStudents: Number(r.student_count) || 0,
      category: r.category || null,
    }));

    return {
      teachers,
      limit,
      cursor,
      nextCursor,
      hasMore,
    };
  }
}

module.exports = new TeacherDiscoveryService();

