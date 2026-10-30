/**
 * Rebuilds the synthetic fixtures of the AI flow eval (scripts/eval-fixtures/ai-flows/*.json).
 *
 * The match-analysis and scouting prompts are rendered by the app's own context builders
 * (`buildMatchAnalysisPrompt`, `buildMatchPrepPrompt`) from hand-authored synthetic data, with the
 * database layer replaced by an in-memory world, so this runs offline: no database, no key, no
 * network. The work is done by a Vitest file that writes the fixtures only when AI_FLOW_EVAL_WRITE=1;
 * a plain `npm test` runs the same file as a smoke test and writes nothing.
 *
 *   npm run eval:ai-flows:fixtures
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const vitest = require.resolve('vitest/vitest.mjs');
const result = spawnSync(
  process.execPath,
  [vitest, 'run', '--project', 'app', 'src/lib/ai/flow-eval/__tests__/build-fixtures.test.ts'],
  { stdio: 'inherit', env: { ...process.env, AI_FLOW_EVAL_WRITE: '1' } },
);
process.exit(result.status ?? 1);
