const express = require('express');
const router = express.Router();
const verifyAdmin = require('../middleware/verifyAdminMiddleware');
const controller = require('../controllers/adminExternalCourseImportsController');

router.use(verifyAdmin);
router.get('/', controller.list);
router.post('/', controller.create);
router.get('/:id', controller.getById);
router.patch('/:id', controller.update);
router.delete('/:id', controller.delete);

module.exports = router;
