const { Client } = require('pg');
const client = new Client({ user: 'postgres.iumxhjxotiqgwhgsbuvq', host: 'aws-1-ap-south-1.pooler.supabase.com', database: 'postgres', password: 'Jt?8AqFHmh*Z8Jx', port: 6543, ssl: { rejectUnauthorized: false } });
client.connect().then(() => client.query("SELECT id, title, status, owner_id, lesson_id FROM videos WHERE lesson_id = 'ceb57368-f627-48fd-bf14-acbcb19cb783'")).then(res => { console.log(res.rows); client.end(); }).catch(console.error);
