const adminCategoryService = require('../services/adminCategoryService');
const { validationResult } = require('express-validator');

class AdminCategoryController {
    async list(req, res) {
        try {
            const { parentId, page, limit, status, q } = req.query;
            const result = await adminCategoryService.list({
                parentId: parentId || null,
                page,
                limit,
                status,
                q,
            });
            res.json(result);
        } catch (error) {
            console.error('List categories error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async getTree(req, res) {
        try {
            const tree = await adminCategoryService.getTreeForSelect();
            res.json({ categories: tree });
        } catch (error) {
            console.error('Get category tree error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async getById(req, res) {
        try {
            const category = await adminCategoryService.findById(req.params.id);
            if (!category) {
                return res.status(404).json({ error: 'Category not found' });
            }
            res.json(category);
        } catch (error) {
            console.error('Get category error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async create(req, res) {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        try {
            const { name, description, parentId, status, displayOrder } = req.body;
            const category = await adminCategoryService.create({
                name,
                description,
                parentId: parentId || null,
                status,
                displayOrder: displayOrder != null ? parseInt(displayOrder, 10) : undefined,
            });
            res.status(201).json({ category });
        } catch (error) {
            if (
                error.message === 'Parent category not found' ||
                error.message === 'Invalid name: could not generate slug'
            ) {
                return res.status(400).json({ error: error.message });
            }
            if (error.code === '23505') {
                return res.status(400).json({ error: 'A category with this name already exists at this level' });
            }
            console.error('Create category error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async update(req, res) {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        try {
            const { name, description, parentId, status, displayOrder } = req.body;
            const category = await adminCategoryService.update(req.params.id, {
                name,
                description,
                parentId,
                status,
                displayOrder: displayOrder != null ? parseInt(displayOrder, 10) : undefined,
            });
            res.json({ category });
        } catch (error) {
            if (error.message === 'Category not found' || error.message === 'Parent category not found') {
                return res.status(404).json({ error: error.message });
            }
            if (error.message === 'Category cannot be its own parent') {
                return res.status(400).json({ error: error.message });
            }
            if (error.message === 'Invalid name: could not generate slug') {
                return res.status(400).json({ error: error.message });
            }
            if (error.code === '23505') {
                return res.status(400).json({ error: 'A category with this name already exists at this level' });
            }
            console.error('Update category error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    async delete(req, res) {
        try {
            const deleted = await adminCategoryService.delete(req.params.id);
            if (!deleted) {
                return res.status(404).json({ error: 'Category not found' });
            }
            res.json({ message: 'Category deleted successfully' });
        } catch (error) {
            console.error('Delete category error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
}

module.exports = new AdminCategoryController();
