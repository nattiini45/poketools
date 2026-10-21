/**
 * Fidelity wave 2 (2B): the Station Card's 390 digest states a fact the world
 * paints — it IS row 1 of the board-painter input (`buildBoardContent`), and
 * the roster fact is the length of the tiles the friezes paint
 * (`deriveRosterTiles`). German on the plaza, English on the isles; teams in
 * standings order.
 */
import { describe, expect, it } from 'vitest';
import {
  buildPreviewRoute,
  buildPreviewSakuraWorld,
  buildPreviewMountainWorld,
  buildPreviewCloudsWorld,
  PREVIEW_SCENARIOS,
} from '@/app/(public)/route-preview/fixtures';
import { buildBoardContent } from '@/components/world/evoliga/route/plaza/board/board-content';
import type { EvoligaRouteData } from '@/components/world/evoliga/route/route-data';
import { deriveRosterTiles, type WorldRouteData } from '@/lib/worlds/route-data';
import { liveMatchPair } from '@/lib/route-world/board-text';
import {
  EMPTY_DIGEST_FACTS,
  INITIAL_CARD_EPISODE,
  cardKicker,
  finishCardExit,
  placeStationCard,
  resolveStationCta,
  CARD_CTA_LABELS,
  stepCardEpisode,
  type CardEpisodeState,
  type CardTravel,
  formatStationDigest,
  liteHref,
  panelHref,
  stationDigestFacts,
  teamChipsInStandingsOrder,
  type StationDigestFacts,
} from '@/lib/route-world/station-digest';
import type { StationDigestKind } from '@/lib/route-world/theme-types';
import { LOCALES } from '@/i18n/config';
import { localizeThemeStations } from '@/components/world/themes/station-copy';
import { plazaTheme } from '@/components/world/themes/plaza/theme';
import { sakuraTheme } from '@/components/world/themes/sakura/theme';
import { mountainTheme } from '@/components/world/themes/mountain/theme';
import { cloudsTheme } from '@/components/world/themes/clouds/theme';
import { VIEWPORTS, paddedFaceRect, routePoseAt, type DataSurfaceTheme } from '@/lib/route-world/data-surfaces';
import type { ScreenRect } from '@/lib/route-world/evidence-probe';
import { PLAZA_DATA_SURFACES } from '@/components/world/evoliga/route/plaza/data-faces';
import { SAKURA_DATA_SURFACES } from '@/components/world/themes/sakura/furniture/data-faces';
import { MOUNTAIN_DATA_SURFACES } from '@/components/world/themes/mountain/furniture/data-faces';
import { CLOUDS_DATA_SURFACES } from '@/components/world/themes/clouds/furniture/data-faces';

function boardView(data: WorldRouteData): EvoligaRouteData {
  if (!data.league) throw new Error('fixtures carry a league row');
  return {
    league: data.league,
    stages: data.stages,
    participants: data.participants,
    entries: data.rosterLines ?? [],
    trackers: data.trackers,
    standings: data.standings,
    fixtures: data.fixtures,
    formatRules: data.formatRules,
    hasDraftPool: data.hasDraftPool,
  };
}

const PAYLOADS: [string, () => WorldRouteData][] = [
  ['plaza', () => buildPreviewRoute()],
  ...PREVIEW_SCENARIOS.flatMap((scenario): [string, () => WorldRouteData][] => [
    [`sakura epb ${scenario}`, () => buildPreviewSakuraWorld('epb', scenario).data],
    [`sakura open ${scenario}`, () => buildPreviewSakuraWorld('open', scenario).data],
    [`mountain open ${scenario}`, () => buildPreviewMountainWorld('open', scenario).data],
    [`clouds epb ${scenario}`, () => buildPreviewCloudsWorld('epb', scenario).data],
  ]),
];

