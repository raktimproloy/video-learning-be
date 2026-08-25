require('dotenv').config();
const db = require('./db');
(async () => {
  try {
    await db.query(`ALTER TABLE book_user_annotations DROP CONSTRAINT book_user_annotations_type_check;`);
    await db.query(`ALTER TABLE book_user_annotations ADD CONSTRAINT book_user_annotations_type_check CHECK (type IN ('highlight', 'note', 'draw', 'text'));`);
    console.log('Constraint updated successfully');
  } catch(e) {
    console.error(e);
  } finally {
    process.exit();
  }
})();
