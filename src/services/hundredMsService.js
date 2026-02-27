/**
 * 100ms.live - live class provider with free-minute package.
 * Returns room/token for teacher and student when configured.
 *
 * Env vars:
 * - HM_APP_ACCESS_KEY: 100ms dashboard access key
 * - HM_APP_SECRET: 100ms dashboard app secret
 * - HM_TEMPLATE_ID: 100ms template id for this classroom
 */
const HMS = require('@100mslive/server-sdk');

const templateId = process.env.HM_TEMPLATE_ID || '';
const appAccessKey = process.env.HM_APP_ACCESS_KEY || '';
const appSecret = process.env.HM_APP_SECRET || '';
// These must match the role names configured in your 100ms template.
// Defaults assume common "host" / "viewer" roles but can be overridden via env.
const publisherRole = process.env.HM_PUBLISHER_ROLE || 'host';
const subscriberRole = process.env.HM_SUBSCRIBER_ROLE || 'viewer';

let hmsInstance = null;

function getSdk() {
    if (!hmsInstance) {
        hmsInstance = new HMS.SDK(appAccessKey, appSecret);
    }
    return hmsInstance;
}

function isConfigured() {
    return !!(appAccessKey && appSecret && templateId);
}

/**
 * Get 100ms credentials for joining a room. Room id is derived from lesson id.
 * Returns a short-lived auth token for the specified role.
 * @param {string} channelName - lesson id (used as room name)
 * @param {number} uid - user id (not used directly, but reserved for future metadata)
 * @param {'publisher'|'subscriber'} role
 * @returns {Promise<object | null>} e.g. { roomId, authToken, role } or null
 */
async function getCredentials(channelName, uid, role) {
    if (!isConfigured()) return null;

    const sdk = getSdk();
    const roomName = `lesson-${channelName}`;
    const userRole = role === 'publisher' ? publisherRole : subscriberRole;

    try {
        let room = null;

        try {
            const rooms = await sdk.rooms.list({ limit: 1, name: roomName });
            room = Array.isArray(rooms?.data) && rooms.data.length > 0 ? rooms.data[0] : null;
        } catch (e) {
            // If listing fails, fall back to create below.
        }

        if (!room) {
            room = await sdk.rooms.create({
                name: roomName,
                template_id: templateId,
            });
        }

        // Generate client auth token for this room and role
        const auth = await sdk.auth.getAuthToken({
            roomId: room.id,
            role: userRole,
            userId: String(uid),
        });

        const authToken = auth && typeof auth.token === 'string' ? auth.token : null;
        if (!authToken) {
            throw new Error('Failed to generate 100ms auth token');
        }

        return {
            roomId: room.id,
            templateId,
            role: userRole,
            authToken,
        };
    } catch (error) {
        console.error('100ms getCredentials error:', error?.response?.data || error);
        return null;
    }
}

module.exports = { getCredentials, isConfigured };
