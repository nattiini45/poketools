/**
 * The "Now" queue beyond matches: draft turns, open league actions and matches without a registered team.
 */
import { describe, expect, it } from 'vitest';
import type { FormatDefinition } from '@/lib/format-kit/types';
import type { PlayerFormatFacts } from '@/lib/supabase/queries/dashboard-now';
import { buildDraftTurns, buildFormatActions, teamlessMatchIds } from '../now-queue';

const turn = (extra: Partial<Parameters<typeof buildDraftTurns>[0][number]> = {}) => ({
  pool_id: 'pool1',
  pool_kind: 'initial',
  paused: false,
  deadline_at: '2026-11-12T18:00:00.000Z',
  season_id: 's1',
  season_name: 'Kanto League',
  season_format_type: 'draft',
  ...extra,
});

describe('buildDraftTurns', () => {
  it('links a draft league to its draft board and an evolution point buy league to its draft room', () => {
    expect(buildDraftTurns([turn()])[0]).toMatchObject({ href: '/leagues/s1/draft', leagueName: 'Kanto League', paused: false, redraft: false });
    expect(buildDraftTurns([turn({ season_format_type: 'evolution_point_buy' })])[0].href).toBe('/leagues/s1/draft-room');
  });

  it('links a redraft pool to the redraft page and a league without a draft page to the league', () => {
    expect(buildDraftTurns([turn({ pool_kind: 'redraft' })])[0]).toMatchObject({ href: '/leagues/s1/redraft', redraft: true });
    expect(buildDraftTurns([turn({ season_format_type: 'custom' })])[0].href).toBe('/leagues/s1');
  });
});

const action = (id: string, extra: Record<string, unknown> = {}) => ({ kind: 'player.action', id, label: { en: id }, window: {}, steps: [], lock: 'manual', ...extra });
const spec = (rules: unknown[]) => ({ rules }) as unknown as FormatDefinition;
const facts = (extra: Partial<PlayerFormatFacts> = {}): PlayerFormatFacts => ({ formats: [], flags: [], submissions: [], links: [], challenges: [], ...extra });
const LEAGUES = [{ id: 's1', name: 'Kit League' }, { id: 's2', name: 'Other League' }];

describe('buildFormatActions', () => {
  it('counts an action with an open window the player has not submitted, and a saved draft', () => {
    const out = buildFormatActions(
      LEAGUES,
      facts({
        formats: [{ season_id: 's1', spec: spec([action('gift'), action('ban'), action('swap'), { kind: 'adjust.manual', id: 'x' }]) }],
        submissions: [
          { season_id: 's1', action_key: 'ban', status: 'draft' },
          { season_id: 's1', action_key: 'swap', status: 'submitted' },
        ],
      }),
    );
    expect(out).toEqual([{ leagueId: 's1', leagueName: 'Kit League', openActions: 2, challenges: 0, answerBy: null }]);
  });

  it('leaves out a window that is not open yet or locked, and counts it once its flag opens it', () => {
    const format = { season_id: 's1', spec: spec([action('later', { window: { opens_on: 'draw' } }), action('done')]) };
    expect(buildFormatActions(LEAGUES, facts({ formats: [format], flags: [{ season_id: 's1', key: 'action:done', value: 'locked' }] }))).toEqual([]);
    const open = buildFormatActions(LEAGUES, facts({ formats: [format], flags: [{ season_id: 's1', key: 'action:later', value: 'open' }] }));
    expect(open[0].openActions).toBe(2);
  });

  it('counts an action via a relation only for a player who holds a link, and never reads another league\'s rows', () => {
    const format = { season_id: 's1', spec: spec([action('gift', { via: 'santa' })]) };
    expect(buildFormatActions(LEAGUES, facts({ formats: [format], links: [{ season_id: 's2', relation_key: 'santa' }] }))).toEqual([]);
    expect(buildFormatActions(LEAGUES, facts({ formats: [format], links: [{ season_id: 's1', relation_key: 'santa' }] }))[0].openActions).toBe(1);
  });

  it('lists open challenges with the earliest answer deadline, for a league with no open action too', () => {
    const out = buildFormatActions(
      LEAGUES,
      facts({
        formats: [{ season_id: 's2', spec: spec([]) }],
        challenges: [
          { season_id: 's2', expires_at: '2026-11-14T10:00:00.000Z' },
          { season_id: 's2', expires_at: '2026-11-13T10:00:00.000Z' },
        ],
      }),
    );
    expect(out).toEqual([{ leagueId: 's2', leagueName: 'Other League', openActions: 0, challenges: 2, answerBy: '2026-11-13T10:00:00.000Z' }]);
  });

  it('has nothing for a league that is not on the kit engine', () => {
    expect(buildFormatActions(LEAGUES, facts({ challenges: [{ season_id: 's1', expires_at: '2026-11-14T10:00:00.000Z' }] }))).toEqual([]);
  });
});

describe('teamlessMatchIds', () => {
  const matches = [
    { id: 'm1', tournament_id: 't1', status: 'scheduled' },
    { id: 'm2', tournament_id: 't2', status: 'in_progress' },
    { id: 'm3', tournament_id: 't3', status: 'pending_confirmation' },
  ];

  it('lists the upcoming matches without a team, and never a match that is already played', () => {
    expect(teamlessMatchIds(matches, [])).toEqual(['m1', 'm2']);
  });

  it('counts a planned team of the tournament and a team linked to the match, not one linked to another match', () => {
    expect(teamlessMatchIds(matches, [{ tournament_id: 't1', match_id: null }, { tournament_id: 't2', match_id: 'm2' }])).toEqual([]);
    expect(teamlessMatchIds(matches, [{ tournament_id: 't1', match_id: 'm9' }, { tournament_id: 't2', match_id: null }])).toEqual(['m1']);
  });
});
