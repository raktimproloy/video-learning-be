/**
 * Institute staff login emails — platform-owned namespace.
 *
 * Format: {username}@{institute-slug}.staff.{rootDomain}
 * Example:  manager@avilash-teach.staff.shikkhabhumi.com
 *
 * These are internal login identifiers (not real mailboxes). Public
 * register / Google sign-up must never accept this pattern.
 */

function getStaffEmailRootDomain() {
  const raw =
    process.env.STAFF_EMAIL_ROOT_DOMAIN ||
    process.env.ROOT_DOMAIN ||
    process.env.NEXT_PUBLIC_ROOT_DOMAIN ||
    'shikkhabhumi.com';
  return String(raw)
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/$/, '') || 'shikkhabhumi.com';
}

function normalizeInstituteSlug(row) {
  if (!row) return null;
  let label = String(row.slug || '').trim().toLowerCase();
  if (!label || label.startsWith('d-')) {
    label = String(row.name || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }
  if (!label || label.length < 2) return null;
  if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) return null;
  return label;
}

/**
 * @returns {string|null} e.g. avilash-teach.staff.shikkhabhumi.com
 */
function buildStaffEmailDomain(instituteRow) {
  const slug = normalizeInstituteSlug(instituteRow);
  if (!slug) return null;
  return `${slug}.staff.${getStaffEmailRootDomain()}`;
}

function buildStaffEmail(username, domain) {
  return `${String(username || '').trim().toLowerCase()}@${domain}`;
}

/**
 * True if this address is reserved for institute staff logins.
 */
function isStaffEmailAddress(email) {
  const e = String(email || '').trim().toLowerCase();
  const at = e.lastIndexOf('@');
  if (at < 1 || at === e.length - 1) return false;
  const domain = e.slice(at + 1);
  const root = getStaffEmailRootDomain();
  if (!domain || !root) return false;
  return domain === `staff.${root}` || domain.endsWith(`.staff.${root}`);
}

function staffEmailBlockedMessage() {
  const root = getStaffEmailRootDomain();
  return `Emails ending with .staff.${root} are reserved for institute staff accounts and cannot be used to sign up.`;
}

module.exports = {
  getStaffEmailRootDomain,
  normalizeInstituteSlug,
  buildStaffEmailDomain,
  buildStaffEmail,
  isStaffEmailAddress,
  staffEmailBlockedMessage,
};
