import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * No direct writes, and an allow-list of what the model-facing modules may import (plan 3.9 test 3).
 *
 * The v2 denylist by name pattern (`create*`, `update*`, ...) is not sound: many mutating exports on main do not match
 * it (`saveFormatDraft`, `publishRulesetVersion`, `repinTarget`, `moveLeagueToTrash`, `reorderPhases`, ...). So the test
 * is inverted. Everything under `registry/`, `readers/` and `previews/` may import from `@/` only the modules and names
 * listed here. A module marked `'*'` is pure or read-only as a whole; a database query module must list its names, and no
 * listed name may look like a write. Adding an import means adding it here, where a reviewer sees it.
 *
 * Also forbidden in these directories: the service-role client, the Supabase SDK, `.from(` / `.insert(` / `.update(` /
 * `.upsert(` / `.delete(` / `.rpc(`, the audit writer, the Discord and social emitters, and the superadmin guards.
 */

const ROOT = path.join(process.cwd(), 'src/lib/ai/admin-agent');
const DIRS = ['registry', 'readers', 'previews'];

type Allowed = readonly string[] | '*';

/** `@/` module -> the value imports it may supply. `'*'` only for modules that are pure or read-only as a whole. */
const ALLOWED: Record<string, Allowed> = {
  // Error catalog and shared error types.
  '@/i18n/messages/errors': ['ERROR_CATALOGS'],
  '@/lib/api/user-facing-error': ['UserFacingError'],
  '@/lib/supabase/timeout-fetch': ['isSupabaseTimeoutError'],
  // Guards (the route's own live require* helpers; never the superadmin ones).
  '@/lib/auth/helpers': ['requireAdmin', 'requireAnyAdmin', 'requireDraftAdmin', 'requireFormatViewer', 'requireResourceAdmin'],
  '@/lib/ruleset-studio/guards': ['assertRulesetUsable', 'requireRulesetOwner', 'requireRulesetViewer'],
  '@/lib/auth/admin-scope': ['getAdminScope', 'scopeAllowsSeason'],
  // Pure catalogs, dex lookups and kits.
  '@/lib/pkmn/dex': ['getAbility', 'getAbilityNatDex', 'getItem', 'getItemNatDex', 'getMove', 'getMoveNatDex', 'getSpecies', 'getSpeciesNatDex', 'searchAbilities', 'searchItems', 'searchMoves', 'searchSpecies'],
  '@/lib/pkmn/format-catalog': ['PRESET_FAMILIES', 'getPreset'],
  '@/lib/pkmn/i18n/id': ['toID'],
  '@/lib/pkmn/preset-data/pin': ['CHAMPIONS_ROSTER_PIN', 'PRESET_DATA_PIN', 'PRESET_RULES_VERSION'],
  '@/lib/pkmn/preset-rules.server': ['resolvePresetRules', 'resolveTourOverlay'],
  '@/lib/pkmn/ruleset-preset-catalog': ['filterRulesetPresets', 'getRulesetPreset', 'isRulesetPresetId', 'listRulesetPresets'],
  '@/lib/pkmn/validation': ['validateTeam'],
  '@/lib/players/public-player': ['toPublicPlayerRef', 'toPublicTournamentParticipant'],
  '@/lib/ruleset-kit/effective': ['computeEffective', 'diffResolved'],
  '@/lib/ruleset-kit/ops': ['allowEntries', 'banEntries', 'resetEntries', 'setClause', 'setMode'],
  '@/lib/ruleset-kit/overlay': ['applyTourOverlay'],
  '@/lib/ruleset-kit/types': ['RULESET_CATEGORIES'],
  '@/lib/studio-core/ltext': ['resolveLText'],
  // One definition of the invisible characters (tag characters, bidi marks, zero-width, variation selectors).
  '@/lib/utils/hidden-text': ['stripHiddenChars'],
  '@/lib/tournament/bracket-structure': ['buildBracketStructureForParticipants'],
  '@/lib/tournament/group-schedule': ['GroupScheduleError', 'planGroupSchedule'],
  '@/lib/tournament/league-phase': ['assertPhaseNameFree'],
  '@/lib/tournament/round-robin': ['getRoundRobinTotalRounds'],
  '@/lib/season/format-utils': ['isEvolutionPointBuy'],
  '@/lib/season/settings-guards': ['assertSeasonDateRange'],
  '@/lib/season/clone': ['assertCloneAllowed'],
  '@/lib/validation': ['formatZodErrors', 'phaseCreateSchema', 'seasonCreateRequestSchema', 'tournamentCreateSchema'],
  '@/lib/ruleset-studio/api-schemas': ['rulesetPinImpactSchema', 'rulesetPublishSchema'],
  // Ruleset Studio / Format Studio library functions that read or compute (each name checked, none mutates).
  '@/lib/ruleset-studio/compile.server': ['compileDocument'],
  '@/lib/ruleset-studio/describe.server': ['describeResolved'],
  '@/lib/ruleset-studio/document': ['newRulesetDocument'],
  '@/lib/ruleset-studio/library': ['getRulesetDetail', 'toActor'],
  '@/lib/ruleset-studio/pin-impact.server': ['computePinImpact'],
  '@/lib/ruleset-studio/pins': ['listUsage'],
  '@/lib/ruleset-studio/view': ['toRulesetView'],
  '@/lib/format-studio/attach-candidates': ['loadAttachCandidates'],
  '@/lib/format-studio/library': ['getFormatDetail', 'toActor'],
  // Rate limiting: a read-then-count on a shared bucket, not a domain write (the pin-impact preview shares the route's bucket).
  '@/lib/utils/rate-limit': ['checkRateLimit'],
  // Database query modules: every name listed, none may look like a write.
  '@/lib/supabase/queries/draft-pool-entries': ['getPoolEntries'],
  '@/lib/supabase/queries/draft-pool-templates': ['getTemplate', 'listTemplates'],
  '@/lib/supabase/queries/draft-tier-limits': ['getTierLimits'],
  '@/lib/supabase/queries/drafts': ['getDraftPoolById', 'getDraftPoolsBySeasonWithGroups'],
  '@/lib/supabase/queries/format-definitions': ['listFormatDefinitions'],
  '@/lib/supabase/queries/format-rules': ['getFormatRules'],
  '@/lib/supabase/queries/league-trash': ['getLeagueTrashBySeason'],
  '@/lib/supabase/queries/players': ['listPlayers'],
  '@/lib/supabase/queries/point-buy-lists': ['getActiveListVersion', 'getPointBuyListById', 'getPointBuyListVersions'],
  '@/lib/supabase/queries/ruleset-definitions': ['getRulesetVersion', 'listRulesetDefinitions'],
  '@/lib/supabase/queries/season-formats': ['getSeasonFormatSummary', 'getSeasonManualPhaseCount', 'getSeasonStartSignals'],
  '@/lib/supabase/queries/season-groups': ['getSeasonGroups'],
  '@/lib/supabase/queries/seasons': ['getPublicSeasonParticipants', 'getSeasonById', 'getSeasonWithDetails', 'listSeasons'],
  '@/lib/supabase/queries/tournaments': ['getParticipants', 'getStagesBySeasonId', 'getTournamentWithDetails', 'listTournaments', 'listTournamentsByIds'],
};

