const adminCategoryService = require('../services/adminCategoryService');
const adminSettingsService = require('../services/adminSettingsService');

/**
 * Public settings API - no auth required.
 * Returns platform settings: categories, share percentages, discounts.
 */
async function getSettings(req, res) {
    try {
        const [tree, platformSettings] = await Promise.all([
            adminCategoryService.getTreeForSelect(),
            adminSettingsService.getAllForPublic(),
        ]);
        res.json({
            categories: tree.map(c => ({
                id: c.id,
                name: c.name,
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
        });
    } catch (error) {
        console.error('Get settings error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

module.exports = { getSettings };
