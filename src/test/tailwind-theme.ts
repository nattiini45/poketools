/**
 * The one place tests read the Tailwind theme and run the Tailwind pipeline. Tests ask for a colour by
 * its utility name and for the CSS a class list compiles to; where the theme is declared (today
 * tailwind.config.ts) and which pipeline compiles it stay in this file, so a Tailwind upgrade changes
 * this adapter and not the tests. The pipeline runs through the typed public API (postcss +
 * tailwindcss); never import tailwindcss/lib/* (no .d.ts, breaks tsc).
 */
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import config from '../../tailwind.config';

type ColorValue = string | { [shade: string]: ColorValue };

/** Every theme colour by its utility name (`poke-blue`, `art-card-blue`, `primary-foreground`), with its declared value. */
export function themeColors(): Record<string, string> {
  const colors = (config.theme?.extend as { colors?: Record<string, ColorValue> } | undefined)?.colors;
  if (!colors) throw new Error('the Tailwind theme declares no colours');
  const out: Record<string, string> = {};
  const walk = (name: string, value: ColorValue) => {
    if (typeof value === 'string') {
      out[name] = value;
      return;
    }
    for (const [shade, inner] of Object.entries(value)) walk(shade === 'DEFAULT' ? name : `${name}-${shade}`, inner);
  };
  for (const [name, value] of Object.entries(colors)) walk(name, value);
  return out;
}

/** The utility CSS the space-separated classes compile to (no preflight, no other sources). */
export async function compileUtilities(classes: string): Promise<string> {
  const result = await postcss([
    tailwindcss({
      ...config,
      content: [{ raw: classes, extension: 'html' }],
      corePlugins: { preflight: false },
    }),
  ]).process('@tailwind utilities;', { from: undefined });
  return result.css;
}
