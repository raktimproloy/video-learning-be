const express = require('express');
const router = express.Router();
const teacherProfileController = require('../controllers/teacherProfileController');
const authMiddleware = require('../middleware/authMiddleware');
const { requireTeacherPermission, attachTeacherContext } = require('../middleware/teacherPermissionMiddleware');
const multer = require('multer');

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024
    },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only image files are allowed'));
        }
    }
});

// PUBLIC ROUTES
router.get(/^\/image\/(.+)$/, (req, res, next) => {
    req.params.key = decodeURIComponent(req.params[0]);
    return teacherProfileController.streamProfileImage(req, res, next);
});

router.get('/public/:userId', teacherProfileController.getPublicProfile);

router.use(authMiddleware);

// Password change is always on the logged-in user's own account
router.post('/change-password', attachTeacherContext, teacherProfileController.changePassword);

// Profile/qualification: owner OR crew with settings — always the main teacher's profile via effectiveTeacherId
router.get('/', requireTeacherPermission('settings'), teacherProfileController.getProfile);
router.put('/', requireTeacherPermission('settings'), upload.fields([
    { name: 'profileImage', maxCount: 1 }
]), teacherProfileController.updateProfile);
router.post('/verify/request', requireTeacherPermission('settings'), teacherProfileController.requestOTP);
router.post('/verify', requireTeacherPermission('settings'), teacherProfileController.verifyOTP);
router.get('/completion', requireTeacherPermission('settings'), teacherProfileController.getProfileCompletion);

module.exports = router;
