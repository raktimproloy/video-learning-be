const bookService = require('../services/bookService');
const bookProcessingService = require('../services/bookProcessingService');
const bookEntitlementService = require('../services/bookEntitlementService');
const bookCourierService = require('../services/bookCourierService');
const bookReaderService = require('../services/bookReaderService');
const bookAnnotationService = require('../services/bookAnnotationService');
const bookCommissionService = require('../services/bookCommissionService');
const r2Storage = require('../services/r2StorageService');
const courseService = require('../services/courseService');
const paymentRequestService = require('../services/paymentRequestService');

function ownerId(req) {
    return req.user.ownerId || req.user.id;
}

function handleError(res, err) {
    const status = err.status || err.statusCode || 500;
    if (status >= 500) console.error(err);
    return res.status(status).json({ error: err.message || 'Server error' });
}

const bookController = {
    // ── Teacher: books CRUD ──────────────────────────────────────────────
    async listCourseBooks(req, res) {
        try {
            const teacherId = ownerId(req);
            await bookService.assertCourseOwner(req.params.courseId, teacherId);
            const books = await bookService.listByCourse(req.params.courseId, { teacherView: true });
            const pricing = await bookService.getCourseBookPricing(req.params.courseId);
            return res.json({ books, bookPricing: pricing });
        } catch (err) {
            return handleError(res, err);
        }
    },

    async createBook(req, res) {
        try {
            const book = await bookService.create(req.params.courseId, ownerId(req), req.body || {});
            return res.status(201).json(book);
        } catch (err) {
            return handleError(res, err);
        }
    },

    async updateBook(req, res) {
        try {
            const book = await bookService.update(req.params.bookId, ownerId(req), req.body || {});
            return res.json(book);
        } catch (err) {
            return handleError(res, err);
        }
    },

    async deleteBook(req, res) {
        try {
            const result = await bookService.delete(req.params.bookId, ownerId(req));
            return res.json(result);
        } catch (err) {
            return handleError(res, err);
        }
    },

    async upsertPricing(req, res) {
        try {
            const pricing = await bookService.upsertCourseBookPricing(
                req.params.courseId,
                ownerId(req),
                req.body || {}
            );
            return res.json(pricing);
        } catch (err) {
            return handleError(res, err);
        }
    },

    async initMultipart(req, res) {
        try {
            if (!r2Storage.isConfigured) {
                return res.status(400).json({ error: 'R2 is not configured on server.' });
            }
            const { bookId, file_name, file_type, file_size } = req.body || {};
            if (!bookId || !file_name) {
                return res.status(400).json({ error: 'bookId and file_name are required.' });
            }
            const book = await bookService.getById(bookId);
            if (!book) return res.status(404).json({ error: 'Book not found' });
            if (String(book.teacherId) !== String(ownerId(req))) {
                return res.status(403).json({ error: 'Not authorized' });
            }
            const ext = require('path').extname(file_name || '').toLowerCase() || '.pdf';
            if (ext !== '.pdf') {
                return res.status(400).json({ error: 'Only PDF files are allowed' });
            }

            const prefix = r2Storage.getBookKeyPrefix(book.teacherId, book.courseId, book.id);
            const objectKey = `${prefix}/master${ext}`;
            const uploadId = await r2Storage.createMultipartUpload(
                objectKey,
                file_type || 'application/pdf'
            );
            return res.json({
                uploadId,
                objectKey,
                r2Prefix: prefix,
                partSize: 10 * 1024 * 1024,
                fileSize: Number(file_size) || null,
            });
        } catch (err) {
            return handleError(res, err);
        }
    },

    async partUrl(req, res) {
        try {
            const { objectKey, uploadId, partNumber } = req.body || {};
            if (!objectKey || !uploadId || !partNumber) {
                return res.status(400).json({ error: 'objectKey, uploadId and partNumber are required.' });
            }
            const url = await r2Storage.getPresignedUploadPartUrl(objectKey, uploadId, partNumber);
            return res.json({ url });
        } catch (err) {
            return handleError(res, err);
        }
    },

    async completeMultipart(req, res) {
        try {
            const { objectKey, uploadId, parts, bookId } = req.body || {};
            if (!objectKey || !uploadId || !Array.isArray(parts) || !parts.length) {
                return res.status(400).json({ error: 'objectKey, uploadId and parts are required.' });
            }
            await r2Storage.completeMultipartUpload(objectKey, uploadId, parts);
            if (bookId) {
                await bookService.attachMasterPdf(bookId, ownerId(req), objectKey);
            }
            return res.json({ ok: true, objectKey });
        } catch (err) {
            return handleError(res, err);
        }
    },

    async abortMultipart(req, res) {
        try {
            const { objectKey, uploadId } = req.body || {};
            if (!objectKey || !uploadId) {
                return res.status(400).json({ error: 'objectKey and uploadId are required.' });
            }
            await r2Storage.abortMultipartUpload(objectKey, uploadId);
            return res.json({ ok: true });
        } catch (err) {
            return handleError(res, err);
        }
    },

    async processingStatus(req, res) {
        try {
            const book = await bookService.getById(req.params.bookId);
            if (!book) return res.status(404).json({ error: 'Book not found' });
            if (String(book.teacherId) !== String(ownerId(req))) {
                return res.status(403).json({ error: 'Not authorized' });
            }
            const status = await bookProcessingService.getStatus(req.params.bookId);
            return res.json(status);
        } catch (err) {
            return handleError(res, err);
        }
    },

    async giftBook(req, res) {
        try {
            const { studentUserId, studentId } = req.body || {};
            const sid = studentUserId || studentId;
            if (!sid) return res.status(400).json({ error: 'studentUserId is required' });
            const ent = await bookEntitlementService.gift({
                teacherId: ownerId(req),
                courseId: req.params.courseId,
                bookId: req.params.bookId,
                studentUserId: sid,
            });
            return res.json({ ok: true, entitlementId: ent.id });
        } catch (err) {
            return handleError(res, err);
        }
    },

    async listOrders(req, res) {
        try {
            const orders = await bookCourierService.listForTeacher(ownerId(req), {
                status: req.query.status || null,
                search: req.query.search || null,
                skip: parseInt(req.query.skip, 10) || 0,
                limit: Math.min(100, parseInt(req.query.limit, 10) || 50),
            });
            return res.json({ orders });
        } catch (err) {
            return handleError(res, err);
        }
    },

    async updateOrder(req, res) {
        try {
            const order = await bookCourierService.updateStatus(
                req.params.orderId,
                ownerId(req),
                req.body || {}
            );
            return res.json(order);
        } catch (err) {
            return handleError(res, err);
        }
    },

    async getPurchaseInfo(req, res) {
        try {
            const info = await bookCourierService.getEligibility(req.params.bookId, req.user.id);
            return res.json(info);
        } catch (err) {
            return handleError(res, err);
        }
    },

    async listStudentBookOrders(req, res) {
        try {
            const activeOnly =
                req.query.active === '1' ||
                req.query.active === 'true' ||
                req.query.activeOnly === '1';
            const orders = await bookCourierService.listForStudent(req.user.id, {
                activeOnly,
                limit: Math.min(100, parseInt(req.query.limit, 10) || 50),
            });
            return res.json({ orders });
        } catch (err) {
            return handleError(res, err);
        }
    },

    async buyPdf(req, res) {
        try {
            const bookId = req.params.bookId;
            const body = req.body || {};
            const result = await bookCourierService.createPdfPurchase(bookId, req.user.id);

            if (result.free) {
                return res.json({ granted: true, free: true });
            }

            const paymentRequestService = require('../services/paymentRequestService');
            const uddoktapayService = require('../services/uddoktapayService');

            const pr = await paymentRequestService.createPaymentRequest({
                courseId: result.courseId,
                userId: req.user.id,
                paymentMethod: body.paymentMethod || 'uddoktapay',
                senderPhone: body.senderPhone || body.phone || '',
                transactionId: body.transactionId || `book-pdf-${Date.now()}`,
                amount: result.totalAmount,
                currency: 'BDT',
                purchaseType: 'book_addon',
                bookItems: result.bookItems,
                courseAmount: 0,
                bookAmount: result.totalAmount,
            });

            if (body.paymentMethod && body.paymentMethod !== 'uddoktapay' && body.paymentMethod !== 'bkash') {
                return res.status(201).json({
                    paymentRequestId: pr.id,
                    amount: result.totalAmount,
                    purchaseType: 'book_addon',
                });
            }

            const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
            const host = req.headers.host;
            const baseUrl = `${protocol}://${host}`;
            const frontendUrl = process.env.FRONTEND_URL || baseUrl.replace(/:\d+$/, ':3000');

            const initRes = await uddoktapayService.initiatePayment({
                fullName: body.fullName || req.user.name || 'Student',
                email: req.user.email,
                amount: result.totalAmount,
                metadata: {
                    type: 'book_addon',
                    payment_request_id: pr.id,
                    requestId: pr.id,
                    course_id: result.courseId,
                    bookId,
                },
                redirectUrl: `${frontendUrl}/uddoktapay-redirect?bookId=${bookId}&type=book_addon`,
                cancelUrl: `${frontendUrl}/student/books/${bookId}/checkout?intent=pdf&status=cancelled&courseId=${result.courseId}`,
                webhookUrl: `${baseUrl}/v1/courses/uddoktapay/webhook`,
            });

            if (!initRes.success || !initRes.paymentUrl) {
                return res.status(500).json({ error: initRes.message || 'Payment initiation failed' });
            }

            return res.status(201).json({
                paymentRequestId: pr.id,
                paymentUrl: initRes.paymentUrl,
                amount: result.totalAmount,
                purchaseType: 'book_addon',
            });
        } catch (err) {
            return handleError(res, err);
        }
    },

    async checkoutBook(req, res) {
        try {
            const bookId = req.params.bookId;
            const body = req.body || {};
            const result = await bookCourierService.createCheckout(bookId, req.user.id, body);

            if (result.free) {
                return res.json({
                    granted: true,
                    free: true,
                    order: result.order,
                });
            }

            const paymentRequestService = require('../services/paymentRequestService');
            const uddoktapayService = require('../services/uddoktapayService');

            const pr = await paymentRequestService.createPaymentRequest({
                courseId: result.courseId,
                userId: req.user.id,
                paymentMethod: body.paymentMethod || 'uddoktapay',
                senderPhone: body.phone || body.senderPhone || '',
                transactionId: body.transactionId || `book-courier-${Date.now()}`,
                amount: result.totalAmount,
                currency: 'BDT',
                purchaseType: result.bookPriceAmount > 0 ? 'book_courier' : 'courier_fee',
                bookItems: result.bookItems,
                courseAmount: 0,
                bookAmount: result.totalAmount,
            });

            const db = require('../../db');
            await bookCourierService.linkPaymentRequest(result.order.id, pr.id, {
                amount: result.totalAmount,
                purchaseType: result.bookPriceAmount > 0 ? 'book_courier' : 'courier_fee',
            });

            // Manual / offline payment request — no gateway redirect
            if (body.paymentMethod && body.paymentMethod !== 'uddoktapay' && body.paymentMethod !== 'bkash') {
                return res.status(201).json({
                    paymentRequestId: pr.id,
                    amount: result.totalAmount,
                    purchaseType: 'book_courier',
                    order: { ...result.order, paymentRequestId: pr.id },
                    quantity: result.quantity,
                });
            }

            const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
            const host = req.headers.host;
            const baseUrl = `${protocol}://${host}`;
            const frontendUrl = process.env.FRONTEND_URL || baseUrl.replace(/:\d+$/, ':3000');

            const initRes = await uddoktapayService.initiatePayment({
                fullName: body.fullName || req.user.name || 'Student',
                email: req.user.email,
                amount: result.totalAmount,
                metadata: {
                    type: 'book_courier',
                    courierOrderId: result.order.id,
                    payment_request_id: pr.id,
                    requestId: pr.id,
                    course_id: result.courseId,
                    bookId,
                },
                redirectUrl: `${frontendUrl}/uddoktapay-redirect?bookId=${bookId}&type=book_courier`,
                cancelUrl: `${frontendUrl}/student/books/${bookId}/checkout?status=cancelled&courseId=${result.courseId}`,
                webhookUrl: `${baseUrl}/v1/courses/uddoktapay/webhook`,
            });

            if (!initRes.success || !initRes.paymentUrl) {
                return res.status(500).json({ error: initRes.message || 'Payment initiation failed' });
            }

            return res.status(201).json({
                paymentRequestId: pr.id,
                paymentUrl: initRes.paymentUrl,
                amount: result.totalAmount,
                purchaseType: 'book_courier',
                order: { ...result.order, paymentRequestId: pr.id },
                quantity: result.quantity,
                bookPriceAmount: result.bookPriceAmount,
                courierFeeAmount: result.courierFeeAmount,
            });
        } catch (err) {
            return handleError(res, err);
        }
    },

    async teacherEarnings(req, res) {
        try {
            const earnings = await bookCommissionService.getTeacherEarnings(ownerId(req));
            return res.json(earnings);
        } catch (err) {
            return handleError(res, err);
        }
    },

    // ── Public / student ─────────────────────────────────────────────────
    async publicCourseBooks(req, res) {
        try {
            const userId = req.user?.id || null;
            const data = await bookService.getPublicMetaForCourse(req.params.courseId, userId);
            return res.json(data);
        } catch (err) {
            return handleError(res, err);
        }
    },

    async previewPage(req, res) {
        try {
            await bookReaderService.streamPage(
                req.user?.id || null,
                req.params.bookId,
                req.params.page,
                res,
                { previewOnly: true }
            );
        } catch (err) {
            if (!res.headersSent) return handleError(res, err);
        }
    },

    async streamPage(req, res) {
        try {
            await bookReaderService.streamPage(
                req.user.id,
                req.params.bookId,
                req.params.page,
                res,
                { previewOnly: false }
            );
        } catch (err) {
            if (!res.headersSent) return handleError(res, err);
        }
    },

    async readerMeta(req, res) {
        try {
            const meta = await bookReaderService.getReaderMeta(req.user.id, req.params.bookId);
            return res.json(meta);
        } catch (err) {
            return handleError(res, err);
        }
    },

    async myBooks(req, res) {
        try {
            const books = await bookEntitlementService.listForUserWithEligibility(req.user.id);
            return res.json({ books });
        } catch (err) {
            return handleError(res, err);
        }
    },

    async purchaseBooks(req, res) {
        try {
            const courseId = req.params.courseId;
            const userId = req.user.id;
            const { bookIds = [], paymentMethod = 'uddoktapay', senderPhone = '', transactionId = '' } =
                req.body || {};

            if (!Array.isArray(bookIds) || !bookIds.length) {
                return res.status(400).json({ error: 'bookIds required' });
            }

            const enrolled = await courseService.isEnrolled(userId, courseId);
            if (!enrolled) {
                return res.status(400).json({ error: 'You must be enrolled in the course to buy books separately' });
            }

            const bookItems = [];
            let bookAmount = 0;
            for (const bookId of bookIds) {
                if (await bookEntitlementService.isPurchaseBlocked(userId, bookId)) {
                    return res.status(409).json({
                        error: 'Book already provided (purchased or gifted)',
                        bookId,
                        purchaseBlocked: true,
                    });
                }
                const book = await bookService.getById(bookId);
                if (!book || book.courseId !== courseId || book.status !== 'published') {
                    return res.status(400).json({ error: `Invalid book: ${bookId}` });
                }
                let price = book.pricingMode === 'free_with_course' ? 0 : book.addonPrice || 0;
                // Courier fee is now charged separately when the student provides their address.
                let courierFee = 0;
                bookAmount += price;
                bookItems.push({
                    bookId: book.id,
                    title: book.title,
                    addonPrice: price,
                    courierFee,
                });
            }

            if (bookAmount <= 0) {
                // Free — grant immediately
                for (const item of bookItems) {
                    await bookEntitlementService.grant({
                        userId,
                        courseId,
                        courseBookId: item.bookId,
                        source: 'purchase',
                        priceSnapshot: item,
                    });
                }
                return res.json({ granted: true, free: true });
            }

            const row = await paymentRequestService.createPaymentRequest({
                courseId,
                userId,
                paymentMethod,
                senderPhone,
                transactionId: transactionId || `book-${Date.now()}`,
                amount: bookAmount,
                currency: 'BDT',
                purchaseType: 'book_addon',
                bookItems,
                courseAmount: 0,
                bookAmount,
            });

            return res.status(201).json({
                paymentRequestId: row.id,
                amount: bookAmount,
                purchaseType: 'book_addon',
                bookItems,
            });
        } catch (err) {
            return handleError(res, err);
        }
    },

    async saveCourierAddress(req, res) {
        try {
            const result = await bookCourierService.upsertAddress(
                req.params.bookId,
                req.user.id,
                req.body || {}
            );

            let paymentRequestId = null;
            let paymentUrl = null;

            if (result.paymentRequired) {
                const paymentRequestService = require('../services/paymentRequestService');
                const uddoktapayService = require('../services/uddoktapayService');
                
                const pr = await paymentRequestService.createPaymentRequest({
                    courseId: result.courseId,
                    userId: req.user.id,
                    paymentMethod: 'uddoktapay',
                    senderPhone: req.body.phone || '',
                    transactionId: `courier-${Date.now()}`,
                    amount: result.courierFeeAmount,
                    currency: 'BDT',
                    purchaseType: 'courier_fee',
                    bookItems: [{ bookId: req.params.bookId, courierFee: result.courierFeeAmount }],
                    courseAmount: 0,
                    bookAmount: result.courierFeeAmount,
                });
                
                paymentRequestId = pr.id;

                // Update the courier order to reference this payment request
                await bookCourierService.linkPaymentRequest(result.order.id, paymentRequestId, {
                    amount: result.courierFeeAmount,
                    purchaseType: 'courier_fee',
                });

                const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
                const host = req.headers.host;
                let baseUrl = `${protocol}://${host}`;
                // Optional: determine frontend url from env for redirects
                const frontendUrl = process.env.FRONTEND_URL || baseUrl.replace(/:\d+$/, ':3000');

                const initRes = await uddoktapayService.initiatePayment({
                    fullName: req.body.fullName || req.user.name || 'Student',
                    email: req.user.email,
                    amount: result.courierFeeAmount,
                    metadata: {
                        type: 'courier_fee',
                        courierOrderId: result.order.id,
                        payment_request_id: paymentRequestId,
                        requestId: paymentRequestId,
                        course_id: result.courseId,
                        bookId: req.params.bookId,
                    },
                    redirectUrl: `${frontendUrl}/uddoktapay-redirect?bookId=${req.params.bookId}&type=courier_fee`,
                    cancelUrl: `${frontendUrl}/student/books/${req.params.bookId}/courier?status=cancelled`,
                    webhookUrl: `${baseUrl}/v1/courses/uddoktapay/webhook`,
                });

                if (initRes.success && initRes.paymentUrl) {
                    paymentUrl = initRes.paymentUrl;
                } else {
                    return res.status(500).json({ error: initRes.message || 'Payment initiation failed' });
                }
            }

            return res.json({ order: result.order, paymentUrl, paymentRequestId });
        } catch (err) {
            return handleError(res, err);
        }
    },

    async getCourierOrder(req, res) {
        try {
            const order = await bookCourierService.getByBookForStudent(req.params.bookId, req.user.id);
            if (!order) return res.status(404).json({ error: 'No courier order' });
            return res.json(order);
        } catch (err) {
            return handleError(res, err);
        }
    },

    // ── Student: Reading Progress ────────────────────────────────────────────────
    async getReadingProgress(req, res) {
        try {
            const lastPage = await bookReaderService.getReadingProgress(ownerId(req), req.params.bookId);
            return res.json({ lastPage });
        } catch (err) {
            return handleError(res, err);
        }
    },

    async saveReadingProgress(req, res) {
        try {
            const { lastPage } = req.body;
            const result = await bookReaderService.saveReadingProgress(ownerId(req), req.params.bookId, lastPage || 0);
            return res.json(result);
        } catch (err) {
            return handleError(res, err);
        }
    },

    async listAnnotations(req, res) {
        try {
            const items = await bookAnnotationService.list(
                req.user.id,
                req.params.bookId,
                req.query.page != null ? req.query.page : null
            );
            return res.json({ annotations: items });
        } catch (err) {
            return handleError(res, err);
        }
    },

    async createAnnotation(req, res) {
        try {
            const item = await bookAnnotationService.create(req.user.id, req.params.bookId, req.body || {});
            return res.status(201).json(item);
        } catch (err) {
            return handleError(res, err);
        }
    },

    async updateAnnotation(req, res) {
        try {
            const item = await bookAnnotationService.update(
                req.user.id,
                req.params.annotationId,
                req.body || {}
            );
            return res.json(item);
        } catch (err) {
            return handleError(res, err);
        }
    },

    async deleteAnnotation(req, res) {
        try {
            const result = await bookAnnotationService.remove(req.user.id, req.params.annotationId);
            return res.json(result);
        } catch (err) {
            return handleError(res, err);
        }
    },

    async bulkSyncAnnotations(req, res) {
        try {
            const result = await bookAnnotationService.bulkSync(
                req.user.id,
                req.params.bookId,
                req.body || {}
            );
            return res.json(result);
        } catch (err) {
            return handleError(res, err);
        }
    },

    // ── Admin ────────────────────────────────────────────────────────────
    async adminListBooks(req, res) {
        try {
            const data = await bookService.adminList({
                skip: parseInt(req.query.skip, 10) || 0,
                limit: Math.min(50, parseInt(req.query.limit, 10) || 20),
                status: req.query.status || null,
                search: req.query.search || null,
            });
            return res.json(data);
        } catch (err) {
            return handleError(res, err);
        }
    },

    async adminGetBook(req, res) {
        try {
            const book = await bookService.adminGetById(req.params.bookId);
            if (!book) return res.status(404).json({ error: 'Book not found' });
            return res.json(book);
        } catch (err) {
            return handleError(res, err);
        }
    },

    async adminUpdateBook(req, res) {
        try {
            const book = await bookService.adminUpdate(req.params.bookId, req.body || {});
            return res.json(book);
        } catch (err) {
            return handleError(res, err);
        }
    },

    async adminDeleteBook(req, res) {
        try {
            const result = await bookService.adminDelete(req.params.bookId);
            return res.json(result);
        } catch (err) {
            return handleError(res, err);
        }
    },

    async adminSetBookStatus(req, res) {
        try {
            const { status } = req.body || {};
            const book = await bookService.adminSetStatus(req.params.bookId, status);
            return res.json(book);
        } catch (err) {
            return handleError(res, err);
        }
    },

    async adminGetRecipients(req, res) {
        try {
            const data = await bookEntitlementService.listRecipientsForBook(req.params.bookId);
            return res.json(data);
        } catch (err) {
            return handleError(res, err);
        }
    },

    async adminManualGrant(req, res) {
        try {
            const { emailOrUserId, studentEmail, studentId, studentUserId, hasPdf = true, hasCourier = false, note } = req.body || {};
            const target = emailOrUserId || studentEmail || studentUserId || studentId;
            if (!target) return res.status(400).json({ error: 'Student email or ID is required' });
            const ent = await bookEntitlementService.adminManualGrant({
                bookId: req.params.bookId,
                emailOrUserId: target,
                hasPdf,
                hasCourier,
                note,
            });
            return res.json({ ok: true, entitlement: ent });
        } catch (err) {
            return handleError(res, err);
        }
    },

    async adminRevokeGrant(req, res) {
        try {
            const { entitlementId } = req.body || {};
            if (!entitlementId) return res.status(400).json({ error: 'entitlementId is required' });
            const result = await bookEntitlementService.adminRevokeGrant({
                entitlementId,
            });
            return res.json(result);
        } catch (err) {
            return handleError(res, err);
        }
    },

    async adminListOrders(req, res) {
        try {
            const data = await bookCourierService.adminList({
                skip: parseInt(req.query.skip, 10) || 0,
                limit: Math.min(50, parseInt(req.query.limit, 10) || 20),
                status: req.query.status || null,
                search: req.query.search || null,
            });
            return res.json(data);
        } catch (err) {
            return handleError(res, err);
        }
    },

    async adminGetOrder(req, res) {
        try {
            const order = await bookCourierService.adminGet(req.params.orderId);
            return res.json(order);
        } catch (err) {
            return handleError(res, err);
        }
    },

    async adminUpdateOrder(req, res) {
        try {
            const order = await bookCourierService.adminUpdate(req.params.orderId, req.body);
            return res.json(order);
        } catch (err) {
            return handleError(res, err);
        }
    },

    async adminDeleteOrder(req, res) {
        try {
            const result = await bookCourierService.adminDelete(req.params.orderId);
            return res.json(result);
        } catch (err) {
            return handleError(res, err);
        }
    },
};

module.exports = bookController;
