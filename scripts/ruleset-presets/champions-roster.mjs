// scripts/ruleset-presets/champions-roster.mjs: the PURE half of the Champions roster generator.
//
// Pokémon Showdown defines the Pokémon Champions roster as plain data in its `champions` mod: `data/mods/champions/`
// holds `formats-data.ts` (every species, with `isNonstandard: 'Past'` on the ones that are not in the game),
// `items.ts`, `abilities.ts`, `moves.ts` and `learnsets.ts`, each layered over the base `data/*.ts` tables by the
// sim's mod rule (a child entry replaces the parent entry; `inherit: true` merges over it; `null` deletes it).
// This module reads those tables (already parsed to plain objects by `parseDataTable`) and derives the legal sets
// without running the sim. The rule it implements is written down in the research note behind it: a species is in
// the roster when its merged data has no `isNonstandard`; a cosmetic forme follows its base species; a Mega or other
// battle-only forme also needs its parent forme to be legal; items, abilities and moves are the ones the merged
// tables leave standard, restricted to the ones a roster species can have (an ability slot) or learn (a learnset).
//
// No IO and no clock: `generate-champions-roster.mjs` reads the files and writes the module, and the tests call
// the functions here with small inline tables. Downloaded Showdown source is only ever PARSED (a TypeScript AST
// walk over literals); it is never executed.
import ts from 'typescript';

