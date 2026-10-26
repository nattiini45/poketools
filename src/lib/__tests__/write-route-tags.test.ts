/**
 * D37 freshness, write routes without a `revalidatePath`: every write handler
 * of the tournament, league and draft routes expires the public read-cache
 * tags it changes, right after the write.
 *
 * Why: `unstable_cache` serves an entry past its TTL once more, whatever its
 * age, and refreshes it in the background. A write that expires no tag (a
 * pairing, a bracket, a status, a participant, a draft pick) reaches the first
 * viewer after an idle spell only on their second view.
 *
 * Two proofs:
 * - a source walk: each exported POST/PUT/PATCH/DELETE handler in the route
 *   trees below calls one of the expiry helpers of `src/lib/revalidation.ts`
 *   (or is listed in `EXEMPT` with its reason);
 * - the tag sets: what each helper expires, so the tournament, league and
 *   draft reads of `src/lib/cache/public-reads.ts` are all reached.
 * The route tests next to each handler check the call on the success path.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock('@/lib/supabase/queries/tournaments', () => ({ getTournamentById: vi.fn() }));

import { revalidateTag } from 'next/cache';
import {
  EXPIRE_NOW,
  draftWriteTags,
  expireDraftReads,
  expireFormatLibraryReads,
  expireSeasonReads,
  expireTournamentReads,
  publicTags,
  seasonWriteTags,
  tournamentWriteTags,
} from '../revalidation';

const API_DIR = path.resolve(__dirname, '../../app/api');

/**
 * Route trees (relative to `src/app/api`) whose every write handler expires tags. `formats` is the format
 * library: its writes expire the `format-library` tag.
 */
const TREES = ['tournaments/[id]', 'seasons', 'drafts/[id]', 'formats'];

/** Single routes outside those trees with the same duty (tournament and draft creation, round pairings). */
const EXTRA_ROUTES = ['tournaments/route.ts', 'generate-round/[tid]/route.ts', 'drafts/route.ts'];

