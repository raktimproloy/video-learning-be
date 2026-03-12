const db = require('../../db');
const cache = require('./ttlCache');

/**
 * Check whether a column exists (cached).
 * This keeps the server resilient when migrations haven't been applied yet.
 *
 * @param {string} tableName
 * @param {string} columnName
 * @returns {Promise<boolean>}
 */
async function hasColumn(tableName, columnName) {
  const key = `schema:hasColumn:${tableName}:${columnName}`;
  return await cache.getOrSet(key, 10 * 60 * 1000, async () => {
    const result = await db.query(
      `SELECT EXISTS (
         SELECT 1
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = $1
           AND column_name = $2
       ) AS exists`,
      [tableName, columnName],
    );
    return !!result.rows[0]?.exists;
  });
}

module.exports = { hasColumn };

