const express = require('express');
const router = express.Router();
const verifyToken = require('../middleware/authMiddleware');
const certificateController = require('../controllers/certificateController');

router.get('/public/:certificateNumber', certificateController.getPublicCertificate);
router.get('/course/:courseId', verifyToken, certificateController.getCourseCertificateStatus);
router.post('/course/:courseId', verifyToken, certificateController.issueCourseCertificate);
router.get('/:certificateId', verifyToken, certificateController.getCertificate);

module.exports = router;
