const express = require('express');
const settingsController = require('../controllers/settingsController');

const router = express.Router();

/**
 * GET /v1/settings
 * Public API - no auth required.
 * Returns platform settings (categories, etc.)
 */
router.get('/', settingsController.getSettings);

module.exports = router;
