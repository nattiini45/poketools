#!/usr/bin/env node
/**
 * Writes src/lib/pkmn/sprite-maps/showdown-ids.json: the Showdown sprite ids the
 * app cannot derive from a species name alone (docs/pkmn.md, "Sprite styles").
 *
 * The app derives a Showdown sprite id by splitting the name at its first hyphen
 * ("Rotom-Wash" -> "rotom-wash"). Base species whose own name carries a hyphen
 * ("Ho-Oh" -> "hooh", "Kommo-o-Totem" -> "kommoo-totem") need an entry here.
 * Keys are @pkmn species ids. Offline, deterministic, no network.
 *
 * Usage: node scripts/sprites/build-showdown-ids.mjs [--check]
 *   --check  exit 1 when the committed file differs from the derivation (CI-style check)
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Dex } from '@pkmn/dex';
import { SHOWDOWN_IDS_FILE, log, naiveShowdownSpriteId, showdownSpriteId, spriteSpecies, stableJson } from './lib.mjs';

/** `{ [@pkmn id]: showdown sprite id }` for every species whose naive id is wrong. */
export function buildShowdownIds(dex = Dex) {
  const out = {};
  for (const species of spriteSpecies(dex)) {
    const id = showdownSpriteId(species);
    if (naiveShowdownSpriteId(species.name) !== id) out[species.id] = id;
  }
  return out;
}

export function main(argv = process.argv.slice(2), file = SHOWDOWN_IDS_FILE) {
  const check = argv.includes('--check');
  const unknown = argv.filter((a) => a !== '--check');
  if (unknown.length > 0) {
    console.error(`build-showdown-ids: unknown argument "${unknown[0]}"\nusage: build-showdown-ids.mjs [--check]`);
    return 2;
  }
  const text = stableJson(buildShowdownIds());
  if (check) {
    const current = readFileSync(file, 'utf8');
    if (current !== text) {
      console.error(`build-showdown-ids: ${file} is stale; run node scripts/sprites/build-showdown-ids.mjs`);
      return 1;
    }
    log(`build-showdown-ids: ${file} is current`);
    return 0;
  }
  writeFileSync(file, text);
  log(`build-showdown-ids: wrote ${Object.keys(JSON.parse(text)).length} entries to ${file}`);
  return 0;
}

const invokedDirectly = Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) process.exit(main());
