/**
 * League wording rules, pinned over every namespace that words the league, with the active format
 * pack spliced in:
 *   - knockouts are "KOs": no "real kills" / "echte Kills" / "echte KOs", no "Kill-Differenz",
 *     no kill thresholds; token names keep "Kill" (Draft Kill Token is a name, not a count);
 *   - the list of lines is the "Point-Buy-Liste" ("Point-Buy list"), never the "Kaderliste".
 * Generic stats pages (kill ranking, top killers) are product wording and stay out of scope.
 */
import { describe, expect, it } from 'vitest';
import type { MessageTree } from '../types';
import { worldMessages } from '../messages/world';
import { worldEvoligaMessages } from '../messages/world/evoliga';
import { worldClientMessages } from '../messages/world/client';
import { worldThemesMessages } from '../messages/world-themes';
import { worldRouteMessages } from '../messages/world-route';
import { paintMessages } from '../messages/paint';
import { draftLegacyEvolutionMessages } from '../messages/draft/legacy/evolution';
import { draftDiscordMessages } from '../messages/draft/discord';
import { draftRedraftMessages } from '../messages/draft/redraft';
import { draftScreenMessages } from '../messages/draft/screen';
import { draftTokensMessages } from '../messages/draft/tokens';
import { draftSharedMessages } from '../messages/draft/shared';
import { glossaryMessages } from '../messages/glossary';
import { leagueHubMessages } from '../messages/league-hub';
import { leagueAdminMessages } from '../messages/league-admin';
import { createTranslator } from '../core';

const LEAGUE_NAMESPACES = [
  worldMessages,
  worldEvoligaMessages,
  worldClientMessages,
  worldThemesMessages,
  worldRouteMessages,
  paintMessages,
  draftLegacyEvolutionMessages,
  draftDiscordMessages,
  draftRedraftMessages,
  draftScreenMessages,
  draftTokensMessages,
  draftSharedMessages,
  glossaryMessages,
  leagueHubMessages,
  leagueAdminMessages,
];

/** Wording the rulings retired: [pattern, why]. */
const RETIRED: [RegExp, string][] = [
  [/\becht\w* (?:kills?|KOs?)\b/i, '"KOs", not "echte Kills/KOs"'],
  [/\breal (?:kills?|KOs?)\b/i, '"KOs", not "real kills/KOs"'],
  [/\bkill[- ]?(?:diff|differenz|difference)/i, '"KO difference"'],
  [/\bkill ?(?:zahl|count)/i, '"KO count"'],
  [/\bkills? (?:bis|to) (?:stage|stufe)/i, '"KOs to stage"'],
  [/\bkills? S\d/i, '"KOs S2/S3"'],
  [/\bkills? (?:wird|werden) übertragen|\bkills? transferred/i, '"KOs transferred"'],
  [/Kaderliste/i, '"Point-Buy-Liste"'],
];

/** Every leaf string (plural forms included) as [path, text]. */
function leaves(tree: MessageTree, at = ''): [string, string][] {
  return Object.entries(tree).flatMap(([key, value]): [string, string][] => {
    const where = at ? `${at}.${key}` : key;
    if (typeof value === 'string') return [[where, value]];
    return leaves(value as MessageTree, where);
  });
}

function retiredWording(): string[] {
  const hits: string[] = [];
  for (const ns of LEAGUE_NAMESPACES) {
    for (const [locale, tree] of [
      ['en', ns.en],
      ['de', ns.de],
    ] as const) {
      for (const [where, text] of leaves(tree as MessageTree)) {
        for (const [pattern, why] of RETIRED) {
          if (pattern.test(text)) hits.push(`${ns.id} ${locale} ${where}: "${text}" (${why})`);
        }
      }
    }
  }
  return hits;
}

describe('league wording (KOs, Point-Buy list)', () => {
  it('no league namespace uses the retired kill or roster-list wording', () => {
    expect(retiredWording()).toEqual([]);
  });

  it('the patterns catch the retired wording and spare the token names', () => {
    const caught = (text: string) => RETIRED.some(([pattern]) => pattern.test(text));
    for (const old of ['Echte Kills', 'echte KOs werden übertragen', 'real kills', 'Kill-Diff.', 'Kill difference', 'Killzahl', 'Kills bis Stufe 2', 'Kills S3+', '4 kills transferred', 'Kaderliste']) {
      expect(caught(old), old).toBe(true);
    }
    for (const kept of ['Draft-Kill-Token', 'Draft Kill Tokens', 'KO-Differenz', 'KOs bis Stufe 2', 'Point-Buy-Liste', 'Kill-Rangliste', 'Kader']) {
      expect(caught(kept), kept).toBe(false);
    }
  });

  it('names the list and its KO columns the new way in both languages', () => {
    const de = createTranslator(worldEvoligaMessages, 'de');
    const en = createTranslator(worldEvoligaMessages, 'en');
    expect(de('roster.heading')).toBe('Point-Buy-Liste');
    expect(en('roster.heading')).toBe('Point-Buy list');
    expect(de('line.killsToStage2')).toBe('KOs bis Stufe 2');
    expect(en('rules.tiebreaker.kill_difference')).toBe('KO difference');
    const discordDe = createTranslator(draftDiscordMessages, 'de');
    expect(discordDe('redraft.dropLine', { player: 'A', line: 'L', count: 2 })).toContain('2 KOs werden übertragen');
  });

  it('carries the pack rule note on passing moves into the rules namespace', () => {
    for (const locale of ['en', 'de'] as const) {
      const text = createTranslator(worldEvoligaMessages, locale)('rules.passRule');
      expect(text).toMatch(/Baton Pass/);
      expect(text).toMatch(/Shed Tail/);
    }
  });
});
