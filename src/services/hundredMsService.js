/**
 * 100ms.live - live class provider with free-minute package.
 * Returns room/token for teacher and student when configured.
 * Configure: HM_* env vars. When not set, returns null.
 */
const authToken = process.env.HM_AUTH_TOKEN || '';       // 100ms dashboard auth / API token
const templateId = process.env.HM_TEMPLATE_ID || '';    // room template id
const appAccessKey = process.env.HM_APP_ACCESS_KEY || '';
const appSecret = process.env.HM_APP_SECRET || '';

function isConfigured() {
    return !!(appAccessKey && appSecret);
}

/**
 * Get 100ms credentials for joining a room. Room id can be derived from lesson id.
 * Returns management token or app token for client SDK.
 * Stub: returns null until 100ms SDK/API is integrated. Frontend can show "100ms not configured".
 * @param {string} channelName - lesson id
 * @param {number} uid - user id
 * @param {'publisher'|'subscriber'} role
 * @returns {object | null} e.g. { roomId, token, role } or null
 */
function getCredentials(channelName, uid, role) {
    if (!isConfigured()) return null;
    // TODO: call 100ms API to create room and get join token (roomId, appId, token)
    // For now return a placeholder so provider selection works; frontend will need 100ms SDK.
    return {
        roomId: channelName,
        templateId: templateId || undefined,
        appAccessKey,
        role: role === 'publisher' ? 'host' : 'viewer',
        message: 'Configure HM_APP_ACCESS_KEY and HM_APP_SECRET; integrate 100ms SDK for full support.',
    };
}

module.exports = { getCredentials, isConfigured };
