const teacherOfflineAccessService = require('../services/teacherOfflineAccessService');

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
}

module.exports = new TeacherOfflineAccessController();