/** Showdown's `toID` for the ASCII names of the data tables: lower-case letters and digits only. */
export function toID(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function literalToValue(node) {
  switch (node.kind) {
    case ts.SyntaxKind.ObjectLiteralExpression: {
      const out = {};
      for (const property of node.properties) {
        if (!property.name || property.name.kind === ts.SyntaxKind.ComputedPropertyName) continue;
        const key = property.name.text !== undefined ? property.name.text : property.name.getText();
        // Methods and shorthand properties are recorded, never evaluated.
        out[key] = property.kind === ts.SyntaxKind.PropertyAssignment ? literalToValue(property.initializer) : '<code>';
      }
      return out;
    }
    case ts.SyntaxKind.ArrayLiteralExpression:
      return node.elements.map(literalToValue);
    case ts.SyntaxKind.StringLiteral:
    case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
      return node.text;
    case ts.SyntaxKind.NumericLiteral:
      return Number(node.text);
    case ts.SyntaxKind.TrueKeyword:
      return true;
    case ts.SyntaxKind.FalseKeyword:
      return false;
    case ts.SyntaxKind.NullKeyword:
      return null;
    case ts.SyntaxKind.PrefixUnaryExpression:
      return node.operator === ts.SyntaxKind.MinusToken ? -Number(node.operand.text) : '<code>';
    default:
      return '<code>';
  }
}

/**
 * The object literal `export const <exportName> = {...}` of a Showdown data file, as a plain object. Code (methods,
 * arrow functions) comes back as the string `'<code>'`; the tables read here are literals except for those.
 * @param {string} source the file text
 * @param {string} exportName `Pokedex`, `FormatsData`, `Items`, `Abilities`, `Moves` or `Learnsets`
 * @returns {Record<string, any> | null} null when the file declares no such constant
 */
export function parseDataTable(source, exportName) {
  const file = ts.createSourceFile('table.ts', source, ts.ScriptTarget.ES2020, true);
  let found = null;
  file.forEachChild((statement) => {
    if (statement.kind !== ts.SyntaxKind.VariableStatement) return;
    for (const declaration of statement.declarationList.declarations) {
      if (declaration.name.text === exportName && declaration.initializer) found = literalToValue(declaration.initializer);
    }
  });
  return found;
}

/**
 * The sim's parent merge for one data table (`sim/dex.ts` loadData): an entry the child lacks comes from the parent,
 * a child entry replaces the parent entry, `inherit: true` merges the child over it, `null` deletes it.
 */
export function mergeTable(parent, child) {
  if (!child) return parent;
  const merged = { ...child };
  for (const id of Object.keys(parent)) {
    if (merged[id] === null) delete merged[id];
    else if (!(id in merged)) merged[id] = parent[id];
    else if (merged[id] && merged[id].inherit) {
      const { inherit: _inherit, ...own } = merged[id];
      merged[id] = { ...parent[id], ...own };
    }
  }
  return merged;
}

/** The six tables the derivation reads, each the base table merged with the mod's own (the mod has only the tables it changes). */
export const TABLES = ['Pokedex', 'FormatsData', 'Items', 'Abilities', 'Moves', 'Learnsets'];

/**
 * The legal sets of the mod.
 * @param {{ base: Record<string, Record<string, any>>, mod: Record<string, Record<string, any> | null> }} tables
 *   `base[Table]` is the base data table, `mod[Table]` the mod's own table or null/absent when the mod has none
 * @returns {{ species: { selectable: string[], mega: string[], battleOnly: string[], cosmetic: string[] },
 *             items: string[], abilities: string[], megaAbilities: string[], moves: string[] }} sorted unique ids
 */
export function deriveChampionsRoster({ base, mod }) {
  const merged = {};
  for (const table of TABLES) merged[table] = mergeTable(base[table] ?? {}, mod[table] ?? null);

  const species = {};
  for (const id of Object.keys(merged.Pokedex)) {
    const entry = { ...merged.Pokedex[id], ...(merged.FormatsData[id] ?? {}), id };
    entry.isMega = Boolean(entry.forme && entry.forme.includes('Mega'));
    entry.isPrimal = entry.forme === 'Primal';
    entry.battleOnlyParent = entry.battleOnly || (entry.isMega || entry.isPrimal ? entry.baseSpecies : undefined);
    species[id] = entry;
  }
  const baseOf = (entry) => species[toID(entry.baseSpecies)];
  const isLegal = (entry) => {
    if (!entry || entry.isNonstandard) return false;
    if (entry.isCosmeticForme) return isLegal(baseOf(entry));
    if (entry.battleOnlyParent) {
      const parentName = Array.isArray(entry.battleOnlyParent) ? entry.battleOnlyParent[0] : entry.battleOnlyParent;
      const parent = species[toID(parentName)];
      if (!parent || parent.isNonstandard) return false;
    }
    return true;
  };

  const groups = { selectable: [], mega: [], battleOnly: [], cosmetic: [] };
  for (const id of Object.keys(species)) {
    const entry = species[id];
    if (!isLegal(entry)) continue;
    const group = entry.isMega ? 'mega' : entry.isCosmeticForme ? 'cosmetic' : entry.battleOnlyParent ? 'battleOnly' : 'selectable';
    groups[group].push(id);
  }

  // Abilities a roster species can have: its slots (a cosmetic forme uses its base species' slots). A Mega ability
  // that no selectable species has is Mega-only.
  const slotAbilities = (entry) => Object.values(entry.abilities ?? {}).map(toID);
  const selectableAbilities = new Set();
  for (const id of [...groups.selectable, ...groups.cosmetic]) {
    const entry = species[id];
    for (const ability of slotAbilities(entry.isCosmeticForme ? baseOf(entry) : entry)) selectableAbilities.add(ability);
  }
  const megaAbilities = new Set();
  for (const id of groups.mega) {
    for (const ability of slotAbilities(species[id])) if (!selectableAbilities.has(ability)) megaAbilities.add(ability);
  }

  // Moves: the ones in the learnset of a roster species. The mod's learnsets do not follow prevolutions, so a
  // species uses its own entry in the MOD file, else its parent forme's (`changesFrom` or base species).
  const ownLearnsets = mod.Learnsets ?? {};
  const learnsetOf = (entry) => {
    let current = entry;
    const seen = new Set();
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      const learnset = ownLearnsets[current.id] ? merged.Learnsets[current.id]?.learnset : null;
      if (learnset) return learnset;
      const next = current.changesFrom || current.baseSpecies;
      if (toID(next) === current.id) break;
      current = species[toID(next)];
    }
    return null;
  };
  const learnable = new Set();
  for (const id of [...groups.selectable, ...groups.mega, ...groups.battleOnly]) {
    const learnset = learnsetOf(species[id]);
    if (learnset) for (const move of Object.keys(learnset)) learnable.add(move);
  }

  const sorted = (ids) => [...new Set(ids)].sort();
  return {
    species: {
      selectable: sorted(groups.selectable),
      mega: sorted(groups.mega),
      battleOnly: sorted(groups.battleOnly),
      cosmetic: sorted(groups.cosmetic),
    },
    items: sorted(Object.keys(merged.Items).filter((id) => !merged.Items[id].isNonstandard)),
    abilities: sorted([...selectableAbilities]),
    megaAbilities: sorted([...megaAbilities]),
    moves: sorted([...learnable].filter((id) => merged.Moves[id] && !merged.Moves[id].isNonstandard)),
  };
}