describe('stationDigestFacts: the digest is row 1 of the painter input', () => {
  for (const [name, build] of PAYLOADS) {
    it(name, () => {
      const data = build();
      const facts = stationDigestFacts(data);
      const content = buildBoardContent(boardView(data), 'de');
      const contentEn = buildBoardContent(boardView(data), 'en');

      const top = content.table[0];
      expect(facts.standingsTop).toEqual(top ? { name: top.name, points: top.points } : null);
      expect(facts.live).toEqual(content.live);

      const row1 = content.upcoming[0];
      if (!row1) expect(facts.nextFixture).toBeNull();
      else {
        expect(facts.nextFixture).toMatchObject({
          home: row1.home,
          away: row1.away,
          status: row1.status,
          matchday: row1.matchday,
          time: row1.time,
          date: { de: row1.date, en: contentEn.upcoming[0].date },
        });
      }

      expect(facts.roster.count).toBe(deriveRosterTiles(data).length);
      expect(facts.roster.lines).toBe((data.rosterLines?.length ?? 0) > 0);
      expect(facts.rules.rulesetName).toBe(data.rulesetName);
      expect(facts.teams).toHaveLength(data.participants.length);

      // The formatted standings line carries the painted row verbatim.
      const line = formatStationDigest('standingsTop', facts, 'en');
      if (top) expect(line).toBe(`1. ${top.name} · ${top.points} pts`);
      // Plain JSON — it crosses the RSC boundary as a prop.
      expect(JSON.parse(JSON.stringify(facts))).toEqual(facts);
    });
  }
});

describe('teamChipsInStandingsOrder', () => {
  it('orders by the first standings row per player, unranked trainers last in participant order', () => {
    const participants = [
      { id: 'a', name: 'Ada', gym_type: 'water' },
      { id: 'b', name: 'Bo', gym_type: null },
      { id: 'c', name: 'Cy', gym_type: 'fire' },
      { id: 'd', name: 'Di', gym_type: 'grass' },
    ] as unknown as WorldRouteData['participants'];
    const standings = [
      { player_id: 'c', points: 9 },
      { player_id: 'a', points: 6 },
      { player_id: 'c', points: 1 },
    ] as unknown as WorldRouteData['standings'];
    const chips = teamChipsInStandingsOrder(participants, standings);
    expect(chips.map((chip) => chip.id)).toEqual(['c', 'a', 'b', 'd']);
    expect(chips[0]).toEqual({ id: 'c', name: 'Cy', gymType: 'fire', rank: 1, points: 9 });
    expect(chips[2]).toMatchObject({ id: 'b', gymType: null, rank: null, points: null });
  });

  it('matches the fixture standings order', () => {
    const data = buildPreviewRoute();
    const chips = stationDigestFacts(data).teams;
    const firstPerPlayer: string[] = [];
    for (const row of data.standings) if (!firstPerPlayer.includes(row.player_id)) firstPerPlayer.push(row.player_id);
    expect(chips.slice(0, firstPerPlayer.length).map((chip) => chip.id)).toEqual(firstPerPlayer);
  });
});

