import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { EMPTY_MANIFEST, normalizeSpecies, WORLD_MANIFEST_FILE, type WorldManifest } from '../model-manifest';
import { POKEMON_TYPES } from '../habitat-types';
import { CAST_DEFECTS } from '../cast-defects';
import { SPECIES_LITERAL_DEBT } from './species-literal-debt';
import { readMirrorManifest } from './world-manifest-fixture';

/**
 * D18 / AGENTS.md lint (D35 core round, SEAT B step 4): no species, type or
 * stat literals in world code. Casting is a manifest query; `habitat-types.ts`
 * is the only table that names types.
 *
 * WHAT IT CHECKS, in `src/components/world/**` and `src/lib/route-world/**`
 * (not `__tests__`), by parsing each file with the TypeScript compiler:
 *  1. String literals (quotes, no-substitution templates, template heads,
 *     middles and tails), JSX text children, and KEYS (property assignments,
 *     shorthand properties, property signatures, enum member names and class
 *     property declarations) against a banned set built from the
 *     TRACKED manifest — every `species` and `alias` — plus the 18 type names
 *     capitalised. Matching is by EXACT NORMALISED TOKEN: a literal matches
 *     when the whole literal, or one of its word tokens (split on everything
 *     but letters, digits, `-`, `.` and apostrophes), normalises
 *     (`normalizeSpecies`) to a banned species; a type name matches only in
 *     its capitalised spelling (`Water`).
 *  2. Lower-case type words are NOT word-matched (they collide with ordinary
 *     vocabulary: 'normal', 'dark', 'ground', 'steel'...). They are handled at
 *     the TYPE level instead: no import of `POKEMON_TYPES` / `PokemonType`
 *     (or their attack aliases `ATTACK_TYPES` / `AttackType`) outside
 *     `habitat-types.ts`, `attack-moves.ts` and `casting.ts`, and no
 *     `Record<PokemonType, …>` / `Record<AttackType, …>` or mapped type over
 *     them outside that allowlist. R35 closes the bypasses: a namespace import
 *     of `habitat-types` / `attack-moves` (`import * as H`), a re-export of
 *     the vocabulary (`export { POKEMON_TYPES } from …`, `export *` from those
 *     modules, or a local `export { PokemonType }`), and an import type
 *     (`import('./habitat-types').PokemonType`) are type-imports. A Record /
 *     mapped-type key is resolved through qualified names (`H.PokemonType`),
 *     import types, parentheses, unions and `(typeof POKEMON_TYPES)[number]`.
 *
 * ALLOWLISTED: `habitat-types.ts` (the type table) and `attack-moves.ts` (the
 * attack table, which imports the vocabulary).
 *
 * FLAGGED DATA FILE: `cast-defects.ts` keys measured asset defects by manifest
 * file path (`models/<form>/<dexId>.glb`), a dex identity in disguise. It is
 * allowed (a path is not a species literal) but pinned here: every row must
 * be a manifest file path with a reason, and nothing else may be added to it.
 *
 * DEBT: `species-literal-debt.ts` pins today's hits per file, from this lint's
 * own first run. It fails both ways; the per-world rounds drive it to 0 (L9).
 *
 * DISCLOSED GAPS: D18's "no stat literals" has no check this round (stats are
 * numbers, and no reliable token separates a base stat from a layout
 * constant). Comments are not scanned (prose mentions are allowed).
 */

const ROOT = join(__dirname, '..', '..', '..', '..');
const SCAN_DIRS = ['src/components/world', 'src/lib/route-world'];
const ALLOWLIST = new Set(['src/lib/route-world/habitat-types.ts', 'src/lib/route-world/attack-moves.ts']);
const TYPE_IMPORT_ALLOWLIST = new Set([
  'src/lib/route-world/habitat-types.ts',
  'src/lib/route-world/attack-moves.ts',
  'src/lib/route-world/casting.ts',
]);
const TYPE_VOCAB_NAMES = new Set(['POKEMON_TYPES', 'PokemonType', 'ATTACK_TYPES', 'AttackType']);
/** Modules that export the type vocabulary (a namespace import or `export *` of one is a type-import). */
const TYPE_VOCAB_MODULE = /(^|\/)(habitat-types|attack-moves)(\.tsx?)?$/;

