'use strict';
/**
 * Error Log Service
 * Captures all backend errors to the system_error_logs table with full context.
 * - API errors: method, path, user, request body summary, stack trace
 * - Worker errors: video_id, task_id, teacher context
 * - System errors: process-level unhandled rejections / uncaught exceptions
 */

const db = require('../../db');

// Fields to redact from request body before storing
const SENSITIVE_KEYS = new Set([
    'password', 'password_hash', 'token', 'secret', 'signing_secret',
    'access_token', 'refresh_token', 'otp', 'card_number', 'cvv',
    'api_key', 'private_key', 'jwt_secret', 'smtp_pass',
]);

/**
 * Auto-generate a human-readable title for the error log.
 */
function buildTitle(method, urlPath, statusCode, errorMessage) {
    const parts = [];
    if (method && urlPath) {
        parts.push(`${method} ${urlPath}`);
    }
    if (statusCode) {
        parts.push(`→ ${statusCode}`);
    }
    if (errorMessage) {
        // Truncate to keep title concise
        const short = errorMessage.length > 120 ? `${errorMessage.slice(0, 120)}…` : errorMessage;
        parts.push(`— ${short}`);
    }
    return parts.join(' ') || 'Unknown Error';
}

/**
 * Recursively redact sensitive fields from an object.
 */
