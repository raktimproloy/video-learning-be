const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/roleMiddleware');
const bundleController = require('../controllers/bundleController');

router.use(authMiddleware);
router.use(requireRole(['teacher']));

router.get('/', bundleController.list);
router.get('/:id', bundleController.getOne);
router.post('/', bundleController.create);
router.put('/:id', bundleController.update);
router.delete('/:id', bundleController.delete);

module.exports = router;
