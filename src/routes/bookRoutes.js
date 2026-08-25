const express = require('express');
const router = express.Router();
const bookController = require('../controllers/bookController');
const authMiddleware = require('../middleware/authMiddleware');
const optionalAuth = require('../middleware/optionalAuthMiddleware');
const { requireRole } = require('../middleware/roleMiddleware');
const { requireTeacherPermission } = require('../middleware/teacherPermissionMiddleware');

// ── Public / optional auth ───────────────────────────────────────────────────
router.get('/courses/:courseId/books', optionalAuth, bookController.publicCourseBooks);
router.get(
    '/courses/:courseId/books/:bookId/preview/:page',
    optionalAuth,
    bookController.previewPage
);

// ── Student (auth) ───────────────────────────────────────────────────────────
router.get(
    '/student/books',
    authMiddleware,
    requireRole(['student', 'teacher']),
    bookController.myBooks
);
router.post(
    '/courses/:courseId/book-purchase',
    authMiddleware,
    requireRole(['student', 'teacher']),
    bookController.purchaseBooks
);
router.get(
    '/books/:bookId/reader',
    authMiddleware,
    requireRole(['student', 'teacher']),
    bookController.readerMeta
);
router.get(
    '/books/:bookId/pages/:page',
    authMiddleware,
    requireRole(['student', 'teacher']),
    bookController.streamPage
);
router.get(
    '/student/books/:bookId/courier',
    authMiddleware,
    requireRole(['student', 'teacher']),
    bookController.getCourierOrder
);
router.post(
    '/student/books/:bookId/courier-address',
    authMiddleware,
    requireRole(['student', 'teacher']),
    bookController.saveCourierAddress
);
router.patch(
    '/student/books/:bookId/courier-address',
    authMiddleware,
    requireRole(['student', 'teacher']),
    bookController.saveCourierAddress
);
router.get(
    '/student/books/:bookId/reading-progress',
    authMiddleware,
    requireRole(['student', 'teacher']),
    bookController.getReadingProgress
);
router.post(
    '/student/books/:bookId/reading-progress',
    authMiddleware,
    requireRole(['student', 'teacher']),
    bookController.saveReadingProgress
);
router.get(
    '/student/books/:bookId/annotations',
    authMiddleware,
    requireRole(['student', 'teacher']),
    bookController.listAnnotations
);
router.post(
    '/student/books/:bookId/annotations',
    authMiddleware,
    requireRole(['student', 'teacher']),
    bookController.createAnnotation
);
router.patch(
    '/student/books/annotations/:annotationId',
    authMiddleware,
    requireRole(['student', 'teacher']),
    bookController.updateAnnotation
);
router.delete(
    '/student/books/annotations/:annotationId',
    authMiddleware,
    requireRole(['student', 'teacher']),
    bookController.deleteAnnotation
);
router.post(
    '/student/books/:bookId/annotations/bulk-sync',
    authMiddleware,
    requireRole(['student', 'teacher']),
    bookController.bulkSyncAnnotations
);

// ── Teacher ──────────────────────────────────────────────────────────────────
router.get(
    '/teacher/courses/:courseId/books',
    authMiddleware,
    requireTeacherPermission('courses'),
    bookController.listCourseBooks
);
router.post(
    '/teacher/courses/:courseId/books',
    authMiddleware,
    requireTeacherPermission('courses'),
    bookController.createBook
);
router.patch(
    '/teacher/courses/:courseId/books/:bookId',
    authMiddleware,
    requireTeacherPermission('courses'),
    bookController.updateBook
);
router.delete(
    '/teacher/courses/:courseId/books/:bookId',
    authMiddleware,
    requireTeacherPermission('courses'),
    bookController.deleteBook
);
router.put(
    '/teacher/courses/:courseId/book-pricing',
    authMiddleware,
    requireTeacherPermission('courses'),
    bookController.upsertPricing
);
router.post(
    '/teacher/books/r2-multipart/init',
    authMiddleware,
    requireTeacherPermission('courses'),
    bookController.initMultipart
);
router.post(
    '/teacher/books/r2-multipart/part-url',
    authMiddleware,
    requireTeacherPermission('courses'),
    bookController.partUrl
);
router.post(
    '/teacher/books/r2-multipart/complete',
    authMiddleware,
    requireTeacherPermission('courses'),
    bookController.completeMultipart
);
router.post(
    '/teacher/books/r2-multipart/abort',
    authMiddleware,
    requireTeacherPermission('courses'),
    bookController.abortMultipart
);
router.get(
    '/teacher/books/:bookId/processing-status',
    authMiddleware,
    requireTeacherPermission('courses'),
    bookController.processingStatus
);
router.post(
    '/teacher/courses/:courseId/books/:bookId/gift',
    authMiddleware,
    requireTeacherPermission('courses'),
    bookController.giftBook
);
router.get(
    '/teacher/book-orders',
    authMiddleware,
    requireTeacherPermission('courses'),
    bookController.listOrders
);
router.patch(
    '/teacher/book-orders/:orderId',
    authMiddleware,
    requireTeacherPermission('courses'),
    bookController.updateOrder
);
router.get(
    '/teacher/book-earnings',
    authMiddleware,
    requireTeacherPermission('courses'),
    bookController.teacherEarnings
);

module.exports = router;
