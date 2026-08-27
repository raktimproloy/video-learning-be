const db = require('../../db');

const TERMINAL_STATUSES = new Set(['delivered', 'cancelled']);
const LOCKED_STATUSES = new Set(['processing', 'shipped', 'delivered', 'cancelled']);
const ACTIVE_STATUSES = [
    'pending_payment',
    'pending_address',
    'submitted',
    'processing',
    'shipped',
];

function parseFees(raw) {
    try {
        if (typeof raw === 'string') return JSON.parse(raw) || [];
        return Array.isArray(raw) ? raw : [];
    } catch {
        return [];
    }
}

class BookCourierService {
    adminOrderSelect = `
        bco.*, cb.title AS book_title, cb.cover_path, c.title AS course_title,
        cb.course_id, cb.courier_fee_paid_by, u.email AS student_email, COALESCE(sp.name, u.email) AS student_name,
        be.source,
        pr.id AS pr_id, pr.status AS pr_status, pr.amount AS pr_amount, pr.currency AS pr_currency,
        pr.payment_method AS pr_payment_method, pr.sender_phone AS pr_sender_phone,
        pr.transaction_id AS pr_transaction_id, pr.created_at AS pr_created_at,
        pr.reviewed_at AS pr_reviewed_at, pr.purchase_type AS pr_purchase_type,
        pr.rejection_reason AS pr_rejection_reason, pr.acceptance_reason AS pr_acceptance_reason,
        COALESCE(tp.name, tu.email) AS teacher_name, tu.email AS teacher_email
    `;

    adminOrderJoins = `
        JOIN course_books cb ON cb.id = bco.course_book_id
        JOIN courses c ON c.id = cb.course_id
        JOIN users u ON u.id = bco.student_id
        LEFT JOIN student_profiles sp ON sp.user_id = u.id
        JOIN book_entitlements be ON be.id = bco.entitlement_id
        LEFT JOIN course_payment_requests pr ON pr.id = bco.payment_request_id
        LEFT JOIN users tu ON tu.id = bco.teacher_id
        LEFT JOIN teacher_profiles tp ON tp.user_id = tu.id
    `;

