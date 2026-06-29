const crypto = require('crypto');
const db = require('../../db');
const parseUserAgent = require('../utils/uaParser');
const { getCountry } = require('../utils/geoIp');
const { recordHeartbeat } = require('../services/analyticsBatchService');

class AnalyticsController {
    /**
     * Log a page view event.
     * Extracts IP, user agent, parses browser/OS/device, resolves country, and inserts a database record.
     */
    async logPageView(req, res) {
        try {
            const { sessionId, pagePath, referrer } = req.body;

            if (!sessionId || !pagePath) {
                return res.status(400).json({ error: 'Missing required parameters: sessionId and pagePath' });
            }

            // Detect Client IP
            let ipAddress = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.ip || req.socket.remoteAddress || '';
            if (Array.isArray(ipAddress)) {
                ipAddress = ipAddress[0];
            }
            if (ipAddress.includes(',')) {
                ipAddress = ipAddress.split(',')[0].trim();
            }

            // Parse User-Agent details
            const userAgent = req.headers['user-agent'] || '';
            const { browser, os, deviceType } = parseUserAgent(userAgent);

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

            await db.query(
                `INSERT INTO page_views 
                    (id, session_id, user_id, page_path, referrer, referrer_domain, browser, os, device_type, country, ip_address, duration_seconds)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 0)
                 ON CONFLICT (id) DO NOTHING`,
                [viewId, sessionId, userId, pagePath, referrer || null, referrerDomain, browser, os, deviceType, country, ipAddress]
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
}

module.exports = new AnalyticsController();
