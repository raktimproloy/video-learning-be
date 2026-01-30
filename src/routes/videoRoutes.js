const express = require('express');
const router = express.Router();
const videoController = require('../controllers/videoController');
const verifyToken = require('../middleware/authMiddleware');

// Endpoint to list videos with access status
// GET /v1/video/list
router.get('/list', verifyToken, videoController.listVideos);

// Endpoint to get signed URL for playback
// GET /v1/video/:videoId/sign
router.get('/:videoId/sign', verifyToken, videoController.getSignedUrl);

// Endpoint for the player to fetch the decryption key
// GET /v1/video/get-key?vid=...
router.get('/get-key', verifyToken, videoController.getKey);

module.exports = router;
