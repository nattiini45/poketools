/**
 * W4 KNOWN_OCCLUDED — Mountain: today's measured wasted-figure set for this
 * world, each with the reason the audit found (split per world from
 * `figure-visibility.test.ts` so per-world seats edit disjoint files). The
 * stale-entry rule holds: an entry whose figure became visible fails the test
 * until it is removed here.
 */
export const KNOWN_OCCLUDED: Readonly<Record<string, string>> = {
  // Mountain — teams wilds out of frame at all poses; Mamoswine behind sign 3/4.
  'mountain:wild:Arctibax:desktop': 'off-frame (ndcX ≈ −1.15)',
  'mountain:wild:Arctibax:landed390': 'off-frame',
  'mountain:wild:Swinub:desktop': 'off-frame (ndcX ≈ +1.10)',
  'mountain:wild:Swinub:landed390': 'off-frame',
  'mountain:wild:Mamoswine:desktop': 'behind sign cloths 3–4',
  'mountain:wild:Mamoswine:landed390': 'behind sign cloths 3–4',
  // Mountain — podium back rank behind the front rank (nominal 1.2 m aces).
  'mountain:podium:0:landed390': 'back rank behind the front rank',
  'mountain:podium:1:desktop': 'back rank behind the front rank',
  'mountain:podium:1:landed390': 'back rank behind the front rank',
  'mountain:podium:2:desktop': 'back rank behind the front rank',
};
