const crypto = require('crypto');
const cache = require('../utils/ttlCache');
const teacherDiscoveryService = require('../services/teacherDiscoveryService');

function buildProfileImageUrl(req, profileImagePath) {
  if (!profileImagePath) return null;
  // Teacher profile images are stored under teachers/... and streamed via /v1/teacher/profile/image/<key>
  if (String(profileImagePath).startsWith('teachers/')) {
    return `${req.protocol}://${req.get('host')}/v1/teacher/profile/image/${encodeURIComponent(profileImagePath)}`;
  }
  // Local uploads fallback
  if (String(profileImagePath).startsWith('/uploads/')) {
    return `${req.protocol}://${req.get('host')}${profileImagePath}`;
  }
  // Default/static avatars under /images
  if (
    String(profileImagePath).startsWith('/images/') ||
    String(profileImagePath).startsWith('images/')
  ) {
    const path = String(profileImagePath).startsWith('/')
      ? String(profileImagePath)
      : `/${String(profileImagePath)}`;
    return `${req.protocol}://${req.get('host')}${path}`;
  }
  return profileImagePath;
}

class TeacherDiscoveryController {
  /**
   * GET /v1/teachers/best?limit=20&cursor=0&category=academic|skill|both
   * Public endpoint. Uses server-side cache + ETag.
   */
  async listBest(req, res) {
    try {
      const limit = req.query.limit;
      const cursor = req.query.cursor;
      const category = req.query.category || '';

      const key = `public:bestTeachers:v1:limit=${limit || ''}:cursor=${cursor || ''}:category=${String(category).trim().toLowerCase()}`;
      const body = await cache.getOrSet(key, 60 * 1000, async () => {
        const data = await teacherDiscoveryService.listBestTeachers({ limit, cursor, category });
        return data;
      });

      // Add computed image URLs for frontend convenience (do not cache host-specific parts in server cache)
      const responseBody = {
        ...body,
        teachers: (body.teachers || []).map((t) => ({
          ...t,
          profileImageUrl: buildProfileImageUrl(req, t.profileImagePath),
        })),
      };

      const json = JSON.stringify(responseBody);
      const etag = `W/"${crypto.createHash('sha1').update(json).digest('hex')}"`;
      res.set('ETag', etag);
      res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=120');
      const inm = req.headers['if-none-match'];
      if (inm && String(inm) === etag) {
        return res.status(304).end();
      }

      return res.json(responseBody);
    } catch (error) {
      console.error('List best teachers error:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
}

module.exports = new TeacherDiscoveryController();

