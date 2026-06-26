const certificateService = require('../services/certificateService');

function toUserFacingError(error) {
  if (error.statusCode && error.statusCode < 500) {
    return error.message;
  }
  const msg = String(error.message || '');
  if (
    error.code === '42P01' ||
    msg.includes('course_certificates') ||
    msg.includes('does not exist')
  ) {
    return 'Certificates are temporarily unavailable. Please try again shortly or contact support if this continues.';
  }
  return 'We could not process your certificate request. Please try again in a moment.';
}

async function getCourseCertificateStatus(req, res) {
  try {
    const userId = req.user.id;
    const { courseId } = req.params;
    const status = await certificateService.getCertificateStatus(userId, courseId);
    return res.json(status);
  } catch (error) {
    const code = error.statusCode || 500;
    if (code >= 500) console.error('Get certificate status error:', error);
    return res.status(code).json({
      error: toUserFacingError(error),
      ...(error.details ? { details: error.details } : {}),
    });
  }
}

async function issueCourseCertificate(req, res) {
  try {
    const userId = req.user.id;
    const { courseId } = req.params;
    const result = await certificateService.issueCertificate(userId, courseId);
    return res.json(result);
  } catch (error) {
    const code = error.statusCode || 500;
    if (code >= 500) console.error('Issue certificate error:', error);
    return res.status(code).json({
      error: toUserFacingError(error),
      ...(error.details ? { details: error.details } : {}),
    });
  }
}

async function getCertificate(req, res) {
  try {
    const userId = req.user.id;
    const { certificateId } = req.params;
    const certificate = await certificateService.getCertificateById(userId, certificateId);
    return res.json(certificate);
  } catch (error) {
    const code = error.statusCode || 500;
    if (code >= 500) console.error('Get certificate error:', error);
    return res.status(code).json({ error: toUserFacingError(error) });
  }
}

async function getPublicCertificate(req, res) {
  try {
    const { certificateNumber } = req.params;
    const certificate = await certificateService.getPublicCertificateByNumber(certificateNumber);
    return res.json(certificate);
  } catch (error) {
    const code = error.statusCode || 500;
    if (code >= 500) console.error('Get public certificate error:', error);
    return res.status(code).json({ error: toUserFacingError(error) });
  }
}

module.exports = {
  getCourseCertificateStatus,
  issueCourseCertificate,
  getCertificate,
  getPublicCertificate,
};
