// usage: npx --no-install tsx scripts/design/frozen-scale.mts
// Regenerates src/app/frozen-scale.css from the Tailwind theme and globals.css (redesign F3).
import { readFileSync, writeFileSync } from 'node:fs';
import { frozenScaleCss } from '../../src/lib/design/frozen-scale';

const read = (path: string) => readFileSync(path, 'utf8');
writeFileSync('src/app/frozen-scale.css', frozenScaleCss(read('node_modules/tailwindcss/theme.css'), read('src/app/globals.css')));
