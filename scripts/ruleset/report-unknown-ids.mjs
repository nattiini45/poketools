#!/usr/bin/env node
/**
 * Pre-flight gate of the Ruleset Studio migration (supabase/migrations/20261026100100_ruleset_conversion_and_pins.sql):
 * reports the legacy ruleset entries whose conversion to a dex id is not the identity of what the old validator did.
 *
 * The old validator compared NAMES in lower case (`entry.toLowerCase() === entity.name.toLowerCase()`). The migration turns
 * every entry into an id with the SQL twin of `toID` (`epb_fold_id`: accents folded, symbols dropped). Three lists:
 *
 *   unmatched    entries whose id matches no Pokémon, move, item or ability of any generation: typos. They stay as ids that
 *                match nothing, exactly as the old exact compare never matched them. Informational.
 *   foldedOnly   entries whose id matches an entity although the old exact-name compare did NOT ('Mr Mime', 'Tapu-Koko',
 *                'Farfetch'd' written with the keyboard apostrophe). After the migration they BAN what they obviously meant,
 *                so the ruleset becomes stricter than it was. The owner decides: fix the entry, or accept the stricter rule.
 *   foldMismatch entries whose id differs between the SQL fold and the application fold (`toID`). Must be empty; needs
 *                `--sql-fold`. A non-empty list means the two folds drifted and the conversion would store wrong ids.
 *
 * Usage (read-only; the input is an export, nothing here touches a database):
 *
 *   1. Export the legacy rulesets (maintainer, read-only SQL):
 *        select json_agg(to_jsonb(r)) from public.rulesets r;                          -> rulesets.json
 *   2. Export the SQL fold of every entry (same connection):
 *        select json_agg(json_build_object('entry', e, 'sql_id', public.epb_fold_id(e)))
 *          from (select distinct unnest(banned_pokemon || banned_moves || banned_items || banned_abilities
 *                                       || added_pokemon || clauses) as e from public.rulesets) s;   -> folds.json
 *   3. node scripts/ruleset/report-unknown-ids.mjs rulesets.json --sql-fold folds.json [--json report.json] [--strict]
 *
 * Exit code: 0 clean (or only informational lists), 1 with --strict when `foldedOnly` or `unmatched` is non-empty, 2 when
 * `foldMismatch` is non-empty (always: the migration must not run). Never part of CI.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { toID } from '../pkmn-i18n/build.mjs';

/** The application's id fold (src/lib/pkmn/i18n/id.ts, pinned to `toID` of scripts/pkmn-i18n/build.mjs by the id parity test) of any stored value. */
const idOf = (entry) => toID(String(entry));

export const CATEGORIES = [
  ['banned_pokemon', 'pokemon'],
  ['banned_moves', 'moves'],
  ['banned_items', 'items'],
  ['banned_abilities', 'abilities'],
  ['added_pokemon', 'pokemon'],
];

/**
 * @param {Array<Record<string, unknown>>} rows legacy `rulesets` rows
 * @param {Record<'pokemon'|'moves'|'items'|'abilities', Map<string, string>>} names id to English name, per category
 * @param {Array<{ entry: string, sql_id: string }> | null} sqlFold the SQL fold of the entries, or null when not exported
 */
export function analyze(rows, names, sqlFold = null) {
  const unmatched = [];
  const foldedOnly = [];
  const foldMismatch = [];
  const seenFold = new Set();

  for (const row of rows) {
    const ruleset = String(row.name ?? row.id);
    for (const [column, category] of CATEGORIES) {
      const entries = Array.isArray(row[column]) ? row[column] : [];
      for (const entry of entries) {
        const id = idOf(entry);
        const entity = names[category].get(id);
        if (entity === undefined) {
          unmatched.push({ ruleset, category, column, entry, id });
        } else if (String(entry).toLowerCase() !== entity.toLowerCase()) {
          foldedOnly.push({ ruleset, category, column, entry, id, entity });
        }
      }
    }
  }

  if (sqlFold !== null) {
    for (const { entry, sql_id: sqlId } of sqlFold) {
      if (seenFold.has(entry)) continue;
      seenFold.add(entry);
      if (idOf(entry) !== sqlId) foldMismatch.push({ entry, app_id: idOf(entry), sql_id: sqlId });
    }
  }
  return { unmatched, foldedOnly, foldMismatch };
}

/** The id-to-name maps of the installed dex, every generation's entities (past ones included). */
export async function loadDexNames() {
  const { Dex } = await import('@pkmn/dex');
  const collect = (list) => new Map(list.filter((e) => e.exists).map((e) => [e.id, e.name]));
  return {
    pokemon: collect(Dex.species.all()),
    moves: collect(Dex.moves.all()),
    items: collect(Dex.items.all()),
    abilities: collect(Dex.abilities.all()),
  };
}

function render(report, foldChecked) {
  const lines = [];
  const section = (title, items, line) => {
    lines.push(`${title}: ${items.length}`);
    for (const item of items) lines.push(`  ${line(item)}`);
  };
  section('unmatched (typos; match nothing before and after)', report.unmatched, (i) => `${i.ruleset} [${i.column}] "${i.entry}" -> ${i.id}`);
  section('foldedOnly (never matched the old compare, match after the fold: the ruleset gets stricter)', report.foldedOnly, (i) => `${i.ruleset} [${i.column}] "${i.entry}" -> ${i.id} = ${i.entity}`);
  if (foldChecked) section('foldMismatch (SQL fold differs from toID; MUST be empty)', report.foldMismatch, (i) => `"${i.entry}": app ${i.app_id}, sql ${i.sql_id}`);
  else lines.push('foldMismatch: not checked (pass --sql-fold <folds.json>)');
  return lines.join('\n');
}

async function main(argv) {
  const args = argv.slice(2);
  const file = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--sql-fold' && args[args.indexOf(a) - 1] !== '--json');
  const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
  if (!file) {
    console.error('usage: report-unknown-ids.mjs <rulesets.json> [--sql-fold folds.json] [--json report.json] [--strict]');
    return 64;
  }
  const rows = JSON.parse(readFileSync(file, 'utf8')) ?? [];
  const sqlFoldFile = flag('--sql-fold');
  const sqlFold = sqlFoldFile ? JSON.parse(readFileSync(sqlFoldFile, 'utf8')) ?? [] : null;
  const report = analyze(rows, await loadDexNames(), sqlFold);
  console.log(render(report, sqlFold !== null));
  const jsonOut = flag('--json');
  if (jsonOut) writeFileSync(jsonOut, `${JSON.stringify(report, null, 2)}\n`);
  if (report.foldMismatch.length > 0) return 2;
  if (args.includes('--strict') && (report.foldedOnly.length > 0 || report.unmatched.length > 0)) return 1;
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv).then((code) => process.exit(code));
}
