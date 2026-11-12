// usage: npx --no-install tsx scripts/design/check-design-guards.mts [--paths "<files>"]
// Direction B guardrails (redesign F3, error level since Z1): fails with exit 1 when any file uses what new and
// redesigned code should not. Frozen surfaces (src/lib/design/frozen-surfaces.ts) are skipped. --paths limits the run to the
// given files. Every hit prints as file:line. docs/design.md, "Guardrails".
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { isFrozenSource } from '../../src/lib/design/frozen-surfaces';

const PALETTE = 'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose';
const RULES: Array<{ id: string; why: string; test: (line: string, file: string) => boolean }> = [
  {
    id: 'text-below-11px',
    why: 'the type floor is 11 px (text-micro)',
    test: (line) => [...line.matchAll(/\btext-\[(\d*\.?\d+)(px|rem)\]/g)].some(([, n, unit]) => Number(n) * (unit === 'rem' ? 16 : 1) < 11),
  },
  { id: 'uppercase-or-tracking', why: 'B sets labels in sentence case without letter-spacing', test: (line) => /(?<![\w-])(uppercase|tracking-[\w[\].-]+)(?![\w-])/.test(line) },
  { id: 'static-palette-colour', why: 'colours come from the B tokens, not the Tailwind palette', test: (line) => new RegExp(`(?<![\\w-])(bg|text|border|ring|outline|fill|stroke|from|via|to|divide|decoration|shadow)-(${PALETTE})-\\d{2,3}\\b`).test(line) },
  { id: 'raw-select', why: 'use the Select primitive', test: (line, file) => file.endsWith('.tsx') && !file.endsWith('components/ui/Select.tsx') && /<select\b/.test(line) },
];

const argv = process.argv.slice(2);
const pathsArg = argv.indexOf('--paths');
const files = (pathsArg >= 0 ? argv[pathsArg + 1].split(/\s+/) : execFileSync('git', ['ls-files', 'src/components/**/*.tsx', 'src/components/**/*.ts', 'src/app/**/*.tsx'], { encoding: 'utf8' }).split('\n'))
  .filter((file) => file && !file.includes('__tests__') && !isFrozenSource(file.replace(/^src\//, '')));

const hits = new Map(RULES.map((rule) => [rule.id, [] as string[]]));
for (const file of files) {
  readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
    for (const rule of RULES) if (rule.test(line, file)) hits.get(rule.id)!.push(`${file}:${index + 1}`);
  });
}
if (files.length === 0) {
  console.error('design-guards: no files to check');
  process.exit(1);
}
console.log(`design-guards: ${files.length} files checked`);
let total = 0;
for (const rule of RULES) {
  const list = hits.get(rule.id)!;
  total += list.length;
  console.log(`design-guards: ${rule.id}: ${list.length} (${rule.why})`);
  for (const hit of list) console.log('  ' + hit);
}
if (total > 0) {
  console.error(`design-guards: ${total} hit(s)`);
  process.exit(1);
}
