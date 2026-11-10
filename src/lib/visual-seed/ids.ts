/**
 * Every fixed id and timestamp the visual seed (`node scripts/visual/seed.mjs`) writes. Dependency-free on purpose: the
 * seed, its runner and the capture runner (through `scripts/visual/seed-ids.json`, kept equal by
 * `__tests__/ids.test.ts`) all read it.
 *
 * Rows the seed creates through a helper that mints its own id (games, battle stats, teams, picks, the format
 * definition, the phases an attach creates) carry no fixed id; everything a capture URL names is fixed here.
 * All ids are RFC 4122 version 4 shaped (`z.uuid()` accepts them), grouped by a recognisable prefix.
 */

export const VISUAL_SEED_IDS = {
  playerAria: '5eed0001-0000-4000-8000-000000000001',
  playerBram: '5eed0001-0000-4000-8000-000000000002',
  playerCleo: '5eed0001-0000-4000-8000-000000000003',
  playerDario: '5eed0001-0000-4000-8000-000000000004',
  playerElin: '5eed0001-0000-4000-8000-000000000005',
  playerFinn: '5eed0001-0000-4000-8000-000000000006',
  playerGreta: '5eed0001-0000-4000-8000-000000000007',
  playerHugo: '5eed0001-0000-4000-8000-000000000008',

  leagueSakura: '5eed0002-0000-4000-8000-000000000001',
  leagueEpb: '5eed0002-0000-4000-8000-000000000002',
  leagueMountain: '5eed0002-0000-4000-8000-000000000003',
  leagueClouds: '5eed0002-0000-4000-8000-000000000004',
  leagueCustom: '5eed0002-0000-4000-8000-000000000005',
  leagueDraft: '5eed0002-0000-4000-8000-000000000006',
  leagueArchived: '5eed0002-0000-4000-8000-000000000007',
  leagueTrashed: '5eed0002-0000-4000-8000-000000000008',
  leagueEpbBoard: '5eed0002-0000-4000-8000-000000000009',

  stageSakura: '5eed0003-0000-4000-8000-000000000001',
  stageEpb: '5eed0003-0000-4000-8000-000000000002',
  stageMountain: '5eed0003-0000-4000-8000-000000000003',
  stageClouds: '5eed0003-0000-4000-8000-000000000004',
  stageArchived: '5eed0003-0000-4000-8000-000000000007',
  stageTrashed: '5eed0003-0000-4000-8000-000000000008',
  tournamentStandalone: '5eed0003-0000-4000-8000-000000000009',

  roundSakura1: '5eed0004-0000-4000-8000-000000000011',
  roundSakura2: '5eed0004-0000-4000-8000-000000000012',
  roundSakura3: '5eed0004-0000-4000-8000-000000000013',
  roundEpb1: '5eed0004-0000-4000-8000-000000000021',
  roundMountain1: '5eed0004-0000-4000-8000-000000000031',
  roundClouds1: '5eed0004-0000-4000-8000-000000000041',
  roundArchived1: '5eed0004-0000-4000-8000-000000000071',
  roundTrashed1: '5eed0004-0000-4000-8000-000000000081',
  roundStandalone1: '5eed0004-0000-4000-8000-000000000091',

  matchCompletedBo3: '5eed0005-0000-4000-8000-000000000011',
  matchSakuraSweep: '5eed0005-0000-4000-8000-000000000012',
  matchSakuraDecider: '5eed0005-0000-4000-8000-000000000013',
  matchCompletedBo1: '5eed0005-0000-4000-8000-000000000014',
  matchSakuraBo1b: '5eed0005-0000-4000-8000-000000000015',
  matchSakuraBo1c: '5eed0005-0000-4000-8000-000000000016',
  matchLive: '5eed0005-0000-4000-8000-000000000017',
  matchScheduled: '5eed0005-0000-4000-8000-000000000018',
  matchEpbCompleted: '5eed0005-0000-4000-8000-000000000021',
  matchEpbCompleted2: '5eed0005-0000-4000-8000-000000000022',
  matchEpbScheduled: '5eed0005-0000-4000-8000-000000000023',
  matchMountain1: '5eed0005-0000-4000-8000-000000000031',
  matchMountain2: '5eed0005-0000-4000-8000-000000000032',
  matchMountain3: '5eed0005-0000-4000-8000-000000000033',
  matchClouds1: '5eed0005-0000-4000-8000-000000000041',
  matchClouds2: '5eed0005-0000-4000-8000-000000000042',
  matchClouds3: '5eed0005-0000-4000-8000-000000000043',
  matchArchived1: '5eed0005-0000-4000-8000-000000000071',
  matchArchived2: '5eed0005-0000-4000-8000-000000000072',
  matchTrashed1: '5eed0005-0000-4000-8000-000000000081',
  matchStandalone1: '5eed0005-0000-4000-8000-000000000091',
  matchStandalone2: '5eed0005-0000-4000-8000-000000000092',
  matchStandalone3: '5eed0005-0000-4000-8000-000000000093',

  draftPool: '5eed0006-0000-4000-8000-000000000001',
  draftPoolEpbBoard: '5eed0006-0000-4000-8000-000000000002',
  castSessionSolo: '5eed0007-0000-4000-8000-000000000001',
  pointBuyList: '5eed0008-0000-4000-8000-000000000001',
  soloGame1: '5eed0009-0000-4000-8000-000000000001',
  soloGame2: '5eed0009-0000-4000-8000-000000000002',
  soloGame3: '5eed0009-0000-4000-8000-000000000003',
} as const;

export type VisualSeedIdKey = keyof typeof VISUAL_SEED_IDS;

/** Slug of the format definition the custom league attaches (a fork of the shipped `classic-league` example). */
export const VISUAL_SEED_FORMAT_SLUG = 'visual-seed-classic-league';

/**
 * The dates the seed writes (October 2026, UTC). Nothing the seed decides is derived from the clock; columns a helper
 * or the database stamps with `now()` on its own (ratings, audit rows, aggregate jobs, the recycle bin's purge date)
 * keep the time of the run.
 */
export const VISUAL_SEED_DATES = {
  leagueStart: '2026-10-01',
  leagueEnd: '2026-10-31',
  firstMatch: '2026-10-03T18:00:00.000Z',
  scheduledMatch: '2026-10-24T18:00:00.000Z',
  soloSession: '2026-10-20T19:30:00.000Z',
  draftStart: '2026-10-02T17:00:00.000Z',
} as const;

/** Played-at timestamp of the `index`-th played match: one day after another from `firstMatch`. */
export function matchPlayedAt(index: number): string {
  return new Date(Date.parse(VISUAL_SEED_DATES.firstMatch) + index * 24 * 60 * 60 * 1000).toISOString();
}
