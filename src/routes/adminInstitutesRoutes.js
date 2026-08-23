const express = require('express');
const router = express.Router();
const { check } = require('express-validator');
const verifyAdmin = require('../middleware/verifyAdminMiddleware');
const adminInstitutesController = require('../controllers/adminInstitutesController');

// Protect admin routes with JWT
router.use(verifyAdmin);

// Reserved Slugs
router.get('/reserved-slugs', adminInstitutesController.getReservedSlugs);
router.post(
  '/reserved-slugs',
  [
    check('slug', 'Slug is required').trim().not().isEmpty(),
  ],
  adminInstitutesController.addReservedSlug
);
router.delete('/reserved-slugs/:slug', adminInstitutesController.removeReservedSlug);

// Institutes
router.get('/', adminInstitutesController.getAllInstitutes);
router.put(
  '/:id',
  [
    check('id', 'Institute ID is required').isUUID(),
    check('slug', 'Slug is required').not().isEmpty(),
    check('name', 'Name is required').not().isEmpty(),
  ],
  adminInstitutesController.updateInstituteAdmin
);
router.delete(
  '/:id',
  [
    check('id', 'Institute ID is required').isUUID()
  ],
  adminInstitutesController.deleteInstituteAdmin
);

module.exports = router;
