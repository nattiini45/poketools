// scripts/pkmn-i18n/build.mjs: the PURE half of the German Pokémon data generator (design pkmn-l10n.md §1).
// buildAll({ tables, universes, overrides }) -> { files, report }. No IO, no clock, no randomness: the caller
// (generate.mjs, or the tests) passes parsed PokeAPI CSV tables, the @pkmn universe and the reviewed overrides.
// Output is deterministic: every map is deep-sorted by key and serialised without timestamps.

/**
 * The app's one id fold. SAME BODY as src/lib/pkmn/i18n/id.ts; src/lib/pkmn/i18n/__tests__/id.test.ts pins the
 * two to identical output over every @pkmn name.
 * @param {string} text
 * @returns {string}
 */
export function toID(text) {
  return text
    .replace(/♀/g, 'f')
    .replace(/♂/g, 'm')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

/**
 * Minimal RFC 4180 CSV parser (quoted fields, doubled quotes, CRLF/LF, BOM). Returns one object per data row,
 * keyed by the header; rows with a single empty field (blank lines) are dropped.
 * @param {string} text
 * @returns {Record<string, string>[]}
 */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  for (; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c !== '\r') field += c;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [head = [], ...body] = rows;
  return body
    .filter((r) => r.length > 1 || (r.length === 1 && r[0] !== ''))
    .map((r) => Object.fromEntries(head.map((h, j) => [h, r[j] ?? ''])));
}

/** Recursively sorts object keys (arrays keep their order). */
export function sortDeep(value) {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value).sort()) out[k] = sortDeep(value[k]);
    return out;
  }
  return value;
}

/** The one serialisation used for every generated JSON file. */
export function serialize(value) {
  return JSON.stringify(sortDeep(value)) + '\n';
}

// PokeAPI language ids.
export const LANG_DE = '6';
export const LANG_EN = '9';
// Scarlet/Violet version groups, newest first. They rank above everything if PokeAPI ever ships German rows.
const SV_VGS = ['27', '26', '25'];
// Legends: Arceus, Legends: Z-A, Mega Dimension: battle mechanics differ, so their texts rank below every other vg.
const LATE_NONSTANDARD_VGS = new Set(['24', '30', '31']);

const REGIONS = new Set(['Alola', 'Galar', 'Hisui', 'Paldea']);
const REGION_SUFFIX_LABEL = { Totem: 'Totem', Zen: 'Trance' };

const STAT_IDENT = { 1: 'hp', 2: 'atk', 3: 'def', 4: 'spa', 5: 'spd', 6: 'spe' };
const DAMAGE_CLASS = { 1: 'Status', 2: 'Physical', 3: 'Special' };
const TERRAINS = ['Electric', 'Grassy', 'Misty', 'Psychic'];
const DESC_KINDS = { move: 'moves', ability: 'abilities', item: 'items' };

const normalizeQuotes = (s) => s.replace(/’/g, "'");

/** English-name id -> PokeAPI row id. On duplicate English names the LOWEST PokeAPI id wins (canonical entry). */
function englishIndex(rows, idCol) {
  const m = new Map();
  for (const r of rows) {
    if (r.local_language_id !== LANG_EN) continue;
    const k = toID(r.name);
    if (!k) continue;
    const prev = m.get(k);
    if (prev === undefined || Number(r[idCol]) < Number(prev)) m.set(k, r[idCol]);
  }
  return m;
}

function germanIndex(rows, idCol) {
  const m = new Map();
  for (const r of rows) if (r.local_language_id === LANG_DE && r.name) m.set(r[idCol], r.name);
  return m;
}

/** toID(identifier) -> PokeAPI row id (lowest id first). */
function identifierIndex(rows) {
  const m = new Map();
  for (const r of rows ?? []) {
    const k = toID(r.identifier);
    if (!k) continue;
    const prev = m.get(k);
    if (prev === undefined || Number(r.id) < Number(prev)) m.set(k, r.id);
  }
  return m;
}

