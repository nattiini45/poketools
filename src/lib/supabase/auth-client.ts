import 'server-only';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { requireEnv } from '@/lib/env';

// Server-side GoTrue client using the anon key. Stateless: never persists
// sessions — NextAuth's JWT remains the only session in this app.
// This is NOT the browser Realtime exception; this module must never be
// imported from client components.
//
// Factory (not singleton) so concurrent requests never share in-memory
// auth state.
export function createAuthClient(): SupabaseClient {
  return createClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    }
  );
}