export interface BannedSet {
  species: ReadonlySet<string>;
  /** Capitalised type names, exact spelling. */
  types: ReadonlySet<string>;
}

export interface LiteralHit {
  file: string;
  line: number;
  kind: 'string' | 'key' | 'type-import' | 'type-record';
  text: string;
}

function capitalise(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

export function bannedFromManifest(manifest: WorldManifest): BannedSet {
  const species = new Set<string>();
  for (const entry of manifest.figures) {
    for (const name of [entry.species, ...entry.aliases]) {
      const key = normalizeSpecies(name);
      if (key.length > 0) species.add(key);
    }
  }
  return { species, types: new Set(POKEMON_TYPES.map(capitalise)) };
}

const TOKEN_SPLIT = /[^A-Za-z0-9\u00C0-\u024F'’.-]+/;

/** Does a literal's text name a banned species or capitalised type? Returns the matched token. */
export function literalMatch(text: string, banned: BannedSet): string | null {
  const whole = normalizeSpecies(text);
  if (whole.length > 0 && banned.species.has(whole)) return text;
  for (const raw of text.split(TOKEN_SPLIT)) {
    const token = raw.replace(/^[.'’-]+|[.'’-]+$/g, '');
    if (token.length === 0) continue;
    if (banned.types.has(token)) return token;
    const key = normalizeSpecies(token);
    if (key.length > 0 && banned.species.has(key)) return token;
  }
  return null;
}

function rightmost(name: ts.EntityName): string {
  return ts.isIdentifier(name) ? name.text : name.right.text;
}

/**
 * The vocabulary-relevant names a type node refers to: `PokemonType`,
 * `H.PokemonType`, `import('…').PokemonType`, `(typeof POKEMON_TYPES)[number]`,
 * parenthesised and union forms. Used on Record keys and mapped-type constraints.
 */
function typeNamesOf(node: ts.TypeNode): string[] {
  if (ts.isParenthesizedTypeNode(node)) return typeNamesOf(node.type);
  if (ts.isUnionTypeNode(node) || ts.isIntersectionTypeNode(node)) return node.types.flatMap(typeNamesOf);
  if (ts.isTypeReferenceNode(node)) return [rightmost(node.typeName)];
  if (ts.isImportTypeNode(node)) return node.qualifier ? [rightmost(node.qualifier)] : [];
  if (ts.isIndexedAccessTypeNode(node)) return typeNamesOf(node.objectType);
  if (ts.isTypeQueryNode(node)) return [rightmost(node.exprName)];
  if (ts.isTypeOperatorNode(node)) return typeNamesOf(node.type);
  return [];
}

function vocabNameOf(node: ts.TypeNode): string | null {
  return typeNamesOf(node).find((name) => TYPE_VOCAB_NAMES.has(name)) ?? null;
}

function moduleText(specifier: ts.Expression | undefined): string | null {
  return specifier && ts.isStringLiteral(specifier) ? specifier.text : null;
}

/** Scan one source text. `file` is repo-relative with forward slashes. */
export function scanSource(file: string, text: string, banned: BannedSet): LiteralHit[] {
  const hits: LiteralHit[] = [];
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const lineOf = (node: ts.Node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  const literalScan = !ALLOWLIST.has(file);
  const typeScan = !TYPE_IMPORT_ALLOWLIST.has(file);

  const checkText = (node: ts.Node, value: string, kind: 'string' | 'key') => {
    const match = literalMatch(value, banned);
    if (match) hits.push({ file, line: lineOf(node), kind, text: match });
  };
  const typeHit = (node: ts.Node, kind: 'type-import' | 'type-record', text: string) => {
    hits.push({ file, line: lineOf(node), kind, text });
  };
  /** A name in key position: property, signature, enum member, class property. */
  const isKeyParent = (parent: ts.Node | undefined, node: ts.Node) =>
    !!parent &&
    (ts.isPropertyAssignment(parent) || ts.isPropertySignature(parent) || ts.isEnumMember(parent) || ts.isPropertyDeclaration(parent)) &&
    parent.name === node;

  const visit = (node: ts.Node) => {
    if (literalScan) {
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        // Module specifiers are paths, not data.
        if (!(node.parent && (ts.isImportDeclaration(node.parent) || ts.isExportDeclaration(node.parent)))) {
          checkText(node, node.text, isKeyParent(node.parent, node) ? 'key' : 'string');
        }
      } else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
        checkText(node, node.text, 'string');
      } else if (ts.isJsxText(node)) {
        if (!node.containsOnlyTriviaWhiteSpaces) checkText(node, node.text, 'string');
      } else if (
        (ts.isPropertyAssignment(node) || ts.isPropertySignature(node) || ts.isEnumMember(node) || ts.isPropertyDeclaration(node)) &&
        (ts.isIdentifier(node.name) || ts.isPrivateIdentifier(node.name))
      ) {
        checkText(node.name, node.name.text.replace(/^#/, ''), 'key');
      } else if (ts.isShorthandPropertyAssignment(node)) {
        checkText(node.name, node.name.text, 'key');
      }
    }
    if (typeScan) {
      if (ts.isImportDeclaration(node) && node.importClause) {
        const bindings = node.importClause.namedBindings;
        const from = moduleText(node.moduleSpecifier);
        if (bindings && ts.isNamedImports(bindings)) {
          for (const element of bindings.elements) {
            const imported = (element.propertyName ?? element.name).text;
            if (TYPE_VOCAB_NAMES.has(imported)) typeHit(element, 'type-import', imported);
          }
        } else if (bindings && ts.isNamespaceImport(bindings) && from && TYPE_VOCAB_MODULE.test(from)) {
          typeHit(bindings, 'type-import', `* as ${bindings.name.text} from ${from}`);
        }
      } else if (ts.isExportDeclaration(node)) {
        const from = moduleText(node.moduleSpecifier);
        const clause = node.exportClause;
        if (clause && ts.isNamedExports(clause)) {
          for (const element of clause.elements) {
            const exported = (element.propertyName ?? element.name).text;
            if (TYPE_VOCAB_NAMES.has(exported)) typeHit(element, 'type-import', `export { ${exported} }`);
          }
        } else if (from && TYPE_VOCAB_MODULE.test(from)) {
          // `export * from` / `export * as N from` a vocabulary module.
          typeHit(node, 'type-import', `export * from ${from}`);
        }
      } else if (ts.isImportTypeNode(node) && node.qualifier && TYPE_VOCAB_NAMES.has(rightmost(node.qualifier))) {
        typeHit(node, 'type-import', `import(…).${rightmost(node.qualifier)}`);
      } else if (ts.isTypeReferenceNode(node) && rightmost(node.typeName) === 'Record') {
        const keyType = node.typeArguments?.[0];
        const name = keyType ? vocabNameOf(keyType) : null;
        if (name) typeHit(node, 'type-record', `Record<${name}, …>`);
      } else if (ts.isMappedTypeNode(node) && node.typeParameter.constraint) {
        const name = vocabNameOf(node.typeParameter.constraint);
        if (name) typeHit(node, 'type-record', `{ [k in ${name}] }`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return hits;
}

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === '__tests__' || name === 'node_modules') continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
}

function scannedFiles(): string[] {
  const out: string[] = [];
  for (const dir of SCAN_DIRS) walk(join(ROOT, dir), out);
  return out.map((f) => relative(ROOT, f).split('\\').join('/')).sort();
}

/**
 * The mirror manifest (a league's figure pool) is maintainer-only and kept out of the tree: without
 * it the species half of the lint skips, and only the type-level rule below runs.
 */
const MIRROR = readMirrorManifest(WORLD_MANIFEST_FILE);

function trackedManifest(): WorldManifest {
  return MIRROR.manifest;
}

function scanTree(banned: BannedSet): LiteralHit[] {
  const hits: LiteralHit[] = [];
  for (const file of scannedFiles()) hits.push(...scanSource(file, readFileSync(join(ROOT, file), 'utf8'), banned));
  return hits;
}

function countsByFile(hits: readonly LiteralHit[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const hit of hits) out[hit.file] = (out[hit.file] ?? 0) + 1;
  return out;
}

describe.skipIf(!MIRROR.present)('D18 species / type literal lint', () => {
  const manifest = trackedManifest();
  const banned = bannedFromManifest(manifest);
  const sample = manifest.figures.find((f) => f.species.length >= 5 && /^[A-Z][a-z]+$/.test(f.species))!;
  const sampleType = POKEMON_TYPES.map(capitalise)[2];

  it('builds the banned set from the tracked manifest and the 18 capitalised type names', () => {
    expect(banned.species.size).toBeGreaterThan(300);
    expect(banned.types.size).toBe(18);
    expect(sample).toBeDefined();
  });

  it('the tree matches the pinned debt exactly (fails both ways)', () => {
    const hits = scanTree(banned);
    const typeLevel = hits.filter((h) => h.kind === 'type-import' || h.kind === 'type-record');
    expect(typeLevel, JSON.stringify(typeLevel, null, 2)).toEqual([]);
    const counts = countsByFile(hits);
    expect(counts, JSON.stringify(hits, null, 2)).toEqual(SPECIES_LITERAL_DEBT);
  }, 60_000); // parses every source file under src/: slow on a cold, loaded runner

  it('the allowlisted tables sit inside the scanned scope', () => {
    for (const file of ALLOWLIST) expect(scannedFiles()).toContain(file);
  });

  it('fails on an injected string literal, template part and capitalised type', () => {
    const file = 'src/lib/route-world/injected.ts';
    expect(scanSource(file, `export const a = '${sample.species}';`, banned)).toHaveLength(1);
    expect(scanSource(file, `export const a = \`wild:${sample.species}@\${1}\`;`, banned)).toHaveLength(1);
    expect(scanSource(file, `export const a = "${sampleType}";`, banned)).toHaveLength(1);
    // Exact tokens only: a species name inside a longer word does not match.
    expect(scanSource(file, `export const a = '${sample.species.toLowerCase()}zzqx';`, banned)).toHaveLength(0);
    // Lower-case type words are not word-matched (type-level rule instead).
    expect(scanSource(file, `export const a = '${POKEMON_TYPES[2]}';`, banned)).toHaveLength(0);
    // Import paths are not data.
    expect(scanSource(file, `import x from './${sample.species}';`, banned)).toHaveLength(0);
  });

  it('fails on an injected object key (identifier, quoted, shorthand, signature)', () => {
    const file = 'src/components/world/injected.tsx';
    const key = sample.species.toLowerCase();
    expect(scanSource(file, `export const a = { ${key}: 1 };`, banned)[0]?.kind).toBe('key');
    expect(scanSource(file, `export const a = { '${sample.species}': 1 };`, banned)[0]?.kind).toBe('key');
    expect(scanSource(file, `const ${key} = 1; export const a = { ${key} };`, banned)[0]?.kind).toBe('key');
    expect(scanSource(file, `export interface A { ${sampleType}: number }`, banned)[0]?.kind).toBe('key');
  });

  it('fails on an injected Record<PokemonType, …>, mapped type or vocabulary import outside the allowlist', () => {
    const file = 'src/lib/route-world/injected.ts';
    const rec = scanSource(file, `type T = Record<PokemonType, number>;`, banned);
    expect(rec.map((h) => h.kind)).toEqual(['type-record']);
    expect(scanSource(file, `type T = { [k in AttackType]: number };`, banned).map((h) => h.kind)).toEqual(['type-record']);
    expect(scanSource(file, `import { POKEMON_TYPES } from './habitat-types';`, banned).map((h) => h.kind)).toEqual(['type-import']);
    expect(scanSource(file, `import { type PokemonType as P } from './habitat-types';`, banned).map((h) => h.kind)).toEqual(['type-import']);
    // casting.ts may import the vocabulary (via habitatAccepts); habitat-types defines it.
    expect(scanSource('src/lib/route-world/casting.ts', `import { POKEMON_TYPES } from './habitat-types';`, banned)).toEqual([]);
    expect(scanSource('src/lib/route-world/habitat-types.ts', `const t: Record<PokemonType, number> = {} as never;`, banned)).toEqual([]);
  });

  describe('R35: the bypasses each fail on an injected case', () => {
    const file = 'src/lib/route-world/injected.ts';
    const kinds = (text: string, at = file) => scanSource(at, text, banned).map((h) => h.kind);

    it('a namespace import of habitat-types / attack-moves', () => {
      expect(kinds(`import * as H from './habitat-types';`)).toEqual(['type-import']);
      expect(kinds(`import * as M from '@/lib/route-world/attack-moves';`)).toEqual(['type-import']);
      // Other namespace imports are fine; allowlisted files may.
      expect(kinds(`import * as THREE from 'three';`)).toEqual([]);
      expect(kinds(`import * as H from './habitat-types';`, 'src/lib/route-world/casting.ts')).toEqual([]);
    });

    it('a re-export of the vocabulary', () => {
      expect(kinds(`export { POKEMON_TYPES } from './habitat-types';`)).toEqual(['type-import']);
      expect(kinds(`export { type AttackType as A } from './attack-moves';`)).toEqual(['type-import']);
      expect(kinds(`export * from './habitat-types';`)).toEqual(['type-import']);
      expect(kinds(`export * as H from './habitat-types';`)).toEqual(['type-import']);
      // A local re-export of an imported vocabulary name (the import is a hit too).
      expect(kinds(`import { PokemonType } from './habitat-types';\nexport type { PokemonType };`)).toEqual(['type-import', 'type-import']);
      // Re-exporting other names is fine.
      expect(kinds(`export { normalizeType } from './habitat-types';`)).toEqual([]);
    });

    it('a QualifiedName key: Record<H.PokemonType, …>', () => {
      expect(kinds(`type T = Record<H.PokemonType, number>;`)).toEqual(['type-record']);
      expect(kinds(`type T = { [k in M.AttackType]: number };`)).toEqual(['type-record']);
      expect(kinds(`type T = Record<H.HabitatId, number>;`)).toEqual([]);
    });

    it('an ImportType reference: import(…).PokemonType', () => {
      expect(kinds(`let t: import('./habitat-types').PokemonType;`)).toEqual(['type-import']);
      expect(kinds(`type T = Record<import('./habitat-types').PokemonType, number>;`)).toEqual(['type-record', 'type-import']);
      expect(kinds(`let t: import('./habitat-types').HabitatId;`)).toEqual([]);
    });

    it('Record<(typeof POKEMON_TYPES)[number], …>', () => {
      expect(kinds(`type T = Record<(typeof POKEMON_TYPES)[number], number>;`)).toEqual(['type-record']);
      expect(kinds(`type T = Record<(typeof H.ATTACK_TYPES)[number], number>;`)).toEqual(['type-record']);
      expect(kinds(`type T = Record<PokemonType | 'x', number>;`)).toEqual(['type-record']);
      expect(kinds(`type T = Record<(typeof OTHER)[number], number>;`)).toEqual([]);
    });

    it('JsxText children', () => {
      const tsx = 'src/components/world/injected.tsx';
      expect(kinds(`export const A = () => <span>${sample.species}</span>;`, tsx)).toEqual(['string']);
      expect(kinds(`export const A = () => <b>a ${sampleType} move</b>;`, tsx)).toEqual(['string']);
      expect(kinds(`export const A = () => <span>Hello there</span>;`, tsx)).toEqual([]);
    });

    it('enum member names', () => {
      expect(kinds(`export enum E { ${sample.species} }`)).toEqual(['key']);
      expect(kinds(`export enum E { '${sampleType}' = 1 }`)).toEqual(['key']);
      expect(kinds(`export enum E { Calm }`)).toEqual([]);
    });

    it('class property names', () => {
      expect(kinds(`export class C { ${sample.species.toLowerCase()} = 1; }`)).toEqual(['key']);
      expect(kinds(`export class C { '${sampleType}' = 1; }`)).toEqual(['key']);
      expect(kinds(`export class C { #${sample.species.toLowerCase()} = 1; }`)).toEqual(['key']);
      expect(kinds(`export class C { calm = 1; }`)).toEqual([]);
    });
  });

  it('flags cast-defects.ts as a file-keyed data file: manifest paths with reasons, nothing else', () => {
    const files = new Set(manifest.figures.map((f) => f.file));
    for (const defect of CAST_DEFECTS) {
      expect(files.has(defect.file), defect.file).toBe(true);
      expect(defect.reason.length).toBeGreaterThan(10);
      expect(literalMatch(defect.reason, banned), defect.reason).toBeNull();
    }
  });
});

describe('D18 type-level rule without the mirror manifest', () => {
  it('the tree has no type-level hits (runs on every checkout)', () => {
    const banned = bannedFromManifest(EMPTY_MANIFEST);
    const typeLevel = scanTree(banned).filter((h) => h.kind === 'type-import' || h.kind === 'type-record');
    expect(typeLevel, JSON.stringify(typeLevel, null, 2)).toEqual([]);
  }, 60_000); // parses every source file under src/: slow on a cold, loaded runner
});
