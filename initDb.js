const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
require('dotenv').config();

const initDb = async () => {
    const dbName = process.env.DB_NAME;
    
    // 1. Create Database if it doesn't exist
    // Connect to 'postgres' database first to check/create the target DB
    const client = new Client({
        user: process.env.DB_USER,
        host: process.env.DB_HOST,
        database: 'postgres', // Connect to default DB
        password: process.env.DB_PASSWORD,
        port: process.env.DB_PORT,
    });

    try {
        await client.connect();
        
        const res = await client.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [dbName]);
        if (res.rowCount === 0) {
            console.log(`Database '${dbName}' does not exist. Creating...`);
            await client.query(`CREATE DATABASE "${dbName}"`);
            console.log(`Database '${dbName}' created successfully.`);
        } else {
            console.log(`Database '${dbName}' already exists.`);
        }
    } catch (err) {
        console.error('Error checking/creating database:', err);
        // If we can't connect to 'postgres', we might already be pointing to the right DB or have other issues.
        // We will proceed to try connecting to the target DB anyway, but logging this is important.
    } finally {
        await client.end();
    }

    // 2. Run Schema on the target database
    // Now load the main db module which connects to process.env.DB_NAME
    // We need to require it fresh or just create a new pool here to avoid cached config issues if we were using a singleton
    // But since we are in a script, we can just use the db module now.
    const db = require('./db');

    try {
        const schemaPath = path.join(__dirname, 'schema.sql');
        const schemaSql = fs.readFileSync(schemaPath, 'utf8');

        console.log('Running schema setup...');
        await db.query(schemaSql);
        console.log('Database schema initialized successfully.');
    } catch (err) {
        console.error('Error initializing schema:', err);
    } finally {
        await db.pool.end();
    }
};

initDb();