function redactSensitive(obj, depth = 0) {
    if (depth > 4 || obj === null || obj === undefined) return obj;
    if (typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.slice(0, 10).map(v => redactSensitive(v, depth + 1));

    const result = {};
    for (const [key, val] of Object.entries(obj)) {
        if (SENSITIVE_KEYS.has(key.toLowerCase())) {
            result[key] = '[REDACTED]';
        } else if (typeof val === 'object' && val !== null) {
            result[key] = redactSensitive(val, depth + 1);
        } else {
            result[key] = val;
        }
    }
    return result;
}

/**
 * Summarize req.body — redact sensitive fields, truncate large values.
 */
function summarizeBody(body) {
    if (!body || typeof body !== 'object') return {};
    try {
        const redacted = redactSensitive(body);
        // Truncate any string value over 500 chars
        const truncated = {};
        for (const [k, v] of Object.entries(redacted)) {
            if (typeof v === 'string' && v.length > 500) {
                truncated[k] = `${v.slice(0, 500)}… [truncated]`;
            } else {
                truncated[k] = v;
            }
        }
        return truncated;
    } catch {
        return { _error: 'Failed to summarize body' };
    }
}

/**
 * Determine severity based on status code.
 */
function statusToSeverity(statusCode) {
    if (!statusCode) return 'error';
    if (statusCode >= 500) return 'error';
    if (statusCode === 413 || statusCode === 429) return 'warn';
    if (statusCode >= 400) return 'warn';
    return 'info';
}

/**
 * Core insert function. All log methods funnel through here.
 */
async function insertLog(data) {
    try {
        await db.query(
            `INSERT INTO system_error_logs
             (title, message, stack, error_code, method, path, query, body_summary,
              ip_address, user_agent, user_id, user_role, user_email, severity, source, context)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
            [
                (data.title || 'Unknown Error').slice(0, 500),
                (data.message || 'No message').slice(0, 5000),
                data.stack ? data.stack.slice(0, 10000) : null,
                data.errorCode || null,
                data.method || null,
                data.path || null,
                data.query ? JSON.stringify(data.query) : '{}',
                data.bodySummary ? JSON.stringify(data.bodySummary) : '{}',
                data.ipAddress || null,
                data.userAgent ? data.userAgent.slice(0, 500) : null,
                data.userId || null,
                data.userRole || null,
                data.userEmail || null,
                data.severity || 'error',
                data.source || 'api',
                data.context ? JSON.stringify(data.context) : '{}',
            ]
        );
    } catch (dbErr) {
        // Never let error logging crash the app — just log to console as fallback
        console.error('[ErrorLogService] Failed to save error log to DB:', dbErr.message);
    }
}

/**
 * Log an API error from Express middleware.
 * @param {Error} err - The error object
 * @param {import('express').Request} req - Express request
 * @param {number} statusCode - HTTP status code being returned
 */
async function logApiError(err, req, statusCode = 500) {
    try {
        const method = req.method;
        const urlPath = req.originalUrl || req.url || '/';
        const cleanPath = urlPath.split('?')[0]; // path only, no query
        const query = req.query || {};
        const body = summarizeBody(req.body);
        const ipAddress = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
            || req.headers['x-real-ip']
            || req.socket?.remoteAddress
            || null;
        const userAgent = req.headers['user-agent'] || null;

        const userId = req.user?.id || null;
        const userRole = req.user?.role || null;
        const userEmail = req.user?.email || null;

        const severity = statusToSeverity(statusCode);
        const title = buildTitle(method, cleanPath, statusCode, err.message);

        await insertLog({
            title,
            message: err.message || 'Internal Server Error',
            stack: err.stack || null,
            errorCode: err.code ? String(err.code) : null,
            method,
            path: cleanPath,
            query,
            bodySummary: body,
            ipAddress,
            userAgent,
            userId,
            userRole,
            userEmail,
            severity,
            source: 'api',
            context: { statusCode },
        });
    } catch (e) {
        console.error('[ErrorLogService] logApiError failed:', e.message);
    }
}

/**
 * Log a worker error (video processing failure).
 * @param {Error} err - The error
 * @param {object} context - { taskId, videoId, videoTitle, teacherId, stage }
 */
async function logWorkerError(err, context = {}) {
    try {
        const { taskId, videoId, videoTitle, teacherId, teacherEmail, stage } = context;
        const title = buildTitle(
            'WORKER',
            stage ? `video-processing:${stage}` : 'video-processing',
            null,
            err.message
        );

        await insertLog({
            title,
            message: err.message || 'Worker error',
            stack: err.stack || null,
            errorCode: err.code ? String(err.code) : null,
            method: 'WORKER',
            path: stage ? `video-processing:${stage}` : 'video-processing',
            query: {},
            bodySummary: {},
            ipAddress: null,
            userAgent: null,
            userId: teacherId || null,
            userRole: 'teacher',
            userEmail: teacherEmail || null,
            severity: 'error',
            source: 'worker',
            context: {
                taskId: taskId || null,
                videoId: videoId || null,
                videoTitle: videoTitle || null,
                stage: stage || null,
            },
        });
    } catch (e) {
        console.error('[ErrorLogService] logWorkerError failed:', e.message);
    }
}

/**
 * Log a system-level error (unhandled rejection, uncaught exception, etc.)
 * @param {string} title - Short descriptive title
 * @param {Error|string} err - Error or message string
 * @param {object} context - Extra data
 */
async function logSystemError(title, err, context = {}) {
    try {
        const message = err instanceof Error ? err.message : String(err);
        const stack = err instanceof Error ? err.stack : null;
        const errorCode = err instanceof Error ? err.code : null;

        await insertLog({
            title: (title || 'System Error').slice(0, 500),
            message: message.slice(0, 5000),
            stack: stack ? stack.slice(0, 10000) : null,
            errorCode: errorCode ? String(errorCode) : null,
            method: null,
            path: null,
            query: {},
            bodySummary: {},
            ipAddress: null,
            userAgent: null,
            userId: null,
            userRole: null,
            userEmail: null,
            severity: 'critical',
            source: 'system',
            context,
        });
    } catch (e) {
        console.error('[ErrorLogService] logSystemError failed:', e.message);
    }
}

/**
 * Log a custom warning/info message (non-error).
 */
async function logWarning(title, message, context = {}) {
    try {
        await insertLog({
            title: (title || 'Warning').slice(0, 500),
            message: (message || '').slice(0, 5000),
            stack: null,
            errorCode: null,
            method: null,
            path: null,
            query: {},
            bodySummary: {},
            ipAddress: null,
            userAgent: null,
            userId: null,
            userRole: null,
            userEmail: null,
            severity: 'warn',
            source: 'system',
            context,
        });
    } catch (e) {
        console.error('[ErrorLogService] logWarning failed:', e.message);
    }
}

module.exports = {
    logApiError,
    logWorkerError,
    logSystemError,
    logWarning,
};
