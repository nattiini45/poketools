/**
 * Visual-capture harness: renders the Discord/social match card (src/lib/discord/match-card-image.tsx, next/og) for
 * fixed fixtures, so its PNGs join the frozen baselines (docs/visual-harness.md). Run by scripts/visual/run.mjs:
 *
 *   npx tsx --tsconfig scripts/visual/tsconfig.json scripts/visual/social-images.tsx <out dir> <cache dir>
 *
 * No database and no Supabase: avatars are null, and the Pokémon renders the card fetches come from the
 * allow-listed sprite host through the harness's disk cache (fetched once, then offline).
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { MatchConfirmedData } from '../../src/types/discord';
import { EXTERNAL_IMAGE_HOSTS } from './lib.mjs';

const [outDir, cacheDir] = process.argv.slice(2);

function team(names: string[], kos: number[], koed: boolean[]) {
  return names.map((pokemon_name, i) => ({ pokemon_name, kos_dealt: kos[i] ?? 0, was_koed: koed[i] ?? false }));
}

const FIXTURES: Record<string, MatchConfirmedData> = {
  'bo3-full-roster': {
    kind: 'match_confirmed',
    player_1_name: 'Dawn',
    player_2_name: 'Barry',
    player_1_avatar_url: null,
    player_2_avatar_url: null,
    winner_name: 'Dawn',
    game_score: '2-1',
    tournament_name: 'Visual League · Matchday 3',
    format: 'Gen 9 OU',
    game_stats: [1, 2, 3].map((game_number) => ({
      game_number,
      winner_id: game_number === 2 ? 'p2' : 'p1',
      players: [
        { player_id: 'p1', player_name: 'Dawn', pokemon: team(['Garchomp', 'Gholdengo', 'Great Tusk', 'Dragapult', 'Kingambit', 'Iron Valiant'], [2, 1, 1, 0, 1, 0], [false, true, false, true, false, false]) },
        { player_id: 'p2', player_name: 'Barry', pokemon: team(['Corviknight', 'Clefable', 'Toxapex', 'Heatran', 'Landorus-Therian', 'Rillaboom'], [1, 0, 1, 0, 0, 0], [true, true, true, false, true, true]) },
      ],
    })),
  },
  'bo1-no-roster': {
    kind: 'match_confirmed',
    player_1_name: 'A trainer with a very long display name',
    player_2_name: 'Lucas',
    player_1_avatar_url: null,
    player_2_avatar_url: null,
    winner_name: 'Lucas',
    game_score: '0-1',
    tournament_name: 'Visual Cup',
  },
};

const realFetch = globalThis.fetch;
globalThis.fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
  const url = String(input instanceof Request ? input.url : input);
  const host = new URL(url).hostname;
  if (!EXTERNAL_IMAGE_HOSTS.includes(host)) throw new Error('visual: social image fetch blocked: ' + url);
  const file = join(cacheDir, createHash('sha256').update(url).digest('hex'));
  if (existsSync(file)) {
    const meta = JSON.parse(await readFile(file + '.json', 'utf8')) as { status: number; contentType: string };
    return new Response(new Uint8Array(await readFile(file)), { status: meta.status, headers: { 'content-type': meta.contentType } });
  }
  const response = await realFetch(input, init);
  const body = Buffer.from(await response.arrayBuffer());
  const meta = { url, status: response.status, contentType: response.headers.get('content-type') ?? 'application/octet-stream' };
  if (meta.status === 200 || meta.status === 404) {
    await writeFile(file, body);
    await writeFile(file + '.json', JSON.stringify(meta));
  }
  return new Response(new Uint8Array(body), { status: meta.status, headers: { 'content-type': meta.contentType } });
};

async function main(): Promise<void> {
  if (!outDir || !cacheDir) throw new Error('usage: social-images.tsx <out dir> <cache dir>');
  await mkdir(outDir, { recursive: true });
  await mkdir(cacheDir, { recursive: true });
  // tsx compiles the card's JSX with the classic runtime: give it the React global it expects.
  Object.assign(globalThis, { React: await import('react') });
  const { generateMatchCardImage } = await import('../../src/lib/discord/match-card-image');
  for (const [name, data] of Object.entries(FIXTURES)) {
    for (const lang of ['en', 'de'] as const) {
      const png = await generateMatchCardImage(data, lang);
      await writeFile(join(outDir, name + '__' + lang + '.png'), png);
      console.log('visual: social image ' + name + ' ' + lang + ' ' + png.length + ' bytes');
    }
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.stack : err);
  process.exit(1);
});
