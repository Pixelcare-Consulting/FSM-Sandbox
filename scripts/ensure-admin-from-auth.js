/**
 * Link an existing Supabase Auth user to public.users (or create both).
 * Use after DB restore/duplicate when auth.users exists but users row is missing.
 *
 * Usage:
 *   node scripts/ensure-admin-from-auth.js --email pixelcaredev@gmail.com --role ADMIN
 *   node scripts/ensure-admin-from-auth.js --email admin@test.com --password secret --role ADMIN --create-auth
 */

try {
  const dotenv = require('dotenv');
  dotenv.config({ path: '.env.local' });
  dotenv.config({ path: '.env' });
} catch {
  // dotenv optional
}

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function parseArgs(argv) {
  const out = {
    email: null,
    password: null,
    role: 'ADMIN',
    name: null,
    createAuth: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--create-auth') {
      out.createAuth = true;
      continue;
    }
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) continue;
    if (key === 'email') out.email = value;
    else if (key === 'password') out.password = value;
    else if (key === 'role') out.role = value.toUpperCase();
    else if (key === 'name') out.name = value;
    i += 1;
  }
  return out;
}

async function findAuthUserByEmail(supabase, email) {
  let page = 1;
  const perPage = 200;
  while (page <= 20) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const match = data?.users?.find(
      (u) => String(u.email || '').toLowerCase() === email.toLowerCase()
    );
    if (match) return match;
    if (!data?.users?.length || data.users.length < perPage) break;
    page += 1;
  }
  return null;
}

async function main() {
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    console.error('❌ Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env');
    process.exit(1);
  }

  const args = parseArgs(process.argv.slice(2));
  if (!args.email) {
    console.error('Usage: node scripts/ensure-admin-from-auth.js --email you@example.com [--role ADMIN] [--create-auth --password secret]');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const email = args.email.trim().toLowerCase();
  let authUser = await findAuthUserByEmail(supabase, email);

  if (!authUser && args.createAuth) {
    if (!args.password) {
      console.error('❌ --create-auth requires --password');
      process.exit(1);
    }
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password: args.password,
      email_confirm: true,
      user_metadata: { role: args.role, full_name: args.name || email },
    });
    if (error) throw error;
    authUser = data.user;
    console.log(`✅ Created Supabase Auth user: ${authUser.id}`);
  }

  if (!authUser) {
    console.error(`❌ No Supabase Auth user for ${email}. Use --create-auth --password ... or sign up in Supabase Auth first.`);
    process.exit(1);
  }

  const { data: byId } = await supabase
    .from('users')
    .select('id, username, role, status, deleted_at')
    .eq('id', authUser.id)
    .maybeSingle();

  if (byId && !byId.deleted_at) {
    if (byId.role !== args.role || byId.status !== 'ACTIVE') {
      const { error: updateError } = await supabase
        .from('users')
        .update({ role: args.role, status: 'ACTIVE', username: email, updated_at: new Date().toISOString() })
        .eq('id', authUser.id);
      if (updateError) throw updateError;
      console.log(`✅ Updated existing users row → role=${args.role}, status=ACTIVE`);
    } else {
      console.log(`✅ users row already exists for ${email} (role=${byId.role})`);
    }
    return;
  }

  const { data: byUsername } = await supabase
    .from('users')
    .select('id, username, role, status, deleted_at')
    .eq('username', email)
    .maybeSingle();

  if (byUsername && !byUsername.deleted_at && byUsername.id !== authUser.id) {
    console.error(
      `❌ users.username=${email} exists with id ${byUsername.id} but auth id is ${authUser.id}.`,
      'Rename or delete the stale users row, then re-run this script.'
    );
    process.exit(1);
  }

  const { data: inserted, error: insertError } = await supabase
    .from('users')
    .insert({
      id: authUser.id,
      username: email,
      role: args.role,
      status: 'ACTIVE',
    })
    .select('id, username, role, status')
    .single();

  if (insertError) throw insertError;

  console.log('✅ Linked Auth user to public.users');
  console.log(JSON.stringify(inserted, null, 2));
  console.log(`\nYou can sign in with ${email} using your existing Supabase Auth password.`);
}

main().catch((err) => {
  console.error('❌', err.message || err);
  process.exit(1);
});
