const express = require('express');
const router = express.Router();

const teacherDiscoveryController = require('../controllers/teacherDiscoveryController');

// Public
router.get('/best', (req, res) => teacherDiscoveryController.listBest(req, res));
router.get('/', (req, res) => teacherDiscoveryController.search(req, res));

module.exports = router;

