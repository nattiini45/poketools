/**
 * The cases of the two flows whose prompts are rendered from a synthetic world: post-match analysis
 * and match-prep scouting. Each spec exercises a branch of the prompts: the three league kinds,
 * best of 1, 3 and 5, replays versus hand-entered games, hidden team sheets, a prep team versus
 * none, an opponent with and without history, German output.
 */

import type { PostMatchSpec, PrepSpec } from './world';

export const POST_MATCH_SPECS: PostMatchSpec[] = [
  { id: 'ma-gym-bo3-replays', label: 'gym league, best of 3, 2-1 with replays and team sheets', locale: 'en', league: 'gym', p1: { player: 'ada', team: 'steel' }, p2: { player: 'bram', team: 'water' }, results: ['p1', 'p2', 'p1'], replays: true, teamSheets: true, bestOf: 3, bring: 4, seed: 4101 },
  { id: 'ma-gym-bo1-replay', label: 'gym league, best of 1 with a replay', locale: 'en', league: 'gym', p1: { player: 'cleo', team: 'fire' }, p2: { player: 'dara', team: 'ground' }, results: ['p2'], replays: true, teamSheets: true, bestOf: 1, bring: 5, seed: 4102 },
  { id: 'ma-core-bo3-sweep', label: 'core league, 2-0 sweep, core types and type quota in the rules', locale: 'en', league: 'core', p1: { player: 'eli', team: 'coreA' }, p2: { player: 'faye', team: 'coreB' }, results: ['p1', 'p1'], replays: true, teamSheets: true, bestOf: 3, bring: 4, seed: 4103 },
  { id: 'ma-core-bo3-manual', label: 'core league, 1-2, games entered by hand (stats only, no turn summary)', locale: 'en', league: 'core', p1: { player: 'gus', team: 'coreC' }, p2: { player: 'hana', team: 'coreA' }, results: ['p1', 'p2', 'p2'], replays: false, teamSheets: true, bestOf: 3, bring: 4, seed: 4104 },
  { id: 'ma-open-bo3-replays', label: 'open cup (no league), 2-1 with replays', locale: 'en', league: 'open', p1: { player: 'ada', team: 'openA' }, p2: { player: 'cleo', team: 'openB' }, results: ['p2', 'p1', 'p1'], replays: true, teamSheets: true, bestOf: 3, bring: 5, seed: 4105 },
  { id: 'ma-open-bo5-four-games', label: 'open cup, best of 5 ending 3-1 (the longest prompt)', locale: 'en', league: 'open', p1: { player: 'dara', team: 'openC' }, p2: { player: 'eli', team: 'openA' }, results: ['p1', 'p2', 'p1', 'p1'], replays: true, teamSheets: true, bestOf: 5, bring: 4, seed: 4106 },
  { id: 'ma-gym-de-sweep', label: 'gym league, German output, 2-0', locale: 'de', league: 'gym', p1: { player: 'faye', team: 'ground' }, p2: { player: 'gus', team: 'steel' }, results: ['p1', 'p1'], replays: true, teamSheets: true, bestOf: 3, bring: 4, seed: 4107 },
  { id: 'ma-gym-no-sheets', label: 'gym league, team sheets not known, replays only', locale: 'en', league: 'gym', p1: { player: 'hana', team: 'water' }, p2: { player: 'ada', team: 'fire' }, results: ['p2', 'p2'], replays: true, teamSheets: false, bestOf: 3, bring: 4, seed: 4108 },
];

export const PREP_SPECS: PrepSpec[] = [
  { id: 'sc-gym-team', label: 'gym league, with a planned team, opponent with 6 games of history', locale: 'en', league: 'gym', user: { player: 'ada', team: 'steel' }, opponent: { player: 'bram', team: 'water' }, userTeam: 'prep', historyGames: 6, seed: 5101 },
  { id: 'sc-gym-noteam', label: 'gym league, no team: must suggest Fire-type picks', locale: 'en', league: 'gym', user: { player: 'cleo', team: 'fire' }, opponent: { player: 'dara', team: 'ground' }, userTeam: 'none', historyGames: 5, seed: 5102 },
  { id: 'sc-core-team', label: 'core league, with a planned team', locale: 'en', league: 'core', user: { player: 'eli', team: 'coreA' }, opponent: { player: 'faye', team: 'coreB' }, userTeam: 'prep', historyGames: 4, seed: 5103 },
  { id: 'sc-core-noteam', label: 'core league, no team: picks must serve the assigned core types', locale: 'en', league: 'core', user: { player: 'gus', team: 'coreC' }, opponent: { player: 'hana', team: 'coreA' }, userTeam: 'none', historyGames: 4, seed: 5104 },
  { id: 'sc-open-team', label: 'open cup, with a planned team, opponent with 8 games of history', locale: 'en', league: 'open', user: { player: 'ada', team: 'openA' }, opponent: { player: 'cleo', team: 'openB' }, userTeam: 'prep', historyGames: 8, seed: 5105 },
  { id: 'sc-open-nohistory', label: 'open cup, no team and an opponent with no history', locale: 'en', league: 'open', user: { player: 'dara', team: 'openC' }, opponent: { player: 'eli', team: 'openA' }, userTeam: 'none', historyGames: 0, seed: 5106 },
  { id: 'sc-gym-de-noteam', label: 'gym league, German output, no team: Ground-type picks', locale: 'de', league: 'gym', user: { player: 'faye', team: 'ground' }, opponent: { player: 'gus', team: 'steel' }, userTeam: 'none', historyGames: 5, seed: 5107 },
  { id: 'sc-gym-registered', label: 'gym league, only the registered tournament team on file (no prep team)', locale: 'en', league: 'gym', user: { player: 'hana', team: 'water' }, opponent: { player: 'ada', team: 'fire' }, userTeam: 'registered', historyGames: 3, seed: 5108 },
];
