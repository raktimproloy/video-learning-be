const adminCategoryService = require('../services/adminCategoryService');
const adminSettingsService = require('../services/adminSettingsService');
const crypto = require('crypto');
const cache = require('../utils/ttlCache');

/**
 * Public settings API - no auth required.
 * Returns platform settings: categories, share percentages, discounts.
 */
async function getSettings(req, res) {
    try {
        const body = await cache.getOrSet('public:settings:v1', 10 * 60 * 1000, async () => {
            const [tree, platformSettings] = await Promise.all([
                adminCategoryService.getTreeForSelect(),
                adminSettingsService.getAllForPublic(),
            ]);
            return {
                categories: tree.map(c => ({
                    id: c.id,
                    name: c.name,
                    nameBn: c.nameBn ?? null,
                    slug: c.slug || c.name.toLowerCase().replace(/\s+/g, '-'),
                    path: c.path,
                    level: c.level ?? 0,
                    parentId: c.parentId ?? null,
                    courseCount: c.courseCount ?? 0,
                    displayOrder: c.displayOrder ?? 0,
                })),
                share: platformSettings.share,
                discounts: platformSettings.discounts,
                live: platformSettings.live || { liveClassEnabled: true, agoraEnabled: true, hundredMsEnabled: true, awsIvsEnabled: false, youtubeEnabled: true },
            };
        });

        // HTTP caching: allow browsers/CDNs to reuse this response for a short time.
        // This endpoint is public and changes infrequently.
        const json = JSON.stringify(body);
        const etag = `W/"${crypto.createHash('sha1').update(json).digest('hex')}"`;
        res.set('ETag', etag);
        res.set('Cache-Control', 'public, max-age=600, stale-while-revalidate=300');

        const inm = req.headers['if-none-match'];
        if (inm && String(inm) === etag) {
            return res.status(304).end();
        }

        res.json(body);
    } catch (error) {
        console.error('Get settings error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

module.exports = { getSettings };
