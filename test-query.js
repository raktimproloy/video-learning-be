const db = require('./db');

async function test() {
    try {
        // Just some dummy UUID
        const userId = '084c1b4b-a8f7-4f55-bf99-d887c9139391';
        const res = await db.query(`SELECT 1 
             FROM courses c
             JOIN teacher_profiles tp ON c.teacher_id = tp.user_id
             JOIN lessons l ON c.id = l.course_id
             JOIN videos v ON l.id = v.lesson_id
             WHERE tp.referred_by = $1 LIMIT 1`, [userId]);
        console.log("Query Success:", res.rows);
    } catch(e) {
        console.error("Query Error:", e.message);
    }
}
test().then(()=>process.exit(0));
