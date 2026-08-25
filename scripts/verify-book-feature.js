/**
 * Static regression checks for Course Book feature (no live DB required).
 * Run: node scripts/verify-book-feature.js
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const failures = [];

function ok(cond, msg) {
  if (!cond) failures.push(msg);
  else console.log('✓', msg);
}

// Migrations
const migrations = [
  '122_course_books.sql',
  '123_book_page_assets_and_processing.sql',
  '124_book_entitlements_and_courier.sql',
  '125_book_annotations_and_reads.sql',
  '126_book_commissions_and_payment_extend.sql',
  '127_admin_book_settings.sql',
];
for (const m of migrations) {
  const p = path.join(root, 'migrations', m);
  ok(fs.existsSync(p), `migration ${m} exists`);
  const sql = fs.readFileSync(p, 'utf8');
  if (m.startsWith('122')) ok(sql.includes('course_books'), '122 defines course_books');
  if (m.startsWith('126')) {
    ok(sql.includes('purchase_type'), '126 extends payment_requests');
    ok(sql.includes("DEFAULT 'course_only'"), '126 defaults course_only (backward compatible)');
  }
  if (m.startsWith('127')) ok(sql.includes('book_platform_percent'), '127 book platform % default');
}

// Services load
try {
  require('../src/services/bookService');
  require('../src/services/bookEntitlementService');
  require('../src/services/paymentRequestService');
  ok(true, 'core book + payment services load');
} catch (e) {
  failures.push('service load: ' + e.message);
}

// Payment service still exports create/accept
const prs = require('../src/services/paymentRequestService');
ok(typeof prs.createPaymentRequest === 'function', 'createPaymentRequest exists');
ok(typeof prs.acceptPaymentRequest === 'function', 'acceptPaymentRequest exists');

// App mounts book routes
const appSrc = fs.readFileSync(path.join(root, 'src/app.js'), 'utf8');
ok(appSrc.includes('bookRoutes'), 'app mounts bookRoutes');
ok(appSrc.includes('adminBookRoutes'), 'app mounts adminBookRoutes');

// Frontend key files
const fe = path.join(root, '../frontend/src');
ok(fs.existsSync(path.join(fe, 'components/book/CourseBookSection.tsx')), 'CourseBookSection');
ok(fs.existsSync(path.join(fe, 'components/book/BookReader.tsx')), 'BookReader');
ok(fs.existsSync(path.join(fe, 'components/book/CourseBooksManager.tsx')), 'CourseBooksManager');
ok(fs.existsSync(path.join(fe, 'app/(main)/student/books/page.tsx')), 'student books page');
ok(fs.existsSync(path.join(fe, 'app/(main)/teacher/books/orders/page.tsx')), 'teacher orders page');

const admin = path.join(root, '../admin');
ok(fs.existsSync(path.join(admin, 'app/books/page.tsx')), 'admin books page');
ok(fs.existsSync(path.join(admin, 'app/book-orders/page.tsx')), 'admin book-orders page');

// Cart backward compat — includeBooks optional in CartContext
const cart = fs.readFileSync(path.join(fe, 'context/CartContext.tsx'), 'utf8');
ok(cart.includes('includeBooks?'), 'CartItem.includeBooks optional');

// Checkout passes book flags
const checkout = fs.readFileSync(path.join(fe, 'app/(main)/checkout/CheckoutPage.tsx'), 'utf8');
ok(checkout.includes('includeAllBooks'), 'checkout sends includeAllBooks');

console.log('\n---');
if (failures.length) {
  console.error('FAILED:', failures.length);
  failures.forEach((f) => console.error(' ✗', f));
  process.exit(1);
}
console.log('All static regression checks passed.');
