const db = require('../../db');
const r2Storage = require('./r2StorageService');
const path = require('path');

function mapBook(row) {
    if (!row) return null;
    return {
        id: row.id,
        courseId: row.course_id,
        teacherId: row.teacher_id,
        title: row.title,
        subtitle: row.subtitle,
        description: row.description,
        coverPath: row.cover_path,
        masterPdfR2Key: row.master_pdf_r2_key,
        totalPages: row.total_pages || 0,
        previewPageCount: row.preview_page_count ?? 3,
        deliveryMode: row.delivery_mode,
        pricingMode: row.pricing_mode,
        addonPrice: row.addon_price != null ? parseFloat(row.addon_price) : 0,
        courierFee: row.courier_fee != null ? parseFloat(row.courier_fee) : 0,
        courierFeePaidBy: row.courier_fee_paid_by || 'student',
        stockLimit: row.stock_limit,
        stockRemaining: row.stock_remaining,
        sortOrder: row.sort_order || 0,
        status: row.status,
        processingStatus: row.processing_status,
        processingError: row.processing_error,
        currency: row.currency || 'BDT',
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        courseTitle: row.course_title || undefined,
        teacherName: row.teacher_name || undefined,
    };
}

function mapPricing(row) {
    if (!row) return null;
    return {
        courseId: row.course_id,
        dualPricingEnabled: !!row.dual_pricing_enabled,
        priceWithoutBooks: row.price_without_books != null ? parseFloat(row.price_without_books) : null,
        priceWithAllBooks: row.price_with_all_books != null ? parseFloat(row.price_with_all_books) : null,
        discountWithoutBooks:
            row.discount_without_books != null ? parseFloat(row.discount_without_books) : null,
        discountWithAllBooks:
            row.discount_with_all_books != null ? parseFloat(row.discount_with_all_books) : null,
        pricingSnapshot: row.pricing_snapshot || [],
        updatedAt: row.updated_at,
    };
}

class BookService {
    async assertCourseOwner(courseId, teacherId) {
        const result = await db.query(
            `SELECT id, teacher_id, title, price, discount_price, currency
             FROM courses WHERE id = $1`,
            [courseId]
        );
        const course = result.rows[0];
        if (!course) {
            const err = new Error('Course not found');
            err.status = 404;
            throw err;
        }
        if (String(course.teacher_id) !== String(teacherId)) {
            const err = new Error('Not authorized for this course');
            err.status = 403;
            throw err;
        }
        return course;
    }

    async listByCourse(courseId, options = {}) {
        const { includeDrafts = false, teacherView = false } = options;
        let where = 'cb.course_id = $1';
        const params = [courseId];
        if (!includeDrafts && !teacherView) {
            where += ` AND cb.status = 'published'`;
        }
        const result = await db.query(
            `SELECT cb.* FROM course_books cb
             WHERE ${where}
             ORDER BY cb.sort_order ASC, cb.created_at ASC`,
            params
        );
        return result.rows.map(mapBook);
    }

    async getById(bookId) {
        const result = await db.query(`SELECT * FROM course_books WHERE id = $1`, [bookId]);
        return mapBook(result.rows[0]);
    }

