/**
 * A lightweight, high-performance user-agent parser to extract browser, OS, and device type.
 * Runs in O(1) and requires no external dependencies.
 */
function parseUserAgent(uaString) {
    if (!uaString) {
        return {
            browser: 'Unknown',
            os: 'Unknown',
            deviceType: 'Desktop'
        };
    }

    let browser = 'Unknown';
    let os = 'Unknown';
    let deviceType = 'Desktop';

    // 1. Device Type detection
    if (/tablet|ipad|playbook|silk/i.test(uaString)) {
        deviceType = 'Tablet';
    } else if (/mobile|iphone|ipod|android|blackberry|opera mini|iemobile|webos/i.test(uaString)) {
        deviceType = 'Mobile';
    }

    // 2. OS detection
    if (/windows/i.test(uaString)) {
        os = 'Windows';
    } else if (/macintosh|mac os x/i.test(uaString)) {
        os = 'macOS';
    } else if (/iphone|ipad|ipod/i.test(uaString)) {
        os = 'iOS';
    } else if (/android/i.test(uaString)) {
        os = 'Android';
    } else if (/linux/i.test(uaString)) {
        os = 'Linux';
    }

    // 3. Browser detection
    if (/edg/i.test(uaString)) {
        browser = 'Edge';
    } else if (/chrome|crios/i.test(uaString) && !/opr|opios|edg/i.test(uaString)) {
        browser = 'Chrome';
    } else if (/safari/i.test(uaString) && !/chrome|crios|opr|opios|edg/i.test(uaString)) {
        browser = 'Safari';
    } else if (/firefox|fxios/i.test(uaString)) {
        browser = 'Firefox';
    } else if (/opr|opera/i.test(uaString)) {
        browser = 'Opera';
    }

    return { browser, os, deviceType };
}

module.exports = parseUserAgent;
