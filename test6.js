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
    const res = await pool.query("SELECT id, title, status FROM videos WHERE lesson_id = 'ceb57368-f627-48fd-bf14-acbcb19cb783'");
    console.log(res.rows);
    pool.end();
}
main();
