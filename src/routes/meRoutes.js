const express = require('express');
const router = express.Router();
const verifyToken = require('../middleware/authMiddleware');
const meController = require('../controllers/meController');

// Authenticated bootstrap payload for dashboard/nav.
router.get('/bootstrap', verifyToken, meController.getBootstrap);

module.exports = router;

