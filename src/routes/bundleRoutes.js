const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { requireTeacherPermission } = require('../middleware/teacherPermissionMiddleware');
const bundleController = require('../controllers/bundleController');

router.use(authMiddleware);
router.use(requireTeacherPermission('courses'));

router.get('/', bundleController.list);
router.get('/:id', bundleController.getOne);
router.post('/', bundleController.create);
router.put('/:id', bundleController.update);
router.delete('/:id', bundleController.delete);

module.exports = router;