    async logOrderEvent(orderId, { eventType, status = null, message = null, meta = {}, actorId = null, actorRole = null }) {
        try {
            await db.query(
                `INSERT INTO book_courier_order_events (order_id, event_type, status, message, meta, actor_id, actor_role)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [
                    orderId,
                    eventType,
                    status,
                    message,
                    JSON.stringify(meta || {}),
                    actorId,
                    actorRole,
                ]
            );
        } catch (err) {
            console.error('book order event log failed:', err.message);
        }
    }

    mapPaymentFromRow(row) {
        if (!row?.pr_id && !row?.payment_request_id) return null;
        return {
            id: row.pr_id || row.payment_request_id,
            status: row.pr_status || null,
            amount: row.pr_amount != null ? parseFloat(row.pr_amount) : null,
            currency: row.pr_currency || 'BDT',
            paymentMethod: row.pr_payment_method || null,
            senderPhone: row.pr_sender_phone || null,
            transactionId: row.pr_transaction_id || null,
            purchaseType: row.pr_purchase_type || null,
            submittedAt: row.pr_created_at || null,
            reviewedAt: row.pr_reviewed_at || null,
            rejectionReason: row.pr_rejection_reason || null,
            acceptanceReason: row.pr_acceptance_reason || null,
        };
    }

    mapAdminOrder(row) {
        const base = this.mapOrder(row);
        const bookAmt = base.bookPriceAmount || 0;
        const courierAmt = base.courierFeeAmount || 0;
        return {
            ...base,
            teacherName: row.teacher_name || null,
            teacherEmail: row.teacher_email || null,
            totalAmount: bookAmt + courierAmt,
            payment: this.mapPaymentFromRow(row),
        };
    }

    async fetchOrderTimeline(orderId) {
        const result = await db.query(
            `SELECT id, event_type, status, message, meta, actor_id, actor_role, created_at
             FROM book_courier_order_events
             WHERE order_id = $1
             ORDER BY created_at ASC, id ASC`,
            [orderId]
        );
        return result.rows.map((e) => ({
            id: e.id,
            eventType: e.event_type,
            status: e.status,
            message: e.message,
            meta: e.meta || {},
            actorId: e.actor_id,
            actorRole: e.actor_role,
            createdAt: e.created_at,
        }));
    }

    mapOrder(row) {
        if (!row) return null;
        return {
            id: row.id,
            entitlementId: row.entitlement_id,
            teacherId: row.teacher_id,
            studentId: row.student_id,
            courseBookId: row.course_book_id,
            courseId: row.course_id || null,
            fullName: row.full_name,
            phone: row.phone,
            altPhone: row.alt_phone,
            addressLine: row.address_line,
            district: row.district,
            area: row.area,
            postalCode: row.postal_code,
            note: row.note,
            status: row.status,
            trackingNumber: row.tracking_number,
            teacherNote: row.teacher_note,
            cancelledReason: row.cancelled_reason,
            addressLockedAt: row.address_locked_at,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            bookTitle: row.book_title,
            coverPath: row.cover_path || null,
            courseTitle: row.course_title,
            studentEmail: row.student_email,
            studentName: row.student_name,
            paid: row.source === 'purchase',
            gifted: row.source === 'gift',
            source: row.source,
            courierFees: row.courier_fees,
            courierFeePaidBy: row.courier_fee_paid_by,
            selectedCourierFeeName: row.selected_courier_fee_name,
            courierFeeAmount: row.courier_fee_amount != null ? parseFloat(row.courier_fee_amount) : 0,
            bookPriceAmount: row.book_price_amount != null ? parseFloat(row.book_price_amount) : 0,
            paymentStatus: row.payment_status,
            paymentRequestId: row.payment_request_id || null,
            quantity: row.quantity != null ? parseInt(row.quantity, 10) : 1,
        };
    }

    /**
     * Lifetime qty remaining + concurrent-order lock for a student+book.
     */
    async getEligibility(bookId, studentId) {
        const bookRes = await db.query(
            `SELECT cb.*, c.title AS course_title
             FROM course_books cb
             JOIN courses c ON c.id = cb.course_id
             WHERE cb.id = $1`,
            [bookId]
        );
        const book = bookRes.rows[0];
        if (!book) {
            const err = new Error('Book not found');
            err.status = 404;
            throw err;
        }

        const max = book.max_courier_orders_per_student != null
            ? parseInt(book.max_courier_orders_per_student, 10)
            : 1;

        const usageRes = await db.query(
            `SELECT
                COALESCE(SUM(quantity) FILTER (WHERE status != 'cancelled'), 0)::int AS used,
                EXISTS (
                    SELECT 1 FROM book_courier_orders b2
                    WHERE b2.student_id = $1 AND b2.course_book_id = $2
                      AND b2.status NOT IN ('delivered', 'cancelled')
                ) AS has_active
             FROM book_courier_orders
             WHERE student_id = $1 AND course_book_id = $2`,
            [studentId, bookId]
        );
        const used = usageRes.rows[0]?.used || 0;
        const hasActiveOrder = !!usageRes.rows[0]?.has_active;
        const remaining = Math.max(0, max - used);
        const alreadyPurchased = remaining === 0;

        let activeOrder = null;
        if (hasActiveOrder) {
            const activeRes = await db.query(
                `SELECT bco.*, cb.title AS book_title, cb.cover_path, c.title AS course_title,
                        cb.courier_fees, cb.courier_fee_paid_by, cb.course_id
                 FROM book_courier_orders bco
                 JOIN course_books cb ON cb.id = bco.course_book_id
                 JOIN courses c ON c.id = cb.course_id
                 WHERE bco.student_id = $1 AND bco.course_book_id = $2
                   AND bco.status NOT IN ('delivered', 'cancelled')
                 ORDER BY bco.created_at DESC
                 LIMIT 1`,
                [studentId, bookId]
            );
            activeOrder = this.mapOrder(activeRes.rows[0]);
        }

        const courierFees = parseFees(book.courier_fees);
        const addonPrice = book.pricing_mode === 'addon' ? parseFloat(book.addon_price) || 0 : 0;

        const bookEntitlementService = require('./bookEntitlementService');
        const courseService = require('./courseService');
        const ent = await bookEntitlementService.getActive(studentId, bookId);
        const enrolled = await courseService.isEnrolled(studentId, book.course_id);
        const pdfOwned = !!(ent && ent.has_pdf);
        const deliveryMode = book.delivery_mode;
        const canBuyPdf =
            !!enrolled &&
            book.status === 'published' &&
            book.pricing_mode === 'addon' &&
            !pdfOwned &&
            (deliveryMode === 'pdf_only' || deliveryMode === 'both');
        const canOrderCourier =
            remaining > 0 &&
            !hasActiveOrder &&
            book.status === 'published' &&
            (deliveryMode === 'courier_only' || deliveryMode === 'both') &&
            (pdfOwned || !!enrolled);
        const resolvedUnitBookPrice = pdfOwned ? 0 : addonPrice;

        return {
            bookId: book.id,
            courseId: book.course_id,
            title: book.title,
            subtitle: book.subtitle,
            coverPath: book.cover_path,
            courseTitle: book.course_title,
            deliveryMode,
            pricingMode: book.pricing_mode,
            currency: book.currency || 'BDT',
            addonPrice,
            unitBookPrice: resolvedUnitBookPrice,
            pdfOwned,
            canBuyPdf,
            enrolled: !!enrolled,
            courierFees,
            courierFeePaidBy: book.courier_fee_paid_by || 'student',
            maxCourierOrdersPerStudent: max,
            used,
            remaining,
            hasActiveOrder,
            canOrder: canOrderCourier,
            alreadyPurchased,
            activeOrder,
            stockRemaining: book.stock_remaining,
            stockLimit: book.stock_limit,
            status: book.status,
        };
    }

    async syncPurchaseBlocked(userId, courseBookId) {
        const elig = await this.getEligibility(courseBookId, userId);
        const blocked = elig.alreadyPurchased;
        await db.query(
            `UPDATE book_entitlements
             SET purchase_blocked = $1, updated_at = NOW()
             WHERE user_id = $2 AND course_book_id = $3 AND revoked_at IS NULL`,
            [blocked, userId, courseBookId]
        );
        return elig;
    }

    async getForStudent(orderId, studentId) {
        const result = await db.query(
            `SELECT bco.*, cb.title AS book_title, cb.cover_path, c.title AS course_title,
                    be.source, cb.course_id, cb.courier_fees, cb.courier_fee_paid_by
             FROM book_courier_orders bco
             JOIN course_books cb ON cb.id = bco.course_book_id
             JOIN courses c ON c.id = cb.course_id
             JOIN book_entitlements be ON be.id = bco.entitlement_id
             WHERE bco.id = $1 AND bco.student_id = $2`,
            [orderId, studentId]
        );
        return this.mapOrder(result.rows[0]);
    }

    async getByBookForStudent(bookId, studentId) {
        const result = await db.query(
            `SELECT bco.*, cb.title AS book_title, cb.cover_path, c.title AS course_title, be.source,
                    cb.courier_fees, cb.courier_fee_paid_by, cb.course_id
             FROM book_courier_orders bco
             JOIN course_books cb ON cb.id = bco.course_book_id
             JOIN courses c ON c.id = cb.course_id
             JOIN book_entitlements be ON be.id = bco.entitlement_id
             WHERE bco.course_book_id = $1 AND bco.student_id = $2
             ORDER BY
                CASE WHEN bco.status NOT IN ('delivered', 'cancelled') THEN 0 ELSE 1 END,
                bco.created_at DESC
             LIMIT 1`,
            [bookId, studentId]
        );
        return this.mapOrder(result.rows[0]);
    }

    async listForStudent(studentId, options = {}) {
        const { activeOnly = false, limit = 50 } = options;
        const conditions = ['bco.student_id = $1'];
        const params = [studentId];
        let i = 2;
        if (activeOnly) {
            conditions.push(`bco.status NOT IN ('delivered', 'cancelled')`);
        }
        const result = await db.query(
            `SELECT bco.*, cb.title AS book_title, cb.cover_path, c.title AS course_title,
                    be.source, cb.course_id, cb.courier_fees, cb.courier_fee_paid_by
             FROM book_courier_orders bco
             JOIN course_books cb ON cb.id = bco.course_book_id
             JOIN courses c ON c.id = cb.course_id
             JOIN book_entitlements be ON be.id = bco.entitlement_id
             WHERE ${conditions.join(' AND ')}
             ORDER BY bco.created_at DESC
             LIMIT $${i}`,
            [...params, Math.min(100, parseInt(limit, 10) || 50)]
        );
        return result.rows.map((r) => this.mapOrder(r));
    }

    /**
     * PDF-only purchase (no delivery address). After payment, student can order hardcopy later.
     */
    async createPdfPurchase(bookId, studentId) {
        const elig = await this.getEligibility(bookId, studentId);
        if (elig.status !== 'published') {
            const err = new Error('Book is not available for purchase');
            err.status = 400;
            throw err;
        }
        if (elig.pdfOwned) {
            const err = new Error('You already have PDF access for this book');
            err.status = 409;
            err.code = 'PDF_OWNED';
            throw err;
        }
        if (!elig.canBuyPdf) {
            const err = new Error(
                elig.enrolled
                    ? 'This book is not available as a separate PDF purchase'
                    : 'You must be enrolled in the course to buy this book'
            );
            err.status = 400;
            throw err;
        }

        const amount = elig.addonPrice || 0;
        if (amount <= 0) {
            const bookEntitlementService = require('./bookEntitlementService');
            await bookEntitlementService.grant({
                userId: studentId,
                courseId: elig.courseId,
                courseBookId: bookId,
                source: 'purchase',
                hasPdf: true,
                hasCourier: false,
                skipCourierOrder: true,
                skipStockDecrement: true,
                priceSnapshot: { addonPrice: 0, pdfOnly: true },
            });
            return {
                free: true,
                granted: true,
                courseId: elig.courseId,
                totalAmount: 0,
            };
        }

        return {
            free: false,
            paymentRequired: true,
            courseId: elig.courseId,
            totalAmount: amount,
            addonPrice: amount,
            title: elig.title,
            bookItems: [
                {
                    bookId,
                    title: elig.title,
                    addonPrice: amount,
                    courierFee: 0,
                    quantity: 1,
                },
            ],
        };
    }

    /**
     * Delivery-first checkout: create pending_payment order + payment request payload.
     * Caller initiates UddoktaPay / returns free grant.
     */
    async createCheckout(bookId, studentId, data = {}) {
        const {
            fullName,
            phone,
            altPhone = null,
            addressLine,
            district = null,
            area = null,
            postalCode = null,
            note = null,
            selectedCourierFeeName = null,
            quantity: rawQty = 1,
            addressId = null,
        } = data;

        let resolved = {
            fullName,
            phone,
            altPhone,
            addressLine,
            district,
            area,
            postalCode,
            note,
        };

        if (addressId) {
            const addrRes = await db.query(
                `SELECT * FROM user_addresses WHERE id = $1 AND user_id = $2`,
                [addressId, studentId]
            );
            const addr = addrRes.rows[0];
            if (!addr) {
                const err = new Error('Saved address not found');
                err.status = 404;
                throw err;
            }
            resolved = {
                fullName: addr.full_name,
                phone: addr.phone,
                altPhone: addr.alt_phone,
                addressLine: addr.address_line,
                district: addr.district,
                area: addr.area,
                postalCode: addr.postal_code,
                note: note || null,
            };
        }

        if (!resolved.fullName || !resolved.phone || !resolved.addressLine) {
            const err = new Error('fullName, phone, and addressLine are required');
            err.status = 400;
            throw err;
        }

        const quantity = Math.max(1, parseInt(rawQty, 10) || 1);
        const elig = await this.getEligibility(bookId, studentId);

        if (elig.status !== 'published') {
            const err = new Error('Book is not available for purchase');
            err.status = 400;
            throw err;
        }
        if (!['courier_only', 'both'].includes(elig.deliveryMode)) {
            const err = new Error('This book does not support courier delivery');
            err.status = 400;
            throw err;
        }
        if (elig.hasActiveOrder) {
            const err = new Error('You already have an active order for this book. Wait until it is completed.');
            err.status = 409;
            err.code = 'ACTIVE_ORDER';
            throw err;
        }
        if (elig.remaining <= 0) {
            const err = new Error('Already purchased — no remaining order quota');
            err.status = 409;
            err.code = 'ALREADY_PURCHASED';
            throw err;
        }
        if (quantity > elig.remaining) {
            const err = new Error(`Quantity exceeds remaining orders (${elig.remaining})`);
            err.status = 400;
            throw err;
        }
        if (elig.stockLimit != null && elig.stockRemaining != null && quantity > elig.stockRemaining) {
            const err = new Error('Not enough stock for the requested quantity');
            err.status = 409;
            throw err;
        }

        const courseService = require('./courseService');
        const enrolled = await courseService.isEnrolled(studentId, elig.courseId);
        if (!enrolled && elig.pricingMode === 'addon') {
            const err = new Error('You must be enrolled in the course to order this book');
            err.status = 400;
            throw err;
        }

        let unitCourierFee = 0;
        let feeName = selectedCourierFeeName || null;
        if (elig.courierFeePaidBy === 'student') {
            const fees = elig.courierFees || [];
            if (fees.length) {
                if (!feeName) feeName = fees[0].name;
                const selected = fees.find((f) => f.name === feeName);
                if (!selected) {
                    const err = new Error('Invalid courier fee selected');
                    err.status = 400;
                    throw err;
                }
                unitCourierFee = parseFloat(selected.fee) || 0;
            }
        }

        const unitBookPrice = elig.unitBookPrice || 0;
        const bookPriceAmount = unitBookPrice * quantity;
        const courierFeeAmount = unitCourierFee * quantity;
        const totalAmount = bookPriceAmount + courierFeeAmount;

        const bookEntitlementService = require('./bookEntitlementService');
        const entitlement = await bookEntitlementService.grant({
            userId: studentId,
            courseId: elig.courseId,
            courseBookId: bookId,
            source: 'purchase',
            hasPdf: elig.deliveryMode === 'both' || elig.deliveryMode === 'pdf_only',
            hasCourier: true,
            skipCourierOrder: true,
            skipStockDecrement: true,
            priceSnapshot: {
                unitBookPrice,
                unitCourierFee,
                quantity,
                checkout: true,
            },
        });

        // Cancel any stale unpaid draft for this student+book
        await db.query(
            `UPDATE book_courier_orders
             SET status = 'cancelled', cancelled_reason = 'superseded_by_new_checkout', updated_at = NOW()
             WHERE student_id = $1 AND course_book_id = $2 AND status = 'pending_payment'`,
            [studentId, bookId]
        );

        const paymentStatus = totalAmount > 0 ? 'pending' : 'not_required';
        const orderStatus = totalAmount > 0 ? 'pending_payment' : 'submitted';

        const bookRes = await db.query(`SELECT teacher_id FROM course_books WHERE id = $1`, [bookId]);
        const teacherId = bookRes.rows[0].teacher_id;

        const insert = await db.query(
            `INSERT INTO book_courier_orders (
                entitlement_id, teacher_id, student_id, course_book_id,
                full_name, phone, alt_phone, address_line, district, area, postal_code, note,
                status, quantity, selected_courier_fee_name, courier_fee_amount, book_price_amount,
                payment_status
             ) VALUES (
                $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18
             ) RETURNING *`,
            [
                entitlement.id,
                teacherId,
                studentId,
                bookId,
                String(resolved.fullName).trim(),
                String(resolved.phone).trim(),
                resolved.altPhone,
                String(resolved.addressLine).trim(),
                resolved.district,
                resolved.area,
                resolved.postalCode,
                resolved.note,
                orderStatus,
                quantity,
                feeName,
                courierFeeAmount,
                bookPriceAmount,
                paymentStatus,
            ]
        );

        const orderRow = insert.rows[0];

        await this.logOrderEvent(orderRow.id, {
            eventType: 'order_created',
            status: orderStatus,
            message: 'Order placed',
            meta: {
                quantity,
                bookPriceAmount,
                courierFeeAmount,
                paymentStatus,
            },
            actorId: studentId,
            actorRole: 'student',
        });

        if (totalAmount <= 0) {
            // Free path: decrement stock, sync blocked, return submitted order
            if (elig.stockLimit != null) {
                await db.query(
                    `UPDATE course_books
                     SET stock_remaining = GREATEST(0, COALESCE(stock_remaining, stock_limit) - $2),
                         updated_at = NOW()
                     WHERE id = $1`,
                    [bookId, quantity]
                );
            }
            await this.syncPurchaseBlocked(studentId, bookId);
            const mapped = await this.getForStudent(orderRow.id, studentId);
            return {
                order: mapped,
                courseId: elig.courseId,
                totalAmount: 0,
                bookPriceAmount,
                courierFeeAmount,
                quantity,
                paymentRequired: false,
                free: true,
            };
        }

        return {
            order: this.mapOrder({
                ...orderRow,
                book_title: elig.title,
                cover_path: elig.coverPath,
                course_title: elig.courseTitle,
                course_id: elig.courseId,
                courier_fees: elig.courierFees,
                courier_fee_paid_by: elig.courierFeePaidBy,
                source: 'purchase',
            }),
            courseId: elig.courseId,
            totalAmount,
            bookPriceAmount,
            courierFeeAmount,
            quantity,
            unitBookPrice,
            unitCourierFee,
            paymentRequired: true,
            free: false,
            bookItems: [
                {
                    bookId,
                    title: elig.title,
                    addonPrice: bookPriceAmount,
                    courierFee: courierFeeAmount,
                    quantity,
                    orderId: orderRow.id,
                },
            ],
        };
    }

    async upsertAddress(bookId, studentId, address) {
        const orderRes = await db.query(
            `SELECT bco.*, cb.courier_fees, cb.courier_fee_paid_by, cb.course_id
             FROM book_courier_orders bco
             JOIN course_books cb ON cb.id = bco.course_book_id
             WHERE bco.course_book_id = $1 AND bco.student_id = $2
               AND bco.status NOT IN ('delivered', 'cancelled')
             ORDER BY bco.created_at DESC
             LIMIT 1`,
            [bookId, studentId]
        );
        const order = orderRes.rows[0];
        if (!order) {
            const err = new Error('Courier order not found');
            err.status = 404;
            throw err;
        }
        if (LOCKED_STATUSES.has(order.status) || order.address_locked_at) {
            const err = new Error('Address can no longer be edited');
            err.status = 409;
            throw err;
        }

        const {
            fullName,
            phone,
            altPhone = null,
            addressLine,
            district = null,
            area = null,
            postalCode = null,
            note = null,
            selectedCourierFeeName = null,
        } = address;

        if (!fullName || !phone || !addressLine) {
            const err = new Error('fullName, phone, and addressLine are required');
            err.status = 400;
            throw err;
        }

        let courierFeeAmount = 0;
        let paymentStatus = 'not_required';
        let finalFeeName = order.selected_courier_fee_name;
        const qty = order.quantity != null ? parseInt(order.quantity, 10) : 1;

        if (order.payment_status !== 'paid') {
            finalFeeName = selectedCourierFeeName;

            if (order.courier_fee_paid_by === 'student' && finalFeeName) {
                const fees = parseFees(order.courier_fees);
                const selectedFee = fees.find((f) => f.name === finalFeeName);
                if (selectedFee) {
                    courierFeeAmount = (parseFloat(selectedFee.fee) || 0) * qty;
                } else {
                    const err = new Error('Invalid courier fee selected');
                    err.status = 400;
                    throw err;
                }
            }

            if (courierFeeAmount > 0) {
                paymentStatus = 'pending';
            }
        } else {
            courierFeeAmount = parseFloat(order.courier_fee_amount) || 0;
            paymentStatus = order.payment_status;
        }

        const newOrderStatus =
            paymentStatus === 'pending'
                ? order.status === 'pending_payment'
                    ? 'pending_payment'
                    : 'pending_address'
                : order.status === 'pending_address' || order.status === 'pending_payment'
                  ? 'submitted'
                  : order.status;

        const result = await db.query(
            `UPDATE book_courier_orders SET
                full_name = $1,
                phone = $2,
                alt_phone = $3,
                address_line = $4,
                district = $5,
                area = $6,
                postal_code = $7,
                note = $8,
                status = $9,
                selected_courier_fee_name = $10,
                courier_fee_amount = $11,
                payment_status = $12,
                updated_at = NOW()
             WHERE id = $13
             RETURNING *`,
            [
                String(fullName).trim(),
                String(phone).trim(),
                altPhone,
                String(addressLine).trim(),
                district,
                area,
                postalCode,
                note,
                newOrderStatus,
                finalFeeName,
                courierFeeAmount,
                paymentStatus,
                order.id,
            ]
        );
        return {
            order: this.mapOrder(result.rows[0]),
            courseId: order.course_id,
            paymentRequired: paymentStatus === 'pending',
            courierFeeAmount,
        };
    }

    async listForTeacher(teacherId, options = {}) {
        const { status = null, search = null, skip = 0, limit = 50 } = options;
        const conditions = ['bco.teacher_id = $1'];
        const params = [teacherId];
        let i = 2;
        if (status && status !== 'all' && status !== 'active') {
            conditions.push(`bco.status = $${i++}`);
            params.push(status);
        } else {
            conditions.push(`bco.status NOT IN ('delivered', 'cancelled')`);
        }
        if (search) {
            conditions.push(
                `(bco.full_name ILIKE $${i} OR bco.phone ILIKE $${i} OR u.email ILIKE $${i} OR cb.title ILIKE $${i})`
            );
            params.push(`%${search}%`);
            i++;
        }
        const where = conditions.join(' AND ');
        params.push(limit, skip);
        const result = await db.query(
            `SELECT ${this.adminOrderSelect}
             FROM book_courier_orders bco
             ${this.adminOrderJoins}
             WHERE ${where}
             ORDER BY bco.created_at DESC
             LIMIT $${i++} OFFSET $${i}`,
            params
        );
        const orders = result.rows.map((r) => this.mapAdminOrder(r));
        const ids = orders.map((o) => o.id).filter(Boolean);
        if (!ids.length) return orders;
        const ev = await db.query(
            `SELECT id, order_id, event_type, status, message, actor_role, created_at
             FROM book_courier_order_events
             WHERE order_id = ANY($1::uuid[])
             ORDER BY created_at ASC, id ASC`,
            [ids]
        );
        const byOrder = {};
        for (const e of ev.rows) {
            if (!byOrder[e.order_id]) byOrder[e.order_id] = [];
            byOrder[e.order_id].push({
                id: e.id,
                eventType: e.event_type,
                status: e.status,
                message: e.message,
                actorRole: e.actor_role,
                createdAt: e.created_at,
            });
        }
        return orders.map((o) => ({ ...o, timeline: byOrder[o.id] || [] }));
    }

    async updateStatus(orderId, teacherId, data) {
        const existing = await db.query(
            `SELECT bco.*, cb.title AS book_title, cb.course_id
             FROM book_courier_orders bco
             JOIN course_books cb ON cb.id = bco.course_book_id
             WHERE bco.id = $1 AND bco.teacher_id = $2`,
            [orderId, teacherId]
        );
        if (!existing.rows[0]) {
            const err = new Error('Order not found');
            err.status = 404;
            throw err;
        }
        const prev = existing.rows[0];

        const { status, trackingNumber, teacherNote, cancelledReason } = data;
        const allowed = [
            'pending_payment',
            'pending_address',
            'submitted',
            'processing',
            'shipped',
            'delivered',
            'cancelled',
        ];
        if (status && !allowed.includes(status)) {
            const err = new Error('Invalid status');
            err.status = 400;
            throw err;
        }

        const lockAddress =
            status && ['processing', 'shipped', 'delivered', 'cancelled'].includes(status);

        const result = await db.query(
            `UPDATE book_courier_orders SET
                status = COALESCE($1, status),
                tracking_number = COALESCE($2, tracking_number),
                teacher_note = COALESCE($3, teacher_note),
                cancelled_reason = COALESCE($4, cancelled_reason),
                address_locked_at = CASE
                    WHEN $5 THEN COALESCE(address_locked_at, NOW())
                    ELSE address_locked_at
                END,
                updated_at = NOW()
             WHERE id = $6
             RETURNING *`,
            [
                status || null,
                trackingNumber !== undefined ? trackingNumber : null,
                teacherNote !== undefined ? teacherNote : null,
                cancelledReason !== undefined ? cancelledReason : null,
                lockAddress,
                orderId,
            ]
        );

        const updated = result.rows[0];

        if (status === 'cancelled' || status === 'delivered') {
            await this.syncPurchaseBlocked(prev.student_id, prev.course_book_id);
        }

        if (status && status !== prev.status) {
            await this.logOrderEvent(orderId, {
                eventType: 'status_updated',
                status,
                message: `Status changed from ${prev.status} to ${status}`,
                meta: {
                    previousStatus: prev.status,
                    trackingNumber: trackingNumber || updated.tracking_number || null,
                },
                actorId: teacherId,
                actorRole: 'teacher',
            });
            try {
                const userNotificationService = require('./userNotificationService');
                const statusLabel = String(status).replace(/_/g, ' ');
                await userNotificationService.create(prev.student_id, {
                    type: 'book_order_status',
                    title: 'Book order update',
                    body: `Your order for "${prev.book_title}" is now ${statusLabel}.${
                        trackingNumber ? ` Tracking: ${trackingNumber}` : ''
                    }`,
                    courseId: prev.course_id,
                    link: `/student/books/${prev.course_book_id}/courier`,
                });
            } catch (notifyErr) {
                console.error('Book order status notification failed:', notifyErr.message);
            }
        }

        return this.mapOrder({
            ...updated,
            book_title: prev.book_title,
            course_id: prev.course_id,
        });
    }

    /**
     * Mark order paid after book_courier / courier_fee payment accept.
     */
    async markPaidByPaymentRequest(paymentRequestId, options = {}) {
        const { decrementStock = true } = options;
        const result = await db.query(
            `UPDATE book_courier_orders
             SET payment_status = 'paid',
                 status = CASE
                     WHEN status IN ('pending_payment', 'pending_address') THEN 'submitted'
                     ELSE status
                 END,
                 address_locked_at = COALESCE(address_locked_at, NOW()),
                 updated_at = NOW()
             WHERE payment_request_id = $1
             RETURNING *`,
            [paymentRequestId]
        );
        const order = result.rows[0];
        if (!order) return null;

        if (decrementStock) {
            const bookRes = await db.query(
                `SELECT stock_limit, stock_remaining FROM course_books WHERE id = $1`,
                [order.course_book_id]
            );
            const b = bookRes.rows[0];
            if (b && b.stock_limit != null) {
                const qty = order.quantity != null ? parseInt(order.quantity, 10) : 1;
                await db.query(
                    `UPDATE course_books
                     SET stock_remaining = GREATEST(0, COALESCE(stock_remaining, stock_limit) - $2),
                         updated_at = NOW()
                     WHERE id = $1`,
                    [order.course_book_id, qty]
                );
            }
        }

        await this.syncPurchaseBlocked(order.student_id, order.course_book_id);

        await this.logOrderEvent(order.id, {
            eventType: 'payment_accepted',
            status: 'paid',
            message: 'Payment verified and accepted',
            meta: { paymentRequestId },
        });
        if (order.status === 'submitted' || order.status === 'pending_payment' || order.status === 'pending_address') {
            await this.logOrderEvent(order.id, {
                eventType: 'status_updated',
                status: order.status === 'pending_payment' || order.status === 'pending_address' ? 'submitted' : order.status,
                message: 'Order moved to submitted after payment',
                meta: { paymentRequestId },
            });
        }
        if (order.address_locked_at) {
            await this.logOrderEvent(order.id, {
                eventType: 'address_locked',
                status: order.status,
                message: 'Delivery address locked',
            });
        }

        return this.mapOrder(order);
    }

    async linkPaymentRequest(orderId, paymentRequestId, meta = {}) {
        await db.query(
            `UPDATE book_courier_orders SET payment_request_id = $1, updated_at = NOW() WHERE id = $2`,
            [paymentRequestId, orderId]
        );
        await this.logOrderEvent(orderId, {
            eventType: 'payment_submitted',
            status: 'pending',
            message: 'Payment submitted — awaiting verification',
            meta: { paymentRequestId, ...meta },
        });
    }

    async adminGet(orderId) {
        const result = await db.query(
            `SELECT ${this.adminOrderSelect}
             FROM book_courier_orders bco
             ${this.adminOrderJoins}
             WHERE bco.id = $1`,
            [orderId]
        );
        if (!result.rows[0]) {
            const err = new Error('Order not found');
            err.status = 404;
            throw err;
        }
        const timeline = await this.fetchOrderTimeline(orderId);
        return {
            ...this.mapAdminOrder(result.rows[0]),
            timeline,
        };
    }

    async adminUpdate(orderId, data) {
        const existing = await db.query(
            `SELECT * FROM book_courier_orders WHERE id = $1`,
            [orderId]
        );
        if (!existing.rows[0]) {
            const err = new Error('Order not found');
            err.status = 404;
            throw err;
        }
        const prev = existing.rows[0];

        const {
            fullName,
            phone,
            addressLine,
            district,
            area,
            postalCode,
            status,
            trackingNumber,
            teacherNote,
            cancelledReason,
            note,
        } = data;

        const allowed = [
            'pending_payment',
            'pending_address',
            'submitted',
            'processing',
            'shipped',
            'delivered',
            'cancelled',
        ];
        if (status && !allowed.includes(status)) {
            const err = new Error('Invalid status');
            err.status = 400;
            throw err;
        }

        const lockAddress =
            status && ['processing', 'shipped', 'delivered', 'cancelled'].includes(status);

        const result = await db.query(
            `UPDATE book_courier_orders SET
                full_name = COALESCE($1, full_name),
                phone = COALESCE($2, phone),
                address_line = COALESCE($3, address_line),
                district = COALESCE($4, district),
                area = COALESCE($5, area),
                postal_code = COALESCE($6, postal_code),
                status = COALESCE($7, status),
                tracking_number = COALESCE($8, tracking_number),
                teacher_note = COALESCE($9, teacher_note),
                cancelled_reason = COALESCE($10, cancelled_reason),
                note = COALESCE($11, note),
                address_locked_at = CASE
                    WHEN $12 THEN COALESCE(address_locked_at, NOW())
                    ELSE address_locked_at
                END,
                updated_at = NOW()
             WHERE id = $13
             RETURNING *`,
            [
                fullName !== undefined ? fullName : null,
                phone !== undefined ? phone : null,
                addressLine !== undefined ? addressLine : null,
                district !== undefined ? district : null,
                area !== undefined ? area : null,
                postalCode !== undefined ? postalCode : null,
                status || null,
                trackingNumber !== undefined ? trackingNumber : null,
                teacherNote !== undefined ? teacherNote : null,
                cancelledReason !== undefined ? cancelledReason : null,
                note !== undefined ? note : null,
                lockAddress,
                orderId,
            ]
        );

        if (status === 'cancelled' || status === 'delivered') {
            const row = result.rows[0];
            await this.syncPurchaseBlocked(row.student_id, row.course_book_id);
        }

        const updated = result.rows[0];
        if (status && status !== prev.status) {
            await this.logOrderEvent(orderId, {
                eventType: 'status_updated',
                status,
                message: `Status changed from ${prev.status} to ${status}`,
                meta: {
                    previousStatus: prev.status,
                    trackingNumber: updated.tracking_number || null,
                    cancelledReason: updated.cancelled_reason || null,
                },
                actorRole: 'admin',
            });
        }
        if (lockAddress && !prev.address_locked_at && updated.address_locked_at) {
            await this.logOrderEvent(orderId, {
                eventType: 'address_locked',
                status: updated.status,
                message: 'Delivery address locked',
                actorRole: 'admin',
            });
        }

        const detail = await this.adminGet(orderId);
        return detail;
    }

    async adminDelete(orderId) {
        const result = await db.query(
            `DELETE FROM book_courier_orders WHERE id = $1 RETURNING id`,
            [orderId]
        );
        if (!result.rows[0]) {
            const err = new Error('Order not found');
            err.status = 404;
            throw err;
        }
        return { success: true, deletedId: result.rows[0].id };
    }

    async adminList(options = {}) {
        const { status = null, search = null, skip = 0, limit = 20 } = options;
        const conditions = [];
        const params = [];
        let i = 1;
        if (status) {
            conditions.push(`bco.status = $${i++}`);
            params.push(status);
        }
        if (search) {
            conditions.push(
                `(bco.full_name ILIKE $${i} OR bco.phone ILIKE $${i} OR u.email ILIKE $${i} OR cb.title ILIKE $${i})`
            );
            params.push(`%${search}%`);
            i++;
        }
        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
        const countRes = await db.query(
            `SELECT COUNT(*)::int AS total
             FROM book_courier_orders bco
             JOIN course_books cb ON cb.id = bco.course_book_id
             JOIN users u ON u.id = bco.student_id
             ${where}`,
            params
        );
        params.push(limit, skip);
        const listRes = await db.query(
            `SELECT ${this.adminOrderSelect}
             FROM book_courier_orders bco
             ${this.adminOrderJoins}
             ${where}
             ORDER BY bco.created_at DESC
             LIMIT $${i++} OFFSET $${i}`,
            params
        );
        return {
            total: countRes.rows[0]?.total || 0,
            items: listRes.rows.map((r) => this.mapAdminOrder(r)),
        };
    }
}

module.exports = new BookCourierService();
