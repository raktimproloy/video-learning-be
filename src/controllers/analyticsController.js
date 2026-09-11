const crypto = require('crypto');
const db = require('../../db');
const parseUserAgent = require('../utils/uaParser');
const { getCountry } = require('../utils/geoIp');
const { recordHeartbeat } = require('../services/analyticsBatchService');
const { toPageTemplate } = require('../utils/pageTemplate');

const VALID_PLATFORMS = new Set(['web', 'app']);

class AnalyticsController {
    /**
     * Log a page view event.
     * Extracts IP, user agent, parses browser/OS/device, resolves country, and inserts a database record.
     */
    async logPageView(req, res) {
        try {
            const {
                sessionId, pagePath, referrer, visitorId, platform,
                utmSource, utmMedium, utmCampaign, utmTerm, utmContent,
                // The app can't be usefully UA-sniffed — let it report these explicitly.
                deviceType: deviceTypeOverride, os: osOverride,
            } = req.body;

            if (!sessionId || !pagePath) {
                return res.status(400).json({ error: 'Missing required parameters: sessionId and pagePath' });
            }

            // Detect Client IP
            const ipAddress = req.clientIp || '';

            // Parse User-Agent details (web); the app sends deviceType/os explicitly instead.
            const userAgent = req.headers['user-agent'] || '';
            const parsedUa = parseUserAgent(userAgent);
            const browser = parsedUa.browser;
            const os = osOverride || parsedUa.os;
            const deviceType = deviceTypeOverride || parsedUa.deviceType;

            // Resolve Country from IP
            const country = await getCountry(ipAddress);

            // Parse Referrer Domain
            let referrerDomain = 'Direct / Bookmark';
            if (referrer) {
                try {
                    const parsedUrl = new URL(referrer);
                    referrerDomain = parsedUrl.hostname;
                    if (referrerDomain.startsWith('www.')) {
                        referrerDomain = referrerDomain.substring(4);
                    }
                } catch (e) {
                    referrerDomain = 'Other';
                }
            }

            // Generate/Retrieve View ID
            const viewId = req.body.viewId || crypto.randomUUID();
            const userId = req.user ? req.user.id : null;
            // Role AT THE TIME of the visit — a later role change must never
            // retroactively reclassify past visits (see migration 142).
            const role = req.user?.role || null;
            const resolvedPlatform = VALID_PLATFORMS.has(platform) ? platform : 'web';
            const pageTemplate = toPageTemplate(pagePath);

            await db.query(
                `INSERT INTO page_views
                    (id, session_id, user_id, page_path, page_template, referrer, referrer_domain,
                     browser, os, device_type, country, ip_address, duration_seconds,
                     platform, visitor_id, role, utm_source, utm_medium, utm_campaign, utm_term, utm_content)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 0,
                         $13, $14, $15, $16, $17, $18, $19, $20)
                 ON CONFLICT (id) DO NOTHING`,
                [
                    viewId, sessionId, userId, pagePath, pageTemplate, referrer || null, referrerDomain,
                    browser, os, deviceType, country, ipAddress,
                    resolvedPlatform, visitorId || null, role,
                    utmSource || null, utmMedium || null, utmCampaign || null, utmTerm || null, utmContent || null,
                ]
            );

            res.status(200).json({ success: true, viewId });
        } catch (error) {
            console.error('Failed to log page view:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    /**
     * Log a heartbeat ping.
     * Accumulates duration_seconds for an existing page view record.
     */
    async logHeartbeat(req, res) {
        try {
            const { viewId, duration } = req.body;

            if (!viewId) {
                return res.status(400).json({ error: 'Missing required parameter: viewId' });
            }

            const durationSec = parseInt(duration || '15', 10);

            await recordHeartbeat(viewId, durationSec);

            res.status(200).json({ success: true });
        } catch (error) {
            console.error('Failed to update page view heartbeat:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    /**
     * Log video playback startup metrics (TTFF) for monitoring.
     * Structured log prefix VideoMetrics for log aggregation.
     */
    async logVideoPlayback(req, res) {
        try {
            const { videoId, ttffMs, autoplay, mutedFallback } = req.body || {};
            if (!videoId || ttffMs == null) {
                return res.status(400).json({ error: 'Missing videoId or ttffMs' });
            }
            const userId = req.user?.id ?? null;
            console.log(JSON.stringify({
                tag: 'VideoMetrics',
                event: 'video_playback_ready',
                videoId,
                userId,
                ttffMs: Number(ttffMs),
                autoplay: !!autoplay,
                mutedFallback: !!mutedFallback,
                cdnMode: process.env.CDN_SEGMENT_DELIVERY || 'off',
                ts: new Date().toISOString(),
            }));
            res.status(200).json({ success: true });
        } catch (error) {
            console.error('Failed to log video playback metric:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
}

module.exports = new AnalyticsController();
