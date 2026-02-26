/**
 * AWS IVS (Interactive Video Service) - fallback when all free-minute packages are exhausted.
 * Returns stream key and playback URL for teacher (broadcast) and student (view).
 * Configure: AWS_IVS_* env vars. When not set, returns null so frontend can show "not configured".
 */
const streamKey = process.env.AWS_IVS_STREAM_KEY || '';
const playbackUrl = process.env.AWS_IVS_PLAYBACK_URL || ''; // e.g. https://xxxxx.global-contribute.live-video.net/1.0.0/xxxxx.m3u8
const region = process.env.AWS_IVS_REGION || '';

function isConfigured() {
    return !!(streamKey && playbackUrl);
}

/**
 * Get IVS credentials for a channel (lesson). For IVS, channel name is typically the lesson id.
 * Teacher gets stream key + playback URL; student gets playback URL only.
 * @param {string} channelName - lesson id
 * @param {number} uid - user id (numeric)
 * @param {'publisher'|'subscriber'} role
 * @returns {{ streamKey?: string, playbackUrl: string, region?: string } | null}
 */
function getCredentials(channelName, uid, role) {
    if (!isConfigured()) return null;
    const out = { playbackUrl, region: region || undefined };
    if (role === 'publisher') out.streamKey = streamKey;
    return out;
}

module.exports = { getCredentials, isConfigured };
