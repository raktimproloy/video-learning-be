const adminSettingsService = require('../services/adminSettingsService');
const r2StorageService = require('../services/r2StorageService');

/**
 * GET /v1/app/download — always serves the current published APK.
 * Public, no auth. Streams through our own domain (not a raw R2 URL) so
 * the link users see/scan always stays on shikkhabhumi.com.
 */
async function download(req, res) {
    try {
        const release = await adminSettingsService.getCurrentAppRelease();
        if (!release) {
            return res.status(404).json({ error: 'No app release is published yet' });
        }

        const publicUrl = r2StorageService.getPublicUrl(release.fileKey);
        if (publicUrl) {
            return res.redirect(302, publicUrl);
        }

        res.setHeader('Content-Type', 'application/vnd.android.package-archive');
        res.setHeader('Content-Length', String(release.fileSizeBytes));
        res.setHeader(
            'Content-Disposition',
            `attachment; filename="shikkhabhumi-v${release.versionName}.apk"`
        );
        const stream = await r2StorageService.getObjectStream(release.fileKey);
        stream.pipe(res);
    } catch (error) {
        console.error('App download error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

module.exports = { download };
