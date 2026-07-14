const express = require('express');
const router = express.Router();
const teacherReferenceController = require('../controllers/teacherReferenceController');
const authMiddleware = require('../middleware/authMiddleware');

const restrictTo = (role) => {
    return (req, res, next) => {
        if (!req.user || req.user.role !== role) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        next();
    };
};

router.use(authMiddleware);
router.use(restrictTo('teacher'));

// Search for marketers
router.get('/search', teacherReferenceController.searchMarketers);

// Get connected references
router.get('/', teacherReferenceController.getConnectedReferences);

// Connect to a new reference user
router.post('/', teacherReferenceController.connectReference);

// Update shared percentage
router.put('/percentage', teacherReferenceController.updateSharedPercent);

// Disconnect from a reference user
router.delete('/:marketerId', teacherReferenceController.disconnectReference);

module.exports = router;
