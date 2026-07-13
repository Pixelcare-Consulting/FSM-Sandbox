/**
 * API Endpoint: Create Test User
 * POST /api/test/create-user
 * 
 * Creates a test user for development/testing purposes
 * 
 * Body:
 * {
 *   "email": "test@example.com",
 *   "password": "test123",
 *   "role": "TECHNICIAN" | "ADMIN" | "CUSTOMER",
 *   "fullName": "Test User",
 *   "phoneNumber": "+1234567890" (optional),
 *   "status": "ACTIVE" (optional)
 * }
 */

import { blockIfProduction } from '../../../lib/api/blockInProduction';
import { getSupabaseAdmin } from '../../../lib/supabase/server';

export default async function handler(req, res) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ 
      success: false, 
      message: 'Method not allowed. Use POST.' 
    });
  }

  if (blockIfProduction(req, res)) return;

  try {
    const {
      email,
      password,
      role = 'TECHNICIAN',
      fullName = 'Test User',
      phoneNumber = null,
      status = 'ACTIVE'
    } = req.body;

    // Validation
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required'
      });
    }

    if (!['ADMIN', 'TECHNICIAN', 'CUSTOMER'].includes(role)) {
      return res.status(400).json({
        success: false,
        message: 'Role must be ADMIN, TECHNICIAN, or CUSTOMER'
      });
    }

    const supabase = getSupabaseAdmin();

    // Check if user already exists in Supabase Auth
    const { data: existingAuthUsers } = await supabase.auth.admin.listUsers();
    const existingAuthUser = existingAuthUsers?.users?.find(u => u.email === email);

    if (existingAuthUser) {
      return res.status(409).json({
        success: false,
        message: 'User already exists in Supabase Auth with this email',
        user: {
          id: existingAuthUser.id,
          email: existingAuthUser.email
        }
      });
    }

    // Check custom users table
    const { data: existingUser } = await supabase
      .from('users')
      .select('id, username')
      .eq('username', email)
      .is('deleted_at', null)
      .single();

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: 'User already exists in users table',
        user: existingUser
      });
    }

    // Create user in Supabase Auth (auth.users) - password stored here
    const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
      email: email,
      password: password,
      email_confirm: true, // Auto-confirm email for test users
      user_metadata: {
        role: role,
        full_name: fullName
      }
    });

    if (authError) {
      throw authError;
    }

    // Create user record in custom users table (for additional details, no password)
    const { data: user, error: userError } = await supabase
      .from('users')
      .insert({
        id: authUser.user.id, // Link to auth user
        username: email,
        role: role,
        status: status
      })
      .select()
      .single();

    if (userError) {
      // Try to clean up auth user if user table insert fails
      try {
        await supabase.auth.admin.deleteUser(authUser.user.id);
      } catch (cleanupError) {
        console.error('Failed to cleanup auth user:', cleanupError);
      }
      throw userError;
    }

    // Create technician record if role is TECHNICIAN
    let technician = null;
    if (role === 'TECHNICIAN') {
      const { data: tech, error: techError } = await supabase
        .from('technicians')
        .insert({
          user_id: user.id,
          email: email,
          full_name: fullName,
          phone_number: phoneNumber,
          status: status
        })
        .select()
        .single();

      if (techError) {
        console.error('Warning: User created but technician record failed:', techError);
      } else {
        technician = tech;
      }
    }

    return res.status(201).json({
      success: true,
      message: 'Test user created successfully',
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        status: user.status
      },
      technician: technician ? {
        id: technician.id,
        email: technician.email,
        full_name: technician.full_name
      } : null,
      credentials: {
        email: email,
        password: password,
        loginUrl: '/sign-in'
      }
    });

  } catch (error) {
    console.error('Error creating test user:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to create test user',
      error: error.message
    });
  }
}

