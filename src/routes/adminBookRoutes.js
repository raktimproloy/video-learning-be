const express = require('express');
const router = express.Router();
const bookController = require('../controllers/bookController');
const verifyAdmin = require('../middleware/verifyAdminMiddleware');

router.use(verifyAdmin);

router.get('/books', bookController.adminListBooks);
router.get('/books/:bookId', bookController.adminGetBook);
router.put('/books/:bookId', bookController.adminUpdateBook);
router.patch('/books/:bookId/status', bookController.adminSetBookStatus);
router.delete('/books/:bookId', bookController.adminDeleteBook);
router.get('/books/:bookId/recipients', bookController.adminGetRecipients);
router.post('/books/:bookId/manual-grant', bookController.adminManualGrant);
router.post('/books/:bookId/revoke-grant', bookController.adminRevokeGrant);
router.get('/book-orders', bookController.adminListOrders);
router.get('/book-orders/:orderId', bookController.adminGetOrder);
router.put('/book-orders/:orderId', bookController.adminUpdateOrder);
router.delete('/book-orders/:orderId', bookController.adminDeleteOrder);

module.exports = router;
