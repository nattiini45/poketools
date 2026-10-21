/**
 * Fidelity wave 2 — integration pins between seats (not owned by any single
 * seat's suite).
 *
 * D16: the Teams formation (2G, `teamsInStandingsOrder`), the painted ledger
 * and the 390 roll-call rail (2B, `teamChipsInStandingsOrder`) must agree on
 * ONE order, or a phone reader's chip 3 names a different trainer than
 * statue 3. The two implementations are separate (station-digest.ts stays
 * free of the formation's three-dependent layout code), so this pins them
 * together on every preview payload plus a hand-built edge case.
 */
import { describe, expect, it } from 'vitest';
import {
  buildPreviewRoute,
  buildPreviewSakuraWorld,
  buildPreviewMountainWorld,
  buildPreviewCloudsWorld,
  PREVIEW_SCENARIOS,
} from '@/app/(public)/route-preview/fixtures';
import type { WorldRouteData } from '@/lib/worlds/route-data';
import { teamChipsInStandingsOrder } from '@/lib/route-world/station-digest';
import { teamsInStandingsOrder } from '@/lib/route-world/teams-formation';

const PAYLOADS: [string, () => WorldRouteData][] = [
  ['plaza', () => buildPreviewRoute()],
  ...PREVIEW_SCENARIOS.flatMap((scenario): [string, () => WorldRouteData][] => [
    [`sakura epb ${scenario}`, () => buildPreviewSakuraWorld('epb', scenario).data],
    [`mountain open ${scenario}`, () => buildPreviewMountainWorld('open', scenario).data],
    [`clouds epb ${scenario}`, () => buildPreviewCloudsWorld('epb', scenario).data],
  ]),
];

describe('D16: roll-call rail order = formation order', () => {
  for (const [name, build] of PAYLOADS) {
    it(name, () => {
      const data = build();
      const rail = teamChipsInStandingsOrder(data.participants, data.standings).map((chip) => chip.id);
      const formation = teamsInStandingsOrder(data.participants, data.standings).map((p) => p.id);
      expect(rail).toEqual(formation);
    });
  }

  it('duplicate standings rows and unranked trainers resolve identically', () => {
    const data = buildPreviewRoute();
    const participants = data.participants;
    expect(participants.length).toBeGreaterThan(2);
    const [first, second, ...rest] = data.standings;
    if (!first || !second) throw new Error('fixture carries standings');
    // Second-ranked row repeated at the bottom; last standings row dropped so
    // at least one trainer is unranked.
    const standings = [second, first, ...rest.slice(0, -1), second];
    const rail = teamChipsInStandingsOrder(participants, standings).map((chip) => chip.id);
    const formation = teamsInStandingsOrder(participants, standings).map((p) => p.id);
    expect(rail).toEqual(formation);
  });
});
