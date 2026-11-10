import { defineMachine } from '@/lib/state-machine/machine';

/**
 * The share link and the library publication of a team: two independent flags on `teams`, each a two-state machine.
 * Neither touches the roster, so the roster locks (`team.roster`) do not apply and the
 * `teams_completed_match_lock` trigger lets both through.
 *
 * Client-safe.
 */

const SHARE_ROUTE = 'src/app/api/teams/share/route.ts';
const LIBRARY_ROUTE = 'src/app/api/teams/library/route.ts';
const QUERIES = 'src/lib/supabase/queries/teams.ts';

export type TeamShareState = 'off' | 'on';
export type TeamLibraryState = 'unpublished' | 'published';
export type TeamFlagActor = 'owner' | 'admin';

export const teamShareMachine = defineMachine({
  id: 'team.share',
  title: 'Team share link',
  storage: 'teams.share_token + teams.share_enabled_at (on = both set)',
  summary:
    'A secret link that shows the whole roster to anyone holding it (GET /api/teams/shared/[token], /teams/shared/[token]). The owner or a site admin turns it on, and every further POST rotates the token, so the previous link stops working. A link is served only while both columns are set; a row with only one of them reads as off. The token is the compare-and-set guard of the write: a POST whose row changed its token in between answers 409 team_changed. Disabling is idempotent and has no UI caller today.',
  doc: 'docs/teambuilder-reference.md',
  states: ['off', 'on'],
  initial: ['off'],
  terminal: [],
  actors: ['owner', 'admin'],
  transitions: [
    {
      event: 'enable',
      from: ['off'],
      to: 'on',
      actors: ['owner', 'admin'],
      writers: [SHARE_ROUTE, QUERIES],
      note: 'POST /api/teams/share: a fresh UUID token and share_enabled_at = now().',
    },
    {
      event: 'rotate',
      from: ['on'],
      to: 'on',
      actors: ['owner', 'admin'],
      writers: [SHARE_ROUTE, QUERIES],
      note: "The editor's Generate link button POSTs again: a new token replaces the old one.",
    },
    {
      event: 'disable',
      from: ['on', 'off'],
      to: 'off',
      actors: ['owner', 'admin'],
      writers: [SHARE_ROUTE, QUERIES],
      note: 'DELETE /api/teams/share clears both columns; on a row without a link it changes nothing and answers 200.',
    },
  ],
});

export const teamLibraryMachine = defineMachine({
  id: 'team.library',
  title: 'Team library publication',
  storage: 'teams.library_published_at (published = set) + library_title, library_description, library_tags',
  summary:
    'A team listed in the public library (/teams/library), forkable by anyone. The owner or a site admin publishes it, and publishing again rewrites the title, description and tags and moves it to the top (library_published_at = now()). The UPDATE is guarded with the library_published_at the route read, so a publish racing another publish or an unpublish answers 409 team_changed. Unpublishing is idempotent and has no UI caller today. Open product question: a team linked to a match that is not played yet (or in a hidden tournament) can be published; kept as is.',
  doc: 'docs/teambuilder-reference.md',
  states: ['unpublished', 'published'],
  initial: ['unpublished'],
  terminal: [],
  actors: ['owner', 'admin'],
  transitions: [
    {
      event: 'publish',
      from: ['unpublished'],
      to: 'published',
      actors: ['owner', 'admin'],
      writers: [LIBRARY_ROUTE, QUERIES],
    },
    {
      event: 'republish',
      from: ['published'],
      to: 'published',
      actors: ['owner', 'admin'],
      writers: [LIBRARY_ROUTE, QUERIES],
      note: 'Rewrites the metadata and the timestamp.',
    },
    {
      event: 'unpublish',
      from: ['published', 'unpublished'],
      to: 'unpublished',
      actors: ['owner', 'admin'],
      writers: [LIBRARY_ROUTE, QUERIES],
      note: 'DELETE /api/teams/library clears the timestamp and the metadata.',
    },
  ],
});

/** A link is served only while both columns are set (`getTeamByShareToken`). */
export function teamShareState(row: { share_token: string | null; share_enabled_at: string | null }): TeamShareState {
  return row.share_token && row.share_enabled_at ? 'on' : 'off';
}

export function teamLibraryState(row: { library_published_at: string | null | undefined }): TeamLibraryState {
  return row.library_published_at ? 'published' : 'unpublished';
}
