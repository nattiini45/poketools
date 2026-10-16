import type {
  OverlayConfig,
  OverlayTheme,
  AnimationIntensity,
  BrandPosition,
  BroadcastPresetType,
} from '@/types/broadcast';

// ─── Overlay Type Registry ──────────────────────────────────────────

export type OverlayEntityType = 'match' | 'season' | 'draft' | 'player' | 'wiki';

export type OverlayTypeKey =
  | 'match_preview'
  | 'match_live'
  | 'match_results'
  | 'match_story'
  | 'match_teams'
  | 'match_h2h'
  | 'match_moments'
  | 'standings'
  | 'attract'
  | 'recap'
  | 'usage_chart'
  | 'draft_live'
  | 'draft_pick'
  | 'draft_replay'
  | 'player_spotlight'
  | 'wiki_move'
  | 'wiki_item'
  | 'wiki_ability'
  | 'wiki_pokemon'
  | 'wiki_tera';

export type OverlayCategory = 'Match' | 'League' | 'Draft' | 'Player' | 'Wiki';

export interface OverlayTypeDefinition {
  key: OverlayTypeKey;
  label: string;
  category: OverlayCategory;
  entityType: OverlayEntityType;
  /** Path template with `[id]` placeholder */
  pathTemplate: string;
  /** Maps to BroadcastPresetType for save/load */
  presetType: BroadcastPresetType;
}

export const OVERLAY_TYPES: Record<OverlayTypeKey, OverlayTypeDefinition> = {
  match_preview: {
    key: 'match_preview',
    label: 'Match Preview',
    category: 'Match',
    entityType: 'match',
    pathTemplate: '/broadcast/match/[id]/preview',
    presetType: 'match_preview',
  },
  match_live: {
    key: 'match_live',
    label: 'Live Stat Bar',
    category: 'Match',
    entityType: 'match',
    pathTemplate: '/broadcast/match/[id]/live',
    presetType: 'match_preview', // shares preset type
  },
  match_results: {
    key: 'match_results',
    label: 'Match Results',
    category: 'Match',
    entityType: 'match',
    pathTemplate: '/broadcast/match/[id]/results',
    presetType: 'match_results',
  },
  standings: {
    key: 'standings',
    label: 'Standings Ticker',
    category: 'League',
    entityType: 'season',
    pathTemplate: '/broadcast/league/[id]/standings',
    presetType: 'standings',
  },
  attract: {
    key: 'attract',
    label: 'Attract Screen',
    category: 'League',
    entityType: 'season',
    pathTemplate: '/broadcast/league/[id]/attract',
    presetType: 'attract',
  },
  recap: {
    key: 'recap',
    label: 'Weekly Recap',
    category: 'League',
    entityType: 'season',
    pathTemplate: '/broadcast/league/[id]/recap',
    presetType: 'recap',
  },
  draft_live: {
    key: 'draft_live',
    label: 'Live Draft',
    category: 'Draft',
    entityType: 'draft',
    pathTemplate: '/broadcast/draft/[id]/live',
    presetType: 'draft',
  },
  draft_pick: {
    key: 'draft_pick',
    label: 'Pick Reveal',
    category: 'Draft',
    entityType: 'draft',
    pathTemplate: '/broadcast/draft/[id]/pick',
    presetType: 'draft',
  },
  draft_replay: {
    key: 'draft_replay',
    label: 'Draft Replay',
    category: 'Draft',
    entityType: 'draft',
    pathTemplate: '/broadcast/draft/[id]/replay',
    presetType: 'draft',
  },
  match_story: {
    key: 'match_story',
    label: 'Match Story',
    category: 'Match',
    entityType: 'match',
    pathTemplate: '/broadcast/match/[id]/story',
    presetType: 'match_story',
  },
  match_teams: {
    key: 'match_teams',
    label: 'Team Comparison',
    category: 'Match',
    entityType: 'match',
    pathTemplate: '/broadcast/match/[id]/teams',
    presetType: 'team_comparison',
  },
  match_h2h: {
    key: 'match_h2h',
    label: 'Head-to-Head',
    category: 'Match',
    entityType: 'match',
    pathTemplate: '/broadcast/match/[id]/h2h',
    presetType: 'h2h_history',
  },
  match_moments: {
    key: 'match_moments',
    label: 'Moment Highlights',
    category: 'Match',
    entityType: 'match',
    pathTemplate: '/broadcast/match/[id]/moments',
    presetType: 'moment_reel',
  },
  usage_chart: {
    key: 'usage_chart',
    label: 'Usage Chart',
    category: 'League',
    entityType: 'season',
    pathTemplate: '/broadcast/league/[id]/usage',
    presetType: 'usage_chart',
  },
  player_spotlight: {
    key: 'player_spotlight',
    label: 'Player Spotlight',
    category: 'Player',
    entityType: 'player',
    pathTemplate: '/broadcast/player/[id]/spotlight',
    presetType: 'match_preview',
  },
  wiki_move: {
    key: 'wiki_move',
    label: 'Wiki: Move',
    category: 'Wiki',
    entityType: 'wiki',
    pathTemplate: '/broadcast/wiki/moves/[id]',
    presetType: 'match_preview',
  },
  wiki_item: {
    key: 'wiki_item',
    label: 'Wiki: Item',
    category: 'Wiki',
    entityType: 'wiki',
    pathTemplate: '/broadcast/wiki/items/[id]',
    presetType: 'match_preview',
  },
  wiki_ability: {
    key: 'wiki_ability',
    label: 'Wiki: Ability',
    category: 'Wiki',
    entityType: 'wiki',
    pathTemplate: '/broadcast/wiki/abilities/[id]',
    presetType: 'match_preview',
  },
  wiki_pokemon: {
    key: 'wiki_pokemon',
    label: 'Wiki: Pokemon',
    category: 'Wiki',
    entityType: 'wiki',
    pathTemplate: '/broadcast/wiki/pokemon/[id]',
    presetType: 'match_preview',
  },
  wiki_tera: {
    key: 'wiki_tera',
    label: 'Wiki: Tera Type',
    category: 'Wiki',
    entityType: 'wiki',
    pathTemplate: '/broadcast/wiki/tera/[id]',
    presetType: 'match_preview',
  },
};