    async getPublicMetaForCourse(courseId, userId = null) {
        const books = await this.listByCourse(courseId, { includeDrafts: false });
        const pricing = await this.getCourseBookPricing(courseId);

        let entitlements = [];
        let isTeacher = false;
        let isEnrolled = false;

        if (userId) {
            const courseRes = await db.query(`SELECT teacher_id FROM courses WHERE id = $1`, [courseId]);
            if (courseRes.rows[0] && String(courseRes.rows[0].teacher_id) === String(userId)) {
                isTeacher = true;
            } else {
                const courseService = require('./courseService');
                isEnrolled = await courseService.isEnrolled(userId, courseId);
            }

            const ent = await db.query(
                `SELECT course_book_id, source, has_pdf, has_courier, purchase_blocked, revoked_at
                 FROM book_entitlements
                 WHERE user_id = $1 AND course_id = $2 AND revoked_at IS NULL`,
                [userId, courseId]
            );
            entitlements = ent.rows.map((r) => ({
                bookId: r.course_book_id,
                source: r.source,
                hasPdf: r.has_pdf,
                hasCourier: r.has_courier,
                purchaseBlocked: r.purchase_blocked,
            }));
        }

        const publicBooks = books.map((b) => {
            const ent = entitlements.find((e) => e.bookId === b.id);
            const isOwned = !!ent || isTeacher || (isEnrolled && (b.pricingMode === 'free_with_course' || b.pricingMode === 'included'));
            const effectiveEntitlement = ent || (isOwned ? {
                bookId: b.id,
                source: isTeacher ? 'teacher' : 'course_enrollment',
                hasPdf: b.deliveryMode === 'pdf_only' || b.deliveryMode === 'both',
                hasCourier: false,
                purchaseBlocked: true,
            } : null);

            return {
                id: b.id,
                title: b.title,
                subtitle: b.subtitle,
                description: b.description,
                coverPath: b.coverPath,
                totalPages: b.totalPages,
                previewPageCount: b.previewPageCount,
                deliveryMode: b.deliveryMode,
                pricingMode: b.pricingMode,
                addonPrice: b.addonPrice,
                courierFee: b.courierFee,
                courierFeePaidBy: b.courierFeePaidBy,
                stockRemaining: b.stockRemaining,
                stockLimit: b.stockLimit,
                currency: b.currency,
                processingStatus: b.processingStatus,
                status: b.status,
                owned: isOwned,
                purchaseBlocked: isOwned || ent?.purchaseBlocked || false,
                entitlement: effectiveEntitlement,
            };
        });

        return { books: publicBooks, bookPricing: pricing };
    }

    async create(courseId, teacherId, data) {
        await this.assertCourseOwner(courseId, teacherId);
        const {
            title,
            subtitle = null,
            description = null,
            deliveryMode = 'pdf_only',
            pricingMode = 'included',
            addonPrice = 0,
            courierFee = 0,
            courierFeePaidBy = 'student',
            previewPageCount = 3,
            stockLimit = null,
            currency = 'BDT',
            sortOrder = 0,
        } = data;

        if (!title || !String(title).trim()) {
            const err = new Error('Book title is required');
            err.status = 400;
            throw err;
        }

        const result = await db.query(
            `INSERT INTO course_books (
                course_id, teacher_id, title, subtitle, description,
                delivery_mode, pricing_mode, addon_price, courier_fee, courier_fee_paid_by,
                preview_page_count, stock_limit, stock_remaining, currency, sort_order, status
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12,$13,$14,'draft')
             RETURNING *`,
            [
                courseId,
                teacherId,
                String(title).trim(),
                subtitle,
                description,
                deliveryMode,
                pricingMode,
                parseFloat(addonPrice) || 0,
                parseFloat(courierFee) || 0,
                courierFeePaidBy,
                Math.min(5, Math.max(0, parseInt(previewPageCount, 10) || 3)),
                stockLimit != null ? parseInt(stockLimit, 10) : null,
                currency || 'BDT',
                parseInt(sortOrder, 10) || 0,
            ]
        );
        return mapBook(result.rows[0]);
    }

    async update(bookId, teacherId, data) {
        const book = await this.getById(bookId);
        if (!book) {
            const err = new Error('Book not found');
            err.status = 404;
            throw err;
        }
        if (String(book.teacherId) !== String(teacherId)) {
            const err = new Error('Not authorized');
            err.status = 403;
            throw err;
        }

        const fields = [];
        const params = [];
        let i = 1;
        const map = {
            title: 'title',
            subtitle: 'subtitle',
            description: 'description',
            coverPath: 'cover_path',
            deliveryMode: 'delivery_mode',
            pricingMode: 'pricing_mode',
            addonPrice: 'addon_price',
            courierFee: 'courier_fee',
            courierFeePaidBy: 'courier_fee_paid_by',
            previewPageCount: 'preview_page_count',
            stockLimit: 'stock_limit',
            stockRemaining: 'stock_remaining',
            sortOrder: 'sort_order',
            status: 'status',
            currency: 'currency',
        };

        for (const [key, col] of Object.entries(map)) {
            if (data[key] !== undefined) {
                let val = data[key];
                if (key === 'addonPrice' || key === 'courierFee') val = parseFloat(val) || 0;
                if (key === 'previewPageCount') val = Math.min(5, Math.max(0, parseInt(val, 10) || 3));
                if (key === 'stockLimit' || key === 'stockRemaining' || key === 'sortOrder') {
                    val = val == null || val === '' ? null : parseInt(val, 10);
                }
                if (key === 'status' && !['draft', 'published', 'suspended'].includes(val)) continue;
                fields.push(`${col} = $${i++}`);
                params.push(val);
            }
        }

        if (fields.length === 0) return book;

        params.push(bookId);
        const result = await db.query(
            `UPDATE course_books SET ${fields.join(', ')}, updated_at = NOW()
             WHERE id = $${i} RETURNING *`,
            params
        );
        return mapBook(result.rows[0]);
    }

