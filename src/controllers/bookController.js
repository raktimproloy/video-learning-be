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

            // Enforce admin max upload size if provided
            const adminSettingsService = require('../services/adminSettingsService');
            let maxMb = 500;
            try {
                const share = await adminSettingsService.getBookShareSettings?.() ||
                    await adminSettingsService.getShareSettings();
                if (share?.bookMaxUploadMb) maxMb = share.bookMaxUploadMb;
            } catch (_) {}
            if (file_size && Number(file_size) > maxMb * 1024 * 1024) {
                return res.status(413).json({ error: `PDF exceeds max size of ${maxMb}MB` });
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
            const books = await bookEntitlementService.listForUser(req.user.id);
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
                let courierFee = 0;
                if (
                    (book.deliveryMode === 'courier_only' || book.deliveryMode === 'both') &&
                    book.courierFeePaidBy === 'student'
                ) {
                    courierFee = book.courierFee || 0;
                }
                bookAmount += price + courierFee;
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
            const order = await bookCourierService.upsertAddress(
                req.params.bookId,
                req.user.id,
                req.body || {}
            );
            return res.json(order);
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

    async adminSetBookStatus(req, res) {
        try {
            const { status } = req.body || {};
            const book = await bookService.adminSetStatus(req.params.bookId, status);
            return res.json(book);
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
};

module.exports = bookController;
