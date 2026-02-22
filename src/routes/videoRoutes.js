const express = require('express');
const router = express.Router();
const videoController = require('../controllers/videoController');
const verifyToken = require('../middleware/authMiddleware');

// Endpoint to list videos with access status
router.get('/list', verifyToken, videoController.listVideos);

// Endpoint for the player to fetch the decryption key (must be before /:videoId)
router.get('/get-key', verifyToken, videoController.getKey);

// Stream HLS from R2
router.get(/^\/([^/]+)\/stream\/(.+)$/, verifyToken, (req, res, next) => {
    req.params.videoId = req.params[0];
    req.params.path = req.params[1];
    return videoController.streamSegment(req, res, next);
});

// Get signed URL for playback
router.get('/:videoId/sign', verifyToken, videoController.getSignedUrl);

// Get archived live chat for a video saved from live (video_id = live_session_id)
router.get('/:videoId/live-chat', verifyToken, videoController.getLiveChat);

// Get video details (title, description, notes, assignments, lesson_id, order)
router.get('/:videoId', verifyToken, videoController.getVideoDetails);

module.exports = router;
