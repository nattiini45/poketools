/**
 * W4 KNOWN_OCCLUDED — Clouds: today's measured wasted-figure set for this
 * world, each with the reason the audit found (split per world from
 * `figure-visibility.test.ts` so per-world seats edit disjoint files). The
 * stale-entry rule holds: an entry whose figure became visible fails the test
 * until it is removed here.
 */
export const KNOWN_OCCLUDED: Readonly<Record<string, string>> = {
  // Clouds — Pikachu/Zapdos behind the flagship sail's west edge.
  'clouds:wild:Zapdos-Galar:desktop': 'half behind the flagship sail',
  'clouds:wild:Pikachu:desktop': 'behind the flagship sail and Zapdos',
  'clouds:wild:Pikachu:landed390': 'behind Zapdos',
  // Clouds — the teams behind-row tiny beside the D16 rear riser (wave 2, 2G:
  // Cosmog and Misdreavus at 390 read clear of the zipper floats now; the
  // front riders lost their plaques and are visible — `clouds:rider:*` gone.
  // Wave-2 r2: Misdreavus now also reads clear at desktop — entry removed).
  'clouds:wild:Lugia:landed390': 'half behind the halo plaque and Eelektross',
};
