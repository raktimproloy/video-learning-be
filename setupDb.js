/**
 * Setup database schema and migrations.
 * Use this when you have a cloud database (Render, Neon, etc.) and init-db fails
 * at the "create database" step (no access to 'postgres').
 */
const fs = require('fs');
const path = require('path');
const db = require('./db');

async function run() {
    console.log('Running schema...');
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
    await db.query(schemaSql);
    console.log('Schema done.');

    const migrationsDir = path.join(__dirname, 'migrations');
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
        const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
        console.log(`Running ${file}...`);
        await db.query(sql);
        console.log(`Done ${file}`);
    }

    await db.pool.end();
    console.log('Database setup complete.');
    process.exit(0);
}

run().catch((err) => {
    console.error(err);
    process.exit(1);
});
