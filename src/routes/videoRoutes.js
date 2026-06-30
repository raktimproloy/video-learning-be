const express = require('express');
const router = express.Router();
const videoController = require('../controllers/videoController');
const verifyToken = require('../middleware/authMiddleware');
const optionalAuth = verifyToken.optional;

// Endpoint to list videos with access status
router.get('/list', verifyToken, videoController.listVideos);

// Endpoint for the player to fetch the decryption key (optionalAuth: guests can get key for preview videos)
router.get('/get-key', optionalAuth, videoController.getKey);

// Stream HLS from R2 (optionalAuth: guests can access preview video streams)
router.get(/^\/([^/]+)\/stream\/(.+)$/, optionalAuth, (req, res, next) => {
    req.params.videoId = req.params[0];
    req.params.path = req.params[1];
    return videoController.streamSegment(req, res, next);
});

// Get signed URL for playback (optionalAuth: guests can get URL for preview videos)
router.get('/:videoId/sign', optionalAuth, videoController.getSignedUrl);

// Get archived live chat for a video saved from live (video_id = live_session_id)
router.get('/:videoId/live-chat', verifyToken, videoController.getLiveChat);

// Serve video thumbnail (first frame JPEG)
router.get('/:videoId/thumbnail', verifyToken, videoController.getThumbnail);

// Get video details (title, description, notes, assignments, lesson_id, order)
// optionalAuth: allows guests to fetch preview video details without a 401
router.get('/:videoId', optionalAuth, videoController.getVideoDetails);

module.exports = router;
