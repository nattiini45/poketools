/**
 * Admin Assistant eval runner (plan 7.2). Plan stage: the real loop against a fixture world, with the real model or, for
 * the deterministic self-test, a replay of recorded model steps. Exec and end-to-end stages: the same loop over the real store
 * and the real staged tools, approved through the real routes and executor on the LOCAL Supabase stack.
 *
 *   # offline self-test, no key, no network, no database
 *   npx tsx --tsconfig scripts/tsconfig.admin-agent-eval.json scripts/admin-agent-eval.ts --port replay
 *
 *   # live: needs ANTHROPIC_API_KEY (shell or .env.local; nothing else is read from an env file)
 *   npx tsx --tsconfig scripts/tsconfig.admin-agent-eval.json scripts/admin-agent-eval.ts --cases RO,SF --model claude-sonnet-5-5 --repeat 3
 *
 *   # local stack (npx supabase start; run `npx supabase db reset --local` before a full run): no model call
 *   npx tsx --tsconfig scripts/tsconfig.admin-agent-eval.json scripts/admin-agent-eval.ts --stage exec
 *
 *   # local stack with the live model, one case
 *   npx tsx --tsconfig scripts/tsconfig.admin-agent-eval.json scripts/admin-agent-eval.ts --stage e2e --cases TN1 --max-cost-usd 1
 *
 *   # with --judge a live run also asks Haiku 5.5 (low effort) about answer groups (those with an intent) whose phrases did not match; it is opt-in with --judge (live only)
 *
 * The logic and the flag list live in `src/lib/ai/admin-agent/eval/cli.ts`; this file only sets the environment before any
 * module that builds the Supabase client is imported. For `--stage exec|e2e` it reads the local stack's address and keys from
 * `npx supabase status -o json` (scripts/admin-agent-eval/stack-env.ts; never from an env file) and refuses any other host, and it
 * hands the CLI the local-stack harness (scripts/admin-agent-eval/stack.ts). It does not copy `scripts/agent-eval.ts`, which
 * loads `.env.local` and `.env` unconditionally. The tsconfig pins the public example format pack, so no private pack is ever
 * loaded, and maps the Discord and social senders and `next/cache` to recorders.
 */
(async () => {
  const { prepareEvalEnv, EvalHostError } = await import('../src/lib/ai/admin-agent/eval/host-guard');
  const argv = process.argv.slice(2);
  const stageAt = argv.indexOf('--stage');
  const stage = stageAt === -1 ? 'plan' : (argv[stageAt + 1] ?? 'plan');
  const onStack = stage === 'exec' || stage === 'e2e';
  const needsStack = onStack && !argv.includes('--help') && !argv.includes('-h') && !argv.includes('--list');
  try {
    if (needsStack) {
      const { prepareStackEnv } = await import('./admin-agent-eval/stack-env');
      prepareStackEnv(process.env);
    }
    prepareEvalEnv(process.env);
  } catch (error) {
    console.error(error instanceof EvalHostError ? error.message : 'admin-agent eval: the environment could not be prepared');
    process.exit(2);
  }
  const { main } = await import('../src/lib/ai/admin-agent/eval/cli');
  const io = { log: (line: string) => console.log(line), error: (line: string) => console.error(line) };
  const stack = onStack ? (await import('./admin-agent-eval/stack')).createStackHarness({ log: io.log }) : undefined;
  process.exit(await main({ argv, env: process.env, io, ...(stack ? { stack } : {}) }));
})().catch((error: unknown) => {
  console.error('admin-agent eval: failed', error instanceof Error ? error.name : 'unknown error');
  // The stack of an unexpected failure, only when asked for (it names files and tables, never a key).
  if (process.env.ADMIN_AGENT_EVAL_DEBUG === '1' && error instanceof Error) console.error(error.stack ?? error.message);
  process.exit(2);
});
