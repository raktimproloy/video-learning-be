const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
    ssl: { rejectUnauthorized: false }
});

async function main() {
    const lessonId = 'ceb57368-f627-48fd-bf14-acbcb19cb783';
    
    // Exactly what videoService.getVideosByLesson does
    const statusFilter = ``; // isOwner = true
    const query = `
            SELECT 
                v.*,
                (
                    SELECT status 
                    FROM video_processing_tasks 
                    WHERE video_id = v.id 
                    ORDER BY created_at DESC 
                    LIMIT 1
                ) as processing_status
            FROM videos v
            WHERE v.lesson_id = $1 ${statusFilter}
            ORDER BY v."order" ASC, v.created_at ASC
        `;
    
    const res = await pool.query(query, [lessonId]);
    console.log("Videos length:", res.rows.length);
    console.log(JSON.stringify(res.rows, null, 2));
    
    pool.end();
}

main().catch(console.error);
