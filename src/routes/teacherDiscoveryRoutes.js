const express = require('express');
const router = express.Router();

const teacherDiscoveryController = require('../controllers/teacherDiscoveryController');

// Public
router.get('/best', (req, res) => teacherDiscoveryController.listBest(req, res));

module.exports = router;

