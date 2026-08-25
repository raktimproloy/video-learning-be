require('dotenv').config();
const db = require('./db');
const bookEntitlementService = require('./src/services/bookEntitlementService');

async function fixEntitlements() {
  try {
    const enrollmentsRes = await db.query(`
      SELECT ce.user_id, ce.course_id, ce.is_invited 
      FROM course_enrollments ce
    `);
    
    let count = 0;
    for (const row of enrollmentsRes.rows) {
      const { user_id, course_id, is_invited } = row;
      const includedBooks = await db.query(
          `SELECT id FROM course_books WHERE course_id = $1 AND pricing_mode = 'included' AND status != 'draft'`,
          [course_id]
      );
      
      for (const book of includedBooks.rows) {
        await bookEntitlementService.grant({
            userId: user_id,
            courseId: course_id,
            courseBookId: book.id,
            source: is_invited ? 'gift' : 'purchase'
        });
        count++;
      }
    }
    console.log(`Successfully granted ${count} missing included book entitlements.`);
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

fixEntitlements();
