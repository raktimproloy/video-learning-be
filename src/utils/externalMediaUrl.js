/**
 * Normalize an optional remote image URL (course thumbnail from the web).
 * Only http(s) is allowed; returns null if missing or unsafe/invalid.
 * @param {unknown} raw
 * @returns {string|null}
 */
function normalizeExternalImageUrl(raw) {
    if (raw == null) return null;
    const s = String(raw).trim();
    if (!s) return null;
    let url;
    try {
        url = s.startsWith('//') ? new URL(`https:${s}`) : new URL(s);
    } catch {
        return null;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!url.hostname) return null;
    if (url.username || url.password) return null;
    return url.toString();
}

module.exports = { normalizeExternalImageUrl };