    async delete(bookId, teacherId) {
        const book = await this.getById(bookId);
        if (!book) {
            const err = new Error('Book not found');
            err.status = 404;
            throw err;
        }
        if (String(book.teacherId) !== String(teacherId)) {
            const err = new Error('Not authorized');
            err.status = 403;
            throw err;
        }
        if (book.masterPdfR2Key && r2Storage.isConfigured) {
            try {
                const prefix = r2Storage.getBookKeyPrefix(book.teacherId, book.courseId, book.id);
                await r2Storage.deletePrefix(prefix);
            } catch (e) {
                console.warn('Failed to delete book R2 prefix:', e.message);
            }
        }
        await db.query(`DELETE FROM course_books WHERE id = $1`, [bookId]);
        return { deleted: true };
    }

    async attachMasterPdf(bookId, teacherId, objectKey) {
        const book = await this.getById(bookId);
        if (!book) {
            const err = new Error('Book not found');
            err.status = 404;
            throw err;
        }
        if (String(book.teacherId) !== String(teacherId)) {
            const err = new Error('Not authorized');
            err.status = 403;
            throw err;
        }

        await db.query(
            `UPDATE course_books
             SET master_pdf_r2_key = $1,
                 processing_status = 'pending',
                 processing_error = NULL,
                 updated_at = NOW()
             WHERE id = $2`,
            [objectKey, bookId]
        );

        const bookProcessingService = require('./bookProcessingService');
        await bookProcessingService.enqueue(bookId);

        return this.getById(bookId);
    }

    async setCoverFromUpload(bookId, teacherId, fileBuffer, originalFilename) {
        const book = await this.getById(bookId);
        if (!book) {
            const err = new Error('Book not found');
            err.status = 404;
            throw err;
        }
        if (String(book.teacherId) !== String(teacherId)) {
            const err = new Error('Not authorized');
            err.status = 403;
            throw err;
        }

        let coverPath;
        if (r2Storage.isConfigured) {
            const ext = path.extname(originalFilename || '') || '.jpg';
            const key = `${r2Storage.getBookKeyPrefix(teacherId, book.courseId, bookId)}/cover${ext}`;
            const extLower = ext.toLowerCase();
            let contentType = 'image/jpeg';
            if (extLower === '.png') contentType = 'image/png';
            else if (extLower === '.webp') contentType = 'image/webp';
            await r2Storage.uploadFile(key, fileBuffer, contentType);
            coverPath = key;
        } else {
            coverPath = null;
        }

        return this.update(bookId, teacherId, { coverPath });
    }

    async getCourseBookPricing(courseId) {
        const result = await db.query(
            `SELECT * FROM course_book_pricing WHERE course_id = $1`,
            [courseId]
        );
        return mapPricing(result.rows[0]);
    }