/** Names that look like writes. Applied to the allow-list itself as a second net (it is not sound alone, which is why the list exists). */
const WRITE_LOOKING = /^(create|insert|update|delete|add|remove|replace|upsert|set(?!Clause|Mode)|save|publish|repin|attach|detach|move|restore|expire|archive|reorder|swap|claim|bulk|clear|mark|apply(?!TourOverlay)|bind|regenerate|generate|merge|reset(?!Entries)|ban(?!Entries)|allow(?!Entries))/;

/** Imports that must never appear in these directories, whatever list they are on. */
const FORBIDDEN_MODULES = [
  '@/lib/supabase/client',
  '@supabase/supabase-js',
  '@/lib/audit/log',
  '@/lib/discord',
  '@/lib/social',
  '@/lib/revalidation',
];
const FORBIDDEN_NAMES = /\b(requireSuperadmin|isSuperadmin|logAuditEvent|emitDiscordEvent|emitSocialEvent|revalidateTag|revalidatePath)\b/;
/** `.from('table'` (not `Array.from`) and the write verbs of the Supabase client. `createHash(...).update(` is crypto, removed before the scan. */
const FORBIDDEN_CALLS = /\.\s*from\s*\(\s*['"`]|\.\s*(insert|update|upsert|delete|rpc)\s*\(/;

function files(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry !== '__tests__') walk(full);
      } else if (full.endsWith('.ts')) {
        out.push(full);
      }
    }
  };
  for (const dir of DIRS) walk(path.join(ROOT, dir));
  return out;
}

