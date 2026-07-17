const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const { requireTeacherPermission } = require('../middleware/teacherPermissionMiddleware');
const teacherStaffController = require('../controllers/teacherStaffController');

const router = express.Router();

router.use(authMiddleware);

router.get('/username-availability', requireTeacherPermission('staff'), teacherStaffController.checkUsername);
router.get('/', requireTeacherPermission('staff'), teacherStaffController.list);
router.post('/', requireTeacherPermission('staff'), teacherStaffController.create);
router.put('/:id', requireTeacherPermission('staff'), teacherStaffController.update);
router.post('/:id/set-password', requireTeacherPermission('staff'), teacherStaffController.setPassword);
router.delete('/:id', requireTeacherPermission('staff'), teacherStaffController.remove);

module.exports = router;
