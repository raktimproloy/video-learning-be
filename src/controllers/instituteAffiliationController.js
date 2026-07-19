const instituteAffiliationService = require('../services/instituteAffiliationService');
const { body, validationResult } = require('express-validator');

exports.sendInvite = [
  body('email').isEmail().withMessage('Valid email is required.'),
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ ok: false, error: errors.array()[0].msg });
    }
    try {
      const ownerTeacherId = req.effectiveTeacherId || req.user.id;
      const { email } = req.body;
      const affiliation = await instituteAffiliationService.sendInvite(ownerTeacherId, email);
      res.json({ ok: true, affiliation });
    } catch (error) {
      next(error);
    }
  }
];

exports.respondToInvite = [
  body('accept').isBoolean().withMessage('accept boolean is required.'),
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ ok: false, error: errors.array()[0].msg });
    }
    try {
      const teacherId = req.effectiveTeacherId || req.user.id;
      const { id } = req.params;
      const { accept } = req.body;
      const affiliation = await instituteAffiliationService.respondToInvite(teacherId, id, accept);
      res.json({ ok: true, affiliation });
    } catch (error) {
      next(error);
    }
  }
];

exports.listIncomingRequests = async (req, res, next) => {
  try {
    const teacherId = req.effectiveTeacherId || req.user.id;
    const requests = await instituteAffiliationService.listIncomingRequests(teacherId);
    res.json({ ok: true, requests });
  } catch (error) {
    next(error);
  }
};

exports.listSentRequests = async (req, res, next) => {
  try {
    const ownerTeacherId = req.effectiveTeacherId || req.user.id;
    const requests = await instituteAffiliationService.listSentRequests(ownerTeacherId);
    res.json({ ok: true, requests });
  } catch (error) {
    next(error);
  }
};

exports.listMyAffiliations = async (req, res, next) => {
  try {
    const teacherId = req.effectiveTeacherId || req.user.id;
    const affiliations = await instituteAffiliationService.listMyAffiliations(teacherId);
    res.json({ ok: true, affiliations });
  } catch (error) {
    next(error);
  }
};

exports.setMainInstitute = [
  body('instituteId').notEmpty().withMessage('instituteId is required.'),
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ ok: false, error: errors.array()[0].msg });
    }
    try {
      const teacherId = req.effectiveTeacherId || req.user.id;
      const { instituteId } = req.body;
      await instituteAffiliationService.setMainInstitute(teacherId, instituteId);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  }
];

exports.leaveInstitute = async (req, res, next) => {
  try {
    const teacherId = req.effectiveTeacherId || req.user.id;
    const { id } = req.params;
    const affiliation = await instituteAffiliationService.leaveInstitute(teacherId, id);
    res.json({ ok: true, affiliation });
  } catch (error) {
    next(error);
  }
};

exports.removeAffiliate = async (req, res, next) => {
  try {
    const ownerTeacherId = req.effectiveTeacherId || req.user.id;
    const { id } = req.params;
    const affiliation = await instituteAffiliationService.removeAffiliate(ownerTeacherId, id);
    res.json({ ok: true, affiliation });
  } catch (error) {
    next(error);
  }
};

exports.updateTag = [
  body('tag').isString().withMessage('Tag must be a string.'),
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ ok: false, error: errors.array()[0].msg });
    }
    try {
      const ownerTeacherId = req.effectiveTeacherId || req.user.id;
      const { id } = req.params;
      const { tag } = req.body;
      const affiliation = await instituteAffiliationService.updateTag(ownerTeacherId, id, tag);
      res.json({ ok: true, affiliation });
    } catch (error) {
      next(error);
    }
  }
];
