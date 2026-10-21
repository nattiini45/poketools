import { describe, expect, it } from 'vitest';
import { manualResultSchema, replayImportSchema } from '@/lib/validation/schemas';
import { buildGamePayload, createInitialState } from '@/lib/broadcast/tracker-reducer';

const MATCH_ID = '12345678-1234-4123-8123-123456789abc';
const P1_ID = '11111111-1111-4111-8111-111111111111';
const P2_ID = '22222222-2222-4222-8222-222222222222';

const P1_TEAM = ['Pikachu', 'Gengar', 'Dragonite', 'Garchomp', 'Lapras', 'Snorlax'];
const P2_TEAM = ['Charizard', 'Blastoise', 'Venusaur', 'Tyranitar', 'Metagross', 'Salamence'];

const block = (player_id: string, names: string[]) => ({
  player_id,
  pokemon: names.map((pokemon_name) => ({ pokemon_name, kos_dealt: 1 })),
});

const body = (pokemon_stats: unknown[]) => ({ match_id: MATCH_ID, winner_id: P1_ID, pokemon_stats });

describe('manualResultSchema pokemon_stats', () => {
  it('accepts a normal two-player 6+6 payload', () => {
    expect(manualResultSchema.safeParse(body([block(P1_ID, P1_TEAM), block(P2_ID, P2_TEAM)])).success).toBe(true);
  });

  it('accepts the same Pokémon on both sides (mirror match)', () => {
    expect(manualResultSchema.safeParse(body([block(P1_ID, ['Pikachu']), block(P2_ID, ['pikachu'])])).success).toBe(
      true
    );
  });

  it('rejects more than two stat blocks', () => {
    const result = manualResultSchema.safeParse(
      body([block(P1_ID, ['Pikachu']), block(P2_ID, ['Charizard']), block(P1_ID, ['Gengar'])])
    );
    expect(result.success).toBe(false);
  });

  it('rejects a player_id repeated across blocks', () => {
    const result = manualResultSchema.safeParse(body([block(P1_ID, ['Pikachu']), block(P1_ID, ['Gengar'])]));
    expect(result.success).toBe(false);
    expect(result.error?.issues).toContainEqual(
      expect.objectContaining({ path: ['pokemon_stats', 1, 'player_id'] })
    );
  });

  it('rejects a Pokémon repeated within one block, ignoring case and whitespace', () => {
    const result = manualResultSchema.safeParse(
      body([block(P1_ID, ['Pikachu', ' PIKACHU ']), block(P2_ID, ['Charizard'])])
    );
    expect(result.success).toBe(false);
    expect(result.error?.issues).toContainEqual(
      expect.objectContaining({ path: ['pokemon_stats', 0, 'pokemon', 1, 'pokemon_name'] })
    );
  });

  it('accepts the tracker submission built by buildGamePayload', () => {
    const state = createInitialState(
      MATCH_ID,
      { id: P1_ID, name: 'Alice', avatar_url: null, pokemon: P1_TEAM },
      { id: P2_ID, name: 'Bob', avatar_url: null, pokemon: P2_TEAM }
    );
    const payload = buildGamePayload(state, P1_ID);
    expect(payload.pokemon_stats).toHaveLength(2);
    expect(payload.pokemon_stats[0].pokemon).toHaveLength(6);
    expect(manualResultSchema.safeParse(payload).success).toBe(true);
  });
});

describe('replayImportSchema pokemon_stats', () => {
  const replayBody = (pokemon_stats: unknown[]) => ({
    replay_url: 'https://replay.pokemonshowdown.com/gen9-1',
    winner_id: P1_ID,
    pokemon_stats,
  });

  it('accepts a normal two-player payload', () => {
    expect(replayImportSchema.safeParse(replayBody([block(P1_ID, P1_TEAM), block(P2_ID, P2_TEAM)])).success).toBe(
      true
    );
  });

  it('rejects repeated blocks for one player', () => {
    const blocks = Array.from({ length: 3 }, () => block(P1_ID, ['Pikachu']));
    expect(replayImportSchema.safeParse(replayBody(blocks)).success).toBe(false);
    expect(replayImportSchema.safeParse(replayBody(blocks.slice(0, 2))).success).toBe(false);
  });
});
