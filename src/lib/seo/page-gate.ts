import { isUnknownWikiDetailName } from '@/lib/broadcast/wiki-overlay-lookup';
import { isValidUuid } from '@/lib/utils/uuid';
import type { ShareLimitMark } from './share-limit-marker';

/**
 * Real 404 statuses for public pages whose subject does not exist. The root `loading.tsx` commits a 200 before a
 * page's `notFound()` runs, so a missing league, player, species or dead share link would answer 200 with the
 * not-found UI (and `noindex`). The proxy asks this gate first and rewrites to the not-found page with a 404
 * (`src/proxy.ts`); the pages still call `notFound()` for the rare race where the row changes between the two reads,
 * and for a failed read here.
 *
 * The gate is the rule, not a list of exceptions: `pageSubjectCoverage` maps every public dynamic route to the
 * lookup that decides its subject, and `__tests__/page-gate-coverage.test.ts` walks the app tree so a new page that
 * can call `notFound()` fails the test until its route has a covering mechanism here, in the phase gate or in the
 * wiki name checks. A route's deeper segments are checked the same way when they name a subject of their own (a
 * player's team inside a league); subpaths that share the parent's subject get the parent check for free.
 *
 * Reads: a team page, a league, a league team, a player and a tournament cost one id-only query for a well-formed id
 * (a league or tournament hit is remembered for a minute); the tera, species and wiki names read a generated id list
 * and no database. Every other path reads nothing.
 *
 * A share link request spends the common `team-shared` allowance (60 per minute per IP, shared with
 * `GET /api/teams/shared/[token]` and the page) exactly once, here: a malformed or missing link is answered before the
 * page runs, so only the gate can count it. The verdict goes back to the proxy as `shareLimit`, which hands it to the
 * page (`share-limit-marker.ts`) so a live link is not charged twice. Past the allowance the gate reads nothing and the
 * page shows the rate-limited notice, so guessed tokens cannot spend unbounded queries.
 */

export interface PageLookups {
  shareLinkIsLive(token: string): Promise<boolean>;
  libraryEntryIsPublished(id: string): Promise<boolean>;
  leagueExists(id: string): Promise<boolean>;
  leagueTeamExists(leagueId: string, playerId: string): Promise<boolean>;
  tournamentExists(id: string): Promise<boolean>;
  playerExists(id: string): Promise<boolean>;
  teraTypeIsKnown(name: string): Promise<boolean>;
  /** Spends one hit of the caller's `team-shared` allowance for this request. */
  chargeShareLink(headers: Headers): Promise<ShareLimitMark>;
}

export interface PageGateResult {
  /** `'not_found'` when the page's subject is malformed or missing. */
  status: 'not_found' | null;
  /** Set when this call charged a share-link request; null when it charged nothing or the charge failed. */
  shareLimit: ShareLimitMark | null;
}

const TEAM_PAGE_PATH = /^\/(teams\/shared|teams\/library)\/([^/]+)\/?$/;
const LEAGUE_TEAM_PATH = /^\/leagues\/([^/]+)\/teams\/([^/]+)\/?$/;
const LEAGUE_PAGE_PATH = /^\/leagues\/([^/]+)(?:\/.*)?$/;
const TOURNAMENT_PAGE_PATH = /^\/tournaments\/([^/]+)(?:\/.*)?$/;
const PLAYER_PAGE_PATH = /^\/players\/([^/]+)\/?$/;
const TERA_PAGE_PATH = /^\/wiki\/tera\/([^/]+)\/?$/;
const PHASE_PAGE_PATH = /^\/leagues\/[^/]+\/phases(?:\/|$)|^\/(?:matches|tournaments\/[^/]+\/(?:stats|matches))(?:\/|$)|^\/admin\/tournaments\/[^/]+\/rounds\/?$/;
const PREVIEW_PAGE_PATH = /^\/(?:draft-preview|route-preview|ruleset-preview(?:\/surfaces)?|team-comparison-preview|ui-preview)\/?$/;
const WIKI_NAME_PAGE_PATH = /^\/(?:pokemon|wiki\/(?:moves|abilities|items))\/[^/]+\/?$/;
const BROADCAST_WIKI_PATH = /^\/broadcast\/wiki\/(?:moves|abilities|items|tera)\/[^/]+\/?$/;

/** Which mechanism guards a path's not-found verdict, and the subject it reads. `null`: the path is not gated. */
export type PageSubjectCoverage =
  | { kind: 'share' | 'library' | 'league' | 'tournament' | 'player'; id: string }
  | { kind: 'league-team'; leagueId: string; playerId: string }
  | { kind: 'tera'; name: string }
  | { kind: 'preview' }
  | { kind: 'phase' }
  | { kind: 'wiki-name' }
  | { kind: 'broadcast-wiki' };

/**
 * The route-to-mechanism map the coverage test enforces. A public page that can call `notFound()` must land on one of
 * these: the phase gate (`phase`), the wiki name checks (`wiki-name`, `broadcast-wiki`), a dev-only preview guard
 * (`preview`), or a subject this gate reads.
 */
