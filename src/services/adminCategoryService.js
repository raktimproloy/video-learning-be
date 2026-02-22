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
                    COALESCE(c.level, 0) as level,
                    COALESCE(c.course_count, 0) as course_count,
                    COALESCE(c.display_order, 0) as display_order,
                    (SELECT COUNT(*)::int FROM admin_categories ch WHERE ch.parent_id = c.id) as children_count
             FROM admin_categories c
             LEFT JOIN admin_categories p ON c.parent_id = p.id
             ${whereClause}
             ORDER BY COALESCE(c.display_order, 0) ASC, c.name ASC
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
            level: parseInt(row.level, 10) || 0,
            courseCount: parseInt(row.course_count, 10) || 0,
            displayOrder: parseInt(row.display_order, 10) || 0,
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
     * Each item: { id, name, slug, path, level, parentId, courseCount }
     * Max 3 levels: 0 (root), 1 (child), 2 (grandchild).
     */
    async getTreeForSelect() {
        const rootsRes = await db.query(
            `SELECT id, name, slug, parent_id, COALESCE(level, 0) as level, COALESCE(course_count, 0) as course_count, COALESCE(display_order, 0) as display_order
             FROM admin_categories WHERE parent_id IS NULL AND status = 'active' ORDER BY COALESCE(display_order, 0), name ASC`
        );
        const result = [];
        for (const r of rootsRes.rows) {
            result.push({ id: r.id, name: r.name, slug: r.slug, path: r.name, level: 0, parentId: null, courseCount: parseInt(r.course_count, 10) || 0, displayOrder: parseInt(r.display_order, 10) || 0 });
            const childrenRes = await db.query(
                `SELECT id, name, slug, parent_id, COALESCE(level, 1) as level, COALESCE(course_count, 0) as course_count, COALESCE(display_order, 0) as display_order
                 FROM admin_categories WHERE parent_id = $1 AND status = 'active' ORDER BY COALESCE(display_order, 0), name ASC`,
                [r.id]
            );
            for (const c of childrenRes.rows) {
                result.push({ id: c.id, name: c.name, slug: c.slug, path: `${r.name} > ${c.name}`, level: 1, parentId: c.parent_id, courseCount: parseInt(c.course_count, 10) || 0, displayOrder: parseInt(c.display_order, 10) || 0 });
                const grandRes = await db.query(
                    `SELECT id, name, slug, parent_id, COALESCE(level, 2) as level, COALESCE(course_count, 0) as course_count, COALESCE(display_order, 0) as display_order
                     FROM admin_categories WHERE parent_id = $1 AND status = 'active' ORDER BY COALESCE(display_order, 0), name ASC`,
                    [c.id]
                );
                for (const g of grandRes.rows) {
                    result.push({
                        id: g.id,
                        name: g.name,
                        slug: g.slug,
                        path: `${r.name} > ${c.name} > ${g.name}`,
                        level: 2,
                        parentId: g.parent_id,
                        courseCount: parseInt(g.course_count, 10) || 0,
                        displayOrder: parseInt(g.display_order, 10) || 0,
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
            level: parseInt(row.level, 10) || 0,
            courseCount: parseInt(row.course_count, 10) || 0,
            displayOrder: parseInt(row.display_order, 10) || 0,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }

    /** Increment course_count when a course uses this category */
    async incrementCourseCount(categoryId) {
        await db.query(
            'UPDATE admin_categories SET course_count = COALESCE(course_count, 0) + 1 WHERE id = $1',
            [categoryId]
        );
    }

    /** Decrement course_count when a course no longer uses this category */
    async decrementCourseCount(categoryId) {
        if (!categoryId) return;
        await db.query(
            'UPDATE admin_categories SET course_count = GREATEST(0, COALESCE(course_count, 0) - 1) WHERE id = $1',
            [categoryId]
        );
    }

    /**
     * Increment course_count on the category and ALL its ancestors (level 0, 1, 2).
     * Use when a course is assigned to a category so every level shows correct count.
     */
    async incrementCourseCountForPath(categoryId) {
        if (!categoryId) return;
        const ids = await this.getAncestorIdsIncludingSelf(categoryId);
        for (const id of ids) {
            await this.incrementCourseCount(id);
        }
    }

    /**
     * Decrement course_count on the category and ALL its ancestors.
     */
    async decrementCourseCountForPath(categoryId) {
        if (!categoryId) return;
        const ids = await this.getAncestorIdsIncludingSelf(categoryId);
        for (const id of ids) {
            await this.decrementCourseCount(id);
        }
    }

    /**
     * Get category id and all ancestor ids (self first, then parent, grandparent).
     */
    async getAncestorIdsIncludingSelf(categoryId) {
        const ids = [];
        let currentId = categoryId;
        while (currentId) {
            const row = (await db.query(
                'SELECT id, parent_id FROM admin_categories WHERE id = $1',
                [currentId]
            )).rows[0];
            if (!row) break;
            ids.push(row.id);
            currentId = row.parent_id;
        }
        return ids;
    }

    /**
     * Get category ids for filtering: the category matching slug (or id) and ALL its descendants.
     * Used when searching courses by category - show courses in this category or any subcategory.
     */
    async getCategoryAndDescendantIds(slugOrId) {
        if (!slugOrId) return [];
        const byId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(slugOrId));
        const row = byId
            ? (await db.query('SELECT id, slug FROM admin_categories WHERE id = $1', [slugOrId])).rows[0]
            : (await db.query('SELECT id, slug FROM admin_categories WHERE slug = $1 AND status = $2', [String(slugOrId).toLowerCase().trim(), 'active'])).rows[0];
        if (!row) return [];
        const ids = [row.id];
        const children = (await db.query('SELECT id FROM admin_categories WHERE parent_id = $1 AND status = $2', [row.id, 'active'])).rows;
        for (const c of children) {
            ids.push(c.id);
            const grand = (await db.query('SELECT id FROM admin_categories WHERE parent_id = $1 AND status = $2', [c.id, 'active'])).rows;
            for (const g of grand) ids.push(g.id);
        }
        return ids;
    }

    async create(data) {
        const { name, description, parentId, status = 'active', displayOrder } = data;
        const slug = slugify(name);
        if (!slug) {
            throw new Error('Invalid name: could not generate slug');
        }

        let level = 0;
        let display_order = 0;
        if (parentId) {
            const parent = await this.findById(parentId);
            if (!parent) {
                throw new Error('Parent category not found');
            }
            level = (parent.level ?? 0) + 1;
            if (level > 2) {
                throw new Error('Maximum 3 levels allowed. Cannot add child to a level-2 category.');
            }
        }
        // Resolve display_order: use provided or next available
        if (displayOrder !== undefined && Number.isInteger(displayOrder) && displayOrder >= 0) {
            display_order = displayOrder;
        } else {
            const maxRes = await db.query(
                parentId
                    ? 'SELECT COALESCE(MAX(display_order), -1) + 1 as next_order FROM admin_categories WHERE parent_id = $1'
                    : 'SELECT COALESCE(MAX(display_order), -1) + 1 as next_order FROM admin_categories WHERE parent_id IS NULL',
                parentId ? [parentId] : []
            );
            display_order = parseInt(maxRes.rows[0]?.next_order, 10) || 0;
        }

        const result = await db.query(
            `INSERT INTO admin_categories (parent_id, name, slug, description, status, level, display_order)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING *`,
            [parentId || null, name.trim(), slug, description?.trim() || null, status, level, display_order]
        );
        const row = result.rows[0];
        return {
            id: row.id,
            parentId: row.parent_id,
            name: row.name,
            slug: row.slug,
            description: row.description,
            status: row.status,
            level: parseInt(row.level, 10) || 0,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }

    async update(id, data) {
        const existing = await this.findById(id);
        if (!existing) {
            throw new Error('Category not found');
        }

        const { name, description, parentId, status, displayOrder } = data;
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
                if ((parent.level ?? 0) >= 2) {
                    throw new Error('Maximum 3 levels allowed. Cannot add child to a level-2 category.');
                }
                updates.push(`parent_id = $${idx}`, `level = $${idx + 1}`);
                values.push(parentId, (parent.level ?? 0) + 1);
                idx += 2;
            } else {
                updates.push(`parent_id = $${idx}`, `level = $${idx + 1}`);
                values.push(null, 0);
                idx += 2;
            }
        }
        if (status !== undefined && ['active', 'inactive'].includes(status)) {
            updates.push(`status = $${idx}`);
            values.push(status);
            idx++;
        }
        if (displayOrder !== undefined && Number.isInteger(displayOrder) && displayOrder >= 0) {
            updates.push(`display_order = $${idx}`);
            values.push(displayOrder);
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
