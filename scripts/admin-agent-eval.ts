/**
 * Admin Assistant eval runner (plan 7.2). Plan stage: the real loop against a fixture world, with the real model or, for
 * the deterministic self-test, a replay of recorded model steps.
 *
 *   # offline self-test, no key, no network, no database
 *   npx tsx --tsconfig scripts/tsconfig.admin-agent-eval.json scripts/admin-agent-eval.ts --port replay
 *
 *   # live: needs ANTHROPIC_API_KEY (shell or .env.local; nothing else is read from an env file)
 *   npx tsx --tsconfig scripts/tsconfig.admin-agent-eval.json scripts/admin-agent-eval.ts --cases RO,SF --model claude-sonnet-5-5 --repeat 3
 *
 * The logic and the flag list live in `src/lib/ai/admin-agent/eval/cli.ts`; this file only sets the environment before any
 * module that builds the Supabase client is imported. It does not copy `scripts/agent-eval.ts`, which loads `.env.local` and
 * `.env` unconditionally. The tsconfig pins the public example format pack, so no private pack is ever loaded.
 */
(async () => {
  const { prepareEvalEnv, EvalHostError } = await import('../src/lib/ai/admin-agent/eval/host-guard');
  try {
    prepareEvalEnv(process.env);
  } catch (error) {
    console.error(error instanceof EvalHostError ? error.message : 'admin-agent eval: the environment could not be prepared');
    process.exit(2);
  }
  const { main } = await import('../src/lib/ai/admin-agent/eval/cli');
  process.exit(await main({ argv: process.argv.slice(2), env: process.env, io: { log: (line) => console.log(line), error: (line) => console.error(line) } }));
})().catch((error: unknown) => {
  console.error('admin-agent eval: failed', error instanceof Error ? error.name : 'unknown error');
  process.exit(2);
});
