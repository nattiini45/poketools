import { defineMachine } from '@/lib/state-machine/machine';

/** Reports on a wiki note (docs/state-machines.md, "Wiki note report"). Client-safe. */
export const noteReportMachine = defineMachine({
  id: 'wiki_note_report.status',
  title: 'Wiki note report',
  storage: 'wiki_note_reports.status',
  summary:
    'A player report on a live note. A moderator closes an open report as reviewed or dismissed, compare-and-set against the status read, so two moderators cannot close one report two ways; repeating the same close is allowed. Reporting the same note again reopens the reporter\'s report (UPSERT on note_id, reporter_id).',
  doc: 'docs/wiki.md',
  states: ['open', 'reviewed', 'dismissed'],
  initial: ['open'],
  terminal: [],
  actors: ['reporter', 'admin'],
  transitions: [
    {
      event: 'report',
      from: ['open', 'reviewed', 'dismissed'],
      to: 'open',
      actors: ['reporter'],
      writers: ['src/app/api/wiki/notes/[id]/report/route.ts', 'src/lib/supabase/queries/wiki-notes.ts'],
      note: 'The reporter reports the note again: the report reopens with the new reason.',
    },
    {
      event: 'review',
      from: ['open', 'reviewed'],
      to: 'reviewed',
      actors: ['admin'],
      writers: ['src/app/api/admin/wiki/reports/[id]/route.ts', 'src/lib/supabase/queries/wiki-notes.ts'],
      note: 'The moderator acted on the report (for example unpublished the note).',
    },
    {
      event: 'dismiss',
      from: ['open', 'dismissed'],
      to: 'dismissed',
      actors: ['admin'],
      writers: ['src/app/api/admin/wiki/reports/[id]/route.ts', 'src/lib/supabase/queries/wiki-notes.ts'],
    },
  ],
});
