const db = require('./db.js');
(async () => {
  try {
    const cid = '8bbd2223-5e30-4b79-b37d-82bdd471589c';
    const courseRes = await db.query('SELECT teacher_id FROM courses WHERE id = $1', [cid]);
    const teacherId = courseRes.rows[0].teacher_id;
    console.log('teacher_id:', teacherId);

    const tpRes = await db.query('SELECT * FROM teacher_profiles WHERE user_id = $1', [teacherId]);
    console.log('teacher profile:', tpRes.rows);
  } catch(e) { console.error(e); }
  process.exit(0);
})();
