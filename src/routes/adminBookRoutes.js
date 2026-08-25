const express = require('express');
const router = express.Router();
const bookController = require('../controllers/bookController');
const verifyAdmin = require('../middleware/verifyAdminMiddleware');

router.use(verifyAdmin);

router.get('/books', bookController.adminListBooks);
router.patch('/books/:bookId/status', bookController.adminSetBookStatus);
router.get('/book-orders', bookController.adminListOrders);

module.exports = router;
