import { describe, expect, it } from 'vitest';
import { rejectInvalidPathId, type InvalidPathIdCode } from '@/lib/api/invalid-path-id';
import { errorsBroadcast } from '@/i18n/messages/errors/broadcast';
import { errorsDraft } from '@/i18n/messages/errors/draft';
import { errorsDraftLegacy } from '@/i18n/messages/errors/draft-legacy';
import { errorsMatches } from '@/i18n/messages/errors/matches';
import { errorsPlayers } from '@/i18n/messages/errors/players';
import { errorsSeasons } from '@/i18n/messages/errors/seasons';
import { errorsStats } from '@/i18n/messages/errors/stats';
import { errorsTeams } from '@/i18n/messages/errors/teams';
import { errorsTournaments } from '@/i18n/messages/errors/tournaments';

const VALID = '12345678-1234-4123-8123-123456789abc';

/** Every catalogued INVALID_<NOUN>_ID code with its catalogue (en + de). */
const CODES: [InvalidPathIdCode, { en: Record<string, unknown>; de: Record<string, unknown> }][] = [
  ['INVALID_MATCH_ID', errorsMatches],
  ['INVALID_PLAYER_ID', errorsPlayers],
  ['INVALID_ROUND_ID', errorsTournaments],
  ['INVALID_SEASON_ID', errorsSeasons],
  ['INVALID_PHASE_ID', errorsSeasons],
  ['INVALID_GROUP_ID', errorsSeasons],
  ['INVALID_TOURNAMENT_ID', errorsTournaments],
  ['INVALID_RULESET_ID', errorsTournaments],
  ['INVALID_STORYLINE_ID', errorsBroadcast],
  ['INVALID_TEAM_ID', errorsTeams],
  ['INVALID_SESSION_ID', errorsBroadcast],
  ['INVALID_POINT_BUY_LIST_ID', errorsDraftLegacy],
  ['INVALID_PRESET_ID', errorsBroadcast],
  ['INVALID_WEBHOOK_ID', errorsBroadcast],
  ['INVALID_INTEGRATION_ID', errorsBroadcast],
  ['INVALID_EVOLUTION_TIER_ID', errorsDraftLegacy],
  ['INVALID_POOL_ENTRY_ID', errorsDraftLegacy],
  ['INVALID_POOL_TEMPLATE_ID', errorsDraftLegacy],
  ['INVALID_PICK_ID', errorsDraft],
  ['INVALID_REDRAFT_SLOT_ID', errorsDraft],
  ['INVALID_GAME_ID', errorsMatches],
  ['INVALID_PROPOSAL_ID', errorsMatches],
  ['INVALID_GALLERY_ITEM_ID', errorsPlayers],
  ['INVALID_ACHIEVEMENT_ID', errorsPlayers],
  ['INVALID_NOTE_ID', errorsStats],
  ['INVALID_WIKI_REPORT_ID', errorsStats],
];

describe('rejectInvalidPathId', () => {
  it.each([VALID, VALID.toUpperCase()])('returns null for the UUID %s', (id) => {
    expect(rejectInvalidPathId(id, 'INVALID_MATCH_ID')).toBeNull();
  });

  it.each(['', 'abc', 'match-1', `${VALID}x`, ` ${VALID}`, "1' OR '1'='1", '../etc/passwd'])(
    'answers 404 for the malformed id %j',
    async (id) => {
      const res = rejectInvalidPathId(id, 'INVALID_SEASON_ID');
      expect(res).not.toBeNull();
      expect(res!.status).toBe(404);
      expect(await res!.json()).toEqual({ success: false, error: 'League not found', code: 'INVALID_SEASON_ID' });
    }
  );

  it.each(CODES)('%s sends the catalogue English text and has a German message', async (code, catalog) => {
    const res = rejectInvalidPathId('nope', code);
    const body = await res!.json();
    expect(body.code).toBe(code);
    expect(body.error).toBe(catalog.en[code]);
    expect(typeof catalog.de[code]).toBe('string');
    expect(catalog.de[code]).not.toBe('');
  });
});