/** All overlay types grouped by category for UI selects. */
export const OVERLAY_CATEGORIES: { category: OverlayCategory; types: OverlayTypeDefinition[] }[] =
  [
    {
      category: 'Match',
      types: [
        OVERLAY_TYPES.match_preview,
        OVERLAY_TYPES.match_live,
        OVERLAY_TYPES.match_results,
        OVERLAY_TYPES.match_story,
        OVERLAY_TYPES.match_teams,
        OVERLAY_TYPES.match_h2h,
        OVERLAY_TYPES.match_moments,
      ],
    },
    {
      category: 'League',
      types: [
        OVERLAY_TYPES.standings,
        OVERLAY_TYPES.attract,
        OVERLAY_TYPES.recap,
        OVERLAY_TYPES.usage_chart,
      ],
    },
    {
      category: 'Draft',
      types: [OVERLAY_TYPES.draft_live, OVERLAY_TYPES.draft_pick, OVERLAY_TYPES.draft_replay],
    },
    { category: 'Player', types: [OVERLAY_TYPES.player_spotlight] },
    {
      category: 'Wiki',
      types: [
        OVERLAY_TYPES.wiki_move,
        OVERLAY_TYPES.wiki_item,
        OVERLAY_TYPES.wiki_ability,
        OVERLAY_TYPES.wiki_pokemon,
        OVERLAY_TYPES.wiki_tera,
      ],
    },
  ];

// ─── Defaults (mirrors overlay-config.ts) ───────────────────────────

export const OVERLAY_DEFAULTS: OverlayConfig = {
  theme: 'dark',
  accent: '#EF4444',
  accent2: '#3B82F6',
  anim: 'smooth',
  poll: 5000,
  w: 1920,
  h: 1080,
  brand: '',
  brandpos: 'br',
  preset: null,
  lang: null,
};

// ─── URL Builder ────────────────────────────────────────────────────

/**
 * Serialize overlay config into URL search params, omitting defaults.
 * Only includes params that differ from OVERLAY_DEFAULTS. `lang` has no
 * default: whenever it is set it is written, so a generated OBS URL keeps its
 * language even if the league language changes later (i18n-core §6.5).
 */
export function serializeConfig(
  config: Partial<OverlayConfig>,
  extras?: Record<string, string | number | boolean>
): URLSearchParams {
  const params = new URLSearchParams();

  if (config.theme && config.theme !== OVERLAY_DEFAULTS.theme) {
    params.set('theme', config.theme);
  }
  if (config.accent && config.accent !== OVERLAY_DEFAULTS.accent) {
    params.set('accent', config.accent.replace('#', ''));
  }
  if (config.accent2 && config.accent2 !== OVERLAY_DEFAULTS.accent2) {
    params.set('accent2', config.accent2.replace('#', ''));
  }
  if (config.anim && config.anim !== OVERLAY_DEFAULTS.anim) {
    params.set('anim', config.anim);
  }
  if (config.poll !== undefined && config.poll !== OVERLAY_DEFAULTS.poll) {
    params.set('poll', String(config.poll));
  }
  if (config.w !== undefined && config.w !== OVERLAY_DEFAULTS.w) {
    params.set('w', String(config.w));
  }
  if (config.h !== undefined && config.h !== OVERLAY_DEFAULTS.h) {
    params.set('h', String(config.h));
  }
  if (config.brand && config.brand !== OVERLAY_DEFAULTS.brand) {
    params.set('brand', config.brand);
  }
  if (config.brandpos && config.brandpos !== OVERLAY_DEFAULTS.brandpos) {
    params.set('brandpos', config.brandpos);
  }
  if (config.lang) {
    params.set('lang', config.lang);
  }

  // Append type-specific extras
  if (extras) {
    for (const [key, value] of Object.entries(extras)) {
      if (value !== undefined && value !== '' && value !== false) {
        params.set(key, String(value));
      }
    }
  }

  return params;
}

/**
 * Build a complete overlay URL from type, entity ID, and config.
 * Returns a root-relative path (e.g., `/broadcast/match/abc123/preview?theme=light`).
 */
export function buildOverlayUrl(
  typeKey: OverlayTypeKey,
  entityId: string,
  config?: Partial<OverlayConfig>,
  extras?: Record<string, string | number | boolean>
): string {
  const typeDef = OVERLAY_TYPES[typeKey];
  const path = typeDef.pathTemplate.replace('[id]', entityId);
  const params = serializeConfig(config ?? {}, extras);
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

// ─── Option Lists ───────────────────────────────────────────────────

export const THEME_OPTIONS: { value: OverlayTheme; label: string }[] = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
  { value: 'custom', label: 'Custom' },
];

export const ANIMATION_OPTIONS: { value: AnimationIntensity; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'subtle', label: 'Subtle' },
  { value: 'smooth', label: 'Smooth' },
  { value: 'dramatic', label: 'Dramatic' },
];

export const BRAND_POSITION_OPTIONS: { value: BrandPosition; label: string }[] = [
  { value: 'tl', label: 'Top Left' },
  { value: 'tr', label: 'Top Right' },
  { value: 'bl', label: 'Bottom Left' },
  { value: 'br', label: 'Bottom Right' },
];
