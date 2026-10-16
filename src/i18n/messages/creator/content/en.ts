/**
 * Namespace `creator/content` (owner T16, i18n-core §11.3): the content
 * dashboard (`src/components/content/**`): overlay URL builder, saved
 * presets, recap generator and broadcast moments.
 *
 * English values are the pre-i18n literals verbatim. Overlay type labels are
 * keyed by `OverlayTypeKey` (the English registry in
 * `src/lib/broadcast/url-builder.ts` stays as it is); preset and moment types
 * by their DB values. Pokémon names come from `@/lib/pkmn/i18n`.
 */
export default {
  dashboard: {
    trackerTitle: 'Live Battle Tracker',
    activeMatches: {
      one: '{count} active match ready to track',
      other: '{count} active matches ready to track',
    },
    noActiveMatches: 'No active matches right now',
    openTracker: 'Open Tracker →',
  },
  common: {
    match: 'Match',
    matchup: '{player1} vs {player2}',
    league: 'League',
    tournament: 'Tournament',
    round: 'Round',
    theme: 'Theme',
    loading: 'Loading…',
    selectMatch: 'Select a match…',
    selectLeague: 'Select a league…',
    selectTournament: 'Select a tournament…',
    selectRound: 'Select a round…',
    selectLeagueFirst: 'Select a league first',
    selectTournamentFirst: 'Select a tournament first',
    noTournaments: 'No tournaments',
    noRounds: 'No rounds',
    copied: 'Copied!',
    openPreview: 'Open Preview →',
    cancel: 'Cancel',
  },
  /** `OverlayConfig['theme']` values. */
  theme: {
    dark: 'Dark',
    light: 'Light',
    custom: 'Custom',
  },
  /** `AnimationIntensity` values. */
  animation: {
    none: 'None',
    subtle: 'Subtle',
    smooth: 'Smooth',
    dramatic: 'Dramatic',
  },
  /** `BrandPosition` values. */
  brandPosition: {
    tl: 'Top Left',
    tr: 'Top Right',
    bl: 'Bottom Left',
    br: 'Bottom Right',
  },
  /** `OverlayCategory` values. */
  overlayCategory: {
    Match: 'Match',
    League: 'League',
    Draft: 'Draft',
    Player: 'Player',
    Wiki: 'Wiki',
  },
  /** `OverlayTypeKey` values. */
  overlayType: {
    match_preview: 'Match Preview',
    match_live: 'Live Stat Bar',
    match_results: 'Match Results',
    match_story: 'Match Story',
    match_teams: 'Team Comparison',
    match_h2h: 'Head-to-Head',
    match_moments: 'Moment Highlights',
    standings: 'Standings Ticker',
    attract: 'Attract Screen',
    recap: 'Weekly Recap',
    usage_chart: 'Usage Chart',
    draft_live: 'Live Draft',
    draft_pick: 'Pick Reveal',
    draft_replay: 'Draft Replay',
    player_spotlight: 'Player Spotlight',
    wiki_move: 'Wiki: Move',
    wiki_item: 'Wiki: Item',
    wiki_ability: 'Wiki: Ability',
    wiki_pokemon: 'Wiki: Pokemon',
    wiki_tera: 'Wiki: Tera Type',
  },
  builder: {
    title: 'Overlay URL Builder',
    overlayType: 'Overlay Type',
    selectOverlayType: 'Select an overlay type…',
    leagueSeason: 'League / Season',
    draftPool: 'Draft Pool',
    selectEntity: {
      match: 'Select a match…',
      season: 'Select a season…',
      draft: 'Select a draft…',
      player: 'Select a player…',
      wiki: 'Select a wiki…',
    },
    draftPoolOption: '{season} — {draftType}',
    playerId: 'Player ID',
    playerIdPlaceholder: 'Enter player ID',
    configuration: 'Configuration',
    animation: 'Animation',
    accentColor: 'Accent Color',
    accentColor2: 'Accent Color 2',
    pollInterval: 'Poll Interval (ms)',
    width: 'Width (px)',
    height: 'Height (px)',
    brand: 'Brand / Watermark',
    brandPlaceholder: 'League name or image URL',
    brandPosition: 'Brand Position',
    overlayLanguage: 'Overlay language',
    overlayLanguageHint: 'Text on the overlay uses this language.',
    generatedUrl: 'Generated URL',
    copy: 'Copy',
    saveAsPreset: 'Save as Preset',
    presetName: 'Preset Name',
    presetNamePlaceholder: 'e.g. My Dark Theme',
    save: 'Save',
  },
  /** Language names, each written in its own language (same in both locales). */
  languageName: {
    en: 'English',
    de: 'Deutsch',
  },
  presets: {
    empty:
      'No saved presets yet. Use the URL Builder above to create an overlay configuration, then save it as a preset for quick reuse.',
    title: 'Saved Presets',
    load: 'Load',
    confirm: 'Confirm',
    cancel: 'Cancel',
    delete: 'Delete',
  },
  /** `BroadcastPresetType` values. */
  presetType: {
    match_preview: 'Match',
    match_results: 'Match Results',
    standings: 'Standings',
    attract: 'Attract',
    draft: 'Draft',
    recap: 'Recap',
    match_story: 'Match Story',
    team_comparison: 'Team Comparison',
    h2h_history: 'Head-to-Head',
    moment_reel: 'Moment Reel',
    usage_chart: 'Usage Chart',
  },
  recap: {
    title: 'Recap Generator',
    copyUrl: 'Copy Recap URL',
  },
  moments: {
    title: 'Broadcast Moments',
    momentType: 'Moment Type',
    allTypes: 'All Types',
    loading: 'Loading moments…',
    loadFailed: 'Failed to load moments',
    networkError: 'Network error loading moments',
    empty: 'No moments recorded for this match.',
    turn: 'Turn {n}',
  },
  /** `BroadcastMomentType` values. */
  momentType: {
    turning_point: 'Turning Point',
    big_ko: 'Big KO',
    misplay: 'Misplay',
    clutch: 'Clutch',
    highlight: 'Highlight',
  },
} as const;
