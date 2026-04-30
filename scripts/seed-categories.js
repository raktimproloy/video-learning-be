#!/usr/bin/env node
/**
 * Seed Academic and Skill-based category trees from acadamic.json and skill-based.json.
 * Structure:
 *   - Academic (root) → levels (Class 5, Class 6, ...) → books (subjects)
 *   - Skill-based (root) → categories → courses
 * Usage: node scripts/seed-categories.js
 * Run from backend folder or project root (script loads JSON from backend/).
 */

require('dotenv').config();
const path = require('path');
const fs = require('fs');
const db = require('../db');

function slugify(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'item';
}

function ensureUniqueSlug(slug, used) {
  if (!used.has(slug)) {
    used.add(slug);
    return slug;
  }
  let n = 1;
  while (used.has(`${slug}-${n}`)) n++;
  const unique = `${slug}-${n}`;
  used.add(unique);
  return unique;
}

async function run() {
  const backendDir = path.resolve(__dirname, '..');
  const academicPath = path.join(backendDir, 'acadamic.json');
  const skillPath = path.join(backendDir, 'skill-based.json');

  if (!fs.existsSync(academicPath)) {
    console.error('Missing backend/acadamic.json');
    process.exit(1);
  }
  if (!fs.existsSync(skillPath)) {
    console.error('Missing backend/skill-based.json');
    process.exit(1);
  }

  const academic = JSON.parse(fs.readFileSync(academicPath, 'utf8'));
  const skillBased = JSON.parse(fs.readFileSync(skillPath, 'utf8'));

    const client = await db.pool.connect();
  try {
    /** All category slugs in the table must be unique for URL lookup; share one set across the whole seed. */
    const globalCategorySlugs = new Set();

    // 1) Remove existing roots so we can re-seed idempotently
    const rootsToReplace = ['academic', 'skill-based'];
    for (const slug of rootsToReplace) {
      const del = await client.query(
        `DELETE FROM admin_categories WHERE parent_id IS NULL AND slug = $1`,
        [slug]
      );
      if (del.rowCount > 0) {
        console.log(`Removed existing "${slug}" root and its children.`);
      }
    }

    // 2) Insert Academic root
    const academicRootSlug = 'academic';
    const academicRootRes = await client.query(
      `INSERT INTO admin_categories (parent_id, name, name_bn, slug, description, status, level, display_order)
       VALUES (NULL, $1, NULL, $2, NULL, 'active', 0, 0)
       RETURNING id`,
      ['Academic', academicRootSlug]
    );
    const academicRootId = academicRootRes.rows[0].id;
    globalCategorySlugs.add(academicRootSlug);
    console.log('Created root: Academic');

    let displayOrder = 0;
    /** Defer "Jobs & Others" so order is: Class 11 & 12 → Admission → Honours → Jobs & Others */
    const JOBS_AND_OTHERS_LEVEL = 'Jobs & Others';
    let jobsAndOthersLevel = null;

    for (const level of academic.academic_levels || []) {
      const levelName = level.level || 'Level';
      if (levelName === JOBS_AND_OTHERS_LEVEL) {
        jobsAndOthersLevel = level;
        continue;
      }
      const levelSlug = ensureUniqueSlug(slugify(levelName), globalCategorySlugs);
      const levelRes = await client.query(
        `INSERT INTO admin_categories (parent_id, name, name_bn, slug, description, status, level, display_order)
         VALUES ($1, $2, NULL, $3, NULL, 'active', 1, $4)
         RETURNING id`,
        [academicRootId, levelName, levelSlug, displayOrder++]
      );
      const levelId = levelRes.rows[0].id;
      let bookOrder = 0;
      for (const book of level.books || []) {
        const name = book.english_name || book.bangla_name || 'Book';
        const nameBn = book.bangla_name || null;
        const slug = ensureUniqueSlug(slugify(name), globalCategorySlugs);
        await client.query(
          `INSERT INTO admin_categories (parent_id, name, name_bn, slug, description, status, level, display_order)
           VALUES ($1, $2, $3, $4, NULL, 'active', 2, $5)`,
          [levelId, name, nameBn, slug, bookOrder++]
        );
      }
      console.log(`  → ${levelName}: ${(level.books || []).length} books`);
    }

    // 2b) Honours / Undergraduate (after Admission, before Jobs & Others)
    if (academic.honours && academic.honours.faculties && academic.honours.faculties.length > 0) {
      const honoursLevelName = academic.honours.education_level || 'Honours / Undergraduate';
      const honoursSlug = ensureUniqueSlug(slugify(honoursLevelName), globalCategorySlugs);
      const honoursRes = await client.query(
        `INSERT INTO admin_categories (parent_id, name, name_bn, slug, description, status, level, display_order)
         VALUES ($1, $2, NULL, $3, NULL, 'active', 1, $4)
         RETURNING id`,
        [academicRootId, honoursLevelName, honoursSlug, displayOrder++]
      );
      const honoursId = honoursRes.rows[0].id;
      let facultyOrder = 0;
      for (const faculty of academic.honours.faculties) {
        const name = faculty.faculty_name || 'Faculty';
        const slug = ensureUniqueSlug(slugify(name), globalCategorySlugs);
        await client.query(
          `INSERT INTO admin_categories (parent_id, name, name_bn, slug, description, status, level, display_order)
           VALUES ($1, $2, NULL, $3, NULL, 'active', 2, $4)`,
          [honoursId, name, slug, facultyOrder++]
        );
      }
      console.log(`  → ${honoursLevelName}: ${academic.honours.faculties.length} faculties (sub-categories)`);
    }

    // 2c) Jobs & Others last
    if (jobsAndOthersLevel) {
      const levelName = jobsAndOthersLevel.level || JOBS_AND_OTHERS_LEVEL;
      const levelSlug = ensureUniqueSlug(slugify(levelName), globalCategorySlugs);
      const levelRes = await client.query(
        `INSERT INTO admin_categories (parent_id, name, name_bn, slug, description, status, level, display_order)
         VALUES ($1, $2, NULL, $3, NULL, 'active', 1, $4)
         RETURNING id`,
        [academicRootId, levelName, levelSlug, displayOrder++]
      );
      const levelId = levelRes.rows[0].id;
      let bookOrder = 0;
      for (const book of jobsAndOthersLevel.books || []) {
        const name = book.english_name || book.bangla_name || 'Book';
        const nameBn = book.bangla_name || null;
        const slug = ensureUniqueSlug(slugify(name), globalCategorySlugs);
        await client.query(
          `INSERT INTO admin_categories (parent_id, name, name_bn, slug, description, status, level, display_order)
           VALUES ($1, $2, $3, $4, NULL, 'active', 2, $5)`,
          [levelId, name, nameBn, slug, bookOrder++]
        );
      }
      console.log(`  → ${levelName}: ${(jobsAndOthersLevel.books || []).length} books`);
    }

    // 3) Insert Skill-based root
    const skillRootRes = await client.query(
      `INSERT INTO admin_categories (parent_id, name, name_bn, slug, description, status, level, display_order)
       VALUES (NULL, $1, NULL, $2, NULL, 'active', 0, 1)
       RETURNING id`,
      ['Skill-based', 'skill-based']
    );
    const skillRootId = skillRootRes.rows[0].id;
    globalCategorySlugs.add('skill-based');
    console.log('Created root: Skill-based');

    displayOrder = 0;
    for (const cat of skillBased.skill_categories || []) {
      const catName = cat.category || 'Category';
      const catSlug = ensureUniqueSlug(slugify(catName), globalCategorySlugs);
      const catRes = await client.query(
        `INSERT INTO admin_categories (parent_id, name, name_bn, slug, description, status, level, display_order)
         VALUES ($1, $2, NULL, $3, NULL, 'active', 1, $4)
         RETURNING id`,
        [skillRootId, catName, catSlug, displayOrder++]
      );
      const catId = catRes.rows[0].id;
      let courseOrder = 0;
      for (const course of cat.courses || []) {
        const name = course.english_name || course.bangla_name || 'Course';
        const nameBn = course.bangla_name || null;
        const slug = ensureUniqueSlug(slugify(name), globalCategorySlugs);
        await client.query(
          `INSERT INTO admin_categories (parent_id, name, name_bn, slug, description, status, level, display_order)
           VALUES ($1, $2, $3, $4, NULL, 'active', 2, $5)`,
          [catId, name, nameBn, slug, courseOrder++]
        );
      }
      console.log(`  → ${catName}: ${(cat.courses || []).length} courses`);
    }

    console.log('Category seed completed.');
  } catch (err) {
    console.error('Seed failed:', err);
    process.exit(1);
  } finally {
    client.release();
    await db.pool.end();
  }
}

run();
