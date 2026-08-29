const db = require('../../db');
const r2Storage = require('./r2StorageService');

const LADDER_VARIANTS = ['360p', '720p', '1080p'];

function normalizePlaybackResolutions(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value.filter(Boolean);
    return [];
}

/** Adaptive ladder = 2+ standard rungs (matches new multi-quality flow). */
function hasAdaptivePlayback(playbackResolutions) {
    const ladder = normalizePlaybackResolutions(playbackResolutions).filter((r) =>
        LADDER_VARIANTS.includes(r)
    );
    return ladder.length >= 2;
}

function formatPlaybackLabel(playbackResolutions) {
    const ladder = normalizePlaybackResolutions(playbackResolutions).filter((r) =>
        LADDER_VARIANTS.includes(r)
    );
    if (ladder.length >= 2) return ladder.join(' · ');
    const all = normalizePlaybackResolutions(playbackResolutions);
    if (all.includes('legacy')) return 'Single quality';
    if (all.length === 1 && LADDER_VARIANTS.includes(all[0])) return `${all[0]} only`;
    if (all.includes('original')) return 'Original quality';
    return null;
}

/**
 * Probe R2 for variant playlists (cached result written to videos.playback_resolutions).
 */
async function probeR2Variants(r2Key) {
    if (!r2Key || !r2Storage.isConfigured) return [];

    const checks = await Promise.all(
        LADDER_VARIANTS.map(async (name) => {
            const exists = await r2Storage.objectExists(`${r2Key}/${name}/playlist.m3u8`);
            return exists ? name : null;
        })
    );
    const found = checks.filter(Boolean);
    if (found.length > 0) return found;

    if (await r2Storage.objectExists(`${r2Key}/original/playlist.m3u8`)) {
        return ['original'];
    }
    if (await r2Storage.objectExists(`${r2Key}/master.m3u8`)) {
        return ['legacy'];
    }
    return [];
}

async function cachePlaybackResolutions(videoId, resolutions) {
    await db.query('UPDATE videos SET playback_resolutions = $1 WHERE id = $2', [
        resolutions.length > 0 ? resolutions : null,
        videoId,
    ]);
    return resolutions;
}

async function ensureCachedForVideo(video) {
    if (!video?.id || !video?.r2_key) return normalizePlaybackResolutions(video?.playback_resolutions);
    if (video.playback_resolutions && video.playback_resolutions.length > 0) {
        return normalizePlaybackResolutions(video.playback_resolutions);
    }
    const detected = await probeR2Variants(video.r2_key);
    await cachePlaybackResolutions(video.id, detected);
    return detected;
}

async function ensureCachedForVideos(videos, concurrency = 6) {
    const pending = videos.filter(
        (v) =>
            v.status === 'active' &&
            v.r2_key &&
            (!v.playback_resolutions || v.playback_resolutions.length === 0)
    );
    if (pending.length === 0) return;

    let index = 0;
    const workers = Array.from({ length: Math.min(concurrency, pending.length) }, async () => {
        while (index < pending.length) {
            const current = pending[index++];
            try {
                const detected = await ensureCachedForVideo(current);
                current.playback_resolutions = detected;
            } catch (err) {
                console.warn(
                    '[PlaybackResolution] probe failed for video',
                    current.id,
                    err.message
                );
            }
        }
    });
    await Promise.all(workers);
}

module.exports = {
    LADDER_VARIANTS,
    normalizePlaybackResolutions,
    hasAdaptivePlayback,
    formatPlaybackLabel,
    probeR2Variants,
    cachePlaybackResolutions,
    ensureCachedForVideo,
    ensureCachedForVideos,
};
