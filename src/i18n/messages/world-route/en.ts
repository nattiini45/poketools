/**
 * `world-route` (T20): the DOM words of the shared 3D route engine
 * (`src/components/world/route/**`, `src/lib/route-world/**`) and the plaza
 * world's accessible subject names — the Station Card, the Pokéball loader
 * and its status lines, the theme veil, the hover pill and the focus
 * subjects' labels. Canvas words live in `paint`.
 */
export default {
  card: {
    readAsText: 'Read as text',
    regionLabel: 'Station',
    regionName: '{region}: {title}',
    railLabel: 'Trainers',
    kicker: '{index}/{total} · {title}',
  },
  digest: {
    liveTag: 'Live',
    live: '{live} · {pair}',
    standingsTop: '1. {name} · {points} pts',
    noStandings: 'No standings yet',
    matchday: 'Matchday {n}',
    fixtureDone: '{matchday} · {teams} · final',
    fixtureWhen: '{matchday} · {teams} · {when}',
    noMatches: 'No matches scheduled yet',
    noLines: 'No lines yet',
    linesOnRoster: { one: '{count} line on the roster', other: '{count} lines on the roster' },
    trainersOnRoster: { one: '{count} trainer on the roster', other: '{count} trainers on the roster' },
    ruleset: 'Ruleset: {name}',
    draftBudget: 'Draft budget: {budget} pts',
    formatNoRuleset: '{format} · {noRuleset}',
    leagueDefaults: 'League default rules',
    noTrainers: 'No trainers yet',
    trainerCount: { one: '{count} trainer', other: '{count} trainers' },
    trainerCountLead: { one: '{count} trainer · 1. {name}', other: '{count} trainers · 1. {name}' },
  },
  cta: {
    standings: 'Open the standings',
    roster: 'Read all lines',
    schedule: 'Open the schedule',
    rules: 'Read the rules',
    team: 'See the teams',
  },
  loader: {
    stage: {
      loading: 'Loading the world',
      renderer: 'Starting graphics',
      assets: 'Models loaded',
      compiled: 'Shaders ready',
      uploaded: 'Textures loaded',
      firstFrame: 'Building the world',
      ready: 'World ready',
      usable: 'The page is already usable.',
    },
    warm: {
      placing: 'Placing',
      shaders: 'Shaders',
      shadows: 'Shadows',
      textures: 'Textures',
      geometry: 'Geometry',
      effects: 'Effects',
      stations: 'Stations',
      final: 'Final frame',
    },
    line: '{stage} · {count}/{total}',
    warmStep: '{step} {n}',
  },
  veil: {
    day: 'Switching the world to day',
    night: 'Switching the world to night',
  },
  hoverHint: 'Click to look closer',
  subject: {
    pulseBoard: 'Pulse board',
    scheduleBoard: 'Schedule board',
    kiosk: 'Rotom PC · Roster',
    rulesPlaque: 'Ruleset — {title}',
    aceOf: '{species} — {name}’s ace',
    rollCall: 'Roll call — every trainer in standings order',
  },
} as const;
