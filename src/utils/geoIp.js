const axios = require('axios');

// In-memory cache to prevent redundant API queries for the same client
const ipCache = new Map();

/**
 * Resolves an IP address to a country name.
 * Handles local IP ranges, caches results, and defaults to 'Unknown' if resolution fails.
 */
async function getCountry(ip) {
    if (!ip) return 'Unknown';

    // Clean IP (strip IPv6 mapping if present, e.g. ::ffff:127.0.0.1)
    let cleanIp = ip;
    if (ip.startsWith('::ffff:')) {
        cleanIp = ip.substring(7);
    }

    // Local IP address detection
    if (
        cleanIp === '127.0.0.1' || 
        cleanIp === '::1' || 
        cleanIp.startsWith('10.') || 
        cleanIp.startsWith('192.168.') || 
        cleanIp.startsWith('172.16.')
    ) {
        return 'Localhost';
    }

    if (ipCache.has(cleanIp)) {
        return ipCache.get(cleanIp);
    }

    try {
        // Query free IP-API service (rate limited to 45 requests per minute per IP, caching protects us)
        const response = await axios.get(`http://ip-api.com/json/${cleanIp}`, { timeout: 1000 });
        if (response.data && response.data.status === 'success') {
            const country = response.data.country || 'Unknown';
            ipCache.set(cleanIp, country);
            return country;
        }
    } catch (error) {
        // Suppress errors to prevent app disruption, fallback to 'Unknown'
    }

    return 'Unknown';
}

module.exports = { getCountry };
