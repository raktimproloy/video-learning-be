require('dotenv').config();
const db = require('./db');

async function check() {
  const books = await db.query(`SELECT id, course_id, title, pricing_mode FROM course_books`);
  console.log('Books:', books.rows);

  const enrollments = await db.query(`SELECT * FROM course_enrollments`);
  console.log('Enrollments:', enrollments.rows);

  const ents = await db.query(`SELECT * FROM book_entitlements`);
  console.log('Entitlements:', ents.rows);

  process.exit(0);
}
check();
