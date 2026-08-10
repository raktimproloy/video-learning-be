'use strict';
const express = require('express');
const router = express.Router();
const verifyAdmin = require('../middleware/verifyAdminMiddleware');
const adminErrorLogController = require('../controllers/adminErrorLogController');

// All routes require admin authentication
router.use(verifyAdmin);

// GET  /v1/admin/error-logs         — list with pagination + filters
router.get('/', adminErrorLogController.list.bind(adminErrorLogController));

// GET  /v1/admin/error-logs/stats   — summary stats for dashboard
router.get('/stats', adminErrorLogController.stats.bind(adminErrorLogController));

// POST /v1/admin/error-logs/bulk-resolve
router.post('/bulk-resolve', adminErrorLogController.bulkResolve.bind(adminErrorLogController));

// GET  /v1/admin/error-logs/:id     — single log detail (full stack trace etc.)
router.get('/:id', adminErrorLogController.getById.bind(adminErrorLogController));

// PATCH /v1/admin/error-logs/:id/resolve
router.patch('/:id/resolve', adminErrorLogController.resolve.bind(adminErrorLogController));

// PATCH /v1/admin/error-logs/:id/unresolve
router.patch('/:id/unresolve', adminErrorLogController.unresolve.bind(adminErrorLogController));

// DELETE /v1/admin/error-logs/:id
router.delete('/:id', adminErrorLogController.delete.bind(adminErrorLogController));

module.exports = router;