    async upsertCourseBookPricing(courseId, teacherId, data) {
        await this.assertCourseOwner(courseId, teacherId);
        const existing = await this.getCourseBookPricing(courseId);

        const dual = !!data.dualPricingEnabled;
        const priceWithout =
            data.priceWithoutBooks != null && data.priceWithoutBooks !== ''
                ? parseFloat(data.priceWithoutBooks)
                : null;
        const priceWith =
            data.priceWithAllBooks != null && data.priceWithAllBooks !== ''
                ? parseFloat(data.priceWithAllBooks)
                : null;
        const discountWithout =
            data.discountWithoutBooks != null && data.discountWithoutBooks !== ''
                ? parseFloat(data.discountWithoutBooks)
                : null;
        const discountWith =
            data.discountWithAllBooks != null && data.discountWithAllBooks !== ''
                ? parseFloat(data.discountWithAllBooks)
                : null;

        if (dual) {
            if (priceWithout == null || Number.isNaN(priceWithout) || priceWithout < 0) {
                const err = new Error('Price without books is required when dual pricing is on');
                err.status = 400;
                throw err;
            }
            if (priceWith == null || Number.isNaN(priceWith) || priceWith < 0) {
                const err = new Error('Price with books is required when dual pricing is on');
                err.status = 400;
                throw err;
            }
            if (discountWithout != null && discountWithout >= priceWithout) {
                const err = new Error('Course-only discount must be less than course-only price');
                err.status = 400;
                throw err;
            }
            if (discountWith != null && discountWith >= priceWith) {
                const err = new Error('Course+book discount must be less than course+book price');
                err.status = 400;
                throw err;
            }
        }

        const snapshotEntry = {
            at: new Date().toISOString(),
            dualPricingEnabled: dual,
            priceWithoutBooks: priceWithout,
            priceWithAllBooks: priceWith,
            discountWithoutBooks: discountWithout,
            discountWithAllBooks: discountWith,
        };
        const snapshot = [...(existing?.pricingSnapshot || []), snapshotEntry].slice(-20);

        const result = await db.query(
            `INSERT INTO course_book_pricing (
                course_id, dual_pricing_enabled,
                price_without_books, price_with_all_books,
                discount_without_books, discount_with_all_books,
                pricing_snapshot
             ) VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (course_id) DO UPDATE SET
                dual_pricing_enabled = EXCLUDED.dual_pricing_enabled,
                price_without_books = EXCLUDED.price_without_books,
                price_with_all_books = EXCLUDED.price_with_all_books,
                discount_without_books = EXCLUDED.discount_without_books,
                discount_with_all_books = EXCLUDED.discount_with_all_books,
                pricing_snapshot = EXCLUDED.pricing_snapshot,
                updated_at = NOW()
             RETURNING *`,
            [
                courseId,
                dual,
                priceWithout,
                priceWith,
                discountWithout,
                discountWith,
                JSON.stringify(snapshot),
            ]
        );

        return mapPricing(result.rows[0]);
    }

    async adminList(options = {}) {
        const { skip = 0, limit = 20, status = null, search = null } = options;
        const conditions = [];
        const params = [];
        let i = 1;
        if (status) {
            conditions.push(`cb.status = $${i++}`);
            params.push(status);
        }
        if (search) {
            conditions.push(`(cb.title ILIKE $${i} OR c.title ILIKE $${i} OR u.email ILIKE $${i})`);
            params.push(`%${search}%`);
            i++;
        }
        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
        const countRes = await db.query(
            `SELECT COUNT(*)::int AS total
             FROM course_books cb
             JOIN courses c ON c.id = cb.course_id
             JOIN users u ON u.id = cb.teacher_id
             ${where}`,
            params
        );
        params.push(limit, skip);
        const listRes = await db.query(
            `SELECT cb.*, c.title AS course_title, COALESCE(tp.name, u.email) AS teacher_name
             FROM course_books cb
             JOIN courses c ON c.id = cb.course_id
             JOIN users u ON u.id = cb.teacher_id
             LEFT JOIN teacher_profiles tp ON tp.user_id = u.id
             ${where}
             ORDER BY cb.created_at DESC
             LIMIT $${i++} OFFSET $${i}`,
            params
        );
        return {
            total: countRes.rows[0]?.total || 0,
            items: listRes.rows.map(mapBook),
        };
    }