function resolvePokeApiId(id, en, ident) {
  return en.get(id) ?? ident.get(id);
}

/** Moves, items, abilities, natures, types. */
function simpleCategory(universe, namesRows, idCol, identRows, overrides) {
  const en = englishIndex(namesRows, idCol);
  const de = germanIndex(namesRows, idCol);
  const ident = identifierIndex(identRows);
  const out = {};
  const missing = [];
  let viaOverride = 0;
  for (const id of universe.keys()) {
    if (!id) continue; // `???` folds to '' (rule 5): runtime falls back to the input
    if (Object.hasOwn(overrides, id)) {
      out[id] = overrides[id];
      viaOverride++;
      continue;
    }
    const pid = resolvePokeApiId(id, en, ident);
    const name = pid === undefined ? undefined : de.get(pid);
    if (name) out[id] = normalizeQuotes(name);
    else missing.push(id);
  }
  return { map: out, missing, viaOverride };
}

/**
 * Species and formes (§1.4 table). Universe entries carry { name, num, forme, gender }.
 * Rule order: override, base, region (+Totem/Zen), Mega X/Y, Primal, Gmax, Totem, F, PokeAPI full name, label only.
 */
function speciesCategory(universe, tables, overrides) {
  const speciesDe = germanIndex(tables.pokemon_species_names, 'pokemon_species_id');
  const formNamesDe = new Map();
  for (const r of tables.pokemon_form_names) if (r.local_language_id === LANG_DE) formNamesDe.set(r.pokemon_form_id, r);
  const formByIdent = new Map();
  for (const f of tables.pokemon_forms) {
    const k = toID(f.identifier);
    const prev = formByIdent.get(k);
    if (!prev || Number(f.id) < Number(prev.id)) formByIdent.set(k, f);
  }
  const out = {};
  const missing = [];
  const rules = {};
  for (const [id, s] of universe) {
    if (!id) continue;
    const baseDe = speciesDe.get(String(s.num));
    const forme = s.forme || '';
    let name;
    let rule;
    if (Object.hasOwn(overrides, id)) {
      name = overrides[id];
      rule = 'override';
    } else if (!baseDe) {
      rule = 'missing';
    } else if (!forme) {
      name = baseDe;
      rule = 'base';
    } else {
      const parts = forme.split('-');
      if (REGIONS.has(parts[0])) {
        const rest = parts.slice(1).join('-');
        if (!rest) {
          name = `${parts[0]}-${baseDe}`;
          rule = 'region';
        } else if (Object.hasOwn(REGION_SUFFIX_LABEL, rest)) {
          name = `${parts[0]}-${baseDe} (${REGION_SUFFIX_LABEL[rest]})`;
          rule = 'region+suffix';
        }
      } else if (/^Mega(-[XY])?$/.test(forme)) {
        name = `Mega-${baseDe}${parts[1] ? ` ${parts[1]}` : ''}`;
        rule = 'mega';
      } else if (forme === 'Primal') {
        name = `Proto-${baseDe}`;
        rule = 'primal';
      } else if (forme === 'Gmax') {
        name = `Gigadynamax-${baseDe}`;
        rule = 'gmax';
      } else if (forme === 'Totem') {
        name = `${baseDe} (Totem)`;
        rule = 'totem';
      } else if (forme === 'F' && s.gender === 'F') {
        // Gender formes only (Meowstic-F, gender 'F'). Unown-F is a letter (cosmetic, gender 'N') and falls through.
        name = `${baseDe} (weiblich)`;
        rule = 'female';
      } else {
        const form = formByIdent.get(id);
        const row = form ? formNamesDe.get(form.id) : undefined;
        if (row && row.pokemon_name && row.pokemon_name.includes(baseDe)) {
          name = row.pokemon_name;
          rule = 'pokeapi-full';
        } else if (row && row.form_name) {
          name = `${baseDe} (${row.form_name})`;
          rule = 'pokeapi-label';
        }
      }
    }
    if (name) {
      out[id] = normalizeQuotes(name).trim();
      rules[rule] = (rules[rule] ?? 0) + 1;
    } else missing.push(id);
  }
  return { map: out, missing, rules };
}

