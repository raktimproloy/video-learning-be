const db = require('../../db');

class AdminInstitutesController {
  async getAllInstitutes(req, res) {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 20;
      const offset = (page - 1) * limit;
      const search = req.query.search ? `%${req.query.search}%` : null;

      let countQuery = 'SELECT COUNT(*) FROM teacher_institutes';
      let dataQuery = `
        SELECT ti.*, 
               u.email as login_email,
               tp.name as teacher_name
        FROM teacher_institutes ti
        JOIN users u ON u.id = ti.teacher_id
        LEFT JOIN teacher_profiles tp ON tp.user_id = ti.teacher_id
      `;
      let queryParams = [];
      let countParams = [];

      if (search) {
        const whereClause = ' WHERE ti.slug ILIKE $1 OR ti.name ILIKE $1 OR u.email ILIKE $1';
        countQuery += whereClause;
        dataQuery += whereClause;
        queryParams.push(search);
        countParams.push(search);
      }

      dataQuery += ` ORDER BY ti.created_at DESC LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}`;
      queryParams.push(limit, offset);

      const countResult = await db.query(countQuery, countParams);
      const dataResult = await db.query(dataQuery, queryParams);

      return res.json({
        total: parseInt(countResult.rows[0].count, 10),
        page,
        limit,
        institutes: dataResult.rows
      });
    } catch (error) {
      console.error('Get all institutes error:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  async updateInstituteAdmin(req, res) {
    try {
      const { id } = req.params;
      const { slug, name, status } = req.body;

      if (!slug || !name) {
        return res.status(400).json({ error: 'Slug and Name are required.' });
      }

      // Check if new slug is taken by another institute
      const existing = await db.query('SELECT id FROM teacher_institutes WHERE slug = $1 AND id != $2', [slug, id]);
      if (existing.rows.length > 0) {
        return res.status(409).json({ error: 'This subdomain is already in use by another institute.' });
      }

      const result = await db.query(
        `UPDATE teacher_institutes 
         SET slug = $1, name = $2, status = $3, updated_at = NOW() 
         WHERE id = $4 RETURNING *`,
        [slug, name, status || 'active', id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Institute not found.' });
      }

      return res.json({ message: 'Institute updated successfully.', institute: result.rows[0] });
    } catch (error) {
      console.error('Update institute error:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  async deleteInstituteAdmin(req, res) {
    try {
      const { id } = req.params;
      const result = await db.query('DELETE FROM teacher_institutes WHERE id = $1 RETURNING *', [id]);
      
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Institute not found.' });
      }

      return res.json({ message: 'Institute deleted successfully.' });
    } catch (error) {
      console.error('Delete institute error:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  async getReservedSlugs(req, res) {
    try {
      const result = await db.query('SELECT * FROM reserved_slugs ORDER BY slug ASC');
      return res.json(result.rows);
    } catch (error) {
      console.error('Get reserved slugs error:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  async addReservedSlug(req, res) {
    try {
      const { slug, reason } = req.body;
      if (!slug) {
        return res.status(400).json({ error: 'Slug is required.' });
      }

      const normalizedSlug = slug.toLowerCase().trim();

      await db.query(
        'INSERT INTO reserved_slugs (slug, reason) VALUES ($1, $2) ON CONFLICT (slug) DO UPDATE SET reason = EXCLUDED.reason',
        [normalizedSlug, reason || 'Admin blocked']
      );

      return res.json({ message: 'Reserved slug added successfully.' });
    } catch (error) {
      console.error('Add reserved slug error:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  async removeReservedSlug(req, res) {
    try {
      const { slug } = req.params;
      await db.query('DELETE FROM reserved_slugs WHERE slug = $1', [slug.toLowerCase().trim()]);
      return res.json({ message: 'Reserved slug removed successfully.' });
    } catch (error) {
      console.error('Remove reserved slug error:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
}

module.exports = new AdminInstitutesController();
