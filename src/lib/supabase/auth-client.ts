import 'server-only';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { readEnv, supabaseAuthEnvSchema } from '@/lib/env';
import { createTimeoutFetch } from '@/lib/supabase/timeout-fetch';

// Server-side GoTrue client using the anon key. Stateless: never persists
// sessions — NextAuth's JWT remains the only session in this app.
// This is NOT the browser Realtime exception; this module must never be
// imported from client components.
//
// Factory (not singleton) so concurrent requests never share in-memory
// auth state. Requests carry the same deadline as the service-role client.
export function createAuthClient(): SupabaseClient {
  const env = readEnv(supabaseAuthEnvSchema);
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: { fetch: createTimeoutFetch() },
  });
}