/** Removes soft hyphens (and the line break after them), joins "-\n", collapses whitespace. */
export function cleanFlavor(text) {
  return text
    .replace(/\u00ad\s*/g, '')
    .replace(/-\s*\n\s*/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function versionGroupRank(vg, vgOrder) {
  const svIndex = SV_VGS.indexOf(vg);
  if (svIndex !== -1) return 10_000 - svIndex;
  const order = vgOrder.get(vg) ?? 0;
  if (LATE_NONSTANDARD_VGS.has(vg)) return -10_000 + order;
  return order;
}

/** German flavour text per universe id: the best-ranked version group wins (§1.4 "Flavour text"). */
function descCategory(universe, namesRows, idCol, identRows, flavorRows, vgOrder, aliasOf) {
  const en = englishIndex(namesRows, idCol);
  const ident = identifierIndex(identRows);
  const best = new Map(); // PokeAPI id -> { vg, rank, text }
  for (const r of flavorRows) {
    if (r.language_id !== LANG_DE) continue;
    const text = cleanFlavor(r.flavor_text ?? '');
    if (!text) continue;
    const pid = r[idCol];
    const rank = versionGroupRank(r.version_group_id, vgOrder);
    const cur = best.get(pid);
    if (!cur || rank > cur.rank) best.set(pid, { vg: r.version_group_id, rank, text });
  }
  const out = {};
  const versionGroups = {};
  for (const id of universe.keys()) {
    if (!id) continue;
    const lookup = aliasOf ? aliasOf(id) : id;
    const pid = resolvePokeApiId(lookup, en, ident);
    const b = pid === undefined ? undefined : best.get(pid);
    if (!b) continue; // English fallback at runtime
    out[id] = b.text;
    versionGroups[b.vg] = (versionGroups[b.vg] ?? 0) + 1;
  }
  return { map: out, versionGroups };
}

/** Splits desc.de.json ("<kind>:<id>": text) into per-file maps. Throws on a malformed key. */
function splitDescOverrides(desc) {
  const byFile = { moves: {}, abilities: {}, items: {} };
  for (const [key, text] of Object.entries(desc ?? {})) {
    const m = /^(move|ability|item):([a-z0-9]+)$/.exec(key);
    if (!m) throw new Error(`desc.de.json: bad key "${key}" (expected "move|ability|item:<@pkmn id>")`);
    if (typeof text !== 'string' || !text.trim()) throw new Error(`desc.de.json: empty text for "${key}"`);
    byFile[DESC_KINDS[m[1]]][m[2]] = text.trim();
  }
  return byFile;
}

/** Keys of an override table that the universe does not contain (stale or misspelt rows). */
function unusedKeys(overrides, universe) {
  return Object.keys(overrides ?? {}).filter((k) => !universe.has(k)).sort();
}

/**
 * @param {{
 *   tables: Record<string, Record<string, string>[]>,
 *   universes: Record<'species'|'moves'|'items'|'abilities'|'natures'|'types', Map<string, { name: string, num?: number, forme?: string, gender?: string }>>,
 *   overrides: { forms?: Record<string,string>, abilities?: Record<string,string>, items?: Record<string,string>,
 *                moves?: Record<string,string>, misc: { statsShort: Record<string,string>, status: Record<string, { long: string, short: string }>, weather: Record<string,string> },
 *                desc?: Record<string,string> },
 * }} input
 */
export function buildAll({ tables, universes, overrides }) {
  const vgOrder = new Map(tables.version_groups.map((v) => [v.id, Number(v.order)]));
  const forms = overrides.forms ?? {};
  const species = speciesCategory(universes.species, tables, forms);
  const moves = simpleCategory(universes.moves, tables.move_names, 'move_id', tables.moves, overrides.moves ?? {});
  const items = simpleCategory(universes.items, tables.item_names, 'item_id', tables.items, overrides.items ?? {});
  const abilities = simpleCategory(
    universes.abilities,
    tables.ability_names,
    'ability_id',
    tables.abilities,
    overrides.abilities ?? {},
  );
  const natures = simpleCategory(universes.natures, tables.nature_names, 'nature_id', tables.natures, {});
  const types = simpleCategory(universes.types, tables.type_names, 'type_id', tables.types, {});

  const statsLong = {};
  for (const r of tables.stat_names) {
    const key = STAT_IDENT[r.stat_id];
    if (r.local_language_id === LANG_DE && key) statsLong[key] = r.name;
  }
  const categories = {};
  for (const r of tables.move_damage_class_prose) {
    const key = DAMAGE_CLASS[r.move_damage_class_id];
    if (r.local_language_id === LANG_DE && key) categories[key] = r.name.charAt(0).toUpperCase() + r.name.slice(1);
  }
  const terrain = {};
  for (const t of TERRAINS) {
    const de = moves.map[toID(`${t} Terrain`)];
    if (de) terrain[t] = de;
  }
  const misc = {
    types: types.map,
    natures: natures.map,
    stats: { long: statsLong, short: overrides.misc.statsShort },
    categories,
    terrain,
    weather: overrides.misc.weather,
    status: overrides.misc.status,
  };

  const descOverrides = splitDescOverrides(overrides.desc);
  const embodyAlias = (id) => (id.startsWith('embodyaspect') ? 'embodyaspect' : id);
  const movesDesc = descCategory(
    universes.moves,
    tables.move_names,
    'move_id',
    tables.moves,
    tables.move_flavor_text,
    vgOrder,
  );
  const abilitiesDesc = descCategory(
    universes.abilities,
    tables.ability_names,
    'ability_id',
    tables.abilities,
    tables.ability_flavor_text,
    vgOrder,
    embodyAlias,
  );
  const itemsDesc = descCategory(
    universes.items,
    tables.item_names,
    'item_id',
    tables.items,
    tables.item_flavor_text,
    vgOrder,
  );
  const withDescOverrides = (map, extra) => ({ ...map, ...extra });

  const files = sortDeep({
    'species.de.json': species.map,
    'moves.de.json': moves.map,
    'items.de.json': items.map,
    'abilities.de.json': abilities.map,
    'misc.de.json': misc,
    'moves.desc.de.json': withDescOverrides(movesDesc.map, descOverrides.moves),
    'abilities.desc.de.json': withDescOverrides(abilitiesDesc.map, descOverrides.abilities),
    'items.desc.de.json': withDescOverrides(itemsDesc.map, descOverrides.items),
  });

  const report = sortDeep({
    speciesRules: species.rules,
    viaOverride: {
      species: species.rules.override ?? 0,
      moves: moves.viaOverride,
      items: items.viaOverride,
      abilities: abilities.viaOverride,
    },
    missing: {
      species: species.missing.sort(),
      moves: moves.missing.sort(),
      items: items.missing.sort(),
      abilities: abilities.missing.sort(),
      natures: natures.missing.sort(),
      types: types.missing.sort(),
    },
    unusedOverrides: {
      forms: unusedKeys(forms, universes.species),
      abilities: unusedKeys(overrides.abilities, universes.abilities),
      items: unusedKeys(overrides.items, universes.items),
      moves: unusedKeys(overrides.moves, universes.moves),
      desc: [
        ...unusedKeys(descOverrides.moves, universes.moves).map((k) => `move:${k}`),
        ...unusedKeys(descOverrides.abilities, universes.abilities).map((k) => `ability:${k}`),
        ...unusedKeys(descOverrides.items, universes.items).map((k) => `item:${k}`),
      ],
    },
    descVersionGroups: {
      moves: movesDesc.versionGroups,
      abilities: abilitiesDesc.versionGroups,
      items: itemsDesc.versionGroups,
    },
  });
  return { files, report };
}
