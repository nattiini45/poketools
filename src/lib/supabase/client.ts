import 'server-only';

import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { requireEnv } from '@/lib/env';
import { createLogMeterSink, createMeteredFetch } from '@/lib/supabase/metering';

const supabaseUrl = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');

// Dev-only request meter (DATA-PLAN §4): SUPABASE_METER=1 outside production
// routes every request through the metered fetch. Anything else builds the
// client exactly as before, with no options.
const meterOn = process.env.SUPABASE_METER === '1' && process.env.NODE_ENV !== 'production';

// Server-side Supabase client using service role key.
// Bypasses RLS — all authorization is enforced in API routes.
// NEVER import this in client components.
export const supabase = meterOn
  ? createClient<Database>(supabaseUrl, serviceRoleKey, {
      global: { fetch: createMeteredFetch((input, init) => fetch(input, init), createLogMeterSink()) },
    })
  : createClient<Database>(supabaseUrl, serviceRoleKey);