describe('formatStationDigest', () => {
  const facts: StationDigestFacts = {
    standingsTop: { name: 'FELDKAMP', points: 12 },
    live: { home: 'FELDKAMP', away: 'AYVAZ' },
    nextFixture: {
      home: 'REED',
      away: 'BELL',
      status: 'upcoming',
      matchday: 3,
      date: { de: '24.9.', en: '9/24' },
      time: '18:00',
    },
    roster: { count: 30, lines: true },
    rules: { rulesetName: 'Liga Standard', draftBudget: 100 },
    teams: [{ id: 'x', name: 'Ada', gymType: null, rank: 1, points: 3 }],
  };

  it('German on the plaza, English on the isles', () => {
    expect(formatStationDigest('standingsTop', facts, 'de')).toBe('1. FELDKAMP · 12 Pkt');
    expect(formatStationDigest('standingsTop', facts, 'en')).toBe('1. FELDKAMP · 12 pts');
    expect(formatStationDigest('nextKickoff', facts, 'de')).toBe('Spieltag 3 · REED vs BELL · 24.9. 18:00');
    expect(formatStationDigest('nextKickoff', facts, 'en')).toBe('Matchday 3 · REED vs BELL · 9/24 18:00');
    expect(formatStationDigest('rosterCount', facts, 'de')).toBe('30 Linien auf der Liste');
    expect(formatStationDigest('rosterCount', facts, 'en')).toBe('30 lines on the roster');
    expect(formatStationDigest('rulesHeadline', facts, 'de')).toBe('Regelwerk: Liga Standard');
  });

  it('the live pair never breaks inside a name (board-text liveMatchPair)', () => {
    expect(formatStationDigest('liveMatch', facts, 'en')).toBe(`LIVE · ${liveMatchPair('FELDKAMP', 'AYVAZ')}`);
  });

  it('a live SPIELPLAN row 1 reads LIVE', () => {
    const live = { ...facts, nextFixture: { ...facts.nextFixture!, status: 'live' as const } };
    expect(formatStationDigest('nextKickoff', live, 'de')).toBe(`LIVE · ${liveMatchPair('REED', 'BELL')}`);
  });

  it('the team rail replaces the sentence while trainers exist', () => {
    expect(formatStationDigest('teamChips', facts, 'de')).toBeNull();
    expect(formatStationDigest('teamChips', EMPTY_DIGEST_FACTS, 'de')).toBe('Noch keine Trainer');
  });

  it('every kind has an honest empty state — no empty slot', () => {
    const kinds: StationDigestKind[] = ['standingsTop', 'liveMatch', 'nextKickoff', 'rosterCount', 'rulesHeadline', 'teamChips'];
    for (const locale of ['de', 'en'] as const) {
      for (const kind of kinds) {
        const line = formatStationDigest(kind, EMPTY_DIGEST_FACTS, locale);
        expect(line, `${kind} ${locale}`).toBeTruthy();
      }
    }
  });

  it('never ships German copy on an English world or English on the plaza', () => {
    for (const kind of ['standingsTop', 'nextKickoff', 'rosterCount', 'rulesHeadline'] as const) {
      expect(formatStationDigest(kind, facts, 'en')).not.toMatch(/Spieltag|Linien|Pkt|Regelwerk/);
      expect(formatStationDigest(kind, facts, 'de')).not.toMatch(/Matchday|lines|pts|Ruleset/);
    }
  });
});

