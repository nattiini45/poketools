/**
 * Setup file of the `db` vitest project (`npm run test:db`). It runs before every local-stack suite and refuses to
 * continue unless the run can only reach a local stack: no suite file loads, so no query is sent anywhere else
 * (AGENTS.md "Automation never spends the Supabase quota").
 */
import { assertLoopbackUrl, ciAllowsLocalStack } from './local-stack';

if (!ciAllowsLocalStack()) {
  throw new Error('[local-stack] refusing to run on CI: set LOCAL_STACK_CI=1 only in a job that starts its own ephemeral stack');
}

assertLoopbackUrl(process.env.NEXT_PUBLIC_SUPABASE_URL, 'NEXT_PUBLIC_SUPABASE_URL');

// One switch opens every suite's own flag, and the draft suites' pair follows the shared one.
process.env.LOCAL_STACK = '1';
process.env.LOCAL_DB_URL ??= process.env.NEXT_PUBLIC_SUPABASE_URL;
process.env.LOCAL_DB_SERVICE_ROLE_KEY ??= process.env.SUPABASE_SERVICE_ROLE_KEY;
