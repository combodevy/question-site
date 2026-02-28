/**
 * @file api/admin/create-user.js
 * @description Admin API to create a new user without ending the admin's session
 * @author Engineer
 * @date 2026-02-28
 */

const { verifyAdmin } = require('./_middleware');
const { handleCors } = require('../_cors');
const { createClient } = require('@supabase/supabase-js');

// We need the SERVICE_ROLE_KEY to bypass RLS and create users on behalf of the admin
// without logging the admin out
const supabaseUrl = process.env.SUPABASE_URL || '';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabaseAdmin = (supabaseUrl && serviceRoleKey) ? createClient(supabaseUrl, serviceRoleKey, {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    }
}) : null;

module.exports = async (req, res) => {
    // 1. CORS
    if (handleCors(req, res)) return;

    // 2. Admin Verification
    const adminUser = await verifyAdmin(req);
    if (!adminUser) {
        res.status(403).json({ error: 'Forbidden: Admin access required' });
        return;
    }

    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }

    if (!supabaseAdmin) {
        res.status(500).json({ error: 'Server configuration error: SUPABASE_SERVICE_ROLE_KEY is required to create users via Admin API.' });
        return;
    }

    const { email, password, username } = req.body || {};

    if (!email || !password) {
        res.status(400).json({ error: 'Email and password are required' });
        return;
    }

    try {
        // Use the Admin API to create the user directly in Supabase Auth
        // This DOES NOT affect the current session of the caller
        const { data, error } = await supabaseAdmin.auth.admin.createUser({
            email,
            password,
            email_confirm: true, // Auto confirm so they can log in immediately
            user_metadata: {
                username: username || email.split('@')[0],
                created_by_admin: true
            }
        });

        if (error) {
            throw error;
        }

        res.status(200).json({
            ok: true,
            user: {
                id: data.user.id,
                email: data.user.email
            }
        });
    } catch (error) {
        console.error('Error creating user via admin API:', error);
        res.status(400).json({ error: error.message || 'Failed to create user' });
    }
};
