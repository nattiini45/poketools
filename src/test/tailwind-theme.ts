/**
 * The one place tests read the Tailwind theme and run the Tailwind pipeline. Tests ask for a colour by
 * its utility name and for the CSS a class list compiles to; where the theme is declared (the @theme
 * blocks at the top of src/app/globals.css) and which pipeline compiles it stay in this file, so a
 * Tailwind upgrade changes this adapter and not the tests.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import tailwindcss from '@tailwindcss/postcss';

const GLOBALS = fileURLToPath(new URL('../app/globals.css', import.meta.url));

/** The site's @theme blocks and its dark variant, as written in globals.css. */
function themeSource(): string {
  const css = readFileSync(GLOBALS, 'utf8');
  const blocks: string[] = [];
  const variant = /^@custom-variant [^\n]*;$/m.exec(css);
  if (variant) blocks.push(variant[0]);
  for (let at = css.indexOf('@theme'); at !== -1; at = css.indexOf('@theme', at + 1)) {
    let depth = 0;
    for (let i = css.indexOf('{', at); i < css.length; i++) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}' && --depth === 0) {
        blocks.push(css.slice(at, i + 1));
        at = i;
        break;
      }
    }
  }
  if (blocks.length < 2) throw new Error('globals.css declares no @theme blocks');
  return blocks.join('\n');
}

/** Every theme colour by its utility name (`poke-blue`, `art-card-blue`, `primary-foreground`), with its declared value. */
export function themeColors(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [, name, value] of themeSource().matchAll(/--color-([a-z0-9-]+):\s*([^;]+);/g)) out[name] = value.trim();
  if (Object.keys(out).length === 0) throw new Error('the Tailwind theme declares no colours');
  return out;
}

/** The utility CSS the space-separated classes compile to (no base, no other sources). */
export async function compileUtilities(classes: string): Promise<string> {
  const input = [
    '@layer theme, base, components, utilities;',
    '@import "tailwindcss/theme.css" layer(theme);',
    '@import "tailwindcss/utilities.css" layer(utilities) source(none);',
    `@source inline(${JSON.stringify(classes)});`,
    themeSource(),
  ].join('\n');
  const result = await postcss([tailwindcss({ optimize: false })]).process(input, { from: GLOBALS });
  return result.css;
}
