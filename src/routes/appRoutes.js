const express = require('express');
const router = express.Router();
const appReleaseController = require('../controllers/appReleaseController');

// Public — no auth. Always serves whichever release is currently published.
router.get('/download', appReleaseController.download);

module.exports = router;
