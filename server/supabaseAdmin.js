import { createClient } from '@supabase/supabase-js';

/** Service-role Supabase client for server/cron use, or null if unconfigured. */
export function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}
