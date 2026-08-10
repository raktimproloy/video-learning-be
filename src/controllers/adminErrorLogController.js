'use strict';
const adminErrorLogService = require('../services/adminErrorLogService');
const verifyAdmin = require('../middleware/verifyAdminMiddleware');

class AdminErrorLogController {

    // GET /v1/admin/error-logs
    async list(req, res) {
        try {
            const {
                page = '1', limit = '50',
                severity, source, resolved, search,
                userId, dateFrom, dateTo,
            } = req.query;

            const result = await adminErrorLogService.getErrorLogs({
                page: Math.max(1, parseInt(page, 10) || 1),
                limit: Math.min(200, Math.max(1, parseInt(limit, 10) || 50)),
                severity,
                source,
                resolved,
                search,
                userId,
                dateFrom,
                dateTo,
            });

            res.status(200).json(result);
        } catch (error) {
            console.error('Admin Error Log List Error:', error);
            res.status(500).json({ error: 'Failed to fetch error logs' });
        }
    }

    // GET /v1/admin/error-logs/stats
    async stats(req, res) {
        try {
            const result = await adminErrorLogService.getErrorStats();
            res.status(200).json(result);
        } catch (error) {
            console.error('Admin Error Log Stats Error:', error);
            res.status(500).json({ error: 'Failed to fetch error stats' });
        }
    }

    // GET /v1/admin/error-logs/:id
    async getById(req, res) {
        try {
            const { id } = req.params;
            const log = await adminErrorLogService.getErrorLogById(id);
            if (!log) return res.status(404).json({ error: 'Error log not found' });
            res.status(200).json(log);
        } catch (error) {
            console.error('Admin Error Log GetById Error:', error);
            res.status(500).json({ error: 'Failed to fetch error log' });
        }
    }

    // PATCH /v1/admin/error-logs/:id/resolve
    async resolve(req, res) {
        try {
            const { id } = req.params;
            const { note } = req.body;
            const adminId = req.admin?.id || null;
            const result = await adminErrorLogService.resolveErrorLog(id, adminId, note || null);
            res.status(200).json({ success: true, ...result });
        } catch (error) {
            console.error('Admin Error Log Resolve Error:', error);
            if (error.message === 'Error log not found') return res.status(404).json({ error: error.message });
            res.status(500).json({ error: 'Failed to resolve error log' });
        }
    }

    // PATCH /v1/admin/error-logs/:id/unresolve
    async unresolve(req, res) {
        try {
            const { id } = req.params;
            const result = await adminErrorLogService.unresolveErrorLog(id);
            res.status(200).json({ success: true, ...result });
        } catch (error) {
            console.error('Admin Error Log Unresolve Error:', error);
            if (error.message === 'Error log not found') return res.status(404).json({ error: error.message });
            res.status(500).json({ error: 'Failed to unresolve error log' });
        }
    }

    // POST /v1/admin/error-logs/bulk-resolve
    async bulkResolve(req, res) {
        try {
            const { ids, note } = req.body;
            if (!Array.isArray(ids) || ids.length === 0) {
                return res.status(400).json({ error: 'ids array is required' });
            }
            const adminId = req.admin?.id || null;
            const result = await adminErrorLogService.bulkResolve(ids, adminId, note || null);
            res.status(200).json({ success: true, ...result });
        } catch (error) {
            console.error('Admin Error Log Bulk Resolve Error:', error);
            res.status(500).json({ error: 'Failed to bulk resolve' });
        }
    }

    // DELETE /v1/admin/error-logs/:id
    async delete(req, res) {
        try {
            const { id } = req.params;
            const result = await adminErrorLogService.deleteErrorLog(id);
            res.status(200).json({ success: true, ...result });
        } catch (error) {
            console.error('Admin Error Log Delete Error:', error);
            if (error.message === 'Error log not found') return res.status(404).json({ error: error.message });
            res.status(500).json({ error: 'Failed to delete error log' });
        }
    }
}

module.exports = new AdminErrorLogController();