    async adminSetStatus(bookId, status) {
        if (!['draft', 'published', 'suspended'].includes(status)) {
            const err = new Error('Invalid status');
            err.status = 400;
            throw err;
        }
        const result = await db.query(
            `UPDATE course_books SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
            [status, bookId]
        );
        return mapBook(result.rows[0]);
    }

    roundMoney(n) {
        return Math.round((Number(n) || 0) * 100) / 100;
    }

    /**
     * Server-side purchase quote. Never trust a client-sent amount.
     * Coupon is optional; consumeCoupon=true records usage (payment), false only validates (preview).
     */
    async quotePurchase({
        course,
        userId = null,
        includeAllBooks = false,
        bookIds = [],
        couponCode = null,
        consumeCoupon = false,
    }) {
        if (!course) {
            const err = new Error('Course not found');
            err.status = 404;
            throw err;
        }

        const courseId = course.id;
        const listPrice = this.roundMoney(course.price);
        const salePrice =
            course.discount_price != null ? this.roundMoney(course.discount_price) : listPrice;
        let courseAmount = salePrice;
        let bookAmount = 0;
        const bookItems = [];
        let purchaseType = 'course_only';

        const requestedIds = Array.isArray(bookIds)
            ? [...new Set(bookIds.map((id) => String(id)).filter(Boolean))]
            : [];
        const wantBooks = !!includeAllBooks || requestedIds.length > 0;

        if (wantBooks) {
            purchaseType = 'course_with_books';
            let ids = requestedIds;
            if (!ids.length && includeAllBooks) {
                const published = await this.listByCourse(courseId, { includeDrafts: false });
                ids = published.filter((b) => b.pricingMode === 'addon').map((b) => b.id);
            }

            const entitlementService = userId ? require('./bookEntitlementService') : null;

            for (const bookId of ids) {
                if (entitlementService && (await entitlementService.isPurchaseBlocked(userId, bookId))) {
                    const err = new Error('One or more books already provided');
                    err.status = 409;
                    err.bookId = bookId;
                    err.purchaseBlocked = true;
                    throw err;
                }
                const book = await this.getById(bookId);
                if (!book || String(book.courseId) !== String(courseId) || book.status !== 'published') {
                    const err = new Error('Invalid or unpublished book');
                    err.status = 400;
                    throw err;
                }
                const price = book.pricingMode === 'addon' ? this.roundMoney(book.addonPrice) : 0;
                const courierFee =
                    book.courierFeePaidBy === 'student' &&
                    (book.deliveryMode === 'courier_only' || book.deliveryMode === 'both')
                        ? this.roundMoney(book.courierFee)
                        : 0;
                bookAmount = this.roundMoney(bookAmount + price + courierFee);
                bookItems.push({
                    bookId: book.id,
                    title: book.title,
                    addonPrice: price,
                    courierFee,
                    pricingMode: book.pricingMode,
                });
            }
        }

        const courseAmountBeforeCoupon = courseAmount;
        let coupon = null;
        if (couponCode && userId) {
            const couponApplyService = require('./couponApplyService');
            const applied = consumeCoupon
                ? await couponApplyService.applyCoupon(couponCode, userId, courseId)
                : await couponApplyService.validateCoupon(couponCode, userId, courseId);
            if (applied.type === 'original') {
                courseAmount = 0;
            } else if (applied.discountType === 'percentage' && applied.discountAmount != null) {
                courseAmount = this.roundMoney(
                    courseAmount * (1 - Number(applied.discountAmount) / 100)
                );
            } else if (applied.discountType === 'amount' && applied.discountAmount != null) {
                courseAmount = Math.max(0, this.roundMoney(courseAmount - Number(applied.discountAmount)));
            }
            coupon = {
                code: String(couponCode).trim(),
                title: applied.title || null,
                type: applied.type || null,
                discountType: applied.discountType || null,
                discountAmount: applied.discountAmount != null ? Number(applied.discountAmount) : null,
            };
        }

        courseAmount = this.roundMoney(courseAmount);
        bookAmount = this.roundMoney(bookAmount);

        return {
            courseId,
            currency: course.currency || 'BDT',
            listPrice,
            salePrice,
            courseAmountBeforeCoupon,
            courseAmount,
            bookAmount,
            totalAmount: this.roundMoney(courseAmount + bookAmount),
            purchaseType,
            includeBooks: purchaseType === 'course_with_books' && bookItems.length > 0,
            bookItems,
            coupon,
        };
    }
}

module.exports = new BookService();
