import { defineMachine } from '@/lib/state-machine/machine';
import type { CastSessionStatus } from '@/types/cast-session';

/**
 * `cast_sessions.status` (docs/state-machines.md, "Cast session"). A label on a
 * caster's Cast Studio session; no screen sets it today, only a PATCH that
 * names a status (`castSessionUpdateSchema.status`). The dashboard broadcast
 * page reuses the first session of a match that is not `archived`.
 */
export const castSessionMachine = defineMachine({
  id: 'cast_session',
  title: 'Cast session',
  storage: 'cast_sessions.status (CHECK cast_sessions_status_check)',
  summary:
    'The lifecycle label of a Cast Studio session. A session is created as draft; no screen moves the status today, only a PATCH /api/cast-sessions/[id] that names one, which is guarded with the current status (a status equal to the current one is not a move). The dashboard broadcast page links a match to its first session that is not archived. mode (cast, solo, replaycast) is a type tag picked at creation and edited in the studio, not a lifecycle: it has no machine.',
  doc: 'docs/cast-studio.md',
  states: ['draft', 'live', 'archived'] as const satisfies readonly CastSessionStatus[],
  initial: ['draft'],
  terminal: [],
  actors: ['owner', 'admin'],
  transitions: [
    {
      event: 'go_live',
      from: ['draft'],
      to: 'live',
      actors: ['owner', 'admin'],
      writers: ['src/app/api/cast-sessions/[id]/route.ts'],
      note: 'The cast starts.',
    },
    {
      event: 'end_live',
      from: ['live'],
      to: 'draft',
      actors: ['owner', 'admin'],
      writers: ['src/app/api/cast-sessions/[id]/route.ts'],
      note: 'The cast ends and the session stays in use.',
    },
    {
      event: 'archive',
      from: ['draft', 'live'],
      to: 'archived',
      actors: ['owner', 'admin'],
      writers: ['src/app/api/cast-sessions/[id]/route.ts'],
      note: 'The session is put away; the dashboard no longer reuses it for its match.',
    },
    {
      event: 'unarchive',
      from: ['archived'],
      to: 'draft',
      actors: ['owner', 'admin'],
      writers: ['src/app/api/cast-sessions/[id]/route.ts'],
      note: 'An archived session comes back as a draft; it goes live from there.',
    },
  ],
});
