/**
 * Send push notifications to users via FCM (all registered devices per user).
 * Fire-and-forget: does not throw; logs errors.
 */

const userFcmTokenService = require('./userFcmTokenService');
const fcmService = require('./fcmService');

/**
 * Send a push to one user (all their devices). Does not throw.
 * Removes invalid tokens from DB when FCM reports them.
 * @param {string} userId - User UUID
 * @param {object} payload - { title, body, data?: Record<string, string> }
 */
async function sendToUser(userId, payload) {
    if (!userId) return;
    const tokens = await userFcmTokenService.getAllTokensByUserId(userId).catch(() => []);
    if (tokens.length === 0) return;
    const { title, body, data = {} } = payload;
    for (const token of tokens) {
        try {
            const result = await fcmService.sendToToken(token, { title, body, data });
            if (result.invalidToken) {
                await userFcmTokenService.removeToken(userId, token);
            }
        } catch (err) {
            console.warn('[Push] sendToUser failed for token:', err?.message || err);
        }
    }
}

/**
 * Send a push to many users (each gets the same payload on all their devices). Does not throw.
 * @param {string[]} userIds - Array of user UUIDs
 * @param {object} payload - { title, body, data?: Record<string, string> }
 */
async function sendToManyUsers(userIds, payload) {
    if (!Array.isArray(userIds) || userIds.length === 0) return;
    const unique = [...new Set(userIds)].filter(Boolean);
    await Promise.all(unique.map((uid) => sendToUser(uid, payload)));
}

module.exports = {
    sendToUser,
    sendToManyUsers,
};
