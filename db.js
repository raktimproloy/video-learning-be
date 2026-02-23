const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
    // Render, Neon, Supabase and other cloud Postgres require SSL
    ssl: process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false },
});

module.exports = {
    query: (text, params) => pool.query(text, params),
    pool,
};
