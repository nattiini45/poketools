/**
 * `world-themes` (T21): the copy of the four route themes in
 * `src/components/world/themes/**` — station beats and card titles, the
 * loader lines, the isle themes' section vocabulary, the 3D subjects'
 * accessible names and every word the isle painters put on a canvas.
 *
 * Painted words are stored in sentence case; painters upper-case them with
 * `upperForPaint` (`paintText` in `themes/paint-copy.ts`), so the English
 * canvases read exactly as before. Pokémon names never live here: they come
 * from `src/lib/pkmn/i18n`.
 */
export default {
  stations: {
    plaza: {
      pulse: { title: 'Pulse', beat: 'The season exists — and this is where it stands.' },
      roster: { title: 'Roster', beat: 'These are the lines you can buy.' },
      teams: { title: 'Teams', beat: 'Every trainer holds a gym — this is what they drafted.' },
      schedule: { title: 'Schedule', beat: 'This is where matches are played — and where the table stands.' },
      rules: { title: 'Rules', beat: 'And these are the rules that give it all meaning.' },
    },
    sakura: {
      pulse: { title: 'Pulse', beat: 'The season exists — and the lake keeps score.' },
      roster: { title: 'Roster', beat: 'These are the lines in bloom — pick them wisely.' },
      teams: { title: 'Teams', beat: 'Every trainer keeps a gym — they drafted for it.' },
      schedule: { title: 'Schedule', beat: 'Here is where matches are played — and where the table stands.' },
      rules: { title: 'Rules', beat: 'And these are the rules that give it all meaning.' },
    },
    mountain: {
      pulse: { title: 'Pulse', beat: 'The season stands at the top — the summit keeps score.' },
      roster: { title: 'Roster', beat: 'These are the lines on the register — sign them wisely.' },
      teams: { title: 'Teams', beat: 'Every trainer keeps a cairn — they drafted for it.' },
      schedule: { title: 'Schedule', beat: 'Here is where matches are played — and the signs say when.' },
      rules: { title: 'Rules', beat: 'And these are the rules of the pass — they hold in any weather.' },
    },
    clouds: {
      pulse: { title: 'Pulse', beat: 'The season rides the sky — the flagship keeps score.' },
      roster: { title: 'Roster', beat: 'These are the lines on the register — sign them wisely.' },
      teams: { title: 'Teams', beat: 'Every trainer keeps a float — they drafted for it.' },
      schedule: { title: 'Schedule', beat: 'Here is where matches are played — and the board says when.' },
      rules: { title: 'Rules', beat: 'And these are the rules of the isles — they hold at any altitude.' },
    },
  },
  loader: {
    loading: 'Loading the 3D world – the page is already usable',
    ready: '3D world ready',
    failed: 'The 3D world could not load.',
    retry: 'Retry 3D world',
  },
  nav: {
    sakura: { label: 'Sakura Park sections', brand: 'Sakura Park' },
    mountain: { label: 'Mountain Pass sections', brand: 'Mountain Pass' },
    clouds: { label: 'Skyisle sections', brand: 'Skyisle' },
  },
  sections: {
    sakura: {
      place: 'Sakura Park',
      scheduleUpcomingPainted: 'painted on the banner row',
      teamsIntro:
        'Every trainer keeps a gym — their statue stands on the east terrace, their ace upon the pedestal and their name on the plaque below it.',
      rosterPointBuy: {
        one: '{count} evolution line in bloom — the full point-buy list, painted on the shrine wall and priced by group.',
        other: '{count} evolution lines in bloom — the full point-buy list, painted on the shrine wall and priced by group.',
      },
      rosterEmpty: 'No roster lines yet — the wall fills as the list is drafted.',
      rulesPlaysBy: 'The park plays by',
      rulesSpiritHeading: 'Evolution & spirit of the park',
      rulesPlaqueNote: 'The red rung of the bracket on the torii plaque carries the same numbers you read here.',
      rulesFormatNote: 'The plaque hanging from the torii carries the same format and best-of you read here.',
    },
    mountain: {
      place: 'Mountain Pass',
      scheduleUpcomingPainted: 'painted on the trail signs',
      teamsIntro:
        'Every trainer keeps a cairn — their statue stands on the east terrace, their ace upon the cap and their name on the plate below it.',
      rosterPointBuy: {
        one: '{count} evolution line on the register — the full point-buy list, painted on the lodge wall and priced by group.',
        other: '{count} evolution lines on the register — the full point-buy list, painted on the lodge wall and priced by group.',
      },
      rosterEmpty: 'No roster lines yet — the register fills as the list is drafted.',
      rulesPlaysBy: 'The pass plays by',
      rulesSpiritHeading: 'Evolution & spirit of the pass',
      rulesPlaqueNote: 'The tablet on the pass gate carries the same numbers you read here.',
      rulesFormatNote: 'The tablet on the pass gate carries the same format and best-of you read here.',
    },
    clouds: {
      place: 'Skyisle',
      scheduleUpcomingPainted: 'painted on the fixtures airship',
      teamsIntro:
        'Every trainer keeps a float — it hangs over the aces isle, their ace enshrined beneath their name on the plaque.',
      rosterPointBuy: {
        one: "{count} evolution line on the register — the full point-buy list, painted on the register airship's sail and priced by group.",
        other:
          "{count} evolution lines on the register — the full point-buy list, painted on the register airship's sail and priced by group.",
      },
      rosterEmpty: 'No roster lines yet — the register fills as the list is drafted.',
      rulesPlaysBy: 'The isles play by',
      rulesSpiritHeading: 'Evolution & spirit of the isles',
      rulesPlaqueNote: 'The plaque on the halo gate carries the same numbers you read here.',
      rulesFormatNote: 'The plaque on the halo gate carries the same format and best-of you read here.',
    },
  },
  subjects: {
    sakura: {
      pulse: "Pulse board — the jumbotron rock's league screen",
      roster: "Roster wall — the shrine's painted frieze",
      schedule: 'Schedule banners — fixtures, results and the table',
      rules: "League rules — the torii's hanging gakuzuka tablet",
    },
    mountain: {
      pulse: "Pulse board — the summit station's slate face",
      roster: "Trail register — the lodge's painted roster frieze",
      schedule: 'Trail signs — fixtures, results and the table',
      rules: "League rules — the pass gate's hanging tablet",
    },
    clouds: {
      pulse: "Pulse board — the flagship's standings sail",
      roster: 'The register — the roster sail',
      schedule: 'Schedule board — the fixtures sail',
      rules: "League rules — the halo gate's hung plaque",
    },
    rollCall: 'Trainer roll call — every trainer in standings order',
    ace: "{species} — {name}'s ace",
  },
  paint: {
    plazaLed: {
      arena: 'Your arena.',
      glory: 'Your glory.',
      ticker: 'League live  •  Matchday on  •  Gyms open',
    },
    status: { open: 'Open', live: 'Live', done: 'FT' },
    livePill: 'Live {home}–{away}',
    kickoffLive: 'Live · {pair}',
    kickoffNext: 'Next kickoff · {date} {time}',
    matchesPlayed: { one: '{count} match played', other: '{count} matches played' },
    matchesFlown: { one: '{count} match flown', other: '{count} matches flown' },
    trainers: { one: '{count} trainer', other: '{count} trainers' },
    matchday: 'Matchday {n}',
    matchdayShort: 'MD {n}',
    firstHalf: '1st half',
    secondHalf: '2nd half',
    more: '+{count} more',
    versus: '{home} vs {away}',
    standingPoints: '{points} pts',
    priceBand: '{price} pts · {band}',
    priceBandPlain: '{price} pts {band}',
    gym: '{type} gym',
    openGym: 'Open gym',
    empty: {
      noTable: 'No table yet',
      formsPark: "It forms with the park's first results",
      formsPass: "It forms with the pass's first results",
      formsIsles: "It forms with the isles' first results",
      nothingPosted: 'Nothing posted yet',
      noRosterLines: 'No roster lines yet',
      noFixtures: 'No fixtures scheduled yet',
    },
    table: { trainer: 'Trainer', win: 'W', loss: 'L', diff: 'Diff', points: 'Pts' },
    fixturesBoard: { match: 'Match', kickoff: 'Kickoff', status: 'Status' },
    heading: {
      fixtures: 'Fixtures',
      upNext: 'Up next',
      results: 'Results',
      pulse: 'Pulse',
      table: 'Table',
      standings: 'Standings',
      schedule: 'Schedule',
      later: 'Later',
      latest: 'Latest',
      season: 'Season',
      top: 'Top {count}',
      roster: 'Roster',
    },
    brand: {
      sakuraBand: 'Sakura Park league',
      summit: 'Summit standings',
      summitShort: 'Standings',
      skyisleStandings: 'Skyisle standings',
      skyisleFixtures: 'Skyisle fixtures',
    },
    note: {
      rosterWallAll: 'Roster wall — {shown} of {total} lines · tap the wall for all {total}',
      rosterWallSome: 'Roster wall — {shown} of {total} lines · tap the wall to read it up close',
      rosterWall: 'Roster wall · tap the wall to read it up close',
      linesUpClose: '{shown} of {total} lines · tap to read up close',
      trailRegister: 'Trail register · tap to read up close',
      register: 'The register · tap to read up close',
    },
    rules: {
      titlePark: 'Rules of the park',
      titlePass: 'Rules of the pass',
      titleIsles: 'Rules of the isles',
      draftBudget: 'Draft budget',
      linesPerTrainer: 'Lines per trainer',
      linesEach: 'Lines each',
      teraStage1: 'Tera — stage 1',
      bannedMoves: 'Banned moves',
      compactDraft: 'Draft',
      compactLines: 'Lines',
      compactTera: 'Tera',
      compactBanned: 'Banned',
      budgetValue: '{points} pts',
      teraFree: 'Free Tera',
      teraStab: 'STAB only',
      teraNone: 'No Tera',
      defaultsNote: 'No explicit rules configured — league defaults apply.',
    },
  },
} as const;
