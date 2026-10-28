/**
 * Prepares the process environment of an `exec` or `e2e` run (plan 7.2 "Local stack"): the Supabase address and the service-role
 * key come from `npx supabase status -o json` of THIS checkout's local stack, never from an env file, and the run is refused
 * unless the address is this machine. The environment must be set before any module that builds the Supabase client is imported
 * (the route modules and the store use the singleton client built from it at import), which is why the entry calls this first.
 *
 * The command is a constant string and nothing the user typed reaches the shell. The key is parsed and put into `process.env`;
 * it is never printed.
 */
import { spawnSync } from 'node:child_process';
import { applyStackEnv, EvalHostError, parseLocalStackStatus } from '../../src/lib/ai/admin-agent/eval/host-guard';

const STATUS_COMMAND = 'npx supabase status -o json';

function readStatusText(): string {
  // `npx` is a .cmd shim on Windows, which `spawn` cannot start without a shell; the command is fixed.
  const result = spawnSync(STATUS_COMMAND, { shell: true, encoding: 'utf8', timeout: 90_000, windowsHide: true });
  if (result.error || typeof result.stdout !== 'string' || result.stdout.trim() === '') {
    throw new EvalHostError('admin-agent eval: could not run `npx supabase status` (is the local stack running? `npx supabase start`).');
  }
  return result.stdout;
}

/** Reads the local stack's status and applies the stack environment. Throws `EvalHostError` (a message with no value in it). */
export function prepareStackEnv(env: Record<string, string | undefined>): string[] {
  return applyStackEnv(env, parseLocalStackStatus(readStatusText()));
}
