/**
 * @file api/admin/[action].js
 * @description Admin API router to bypass Vercel serverless function limits
 * Vercel Hobby plan has a 12-function limit. By nesting all admin API 
 * endpoints behind a single [action].js catch-all router, we drastically 
 * reduce the number of deployed serverless functions.
 */

const path = require('path');
const fs = require('fs');

module.exports = async (req, res) => {
    try {
        const { action } = req.query;

        if (!action) {
            res.status(400).json({ error: 'Missing action parameter' });
            return;
        }

        // Prevent path traversal by only allowing valid endpoint names
        if (!/^[a-zA-Z0-9\-]+$/.test(action)) {
            res.status(400).json({ error: 'Invalid API action' });
            return;
        }

        // All internal endpoint files have been renamed to begin with an underscore '_'
        // so Vercel does not count them as independent serverless functions.
        const handlerPath = path.join(__dirname, `_${action}.js`);

        if (!fs.existsSync(handlerPath)) {
            res.status(404).json({ error: `API endpoint /api/admin/${action} not found` });
            return;
        }

        // Dynamically load the appropriate _script.js handler and execute it
        const handler = require(handlerPath);

        if (typeof handler !== 'function') {
            res.status(500).json({ error: 'Invalid handler exported' });
            return;
        }

        await handler(req, res);

    } catch (e) {
        console.error(`[Admin API Router] Error executing ${req.query.action}:`, e);
        res.status(500).json({ error: 'Internal Server Error', details: e.message });
    }
};
