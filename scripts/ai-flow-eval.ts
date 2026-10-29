/**
 * Eval of the non-admin Claude text flows: Kale round recap and forecast, post-match analysis,
 * match-prep scouting, the two teambuilder coaches and the weekly recap narrative. Opt-in: it is
 * never part of `npm run test`, and a live run spends money, capped by --max-cost-usd.
 *
 *   # offline: render every prompt and estimate the cost, no key, no network
 *   npm run eval:ai-flows -- --dry-run
 *
 *   # live: needs ANTHROPIC_API_KEY (shell, or an env file named with --env-file; nothing else is read from it)
 *   npm run eval:ai-flows -- --repeat 2 --max-cost-usd 4 --env-file ../.env.local
 *
 *   # rebuild the synthetic fixtures through the app's own context builders (offline)
 *   npm run eval:ai-flows:fixtures
 *
 * The logic and the flag list live in `src/lib/ai/flow-eval/cli.ts`. This file only installs the egress
 * guard (a live run may reach api.anthropic.com and nothing else: no database, no other host) and hands
 * over. Fixtures are synthetic (`scripts/eval-fixtures/ai-flows/`); anything derived from real data
 * belongs under the gitignored `.internal/evals/ai-flows/fixtures/` and is read only with `--fixtures internal|both`.
 */
(async () => {
  const argv = process.argv.slice(2);
  const { installEgressGuard, main } = await import('../src/lib/ai/flow-eval/cli');
  const offline = argv.some((arg) => arg === '--dry-run' || arg === '--list' || arg === '--help' || arg === '-h');
  if (!offline) installEgressGuard();
  const io = { log: (line: string) => console.log(line), error: (line: string) => console.error(line) };
  process.exit(await main({ argv, env: process.env, io, root: process.cwd() }));
})().catch((error: unknown) => {
  // The name only: an error message can carry a request detail.
  console.error('ai-flow eval: failed', error instanceof Error ? error.name : 'unknown error');
  if (process.env.AI_FLOW_EVAL_DEBUG === '1' && error instanceof Error) console.error(error.stack ?? error.message);
  process.exit(2);
});
