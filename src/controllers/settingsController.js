const adminCategoryService = require('../services/adminCategoryService');
const adminSettingsService = require('../services/adminSettingsService');

/**
 * Public settings API - no auth required.
 * Returns platform settings: categories, share percentages, coupons, discounts.
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
                level: c.level,
            })),
            share: platformSettings.share,
            coupons: platformSettings.coupons,
            discounts: platformSettings.discounts,
        });
    } catch (error) {
        console.error('Get settings error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

module.exports = { getSettings };
