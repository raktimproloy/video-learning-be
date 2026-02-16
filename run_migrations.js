const fs = require('fs');
const path = require('path');
const db = require('./db');

const migrationsDir = path.join(__dirname, 'migrations');

async function run() {
    const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
    for (const file of files) {
        const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
        console.log(`Running ${file}...`);
        await db.query(sql);
        console.log(`Done ${file}`);
    }
    await db.pool.end();
    process.exit(0);
}

run().catch(err => {
    console.error(err);
    process.exit(1);
});
