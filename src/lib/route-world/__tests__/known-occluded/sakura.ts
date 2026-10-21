/**
 * W4 KNOWN_OCCLUDED — Sakura: today's measured wasted-figure set for this
 * world, each with the reason the audit found (split per world from
 * `figure-visibility.test.ts` so per-world seats edit disjoint files). The
 * stale-entry rule holds: an entry whose figure became visible fails the test
 * until it is removed here.
 */
export const KNOWN_OCCLUDED: Readonly<Record<string, string>> = {
  // Sakura — schedule wilds stand behind the 6 m banner cloths; Gyarados'
  // "head clears the cloth tops" does not hold for ≥ half its silhouette.
  'sakura:wild:Wingull:desktop': 'behind banner 3 (and Slowpoke/Gyarados)',
  'sakura:wild:Wingull:landed390': 'behind banners 3–4',
  'sakura:wild:Azumarill:desktop': 'behind banner 3',
  'sakura:wild:Azumarill:landed390': 'behind banner 3',
  'sakura:wild:Slowpoke:desktop': 'behind banners 2–3',
  'sakura:wild:Slowpoke:landed390': 'behind banners 2–3',
  'sakura:wild:Gyarados:desktop': 'behind banners 3–4 (colossal, grounded)',
  'sakura:wild:Gyarados:landed390': 'behind banners 3–4 (colossal, grounded)',
  // Sakura — the teams approach anchor (11.9, −4.9) projects to ndcX ≈ −1.15
  // at both teams poses (the same anchor the mountain reader measured).
  'sakura:wild:Marill:desktop': 'off-frame (ndcX ≈ −1.15)',
  'sakura:wild:Marill:landed390': 'off-frame',
  // Sakura — pulse: Lombre behind a full 8-ace grandstand; the grandstand's
  // rear rank stands 1.85 m behind the front rank and west slots behind the rock.
  'sakura:wild:Lombre:desktop': 'behind the grandstand ranks (full roster)',
  'sakura:wild:Lombre:landed390': 'behind the grandstand rear rank',
  'sakura:grandstand:0:landed390': 'front-rank bodies overlap at the landed pose',
  'sakura:grandstand:1:landed390': 'front-rank bodies overlap at the landed pose',
  'sakura:grandstand:4:desktop': 'rear rank behind the rock and the front rank',
  'sakura:grandstand:4:landed390': 'rear rank behind the rock',
  'sakura:grandstand:5:desktop': 'rear rank behind the rock screen',
  'sakura:grandstand:7:landed390': 'rear-rank east slot leaves the 390 frame',
};