describe('card copy and links', () => {
  it('kicker is "n/5 · TITLE"', () => {
    expect(cardKicker(1, 5, 'Kaderliste')).toBe('2/5 · Kaderliste');
  });

  it('every theme station carries card copy in the viewer language, CTA on a registered panel param', () => {
    for (const theme of [plazaTheme, sakuraTheme, mountainTheme, cloudsTheme]) {
      expect(theme.stations).toHaveLength(5);
      for (const locale of LOCALES) {
        // i18n D11: the card shows the station copy in the viewer's language.
        for (const station of localizeThemeStations(theme.id, theme.stations, locale)) {
          const card = station.card;
          expect(card, `${theme.id}/${station.id}`).toBeDefined();
          if (!card) continue;
          expect(theme.focusVocabulary.panelParams).toContain(card.cta.param);
          expect(card.digest).toBeDefined();
          const label = resolveStationCta(card, EMPTY_DIGEST_FACTS, locale).label;
          if (locale === 'en') expect(`${card.title} ${label}`).not.toMatch(/[äöüÄÖÜß]|öffnen|lesen/);
        }
      }
      const roster = theme.stations.find((station) => station.id === 'roster');
      expect(roster?.card?.cta).toMatchObject({ param: 'board', value: 'roster' });
      expect(theme.stations.find((station) => station.id === 'teams')?.card?.digest).toBe('teamChips');
    }
  });

  it('CTA label and param come from one table, per station and per locale (wave-2 r3)', () => {
    const lead = { id: 'team-rank-1', name: 'Erste', gymType: null, rank: 1, points: 9 };
    const withTeams: StationDigestFacts = { ...EMPTY_DIGEST_FACTS, teams: [lead] };
    const expected: Record<string, { param: string; value?: string; de: string; en: string }> = {
      pulse: { param: 'board', value: 'pulse', de: 'Tabelle öffnen', en: 'Open the standings' },
      roster: { param: 'board', value: 'roster', de: 'Alle Linien lesen', en: 'Read all lines' },
      schedule: { param: 'board', value: 'schedule', de: 'Spielplan öffnen', en: 'Open the schedule' },
      teams: { param: 'team', value: lead.id, de: 'Team ansehen', en: 'See the teams' },
    };
    for (const theme of [plazaTheme, sakuraTheme, mountainTheme, cloudsTheme]) {
      for (const locale of LOCALES) {
        for (const station of theme.stations) {
          const card = station.card;
          if (!card) continue;
          const cta = resolveStationCta(card, withTeams, locale);
          const want = expected[station.id];
          if (want) {
            expect(cta, `${theme.id}/${station.id}`).toMatchObject({ param: want.param, label: want[locale] });
            if (want.value) expect(cta.value, `${theme.id}/${station.id}`).toBe(want.value);
          } else if (cta.param === 'rules') {
            expect(cta.label, `${theme.id}/${station.id}`).toBe(CARD_CTA_LABELS.rules[locale]);
          }
          expect(theme.focusVocabulary.panelParams).toContain(cta.param);
        }
        // Teams with no trainers falls back to the theme's authored target.
        const teams = theme.stations.find((station) => station.id === 'teams')?.card;
        if (teams) {
          const fallback = resolveStationCta(teams, EMPTY_DIGEST_FACTS, locale);
          expect(fallback.param).toBe(teams.cta.param);
        }
      }
    }
  });

  it('the Teams digest on desktop states the count and leader; the phone shows the rail', () => {
    const facts: StationDigestFacts = {
      ...EMPTY_DIGEST_FACTS,
      teams: [
        { id: 'a', name: 'Alpha', gymType: null, rank: 1, points: 9 },
        { id: 'b', name: 'Beta', gymType: null, rank: 2, points: 6 },
      ],
    };
    expect(formatStationDigest('teamChips', facts, 'de')).toBeNull();
    expect(formatStationDigest('teamChips', facts, 'de', { rail: false })).toBe('2 Trainer · 1. Alpha');
    expect(formatStationDigest('teamChips', facts, 'en', { rail: false })).toBe('2 trainers · 1. Alpha');
    expect(formatStationDigest('teamChips', EMPTY_DIGEST_FACTS, 'en', { rail: false })).toBe('No trainers yet');
  });

  it('the CTA keeps non-panel params and replaces any open panel', () => {
    const params = ['team', 'mon', 'board', 'rules'];
    expect(panelHref('?tier=route&team=abc', params, { param: 'board', value: 'pulse' })).toBe(
      '?tier=route&board=pulse',
    );
    expect(panelHref('', params, { param: 'rules', value: 'gate' })).toBe('?rules=gate');
  });

  it('"Read as text" forces Lite and lands on the same section', () => {
    expect(liteHref('?tier=route&routeDebug=1&board=pulse&x=1', ['board'], 'teams')).toBe('?tier=lite&x=1#teams');
  });
});

// ── Wave-2 r2: the card slot hugs its content (W1 / TEAMS judge gap) ─────────

const SURFACES: readonly DataSurfaceTheme[] = [
  PLAZA_DATA_SURFACES,
  SAKURA_DATA_SURFACES,
  MOUNTAIN_DATA_SURFACES,
  CLOUDS_DATA_SURFACES,
];

