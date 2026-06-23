const db = require('./src/../db');
const courseService = require('./src/services/courseService');

async function fixMissingEnrollments() {
    console.log('Scanning for missing enrollments...');
    
    // Find payment requests that are 'accepted' but the user is not enrolled
    const result = await db.query(`
        SELECT pr.id, pr.user_id, pr.course_id, pr.amount, pr.currency 
        FROM course_payment_requests pr
        LEFT JOIN course_enrollments ce 
            ON pr.user_id = ce.user_id AND pr.course_id = ce.course_id
        WHERE pr.status = 'accepted' 
          AND ce.course_id IS NULL
    `);
    
    console.log(`Found ${result.rows.length} accepted payment requests missing enrollments.`);
    
    for (const row of result.rows) {
        console.log(`Fixing enrollment for User: ${row.user_id}, Course: ${row.course_id}`);
        try {
            await courseService.enrollUser(row.user_id, row.course_id, {
                amountPaid: row.amount,
                currency: row.currency || 'BDT'
            });
            console.log(`  -> Successfully enrolled!`);
        } catch (err) {
            console.error(`  -> Failed:`, err);
        }
    }
    
    console.log('Done!');
    process.exit(0);
}

fixMissingEnrollments().catch(err => {
    console.error(err);
    process.exit(1);
});
