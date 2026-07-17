const express = require('express');
const teacherInstituteController = require('../controllers/teacherInstituteController');

const router = express.Router();

// PUBLIC: stream institute logo/cover
router.get(/^\/media\/(.+)$/, (req, res, next) => {
  req.params.key = decodeURIComponent(req.params[0]);
  return teacherInstituteController.streamMedia(req, res, next);
});

// PUBLIC: institute storefront by subdomain slug
router.get('/:slug', teacherInstituteController.getPublic);

module.exports = router;
