#!/usr/bin/env node
// scripts/ruleset-presets/generate-champions-roster.mjs: writes src/lib/pkmn/preset-data/champions-roster.generated.ts.
//
//   node scripts/ruleset-presets/generate-champions-roster.mjs --base <dir> --mod <dir> --sha <40 hex> --date <YYYY-MM-DD>
//                                                              [--out <file>] [--regulation M-C]
//
// --base  a directory with Showdown's base data tables: pokedex.ts, formats-data.ts, items.ts, abilities.ts, moves.ts,
//         learnsets.ts (the files of data/ in smogon/pokemon-showdown)
// --mod   a directory with the files of data/mods/champions/ (the ones the mod has: formats-data.ts, items.ts, ...)
// --sha   the commit of smogon/pokemon-showdown both directories were taken from; it is written into the output
//
// The script reads only the directories it is given (no network) and parses the files without executing them.
// After refreshing, rerun it, review the diff, bump PRESET_RULES_VERSION (src/lib/pkmn/preset-data/pin.ts) and run
// the preset tests; the refresh procedure is in docs/ruleset-presets.md.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveChampionsRoster, emitRosterModule, parseDataTable, TABLES } from './champions-roster.mjs';

const FILE_OF = {
  Pokedex: 'pokedex',
  FormatsData: 'formats-data',
  Items: 'items',
  Abilities: 'abilities',
  Moves: 'moves',
  Learnsets: 'learnsets',
};

function readTables(dir, { required }) {
  const tables = {};
  for (const table of TABLES) {
    const file = path.join(dir, `${FILE_OF[table]}.ts`);
    if (!fs.existsSync(file)) {
      if (required && table !== 'Pokedex') throw new Error(`missing ${file}`);
      tables[table] = null;
      continue;
    }
    tables[table] = parseDataTable(fs.readFileSync(file, 'utf8'), table);
    if (tables[table] === null) throw new Error(`${file} declares no ${table} constant`);
  }
  return tables;
}

function parseArgs(argv) {
  const args = new Map();
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith('--') || argv[i + 1] === undefined) throw new Error(`bad argument: ${argv[i]}`);
    args.set(argv[i].slice(2), argv[i + 1]);
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const base = args.get('base');
  const mod = args.get('mod');
  const sha = args.get('sha');
  const date = args.get('date');
  if (!base || !mod || !sha || !date) throw new Error('usage: --base <dir> --mod <dir> --sha <40 hex> --date <YYYY-MM-DD> [--out <file>] [--regulation M-C]');
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error('--sha must be a full 40-character commit hash');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('--date must be YYYY-MM-DD');

  const roster = deriveChampionsRoster({ base: readTables(base, { required: true }), mod: readTables(mod, { required: false }) });
  const out =
    args.get('out') ??
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/lib/pkmn/preset-data/champions-roster.generated.ts');
  fs.writeFileSync(out, `${emitRosterModule(roster, { sha, date, mod: 'champions', regulation: args.get('regulation') ?? 'M-C' })}\n`);
  const { species } = roster;
  console.log(
    `wrote ${out}: ${species.selectable.length} selectable, ${species.mega.length} Mega, ${species.battleOnly.length} battle-only, ` +
      `${species.cosmetic.length} cosmetic species; ${roster.items.length} items; ${roster.abilities.length} + ${roster.megaAbilities.length} abilities; ${roster.moves.length} moves`,
  );
}

main();