const LINE_WIDTH = 118;

function idArray(name, ids) {
  const lines = [];
  let line = '  ';
  for (const id of ids) {
    const token = `'${id}',`;
    if (line.length + token.length + 1 > LINE_WIDTH && line.trim() !== '') {
      lines.push(line.trimEnd());
      line = '  ';
    }
    line += `${token} `;
  }
  if (line.trim() !== '') lines.push(line.trimEnd());
  return `export const ${name}: readonly string[] = [\n${lines.join('\n')}\n];\n`;
}

/**
 * The text of `champions-roster.generated.ts`.
 * @param {ReturnType<typeof deriveChampionsRoster>} roster
 * @param {{ sha: string, regulation: string, mod: string, date: string }} pin
 */
export function emitRosterModule(roster, pin) {
  const count = roster.species.selectable.length + roster.species.mega.length + roster.species.battleOnly.length + roster.species.cosmetic.length;
  return [
    '// GENERATED by scripts/ruleset-presets/generate-champions-roster.mjs. Do not edit by hand.',
    '//',
    `// The Pokémon Champions roster (regulation ${pin.regulation}) as Pokémon Showdown defines it: the legal species,`,
    `// items, abilities and moves of its \`${pin.mod}\` mod, derived from \`data/mods/${pin.mod}/\` layered over \`data/\` at the pin below.`,
    '// Source: https://github.com/smogon/pokemon-showdown (MIT), see NOTICE.md. Refresh procedure: docs/ruleset-presets.md.',
    '//',
    `// ${count} species ids (${roster.species.selectable.length} selectable, ${roster.species.mega.length} Mega, ${roster.species.battleOnly.length} battle-only, ${roster.species.cosmetic.length} cosmetic),`,
    `// ${roster.items.length} items, ${roster.abilities.length} abilities (+ ${roster.megaAbilities.length} Mega-only), ${roster.moves.length} moves. Ids are Showdown ids (sorted, unique).`,
    '',
    'export const CHAMPIONS_ROSTER_PIN = {',
    "  repo: 'smogon/pokemon-showdown',",
    `  sha: '${pin.sha}',`,
    `  date: '${pin.date}',`,
    `  mod: '${pin.mod}',`,
    `  regulation: '${pin.regulation}',`,
    '} as const;',
    '',
    '/** Species a team can bring (a Mega is reached through its stone, a battle-only forme through its base forme). */',
    idArray('CHAMPIONS_SPECIES_SELECTABLE', roster.species.selectable),
    idArray('CHAMPIONS_SPECIES_MEGA', roster.species.mega),
    idArray('CHAMPIONS_SPECIES_BATTLE_ONLY', roster.species.battleOnly),
    '/** Cosmetic formes (Vivillon patterns, Alcremie flavours); each follows its base species. */',
    idArray('CHAMPIONS_SPECIES_COSMETIC', roster.species.cosmetic),
    idArray('CHAMPIONS_ITEMS', roster.items),
    '/** Abilities some selectable species has in one of its slots. */',
    idArray('CHAMPIONS_ABILITIES', roster.abilities),
    '/** Abilities only a Mega Evolution has. */',
    idArray('CHAMPIONS_MEGA_ABILITIES', roster.megaAbilities),
    '/** Moves in the learnset of at least one roster species. Per-species move legality is not part of this file. */',
    idArray('CHAMPIONS_MOVES', roster.moves),
  ].join('\n');
}
