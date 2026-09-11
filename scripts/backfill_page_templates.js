// One-off backfill: compute page_template for page_views rows inserted before
// migration 142 (which only computes it going forward). Safe to re-run — only
// touches rows where page_template IS NULL. Batches to avoid one huge UPDATE.
const db = require('../db');
const { toPageTemplate } = require('../src/utils/pageTemplate');

const BATCH_SIZE = 500;

async function run() {
  let totalUpdated = 0;
  for (;;) {
    const { rows } = await db.query(
      `SELECT id, page_path FROM page_views WHERE page_template IS NULL LIMIT $1`,
      [BATCH_SIZE]
    );
    if (rows.length === 0) break;

    // One UPDATE per distinct computed template value in this batch (far fewer
    // round trips than one UPDATE per row).
    const byTemplate = new Map();
    for (const r of rows) {
      const tpl = toPageTemplate(r.page_path);
      if (!byTemplate.has(tpl)) byTemplate.set(tpl, []);
      byTemplate.get(tpl).push(r.id);
    }
    for (const [tpl, ids] of byTemplate) {
      await db.query(`UPDATE page_views SET page_template = $1 WHERE id = ANY($2::uuid[])`, [tpl, ids]);
    }
    totalUpdated += rows.length;
    console.log(`Backfilled ${totalUpdated} rows so far...`);
  }
  console.log(`Done. Total backfilled: ${totalUpdated}`);
  await db.pool.end();
  process.exit(0);
}

run().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