/** The source without comments and string-literal contents that are not import paths. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

interface Import {
  module: string;
  names: string[];
  typeOnly: boolean;
}

function importsOf(source: string): Import[] {
  const out: Import[] = [];
  const text = code(source);
  for (const match of text.matchAll(/import\s+(type\s+)?([^'";]*?)\s+from\s+'([^']+)'/g)) {
    const [, typeKeyword, clause, module] = match;
    const names: string[] = [];
    for (const part of clause.replace(/[{}]/g, ',').split(',')) {
      const trimmed = part.trim();
      if (trimmed === '' || trimmed.startsWith('type ')) continue;
      names.push(trimmed.split(/\s+as\s+/)[0].replace(/^\*\s+as\s+/, '*').trim());
    }
    out.push({ module, names, typeOnly: typeKeyword !== undefined });
  }
  for (const match of text.matchAll(/(?:^|\n)\s*export\s+(?:type\s+)?(?:\*|\{[^}]*\})\s+from\s+'([^']+)'/g)) {
    out.push({ module: match[1], names: ['*'], typeOnly: false });
  }
  for (const match of text.matchAll(/import\(\s*'([^']+)'\s*\)/g)) out.push({ module: match[1], names: ['*'], typeOnly: false });
  return out;
}

const rel = (file: string) => path.relative(ROOT, file).replaceAll('\\', '/');

describe('registry, readers and previews: no writes, allow-listed imports only', () => {
  const sources = files().map((file) => ({ file: rel(file), source: readFileSync(file, 'utf8') }));

  it('scans the three directories', () => {
    expect(sources.length).toBeGreaterThan(20);
    expect(new Set(sources.map((s) => s.file.split('/')[0]))).toEqual(new Set(DIRS));
  });

  it('imports from @/ only listed modules and, for each, only listed names', () => {
    const problems: string[] = [];
    for (const { file, source } of sources) {
      for (const imported of importsOf(source)) {
        if (!imported.module.startsWith('@/')) continue;
        if (imported.typeOnly) continue;
        const allowed = ALLOWED[imported.module];
        if (allowed === undefined) {
          // A module that exports only types (no runtime import) leaves no names; anything with a value name is a violation.
          if (imported.names.length > 0) problems.push(`${file}: ${imported.module} is not on the allow-list (${imported.names.join(', ')})`);
          continue;
        }
        if (allowed === '*') continue;
        for (const name of imported.names) {
          if (!allowed.includes(name)) problems.push(`${file}: ${name} from ${imported.module} is not allow-listed`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('keeps every allow-listed name off the write-looking list, and every query module explicit', () => {
    for (const [module, names] of Object.entries(ALLOWED)) {
      if (module.startsWith('@/lib/supabase/queries/')) expect(names, module).not.toBe('*');
      if (names === '*') continue;
      for (const name of names) {
        if (name === 'toActor' || name === 'checkRateLimit') continue;
        expect(WRITE_LOOKING.test(name), `${module}: ${name} looks like a write`).toBe(false);
      }
    }
  });

  it('every allow-list entry is used by some file (no stale permission)', () => {
    const used = new Map<string, Set<string>>();
    for (const { source } of sources) {
      for (const imported of importsOf(source)) {
        if (imported.typeOnly || !imported.module.startsWith('@/')) continue;
        const set = used.get(imported.module) ?? new Set<string>();
        for (const name of imported.names) set.add(name);
        used.set(imported.module, set);
      }
    }
    const stale: string[] = [];
    for (const [module, names] of Object.entries(ALLOWED)) {
      if (names === '*') continue;
      for (const name of names) if (!used.get(module)?.has(name)) stale.push(`${module}: ${name}`);
    }
    expect(stale).toEqual([]);
  });

  it('never imports the service-role client, the SDK, the audit writer, the emitters or a cache expiry', () => {
    for (const { file, source } of sources) {
      for (const imported of importsOf(source)) {
        for (const forbidden of FORBIDDEN_MODULES) {
          expect(imported.module === forbidden || imported.module.startsWith(`${forbidden}/`), `${file} imports ${imported.module}`).toBe(false);
        }
      }
    }
  });

  it('calls no .from / .insert / .update / .upsert / .delete / .rpc and names no superadmin guard, emitter or revalidation', () => {
    for (const { file, source } of sources) {
      const text = code(source).replace(/createHash\('[^']*'\)\s*\.update\(/g, 'createHash()(');
      expect(text.match(FORBIDDEN_CALLS)?.[0], `${file} contains a direct database call`).toBeUndefined();
      expect(text.match(FORBIDDEN_NAMES)?.[0], `${file} names a forbidden function`).toBeUndefined();
    }
  });

  it('detects what it is meant to detect', () => {
    const sample = `import { createSeason, getSeasonById } from '@/lib/supabase/queries/seasons';\nimport { supabase } from '@/lib/supabase/client';\nawait supabase.from('x').insert({});`;
    expect(importsOf(sample).map((i) => i.module)).toEqual(['@/lib/supabase/queries/seasons', '@/lib/supabase/client']);
    expect(importsOf(sample)[0].names).toEqual(['createSeason', 'getSeasonById']);
    expect(ALLOWED['@/lib/supabase/queries/seasons']).not.toContain('createSeason');
    expect(code(sample).match(FORBIDDEN_CALLS)?.[0]).toBeDefined();
    expect('Array.from(x)'.match(FORBIDDEN_CALLS)).toBeNull();
    expect(WRITE_LOOKING.test('saveFormatDraft')).toBe(true);
    expect(WRITE_LOOKING.test('moveLeagueToTrash')).toBe(true);
    expect(WRITE_LOOKING.test('publishRulesetVersion')).toBe(true);
    expect(WRITE_LOOKING.test('listSeasons')).toBe(false);
  });
});
