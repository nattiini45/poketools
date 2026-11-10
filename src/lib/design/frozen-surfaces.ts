/**
 * Source directories and files that render the frozen surfaces (docs/design.md, "Frozen surfaces"). They keep
 * their pre-redesign look, so the redesign guardrails (scripts/design/check-design-guards.mts, the CSS duration
 * guard in motion-guards.test.ts) skip them. Paths are relative to src/.
 */
export const FROZEN_SOURCE_PATHS = [
  'components/draft-tool/',
  'components/draft-redraft/',
  'components/draft-tokens/',
  'components/draft-admin/RoomAdminSheet.tsx',
  'components/world/',
  'components/broadcast/overlays/',
  'components/broadcast/shared/',
  'components/evolution/CrystalXPBar.tsx',
  'components/evolution/MatchEvolutionReplay.tsx',
  'components/draft/EvolutionRosterCard.tsx',
  'components/ui/frozen/',
  'components/match/MatchHighlightCard.tsx',
  'lib/discord/match-card-image.tsx',
] as const;

export function isFrozenSource(pathFromSrc: string): boolean {
  return FROZEN_SOURCE_PATHS.some((frozen) => (frozen.endsWith('/') ? pathFromSrc.startsWith(frozen) : pathFromSrc === frozen));
}
