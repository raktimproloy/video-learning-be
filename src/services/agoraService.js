const { RtcTokenBuilder, RtcRole } = require('agora-access-token');

const APP_ID = process.env.AGORA_APP_ID || '';
const APP_CERTIFICATE = process.env.AGORA_APP_CERTIFICATE || '';
const TOKEN_EXPIRY_SECONDS = 3600; // 1 hour

/**
 * Generate Agora RTC token for a channel (lesson live stream).
 * @param {string} channelName - Agora channel (use lessonId)
 * @param {number} uid - User ID as integer (0 or positive)
 * @param {'publisher'|'subscriber'} role - publisher = host/teacher, subscriber = audience/student
 * @returns {{ token: string, channel: string, uid: number, appId: string } | null}
 */
function generateRtcToken(channelName, uid, role) {
    if (!APP_ID) return null;
    const roleValue = role === 'publisher' ? RtcRole.PUBLISHER : RtcRole.SUBSCRIBER;
    const currentTs = Math.floor(Date.now() / 1000);
    const privilegeExpiredTs = currentTs + TOKEN_EXPIRY_SECONDS;

    let token;
    if (APP_CERTIFICATE) {
        token = RtcTokenBuilder.buildTokenWithUid(
            APP_ID,
            APP_CERTIFICATE,
            channelName,
            uid,
            roleValue,
            privilegeExpiredTs
        );
    } else {
        token = null; // Testing without certificate (nullable token)
    }

    return {
        appId: APP_ID,
        channel: channelName,
        token,
        uid,
    };
}

module.exports = { generateRtcToken, APP_ID };
