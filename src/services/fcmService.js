const admin = require('firebase-admin');
const db = require('../../db');

let appInitialized = false;

function initFirebaseAdmin() {
    if (appInitialized) return;

    try {
        // Prefer full service account JSON in env
        const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
        if (serviceAccountJson) {
            const credentials = JSON.parse(serviceAccountJson);
            admin.initializeApp({
                credential: admin.credential.cert(credentials),
            });
        } else if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
            // Or a path to the JSON file
            const serviceAccount = require(process.env.FIREBASE_SERVICE_ACCOUNT_PATH);
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount),
            });
        } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
            // Or ADC-style JSON path
            admin.initializeApp({
                credential: admin.credential.applicationDefault(),
            });
        } else {
            console.warn('[FCM] No Firebase credentials configured. Push notifications will be disabled.');
            return;
        }

        appInitialized = true;
        console.log('[FCM] Firebase Admin initialized');
    } catch (err) {
        console.error('[FCM] Failed to initialize Firebase Admin:', err);
    }
}

function isEnabled() {
    return appInitialized;
}

async function registerToken(userId, token) {
    initFirebaseAdmin();
    if (!token || !userId) return;

    try {
        // A token identifies one device/install, not an account — reassign
        // rather than accumulate, so a previous user on a shared/handed-down
        // device (or one who just logged out) stops receiving push meant for
        // whoever is actually signed in on it now.
        await db.query(
            `DELETE FROM user_fcm_tokens WHERE token = $1 AND user_id != $2`,
            [token, userId]
        );
        await db.query(
            `INSERT INTO user_fcm_tokens (user_id, token)
             VALUES ($1, $2)
             ON CONFLICT (user_id, token) DO NOTHING`,
            [userId, token]
        );
    } catch (err) {
        console.error('[FCM] Failed to store user token:', err);
    }
}

async function getTokensForUsers(userIds) {
    if (!userIds || userIds.length === 0) return [];
    const result = await db.query(
        `SELECT token
         FROM user_fcm_tokens
         WHERE user_id = ANY($1::uuid[])`,
        [userIds]
    );
    return result.rows.map((r) => r.token);
}

async function sendMulticast(tokens, payload) {
    initFirebaseAdmin();
    if (!isEnabled()) return;
    if (!tokens || tokens.length === 0) return;

    try {
        const messaging = admin.messaging();
        // All `data` values must be strings for FCM.
        const data = {};
        for (const [k, val] of Object.entries(payload.data || {})) {
            if (val != null) data[k] = String(val);
        }
        const channelId = payload.channelId || 'default';
        const response = await messaging.sendEachForMulticast({
            tokens,
            notification: payload.notification,
            data,
            android: {
                priority: 'high',
                notification: {
                    channelId,
                    sound: 'default',
                    ...(channelId === 'live' ? { color: '#EF4444' } : {}),
                },
            },
            apns: {
                headers: {
                    'apns-priority': '10',
                },
                payload: { aps: { sound: 'default' } },
            },
            webpush: {
                headers: {
                    Urgency: 'high',
                },
            },
        });

        // Optionally clean up invalid tokens
        const invalidTokens = [];
        response.responses.forEach((res, idx) => {
            if (!res.success && res.error && tokens[idx]) {
                const code = res.error.code;
                if (
                    code === 'messaging/registration-token-not-registered' ||
                    code === 'messaging/invalid-registration-token'
                ) {
                    invalidTokens.push(tokens[idx]);
                } else {
                    console.warn('[FCM] Error sending to token:', code, res.error.message);
                }
            }
        });

        if (invalidTokens.length > 0) {
            await db.query(
                `DELETE FROM user_fcm_tokens
                 WHERE token = ANY($1::text[])`,
                [invalidTokens]
            );
        }
    } catch (err) {
        console.error('[FCM] Failed to send multicast notification:', err);
    }
}

/**
 * Send a course announcement push notification to all enrolled students.
 * Does not throw – errors are logged only.
 */
async function sendCourseAnnouncementPush(announcement) {
    try {
        if (!announcement || !announcement.course_id) return;

        // Find all enrolled students for the course
        const enrolled = await db.query(
            `SELECT DISTINCT user_id
             FROM course_enrollments
             WHERE course_id = $1`,
            [announcement.course_id]
        );
        const userIds = enrolled.rows.map((r) => r.user_id);
        if (userIds.length === 0) return;

        const tokens = await getTokensForUsers(userIds);
        if (tokens.length === 0) return;

        // Get course title for nicer notification
        const courseResult = await db.query(
            `SELECT title
             FROM courses
             WHERE id = $1`,
            [announcement.course_id]
        );
        const courseTitle = courseResult.rows[0]?.title || 'New course announcement';

        // Push format:
        // Title: course title
        // Body: "<announcement title> - <announcement description>"
        const notificationTitle = courseTitle;
        const notificationBody = [
            announcement.title || 'New announcement',
            announcement.body || '',
        ]
            .filter(Boolean)
            .join(' - ');

        await sendMulticast(tokens, {
            channelId: 'announcements',
            // FCM Admin Notification only supports title/body/image
            notification: {
                title: notificationTitle,
                body: notificationBody,
            },
            // Pass icon and extra fields via data; service worker / app use these
            data: {
                type: 'course_announcement',
                courseId: String(announcement.course_id),
                announcementId: String(announcement.id),
                courseTitle: String(courseTitle),
                announcementTitle: String(announcement.title || ''),
                announcementBody: String(announcement.body || ''),
                icon: '/images/logo/favIcon.png',
                url: `/course/${announcement.course_id}`,
            },
        });
    } catch (err) {
        console.error('[FCM] Failed to send course announcement push:', err);
    }
}

/**
 * Notify every enrolled student that a live class just started.
 * `lesson` fields expected: `id`, `course_id`, `title`, optional `live_name`.
 * Does not throw – errors are logged only.
 */
async function sendLiveStartedPush(lesson) {
    try {
        if (!lesson || !lesson.course_id) return;

        const enrolled = await db.query(
            `SELECT DISTINCT user_id FROM course_enrollments WHERE course_id = $1`,
            [lesson.course_id]
        );
        const userIds = enrolled.rows.map((r) => r.user_id).filter(Boolean);
        if (userIds.length === 0) return;

        const tokens = await getTokensForUsers(userIds);
        if (tokens.length === 0) return;

        const courseRes = await db.query(`SELECT title FROM courses WHERE id = $1`, [
            lesson.course_id,
        ]);
        const courseTitle = courseRes.rows[0]?.title || 'Your course';
        const liveName = lesson.live_name || lesson.title || 'Live class';

        await sendMulticast(tokens, {
            channelId: 'live',
            notification: {
                title: '🔴 লাইভ ক্লাস শুরু হয়েছে',
                body: `${courseTitle} — ${liveName}`,
            },
            data: {
                type: 'live_started',
                lessonId: String(lesson.id),
                courseId: String(lesson.course_id),
                courseTitle: String(courseTitle),
                liveName: String(liveName),
                url: `/live/${lesson.id}`,
            },
        });
    } catch (err) {
        console.error('[FCM] Failed to send live-started push:', err);
    }
}

module.exports = {
    initFirebaseAdmin,
    isEnabled,
    registerToken,
    sendCourseAnnouncementPush,
    sendLiveStartedPush,
};

