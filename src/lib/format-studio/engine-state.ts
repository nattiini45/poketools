import { defineMachine } from '@/lib/state-machine/machine';

/**
 * `season_formats.engine`: which engine runs a league's attached format (docs/format-kit.md, "Format engine and runtime"). The only
 * writer of a change is `PUT /api/seasons/[id]/format/engine` through `setSeasonFormatEngine`, which guards its UPDATE
 * with the engine it read. The intended way in is legacy, then shadow (the admin diff), then kit, but every switch
 * stays allowed: nothing in code requires the diff to be clean. Client-safe.
 */
export const seasonFormatEngineMachine = defineMachine({
  id: 'season_format_engine',
  title: 'Season format engine',
  storage: 'season_formats.engine',
  summary:
    "The engine of a league's attached format. A first attach inserts the row with the column default kit; a replace keeps the engine; a detach deletes the row, so a detach and a new attach start again at kit. SQL knows only kit or not kit: shadow and legacy are the same to the database. Switching to kit makes the cron replay the league's finished matches; switching away stops new reactions and leaves open challenges open.",
  doc: 'docs/format-kit.md',
  states: ['legacy', 'shadow', 'kit'],
  initial: ['kit'],
  terminal: [],
  actors: ['admin'],
  transitions: [
    {
      event: 'use_legacy',
      from: ['shadow', 'kit'],
      to: 'legacy',
      actors: ['admin'],
      writers: ['src/app/api/seasons/[id]/format/engine/route.ts', 'src/lib/supabase/queries/season-formats.ts'],
    },
    {
      event: 'use_shadow',
      from: ['legacy', 'kit'],
      to: 'shadow',
      actors: ['admin'],
      writers: ['src/app/api/seasons/[id]/format/engine/route.ts', 'src/lib/supabase/queries/season-formats.ts'],
      note: 'Legacy tables stay in charge; the kit is computed alongside for the admin diff.',
    },
    {
      event: 'use_kit',
      from: ['legacy', 'shadow'],
      to: 'kit',
      actors: ['admin'],
      writers: ['src/app/api/seasons/[id]/format/engine/route.ts', 'src/lib/supabase/queries/season-formats.ts'],
      note: 'The docs advise going through shadow first; legacy to kit directly stays allowed.',
    },
  ],
});

export type SeasonFormatEngineState = (typeof seasonFormatEngineMachine.spec.states)[number];
