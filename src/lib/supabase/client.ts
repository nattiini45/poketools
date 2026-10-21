import 'server-only';

import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { readEnv, supabaseServerEnvSchema } from '@/lib/env';
import { createLogMeterSink, createMeteredFetch } from '@/lib/supabase/metering';
import { createTimeoutFetch } from '@/lib/supabase/timeout-fetch';

const env = readEnv(supabaseServerEnvSchema);

// Every request carries a deadline (timeout-fetch.ts: 10 s PostgREST/GoTrue,
// 30 s Storage). Dev-only request meter (DATA-PLAN §4): SUPABASE_METER=1
// outside production wraps the deadline fetch, so a timed-out request is
// still recorded (status 0).
const meterOn = process.env.SUPABASE_METER === '1' && process.env.NODE_ENV !== 'production';
const timedFetch = createTimeoutFetch();

// Server-side Supabase client using service role key.
// Bypasses RLS — all authorization is enforced in API routes.
// NEVER import this in client components.
export const supabase = createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  global: { fetch: meterOn ? createMeteredFetch(timedFetch, createLogMeterSink()) : timedFetch },
});