/** A call that expires public read-cache tags (directly or through a match pass). */
const EXPIRE_CALL =
  /\b(expireTournamentReads|expireSeasonReads|expireDraftReads|expireFormatLibraryReads|expirePublicTags|revalidateMatchPages|revalidatePublicPath)\(/;

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Write handlers that change nothing a cached public read shows. Key:
 * `<route file relative to src/app/api>#<METHOD>`. Each needs its reason.
 */
const EXEMPT: Record<string, string> = {
  'drafts/[id]/replay-events/route.ts#POST':
    'appends a draft replay event for the replay viewer; no cached public read includes replay events',
  'seasons/[id]/redraft/route.ts#POST':
    'retired endpoint answering 410 (free swaps and trades both retired); writes nothing',
  // pick-screen routes
  'drafts/[id]/extensions/route.ts#POST':
    'extends the active pick deadline; deadlines are read only from the uncached state poll',
  'drafts/[id]/favorites/route.ts#PUT':
    'stores a per-viewer favourite line; no cached public read includes favourites',
  // admin routes
  'drafts/[id]/pause/route.ts#POST':
    'pauses or resumes the pick clock; the pause state is read only from the uncached state poll',
  'drafts/[id]/participants/[playerId]/penalty/route.ts#POST':
    'changes a slow-draft penalty stage; only the uncached state poll shows it',
  // redraft routes
  'drafts/[id]/redraft/submission/route.ts#PUT':
    'stores a SECRET redraft submission; nothing public changes until publish, and secrecy forbids touching public reads',
  'drafts/[id]/redraft/route.ts#PATCH':
    'edits the redraft deadline/order before publish; read only from the uncached state poll',
  // token routes
  'seasons/[id]/draft-tokens/route.ts#POST': 'retired endpoint answering 410; writes nothing',
  'seasons/[id]/kill-tokens/route.ts#POST': 'retired endpoint answering 410; writes nothing',
};

/**
 * The handlers the D37 correctness verifier named. The walk must find each
 * one, so a moved or renamed route cannot silently drop out of the check.
 */
const REQUIRED = [
  'tournaments/[id]/route.ts#PATCH',
  'tournaments/[id]/route.ts#DELETE',
  'tournaments/[id]/generate-bracket/route.ts#POST',
  'tournaments/[id]/generate-all-rounds/route.ts#POST',
  'tournaments/[id]/regenerate-bracket/route.ts#POST',
  'tournaments/[id]/repair-bracket/route.ts#POST',
  'tournaments/[id]/rounds/manual/route.ts#POST',
  'tournaments/[id]/rounds/[rid]/route.ts#PATCH',
  'tournaments/[id]/participants/route.ts#POST',
  'tournaments/[id]/participants/route.ts#PATCH',
  'tournaments/[id]/participants/route.ts#DELETE',
  'generate-round/[tid]/route.ts#POST',
  'seasons/route.ts#POST',
  'seasons/[id]/route.ts#PATCH',
  'seasons/[id]/route.ts#DELETE',
  'seasons/[id]/advance/route.ts#POST',
  'seasons/[id]/phases/route.ts#POST',
  'seasons/[id]/phases/reorder/route.ts#POST',
  'seasons/[id]/phases/[phaseId]/route.ts#PATCH',
  'seasons/[id]/phases/[phaseId]/route.ts#DELETE',
  'seasons/[id]/phases/[phaseId]/participants/route.ts#POST',
  'seasons/[id]/participants/route.ts#POST',
  'seasons/[id]/participants/route.ts#DELETE',
  'seasons/[id]/participants/substitute/route.ts#POST',
  'seasons/[id]/format-rules/route.ts#PUT',
  'seasons/[id]/progress/route.ts#POST',
  'seasons/[id]/evolution-points/recalculate/route.ts#POST',
  'seasons/[id]/redraft/phase/route.ts#PATCH',
  'drafts/route.ts#POST',
  'drafts/[id]/picks/route.ts#POST',
  'drafts/[id]/undo/route.ts#POST',
  'drafts/[id]/route.ts#PATCH',
  // admin routes
  'drafts/[id]/config/route.ts#PATCH',
  'drafts/[id]/start/route.ts#POST',
  'drafts/[id]/end/route.ts#POST',
  'drafts/[id]/picks/[pickId]/void/route.ts#POST',
  'drafts/[id]/picks/[pickId]/correct/route.ts#POST',
  // format library and the format of a league
  'formats/route.ts#POST',
  'formats/[id]/route.ts#PATCH',
  'formats/[id]/route.ts#DELETE',
  'formats/[id]/draft/route.ts#PUT',
  'formats/[id]/publish/route.ts#POST',
  'formats/[id]/fork/route.ts#POST',
  'formats/presets/[presetId]/fork/route.ts#POST',
  'seasons/[id]/format/route.ts#POST',
  'seasons/[id]/format/route.ts#DELETE',
  // redraft routes
  'drafts/[id]/redraft/publish/route.ts#POST',
  'drafts/[id]/redraft/slots/[redraftSlotId]/restore/route.ts#POST',
  // token routes
  'seasons/[id]/draft-kill-tokens/route.ts#POST',
  'seasons/[id]/comeback-tokens/spend/route.ts#POST',
  'seasons/[id]/comeback-tokens/open/route.ts#POST',
];

function routeFilesUnder(relDir: string): string[] {
  const abs = path.join(API_DIR, relDir);
  const found: string[] = [];
  for (const entry of readdirSync(abs)) {
    if (entry === '__tests__') continue;
    const child = path.join(abs, entry);
    if (statSync(child).isDirectory()) {
      found.push(...routeFilesUnder(path.join(relDir, entry)));
    } else if (entry === 'route.ts') {
      found.push(path.join(relDir, entry));
    }
  }
  return found;
}

const toKeyPath = (rel: string) => rel.split(path.sep).join('/');

/** Exported HTTP write handlers of a route module: METHOD → handler source. */
function writeHandlers(source: string): Map<string, string> {
  const starts = [
    ...source.matchAll(/^(?:export\s+)?(?:async\s+)?(?:function\s+(\w+)|const\s+(\w+)\s*=)/gm),
  ];
  const handlers = new Map<string, string>();
  starts.forEach((match, i) => {
    const name = match[1] ?? match[2];
    if (!match[0].startsWith('export') || !WRITE_METHODS.has(name)) return;
    const end = starts[i + 1]?.index ?? source.length;
    handlers.set(name, source.slice(match.index, end));
  });
  return handlers;
}

const ROUTES = [...TREES.flatMap(routeFilesUnder), ...EXTRA_ROUTES].map(toKeyPath);

const HANDLERS = ROUTES.flatMap((rel) => {
  const source = readFileSync(path.join(API_DIR, rel), 'utf8');
  return [...writeHandlers(source)].map(([method, body]) => ({ key: `${rel}#${method}`, body }));
});

// Walks the source tree: under a loaded full suite or a cold clone the walk can pass the
// 5 s default (engine-r3-contract.test.ts uses the same bound).
const FILE_WALK_TIMEOUT_MS = 30_000;

describe('route walk: every tournament, league and draft write expires public tags', { timeout: FILE_WALK_TIMEOUT_MS }, () => {
  it('finds every handler the verifier named', () => {
    const keys = new Set(HANDLERS.map((h) => h.key));
    expect(REQUIRED.filter((key) => !keys.has(key))).toEqual([]);
  });

  it('every exemption names an existing write handler and a reason', () => {
    const keys = new Set(HANDLERS.map((h) => h.key));
    for (const [key, reason] of Object.entries(EXEMPT)) {
      expect(keys.has(key), `${key} is exempt but no longer exists`).toBe(true);
      expect(reason.length).toBeGreaterThan(20);
    }
  });

  it.each(HANDLERS.filter((h) => !(h.key in EXEMPT)).map((h) => [h.key, h.body] as const))(
    '%s calls an expiry helper',
    (_key, body) => {
      expect(body).toMatch(EXPIRE_CALL);
    },
  );
});

describe('write tags: what each route helper expires', () => {
  it('a standalone tournament write: its reads, the list and the profiles', () => {
    expect(tournamentWriteTags('t1')).toEqual(['tournament:t1', 'tournaments', 'player-profiles']);
    expect(tournamentWriteTags('t1', null)).toEqual(tournamentWriteTags('t1'));
  });

  it('a league stage write also expires the league and the season list', () => {
    expect(tournamentWriteTags('t1', 's1')).toEqual([
      publicTags.tournament('t1'),
      publicTags.tournaments,
      publicTags.playerProfiles,
      publicTags.season('s1'),
      publicTags.seasons,
    ]);
  });

  it('a league write expires the league, both lists, the profiles and the phases it names', () => {
    expect(seasonWriteTags('s1')).toEqual(['season:s1', 'seasons', 'tournaments', 'player-profiles']);
    expect(seasonWriteTags('s1', ['p1', 'p2'])).toEqual([
      'season:s1',
      'seasons',
      'tournaments',
      'player-profiles',
      'tournament:p1',
      'tournament:p2',
    ]);
  });

  it('a draft write expires its league only', () => {
    expect(draftWriteTags('s1')).toEqual(['season:s1']);
  });

  it('a format library write expires the format-library tag, immediately', () => {
    vi.mocked(revalidateTag).mockClear();
    expireFormatLibraryReads();

    expect(vi.mocked(revalidateTag).mock.calls).toEqual([[publicTags.formatLibrary, EXPIRE_NOW]]);
    expect(publicTags.formatLibrary).toBe('format-library');
  });

  it('the expire helpers expire exactly those tags, immediately', () => {
    vi.mocked(revalidateTag).mockClear();
    expireTournamentReads('t1', 's1');
    expireSeasonReads('s2', ['p9']);
    expireDraftReads('s3');

    const calls = vi.mocked(revalidateTag).mock.calls;
    expect(calls.map(([tag]) => tag)).toEqual([
      ...tournamentWriteTags('t1', 's1'),
      ...seasonWriteTags('s2', ['p9']),
      ...draftWriteTags('s3'),
    ]);
    for (const [, profile] of calls) expect(profile).toEqual(EXPIRE_NOW);
  });
});
