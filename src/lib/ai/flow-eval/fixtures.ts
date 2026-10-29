/**
 * Fixture loading of the AI flow eval.
 *
 * Two places, one file per flow in each:
 * - `scripts/eval-fixtures/ai-flows/<flow>.json`: synthetic, hand-authored, committed. Built by
 *   `npm run eval:ai-flows:fixtures` from the synthetic worlds in `flow-eval/synthetic/`.
 * - `.internal/evals/ai-flows/fixtures/<flow>.json`: anything derived from real data. Gitignored
 *   (the repository is public), never committed; the eval reads it only with `--fixtures internal|both`.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { FLOW_IDS, type AnyCase, type CaseByFlow, type FixtureFile, type FlowId } from './types';

export const SYNTHETIC_FIXTURE_DIR = path.join('scripts', 'eval-fixtures', 'ai-flows');
export const INTERNAL_FIXTURE_DIR = path.join('.internal', 'evals', 'ai-flows', 'fixtures');

export type FixtureSource = 'synthetic' | 'internal' | 'both';

const base = { id: z.string().min(1), label: z.string().min(1), locale: z.enum(['en', 'de']) };
const nonEmpty = z.string().min(1);

const coachSet = z.object({
  name: z.string().nullish(),
  species: z.string().nullish(),
  item: z.string().nullish(),
  ability: z.string().nullish(),
  nature: z.string().nullish(),
  tera_type: z.string().nullish(),
  moves: z.array(z.string()).nullish(),
  evs: z.record(z.string(), z.number()).nullish(),
});

const matchResult = z.object({
  player1_name: z.string(),
  player2_name: z.string(),
  winner_name: z.string(),
  score: z.string(),
}).passthrough();

const SCHEMAS: { [F in FlowId]: z.ZodType<CaseByFlow[F]> } = {
  'kale-recap': z.object({
    ...base,
    factPack: z.object({ matches: z.array(z.object({}).passthrough()).min(1), validPlayerNames: z.array(z.string()), currentStandings: z.array(z.object({}).passthrough()) }).passthrough(),
  }).passthrough() as unknown as z.ZodType<CaseByFlow['kale-recap']>,
  'kale-forecast': z.object({
    ...base,
    factPack: z.object({ matchups: z.array(z.object({}).passthrough()).min(1), validPlayerNames: z.array(z.string()), currentStandings: z.array(z.object({}).passthrough()) }).passthrough(),
  }).passthrough() as unknown as z.ZodType<CaseByFlow['kale-forecast']>,
  'match-analysis': z.object({
    ...base,
    systemPrompt: nonEmpty,
    userPrompt: nonEmpty,
    expect: z.object({
      player1: nonEmpty,
      player2: nonEmpty,
      matchWinner: nonEmpty,
      games: z.array(z.object({ gameNumber: z.number().int(), winner: nonEmpty })).min(1),
      hasLeagueConstraint: z.boolean(),
      gen: z.number().int().min(1).max(9),
    }),
  }),
  scouting: z.object({
    ...base,
    systemPrompt: nonEmpty,
    userPrompt: nonEmpty,
    hasUserTeam: z.boolean(),
    expect: z.object({
      opponent: nonEmpty,
      opponentSpecies: z.array(z.string()),
      userGymType: z.string().nullable(),
      gen: z.number().int().min(1).max(9),
    }),
  }),
  'team-coach': z.object({ ...base, team: z.array(coachSet).min(1).max(6), format: nonEmpty, generation: z.number().int() }) as unknown as z.ZodType<CaseByFlow['team-coach']>,
  'slot-coach': z.object({ ...base, set: coachSet, team: z.array(coachSet), format: nonEmpty, generation: z.number().int() }) as unknown as z.ZodType<CaseByFlow['slot-coach']>,
  recap: z.object({
    ...base,
    input: z.object({
      leagueName: nonEmpty,
      tournamentName: nonEmpty,
      roundName: nonEmpty,
      roundNumber: z.number().int(),
      results: z.array(matchResult).min(1),
      headlineMatch: matchResult.nullable(),
    }),
  }) as unknown as z.ZodType<CaseByFlow['recap']>,
};

export class FixtureError extends Error {}

/** Parse and validate the text of one fixture file. */
export function parseFixtureFile(flow: FlowId, text: string, origin: string): FixtureFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new FixtureError(`${origin}: not valid JSON`);
  }
  const file = raw as Partial<FixtureFile>;
  if (!file || file.schemaVersion !== 1 || file.flow !== flow || !Array.isArray(file.cases) || typeof file.synthetic !== 'boolean') {
    throw new FixtureError(`${origin}: expected { schemaVersion: 1, flow: "${flow}", synthetic, cases: [] }`);
  }
  const seen = new Set<string>();
  const cases = file.cases.map((c, i) => {
    const parsed = SCHEMAS[flow].safeParse(c);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new FixtureError(`${origin}: case ${i} is invalid at ${issue.path.join('.') || '(root)'}: ${issue.message}`);
    }
    if (seen.has(parsed.data.id)) throw new FixtureError(`${origin}: duplicate case id ${parsed.data.id}`);
    seen.add(parsed.data.id);
    return parsed.data;
  });
  return { schemaVersion: 1, flow, synthetic: file.synthetic, cases } as FixtureFile;
}

export interface LoadedCase {
  flow: FlowId;
  case: AnyCase;
  /** `synthetic` or `internal`. */
  source: 'synthetic' | 'internal';
}

function readIfPresent(file: string): string | null {
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
}

/** All cases of the given flows, in flow order then file order. `root` is the repository root. */
export function loadCases(root: string, flows: readonly FlowId[], source: FixtureSource): LoadedCase[] {
  const out: LoadedCase[] = [];
  const dirs: { dir: string; source: 'synthetic' | 'internal' }[] = [];
  if (source !== 'internal') dirs.push({ dir: path.join(root, SYNTHETIC_FIXTURE_DIR), source: 'synthetic' });
  if (source !== 'synthetic') dirs.push({ dir: path.join(root, INTERNAL_FIXTURE_DIR), source: 'internal' });
  for (const flow of FLOW_IDS) {
    if (!flows.includes(flow)) continue;
    for (const { dir, source: origin } of dirs) {
      const file = path.join(dir, `${flow}.json`);
      const text = readIfPresent(file);
      if (text === null) continue;
      const parsed = parseFixtureFile(flow, text, `${origin}/${flow}.json`);
      if (origin === 'synthetic' && !parsed.synthetic) {
        throw new FixtureError(`${origin}/${flow}.json: a committed fixture file must be marked synthetic`);
      }
      for (const c of parsed.cases) out.push({ flow, case: c, source: origin });
    }
  }
  return out;
}
