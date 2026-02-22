const express = require('express');
const router = express.Router();
const { check } = require('express-validator');
const adminCategoryController = require('../controllers/adminCategoryController');
const verifyAdmin = require('../middleware/verifyAdminMiddleware');

router.use(verifyAdmin);

router.get('/', adminCategoryController.list);
router.get('/tree', adminCategoryController.getTree);
router.get('/full-tree', adminCategoryController.getFullTree);
router.get('/:id', adminCategoryController.getById);

router.post(
    '/',
    [
        check('name', 'Name is required').trim().notEmpty(),
        check('description', 'Description must be a string').optional().isString(),
        check('parentId', 'Parent ID must be a valid UUID').optional().isUUID(),
        check('status', 'Status must be active or inactive').optional().isIn(['active', 'inactive']),
    ],
    adminCategoryController.create
);

router.put(
    '/:id',
    [
        check('id', 'Invalid category ID').isUUID(),
        check('name', 'Name must be a non-empty string').optional().trim().notEmpty(),
        check('description', 'Description must be a string').optional().isString(),
        check('parentId', 'Parent ID must be a valid UUID').optional().isUUID(),
        check('status', 'Status must be active or inactive').optional().isIn(['active', 'inactive']),
    ],
    adminCategoryController.update
);

router.delete('/:id', [check('id', 'Invalid category ID').isUUID()], adminCategoryController.delete);

module.exports = router;
