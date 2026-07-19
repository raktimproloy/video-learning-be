const express = require('express');
const router = express.Router();
const instituteAffiliationController = require('../controllers/instituteAffiliationController');
const authMiddleware = require('../middleware/authMiddleware');
const { requireTeacherOwner } = require('../middleware/teacherPermissionMiddleware');

router.use(authMiddleware);

router.post('/invite', requireTeacherOwner, instituteAffiliationController.sendInvite);
router.get('/incoming', instituteAffiliationController.listIncomingRequests);
router.get('/sent', requireTeacherOwner, instituteAffiliationController.listSentRequests);
router.get('/mine', instituteAffiliationController.listMyAffiliations);
router.post('/:id/accept', (req, res, next) => {
  req.body.accept = true;
  next();
}, instituteAffiliationController.respondToInvite);
router.post('/:id/refuse', (req, res, next) => {
  req.body.accept = false;
  next();
}, instituteAffiliationController.respondToInvite);
router.put('/main', instituteAffiliationController.setMainInstitute);
router.post('/:id/leave', instituteAffiliationController.leaveInstitute);
// Owner actions on affiliates
router.post('/:id/remove', requireTeacherOwner, instituteAffiliationController.removeAffiliate);
router.put('/:id/tag', requireTeacherOwner, instituteAffiliationController.updateTag);

module.exports = router;
