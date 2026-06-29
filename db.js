const { Pool } = require('pg');
require('dotenv').config();

const poolMax = Math.min(100, Math.max(5, parseInt(process.env.DB_POOL_MAX || '30', 10)));
const poolMin = Math.min(poolMax, Math.max(0, parseInt(process.env.DB_POOL_MIN || '2', 10)));

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
    max: poolMax,
    min: poolMin,
    idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT_MS || '30000', 10),
    connectionTimeoutMillis: parseInt(process.env.DB_CONNECT_TIMEOUT_MS || '10000', 10),
    allowExitOnIdle: false,
    ssl: process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false },
});

pool.on('error', (err) => {
    console.error('Unexpected PostgreSQL pool error:', err.message);
});

module.exports = {
    query: (text, params) => pool.query(text, params),
    pool,
};
