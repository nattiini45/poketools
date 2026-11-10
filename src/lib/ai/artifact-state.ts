import { defineMachine } from '@/lib/state-machine/machine';

/**
 * The lifecycle shared by the stored AI artifacts: post-match analyses (`match_analyses`), scouting reports
 * (`match_prep_analyses`) and round recaps / forecasts (`tournament_reports`). `absent` is "no row". Every
 * generation is delete-then-insert, so a row only ever moves pending → completed | failed, and only while it is still
 * pending: `settleAiArtifact` (`src/lib/supabase/queries/ai-artifacts.ts`) is the one writer of that move.
 * Client-safe.
 */
const ROUTES = [
  'src/app/api/ai/match-analysis/route.ts',
  'src/app/api/ai/match-prep-analysis/route.ts',
  'src/app/api/ai/tournament-report/route.ts',
  'src/app/api/ai/agent/analyze-match/route.ts',
  'src/lib/ai/tournament-report-generator.ts',
];

export const aiArtifactMachine = defineMachine({
  id: 'ai_artifact.status',
  title: 'AI artifact',
  storage: 'match_analyses.status, match_prep_analyses.status, tournament_reports.status (absent = no row)',
  summary:
    'A stored AI generation from request to result. A request inserts a pending row (absent → pending), the generation settles it as completed or failed with UPDATE … WHERE id AND status = \'pending\' and a row-count check, and a pending row older than AI_ANALYSIS_STALE_MS is failed by the next request. Regenerating (force, retry after a failure) and a result change on the match delete the row first. A settle that matches no row (the row was deleted or replaced meanwhile) writes nothing and is logged.',
  doc: 'docs/ai.md',
  states: ['absent', 'pending', 'completed', 'failed'],
  initial: ['absent'],
  terminal: [],
  actors: ['player', 'admin', 'system'],
  transitions: [
    {
      event: 'start',
      from: ['absent'],
      to: 'pending',
      actors: ['player', 'admin', 'system'],
      writers: [...ROUTES, 'src/lib/supabase/queries/match-analyses.ts', 'src/lib/supabase/queries/match-prep-analyses.ts', 'src/lib/supabase/queries/tournament-reports.ts'],
      note: 'A request (or the round trigger) inserts a pending row; the unique key allows one per scope.',
    },
    {
      event: 'complete',
      from: ['pending'],
      to: 'completed',
      actors: ['system'],
      writers: ['src/lib/supabase/queries/ai-artifacts.ts', ...ROUTES],
    },
    {
      event: 'fail',
      from: ['pending'],
      to: 'failed',
      actors: ['system'],
      writers: ['src/lib/supabase/queries/ai-artifacts.ts', ...ROUTES],
      note: 'The generation failed, or a request found the pending row older than AI_ANALYSIS_STALE_MS.',
    },
    {
      event: 'discard',
      from: ['pending', 'completed', 'failed'],
      to: 'absent',
      actors: ['player', 'admin', 'system'],
      writers: [...ROUTES, 'src/lib/match/reopen.ts', 'src/lib/pkmn/game-pipeline.ts'],
      note: 'Regenerate (force, retry after failure, stale pending) deletes the row before the new insert; a match reset or result change deletes its analyses.',
    },
  ],
});

export type AiArtifactState = (typeof aiArtifactMachine.spec.states)[number];
