/**
 * W4 KNOWN_OCCLUDED — Plaza: today's measured wasted-figure set for this
 * world, each with the reason the audit found (split per world from
 * `figure-visibility.test.ts` so per-world seats edit disjoint files). The
 * stale-entry rule holds: an entry whose figure became visible fails the test
 * until it is removed here.
 */
export const KNOWN_OCCLUDED: Readonly<Record<string, string>> = {
  // Plaza — LOITER_SPOTS "off every sightline" (ambient.ts): the four
  // (±7.6, 6.4) / (±7.6, −4.4) spots fall outside every station frustum.
  'plaza:loiter:0:desktop': 'off-frame at every station',
  'plaza:loiter:0:landed390': 'off-frame at every station',
  'plaza:loiter:1:desktop': 'off-frame at every station',
  'plaza:loiter:1:landed390': 'off-frame at every station',
  'plaza:loiter:2:desktop': 'off-frame at every station',
  'plaza:loiter:2:landed390': 'off-frame at every station',
  'plaza:loiter:3:desktop': 'off-frame at every station',
  'plaza:loiter:3:landed390': 'off-frame at every station',
};
