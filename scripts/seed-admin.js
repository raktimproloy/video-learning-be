#!/usr/bin/env node
/**
 * Seed script to create an initial admin user.
 * Usage: node scripts/seed-admin.js [email] [password]
 * Example: node scripts/seed-admin.js admin@example.com SecurePass123!
 */

require('dotenv').config();
const db = require('../db');
const bcrypt = require('bcryptjs');

async function seedAdmin() {
  const email = process.argv[2] || process.env.ADMIN_EMAIL || 'admin@example.com';
  const password = process.argv[3] || process.env.ADMIN_PASSWORD || 'admin123';

  if (password.length < 6) {
    console.error('Password must be at least 6 characters');
    process.exit(1);
  }

  try {
    const existing = await db.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      const u = existing.rows[0];
      const roleCheck = await db.query('SELECT role FROM users WHERE id = $1', [u.id]);
      if (roleCheck.rows[0]?.role === 'admin') {
        console.log(`Admin already exists: ${email}`);
        process.exit(0);
      }
      await db.query("UPDATE users SET role = 'admin' WHERE id = $1", [u.id]);
      console.log(`Updated user ${email} to admin role`);
      process.exit(0);
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    await db.query(
      "INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'admin')",
      [email, passwordHash]
    );

    console.log(`Admin created: ${email}`);
  } catch (err) {
    console.error('Seed failed:', err);
    process.exit(1);
  } finally {
    await db.pool.end();
  }
}

seedAdmin();
