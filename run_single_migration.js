// Run a single migration file
const fs = require('fs');
const path = require('path');
const db = require('./db');

async function run() {
    const file = process.argv[2];
    if (!file) {
        console.error('Usage: node run_single_migration.js <filename.sql>');
        process.exit(1);
    }
    const filePath = path.join(__dirname, 'migrations', file);
    if (!fs.existsSync(filePath)) {
        console.error('File not found:', filePath);
        process.exit(1);
    }
    const sql = fs.readFileSync(filePath, 'utf8');
    console.log(`Running migration: ${file}`);
    await db.query(sql);
    console.log(`✅ Done: ${file}`);
    await db.pool.end();
    process.exit(0);
}

run().catch(err => {
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
});
