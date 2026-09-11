/**
 * Normalize a page path by replacing dynamic id-like segments with `:id`, so
 * analytics aggregates (top/entry/exit pages) group `/watch/<uuid>` and
 * `/watch/<other-uuid>` together instead of listing one row per course/video.
 * The real `page_path` is stored alongside untouched, for drill-in.
 *
 * Regex-based (not a hand-maintained route table) so it works the same for
 * web (Next.js) and app (expo-router) paths without needing to track every
 * dynamic route on both platforms.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MONGO_ID_RE = /^[0-9a-f]{24}$/i;
const LONG_NUMERIC_RE = /^\d{4,}$/;

function toPageTemplate(pagePath) {
  if (!pagePath || typeof pagePath !== 'string') return pagePath || '/';
  const path = pagePath.split('?')[0].split('#')[0];
  const segments = path.split('/').map((seg) => {
    if (!seg) return seg;
    if (UUID_RE.test(seg) || MONGO_ID_RE.test(seg) || LONG_NUMERIC_RE.test(seg)) return ':id';
    return seg;
  });
  const joined = segments.join('/');
  return joined || '/';
}

module.exports = { toPageTemplate };
