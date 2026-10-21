/**
 * Font loading for satori-based image generation.
 * Reads bundled TTF files from public/fonts/.
 * Caches in module-level variables so fonts are only read once per cold start.
 */
import { readFile } from 'fs/promises';
import path from 'path';

interface FontData {
  nunito700: ArrayBuffer;
  dmSans400: ArrayBuffer;
  dmSans600: ArrayBuffer;
}

let cached: FontData | null = null;

export async function loadFonts(): Promise<FontData> {
  if (cached) return cached;

  const fontsDir = path.join(process.cwd(), 'public', 'fonts');

  const [nunito700, dmSans400, dmSans600] = await Promise.all([
    readFile(path.join(fontsDir, 'Nunito-Bold.ttf')),
    readFile(path.join(fontsDir, 'DMSans-Regular.ttf')),
    readFile(path.join(fontsDir, 'DMSans-SemiBold.ttf')),
  ]);

  cached = {
    nunito700: nunito700.buffer.slice(nunito700.byteOffset, nunito700.byteOffset + nunito700.byteLength),
    dmSans400: dmSans400.buffer.slice(dmSans400.byteOffset, dmSans400.byteOffset + dmSans400.byteLength),
    dmSans600: dmSans600.buffer.slice(dmSans600.byteOffset, dmSans600.byteOffset + dmSans600.byteLength),
  };
  return cached;
}
