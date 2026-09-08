const teacherOfflineAccessService = require('../services/teacherOfflineAccessService');
const { resolveCourseMediaUrl, resolveCourseThumbnailUrl, resolveProfileImageUrl } = require('../utils/courseMediaUrl');

function teacherId(req) {
    return req.effectiveTeacherId || req.user.id;
}

class TeacherOfflineAccessController {
    async calculateFee(req, res) {
        try {
            const { courseId, count } = req.query;
            if (!courseId || !count) return res.status(400).json({ error: 'courseId and count are required' });
            
            const studentCount = parseInt(count, 10);
            if (isNaN(studentCount) || studentCount <= 0) {
                return res.status(400).json({ error: 'Invalid student count' });
            }

            const feeData = await teacherOfflineAccessService.calculateFee(courseId, studentCount);
            res.json(feeData);
        } catch (error) {
            console.error('Calculate fee error:', error);
            res.status(500).json({ error: error.message || 'Internal server error' });
        }
    }

    async createPurchase(req, res) {
        try {
            const { courseId, studentCount } = req.body;
            
            if (!courseId || !studentCount) {
                return res.status(400).json({ error: 'courseId and studentCount are required.' });
            }

            const teacherIdVal = teacherId(req);
            const uddoktapayService = require('../services/uddoktapayService');

            // 1. Create a pending purchase request
            const purchase = await teacherOfflineAccessService.createPurchaseRequest(teacherIdVal, {
                courseId,
                studentCount: parseInt(studentCount, 10),
                paymentMethod: 'uddoktapay', // Auto-set
                senderPhone: null,
                transactionId: null
            });

            // 2. Build URLs for redirection (similar to courseController.js)
            let serverUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/v1';
            let frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
            
            // Remove /v1 if present in API_URL for base URL
            const cleanServerUrl = serverUrl.replace(/\/v1\/?$/, '');
            const sanitizeUrl = (base, path) => `${base.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
            
            // Redirect back to the students page
            const redirectUrl = sanitizeUrl(frontendUrl, 'teacher/students');
            const cancelUrl = sanitizeUrl(frontendUrl, 'teacher/students');
            const webhookUrl = sanitizeUrl(frontendUrl, 'api/uddoktapay/webhook');

            // 3. Initiate payment
            const initiateResult = await uddoktapayService.initiatePayment({
                fullName: req.user.name || 'Teacher',
                email: req.user.email || 'teacher@example.com',
                amount: purchase.total_amount,
                metadata: {
                    type: 'teacher_offline_access',
                    purchase_id: purchase.id,
                    user_id: teacherIdVal
                },
                redirectUrl,
                cancelUrl,
                webhookUrl,
            });

            if (!initiateResult.success) {
                // Remove the pending purchase if initiation fails
                const db = require('../../db');
                await db.query(`DELETE FROM teacher_offline_access_purchases WHERE id = $1`, [purchase.id]);
                console.error(`UddoktaPay Error: ${initiateResult.message}`);
                return res.status(500).json({ error: initiateResult.message || 'UddoktaPay payment initiation failed.' });
            }

            res.status(201).json({ paymentUrl: initiateResult.paymentUrl, purchaseId: purchase.id });
        } catch (error) {
            console.error('Create purchase error:', error);
            res.status(500).json({ error: error.message || 'Internal server error' });
        }
    }

    async getPurchases(req, res) {
        try {
            const purchases = await teacherOfflineAccessService.listPurchasesByTeacher(teacherId(req));
            res.json(purchases);
        } catch (error) {
            console.error('Get purchases error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async assignStudent(req, res) {
        try {
            const { purchaseId, studentEmail } = req.body;
            if (!purchaseId || !studentEmail) {
                return res.status(400).json({ error: 'purchaseId and studentEmail are required.' });
            }

            const result = await teacherOfflineAccessService.assignStudentAccess(purchaseId, studentEmail.trim(), teacherId(req));
            res.json(result);
        } catch (error) {
            console.error('Assign student error:', error);
            res.status(400).json({ error: error.message || 'Failed to assign student' });
        }
    }

    // ── Invite links ──────────────────────────────────────────────────────

    async generateInvite(req, res) {
        try {
            const { purchaseId } = req.body;
            if (!purchaseId) return res.status(400).json({ error: 'purchaseId is required.' });
            const invite = await teacherOfflineAccessService.generateInvite(purchaseId, teacherId(req), req.user.id);
            res.status(201).json(invite);
        } catch (error) {
            console.error('Generate invite error:', error);
            res.status(400).json({ error: error.message || 'Failed to generate invite link' });
        }
    }

    async getInvites(req, res) {
        try {
            const invites = await teacherOfflineAccessService.listInvitesByTeacher(
                teacherId(req),
                req.query.purchaseId || null
            );
            res.json(invites);
        } catch (error) {
            console.error('Get invites error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async revokeInvite(req, res) {
        try {
            await teacherOfflineAccessService.revokeInvite(req.params.id, teacherId(req));
            res.json({ success: true });
        } catch (error) {
            console.error('Revoke invite error:', error);
            res.status(400).json({ error: error.message || 'Failed to revoke invite link' });
        }
    }

    // ── Public claim landing ─────────────────────────────────────────────

    async getPublicInvite(req, res) {
        try {
            const info = await teacherOfflineAccessService.getInviteByToken(req.params.token, req.user?.id || null);
            if (!info) return res.status(404).json({ error: 'This invite link is not valid.' });

            const thumbnailUrl = resolveCourseThumbnailUrl(info);
            const introVideoUrl = resolveCourseMediaUrl(info.intro_video_path);

            res.json({
                invite: {
                    status: info.status,
                    available: info.available,
                    claimed_by_me: info.claimed_by_me,
                    claimed_at: info.claimed_at,
                },
                course: {
                    id: info.course_id,
                    title: info.title,
                    short_description: info.short_description,
                    full_description: info.full_description,
                    level: info.level,
                    language: info.language,
                    price: info.price,
                    discount_price: info.discount_price,
                    currency: info.currency,
                    lesson_count: parseInt(info.lesson_count) || 0,
                    thumbnail_url: thumbnailUrl || null,
                    intro_video_url: introVideoUrl || null,
                },
                teacher: {
                    id: info.teacher_id,
                    name: info.teacher_name || null,
                    email: info.teacher_email || null,
                    bio: info.teacher_bio || null,
                    institute_name: info.teacher_institute_name || null,
                    avatar_url: resolveProfileImageUrl(info.teacher_profile_image_path),
                    is_verified: !!info.teacher_is_verified,
                    course_count: parseInt(info.teacher_course_count) || 0,
                    student_count: parseInt(info.teacher_student_count) || 0,
                    rating: info.teacher_rating != null ? Number(Number(info.teacher_rating).toFixed(1)) : 0,
                },
                // kept for backward compatibility
                teacher_name: info.teacher_name || null,
            });
        } catch (error) {
            console.error('Get public invite error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async claimInvite(req, res) {
        try {
            const result = await teacherOfflineAccessService.claimInvite(req.params.token, req.user.id);
            res.json(result);
        } catch (error) {
            const code = error.code || 'ERROR';
            const status = code === 'ALREADY_ENROLLED' || code === 'ALREADY_CLAIMED_BY_ME' ? 409
                : code === 'ALREADY_CLAIMED' ? 409
                : code === 'INVALID' ? 404
                : 400;
            if (status >= 500) console.error('Claim invite error:', error);
            res.status(status).json({ error: error.message || 'Failed to claim course', code, courseId: error.courseId || null });
        }
    }
}

module.exports = new TeacherOfflineAccessController();
