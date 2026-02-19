const db = require('../../db');

/**
 * Generate URL-friendly slug from name
 */
function slugify(text) {
    return String(text || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
}

class AdminCategoryService {
    /**
     * List categories with pagination.
     * @param {Object} options - { parentId, page, limit, status, q }
     * @returns {Promise<{ categories: Array, total: number, page: number, limit: number, totalPages: number }>}
     */
    async list(options = {}) {
        const { parentId = null, page = 1, limit = 20, status, q } = options;
        const offset = (Math.max(1, parseInt(page, 10)) - 1) * Math.min(50, Math.max(1, parseInt(limit, 10)));
        const limitVal = Math.min(50, Math.max(1, parseInt(limit, 10)));

        const conditions = [];
        const params = [];
        let paramIdx = 1;

        if (parentId === null || parentId === '' || parentId === 'root') {
            conditions.push('c.parent_id IS NULL');
        } else {
            conditions.push(`c.parent_id = $${paramIdx}`);
            params.push(parentId);
            paramIdx++;
        }

        if (status && ['active', 'inactive'].includes(status)) {
            conditions.push(`c.status = $${paramIdx}`);
            params.push(status);
            paramIdx++;
        }

        if (q && String(q).trim()) {
            const searchPattern = `%${String(q).trim().replace(/%/g, '\\%')}%`;
            conditions.push(`(c.name ILIKE $${paramIdx} OR c.description ILIKE $${paramIdx})`);
            params.push(searchPattern, searchPattern);
            paramIdx += 2;
        }

        const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

        const countResult = await db.query(
            `SELECT COUNT(*)::int as total FROM admin_categories c ${whereClause}`,
            params
        );
        const total = countResult.rows[0]?.total || 0;

        params.push(limitVal, offset);
        const limitParam = params.length - 1;
        const offsetParam = params.length;
        const listResult = await db.query(
            `SELECT c.*, 
                    p.name as parent_name,
                    (SELECT COUNT(*)::int FROM admin_categories ch WHERE ch.parent_id = c.id) as children_count
             FROM admin_categories c
             LEFT JOIN admin_categories p ON c.parent_id = p.id
             ${whereClause}
             ORDER BY c.name ASC
             LIMIT $${limitParam} OFFSET $${offsetParam}`,
            params
        );

        const categories = listResult.rows.map((row) => ({
            id: row.id,
            parentId: row.parent_id,
            parentName: row.parent_name,
            name: row.name,
            slug: row.slug,
            description: row.description,
            status: row.status,
            childrenCount: parseInt(row.children_count, 10) || 0,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        }));

        const totalPages = Math.ceil(total / limitVal) || 1;

        return {
            categories,
            total,
            page: Math.max(1, parseInt(page, 10)),
            limit: limitVal,
            totalPages,
        };
    }

    /**
     * Get main categories (roots) for parent selector
     */
    async getRootCategories() {
        const result = await db.query(
            `SELECT id, name, slug FROM admin_categories 
             WHERE parent_id IS NULL AND status = 'active' 
             ORDER BY name ASC`
        );
        return result.rows;
    }

    /**
     * Get children of a parent (for cascading parent selector)
     */
    async getChildren(parentId) {
        const result = await db.query(
            `SELECT id, name, slug, parent_id FROM admin_categories 
             WHERE parent_id = $1 AND status = 'active' 
             ORDER BY name ASC`,
            [parentId]
        );
        return result.rows;
    }

    /**
     * Get full tree for dropdown (all levels, flattened with path).
     * Each item: { id, name, slug, path, level }
     */
    async getTreeForSelect() {
        const roots = await this.getRootCategories();
        const result = [];
        for (const r of roots) {
            result.push({ id: r.id, name: r.name, slug: r.slug, path: r.name, level: 0 });
            const children = await this.getChildren(r.id);
            for (const c of children) {
                result.push({ id: c.id, name: c.name, slug: c.slug, path: `${r.name} > ${c.name}`, level: 1 });
                const grandChildren = await this.getChildren(c.id);
                for (const g of grandChildren) {
                    result.push({
                        id: g.id,
                        name: g.name,
                        slug: g.slug,
                        path: `${r.name} > ${c.name} > ${g.name}`,
                        level: 2,
                    });
                }
            }
        }
        return result;
    }

    async findById(id) {
        const result = await db.query(
            `SELECT c.*, p.name as parent_name, p.slug as parent_slug
             FROM admin_categories c
             LEFT JOIN admin_categories p ON c.parent_id = p.id
             WHERE c.id = $1`,
            [id]
        );
        const row = result.rows[0];
        if (!row) return null;
        return {
            id: row.id,
            parentId: row.parent_id,
            parentName: row.parent_name,
            parentSlug: row.parent_slug,
            name: row.name,
            slug: row.slug,
            description: row.description,
            status: row.status,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }

    async create(data) {
        const { name, description, parentId, status = 'active' } = data;
        const slug = slugify(name);
        if (!slug) {
            throw new Error('Invalid name: could not generate slug');
        }

        if (parentId) {
            const parent = await this.findById(parentId);
            if (!parent) {
                throw new Error('Parent category not found');
            }
        }

        const result = await db.query(
            `INSERT INTO admin_categories (parent_id, name, slug, description, status)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING *`,
            [parentId || null, name.trim(), slug, description?.trim() || null, status]
        );
        const row = result.rows[0];
        return {
            id: row.id,
            parentId: row.parent_id,
            name: row.name,
            slug: row.slug,
            description: row.description,
            status: row.status,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }

    async update(id, data) {
        const existing = await this.findById(id);
        if (!existing) {
            throw new Error('Category not found');
        }

        const { name, description, parentId, status } = data;
        const updates = [];
        const values = [];
        let idx = 1;

        if (name !== undefined) {
            const slug = slugify(name);
            if (!slug) throw new Error('Invalid name: could not generate slug');
            updates.push(`name = $${idx}`, `slug = $${idx + 1}`);
            values.push(name.trim(), slug);
            idx += 2;
        }
        if (description !== undefined) {
            updates.push(`description = $${idx}`);
            values.push(description?.trim() || null);
            idx++;
        }
        if (parentId !== undefined) {
            if (parentId === id) {
                throw new Error('Category cannot be its own parent');
            }
            if (parentId) {
                const parent = await this.findById(parentId);
                if (!parent) throw new Error('Parent category not found');
            }
            updates.push(`parent_id = $${idx}`);
            values.push(parentId || null);
            idx++;
        }
        if (status !== undefined && ['active', 'inactive'].includes(status)) {
            updates.push(`status = $${idx}`);
            values.push(status);
            idx++;
        }

        if (updates.length === 0) return existing;

        values.push(id);
        const result = await db.query(
            `UPDATE admin_categories SET ${updates.join(', ')}, updated_at = NOW()
             WHERE id = $${idx} RETURNING *`,
            values
        );
        const row = result.rows[0];
        return {
            id: row.id,
            parentId: row.parent_id,
            name: row.name,
            slug: row.slug,
            description: row.description,
            status: row.status,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }

    async delete(id) {
        const result = await db.query(
            'DELETE FROM admin_categories WHERE id = $1 RETURNING id',
            [id]
        );
        return result.rowCount > 0;
    }
}

module.exports = new AdminCategoryService();