export function pageSubjectCoverage(pathname: string): PageSubjectCoverage | null {
  if (PHASE_PAGE_PATH.test(pathname)) return { kind: 'phase' };
  if (BROADCAST_WIKI_PATH.test(pathname)) return { kind: 'broadcast-wiki' };
  if (WIKI_NAME_PAGE_PATH.test(pathname)) return { kind: 'wiki-name' };
  if (PREVIEW_PAGE_PATH.test(pathname)) return { kind: 'preview' };

  const team = TEAM_PAGE_PATH.exec(pathname);
  if (team) return { kind: team[1] === 'teams/shared' ? 'share' : 'library', id: team[2] };

  const leagueTeam = LEAGUE_TEAM_PATH.exec(pathname);
  if (leagueTeam) return { kind: 'league-team', leagueId: leagueTeam[1], playerId: leagueTeam[2] };

  const league = LEAGUE_PAGE_PATH.exec(pathname);
  if (league) return { kind: 'league', id: league[1] };

  const tournament = TOURNAMENT_PAGE_PATH.exec(pathname);
  if (tournament) return { kind: 'tournament', id: tournament[1] };

  const player = PLAYER_PAGE_PATH.exec(pathname);
  if (player) return { kind: 'player', id: player[1] };

  const tera = TERA_PAGE_PATH.exec(pathname);
  if (tera) {
    let name: string | null;
    try {
      name = decodeURIComponent(tera[1]);
    } catch {
      name = null;
    }
    return name === null ? { kind: 'wiki-name' } : { kind: 'tera', name };
  }

  return null;
}

/** Same bucket, limit and window as `GET /api/teams/shared/[token]` and `loadSharedTeam`. */
export async function chargeShareLinkRequest(headers: Headers): Promise<ShareLimitMark> {
  const limits = await import('@/lib/utils/rate-limit');
  const result = await limits.checkPublicRateLimit('team-shared', { headers }, { limit: 60, windowSeconds: 60 });
  return result.allowed ? { allowed: true } : { allowed: false, retryAfterSeconds: result.retryAfterSeconds };
}

async function databaseLookups(): Promise<PageLookups> {
  // Loaded on demand: only a page that needs a read reaches the database client.
  const existence = await import('@/lib/supabase/queries/page-existence');
  const wiki = await import('@/lib/wiki/index-rows.server');
  return {
    ...existence,
    teraTypeIsKnown: async (name) => wiki.resolveWikiTeraType(name) !== null,
    chargeShareLink: chargeShareLinkRequest,
  };
}

async function subjectExists(subject: PageSubjectCoverage, reads: PageLookups): Promise<boolean | null> {
  switch (subject.kind) {
    case 'share':
      return reads.shareLinkIsLive(subject.id);
    case 'library':
      return reads.libraryEntryIsPublished(subject.id);
    case 'league':
      return reads.leagueExists(subject.id);
    case 'league-team':
      return reads.leagueTeamExists(subject.leagueId, subject.playerId);
    case 'tournament':
      return reads.tournamentExists(subject.id);
    case 'player':
      return reads.playerExists(subject.id);
    case 'tera':
      return reads.teraTypeIsKnown(subject.name);
    case 'preview':
      // Dev-only fixture pages: the page's own production guard is the not-found rule.
      return process.env.NODE_ENV === 'production' ? false : true;
    default:
      return null;
  }
}

/**
 * Whether `pathname` names a page whose subject is malformed or missing, and what the call charged. A failed read or
 * charge answers `null` status and logs the cause: the page decides (and charges for itself when nothing was charged
 * here).
 */
export async function pageGate(pathname: string, headers: Headers, lookups?: PageLookups): Promise<PageGateResult> {
  if (isUnknownWikiDetailName(pathname)) return { status: 'not_found', shareLimit: null };

  const subject = pageSubjectCoverage(pathname);
  if (!subject || subject.kind === 'phase' || subject.kind === 'broadcast-wiki' || subject.kind === 'wiki-name') {
    return { status: null, shareLimit: null };
  }

  if (subject.kind === 'preview' || subject.kind === 'tera') {
    try {
      const reads = lookups ?? (await databaseLookups());
      return { status: (await subjectExists(subject, reads)) ? null : 'not_found', shareLimit: null };
    } catch (error) {
      console.error('[page-gate] existence check failed; the page decides:', error);
      return { status: null, shareLimit: null };
    }
  }

  const ids = subject.kind === 'league-team' ? [subject.leagueId, subject.playerId] : [subject.id];
  let wellFormed: boolean;
  try {
    wellFormed = ids.every((id) => isValidUuid(decodeURIComponent(id)));
  } catch {
    wellFormed = false;
  }
  if (!wellFormed && subject.kind !== 'share') return { status: 'not_found', shareLimit: null };

  let shareLimit: ShareLimitMark | null = null;
  try {
    const reads = lookups ?? (await databaseLookups());

    if (subject.kind === 'share') {
      shareLimit = await reads.chargeShareLink(headers);
      if (!shareLimit.allowed) return { status: null, shareLimit };
      if (!wellFormed) return { status: 'not_found', shareLimit };
    }

    const found = await subjectExists(subject, reads);
    return { status: found ? null : 'not_found', shareLimit };
  } catch (error) {
    console.error('[page-gate] existence check failed; the page decides:', error);
    return { status: wellFormed ? null : 'not_found', shareLimit };
  }
}