function rectsMeet(a: ScreenRect, b: ScreenRect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

describe('placeStationCard: the slot is the card, not the free column', () => {
  for (const theme of SURFACES) {
    theme.stations.forEach((station, index) => {
      it(`${theme.id}/${station.id}: ≤ 0.3·vh at 390, ≤ 260 px at 1440, clear of every padded face`, () => {
        for (const [viewport, maxH] of [
          [VIEWPORTS.mobile, 0.3 * VIEWPORTS.mobile.height],
          [VIEWPORTS.desktop, 260],
          [VIEWPORTS.tablet, 260],
        ] as const) {
          const { rect } = placeStationCard(theme, index, viewport);
          expect(rect.h).toBeLessThanOrEqual(maxH);
          const camera = routePoseAt(theme.stations, index, viewport);
          for (const face of theme.faces) {
            const padded = paddedFaceRect(face, camera, viewport);
            if (padded) expect(rectsMeet(rect, padded), `${face.id} under the card`).toBe(false);
          }
        }
      });
    });
  }
});

// ── Wave-2 r2: enter / exit edge follows the visible travel (W6 residual) ────

describe('stepCardEpisode: one edge latch per episode, keyed on visible travel', () => {
  const fwd: CardTravel = { velocitySign: 1, direction: 1 };

  function run(steps: readonly [number | null, CardTravel][], from: CardEpisodeState = INITIAL_CARD_EPISODE) {
    return steps.reduce((state, [target, travel]) => stepCardEpisode(state, target, travel), from);
  }

  it('forward: exits up, the next card enters from below; backward: exits down, enters from above', () => {
    let s = run([[1, fwd], [null, fwd]]);
    expect(s.shown).toMatchObject({ station: 1, edge: 'top', exiting: true });
    s = run([[2, fwd]], s);
    expect(s.shown).toMatchObject({ station: 2, edge: 'bottom', exiting: false });
    const back: CardTravel = { velocitySign: -1, direction: -1 };
    s = run([[null, back]], s);
    expect(s.shown?.edge).toBe('bottom');
    s = run([[1, back]], finishCardExit(s));
    expect(s.shown).toMatchObject({ station: 1, edge: 'top' });
  });

  it('jitter ending at the last station with input +1 enters from the bottom edge', () => {
    // wave-2 r1 trace t=21220–21387: input +1 throughout, the latch still -1
    // (then 0 → last non-zero -1), smooth 3.953 → 4.000 (below the velocity eps).
    const s = run([
      [3, fwd],
      [null, { velocitySign: 1, direction: 1 }],
      [null, { velocitySign: -1, direction: -1 }],
      [4, { velocitySign: 0, direction: -1 }],
    ]);
    expect(s.shown).toMatchObject({ station: 4, edge: 'bottom', exiting: false });
    // The same with the smoothed velocity still rising and the latch lagging.
    expect(run([[3, fwd], [null, fwd], [4, { velocitySign: 1, direction: -1 }]]).shown?.edge).toBe('bottom');
  });

  it('exit follows the smoothed velocity when the direction latch lags a reversal', () => {
    // wave-2 r1 trace t=14148–14248: input +1, smooth 0.366 → 0.493, latch -1.
    const s = run([[0, fwd], [null, { velocitySign: 1, direction: -1 }]]);
    expect(s.shown).toMatchObject({ station: 0, edge: 'top', exiting: true });
  });

  it('with no velocity the latched direction decides; a same-station return uses travel', () => {
    expect(run([[2, { velocitySign: 0, direction: -1 }]]).shown?.edge).toBe('top');
    expect(run([[2, fwd], [null, { velocitySign: 0, direction: -1 }]]).shown?.edge).toBe('bottom');
    const back = run([[4, fwd], [null, { velocitySign: -1, direction: -1 }], [4, { velocitySign: 1, direction: -1 }]]);
    expect(back.shown).toMatchObject({ station: 4, edge: 'bottom', exiting: false });
  });

  it('latches once: an unchanged target returns the same state; finish clears only an exit', () => {
    const shown = run([[1, fwd]]);
    expect(stepCardEpisode(shown, 1, { velocitySign: -1, direction: -1 })).toBe(shown);
    expect(finishCardExit(shown)).toBe(shown);
    const exiting = run([[null, fwd]], shown);
    expect(stepCardEpisode(exiting, null, { velocitySign: -1, direction: -1 })).toBe(exiting);
    expect(finishCardExit(exiting).shown).toBeNull();
    expect(finishCardExit(exiting).lastStation).toBe(1);
  });
});
