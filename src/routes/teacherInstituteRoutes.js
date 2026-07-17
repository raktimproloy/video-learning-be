const express = require('express');
const multer = require('multer');
const authMiddleware = require('../middleware/authMiddleware');
const { requireTeacherPermission } = require('../middleware/teacherPermissionMiddleware');
const teacherInstituteController = require('../controllers/teacherInstituteController');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype && file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  },
});

router.use(authMiddleware);

router.get('/', requireTeacherPermission('settings'), teacherInstituteController.getMine);
router.get('/slug-availability', requireTeacherPermission('settings'), teacherInstituteController.checkSlug);
router.put(
  '/',
  requireTeacherPermission('settings'),
  upload.fields([
    { name: 'logo', maxCount: 1 },
    { name: 'cover', maxCount: 1 },
  ]),
  teacherInstituteController.upsert
);
router.post('/phone/request', requireTeacherPermission('settings'), teacherInstituteController.requestPhoneOtp);
router.post('/phone/verify', requireTeacherPermission('settings'), teacherInstituteController.verifyPhoneOtp);

module.exports = router;
