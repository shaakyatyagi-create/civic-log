const { createClient } = require('@supabase/supabase-js');
const WebSocket = require('ws');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.warn('[supabase] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — backend cannot read/write the database until these are configured.');
}

const supabase = url && key
  ? createClient(url, key, { auth: { persistSession: false }, realtime: { transport: WebSocket } })
  : null;

function requireSupabase() {
  if (!supabase) {
    const err = new Error('Supabase is not configured (missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).');
    err.status = 503;
    throw err;
  }
  return supabase;
}

module.exports = { supabase, requireSupabase };
