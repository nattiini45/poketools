import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PackExtensions } from '@/lib/pack-extensions/types';
import type { CachedPlayerProfile } from '@/types/profile';
import type { HistoricalProfileContribution } from '@/lib/pack-extensions/historical-statistics-types';

const h = vi.hoisted(() => {
  const extensions: PackExtensions = {};
  return { extensions, readProfile: vi.fn(), loadSupplement: vi.fn() };
});

vi.mock('@/lib/pack-extensions', () => ({ packExtensions: h.extensions, loadSupplement: h.loadSupplement }));
vi.mock('@/lib/seo/page-reads', () => ({ readPlayerProfile: h.readProfile }));
vi.mock('@/lib/seo/page-metadata', () => ({ playerMetadata: vi.fn() }));
vi.mock('@/lib/cache/public-reads', () => ({ publicReads: {
  playerRatingHistory: async () => [], achievementDefinitions: async () => [],
} }));
vi.mock('@/lib/auth/helpers', () => ({ getSessionPlayer: async () => null }));
vi.mock('@/lib/auth/redirect-to-sign-in', () => ({ currentSignInPath: async () => '/auth/signin' }));
vi.mock('@/i18n/server', () => ({ getT: async () => (key: string) => key }));

import PlayerProfilePage from '../page';
import ProfileHeader from '@/components/profile/ProfileHeader';
import ProfilePokemonSpotlight from '@/components/profile/ProfilePokemonSpotlight';
import SupplementaryRecordSection from '@/components/supplementary/SupplementaryRecordSection';

function CareerSection() { return null; }

interface ElementProps {
  children?: ReactNode;
  headline?: unknown;
  mostUsed?: unknown;
  playerId?: string;
}

function descendants(node: ReactNode): ReactElement<ElementProps>[] {
  if (Array.isArray(node)) return node.flatMap(descendants);
  if (!isValidElement<ElementProps>(node)) return [];
  return [node, ...descendants(node.props.children)];
}

function profile(): CachedPlayerProfile {
  return {
    player: { id: 'trainer-orbit', name: 'Trainer Orbit', avatar_url: null, ps_username: 'orbit_ps', champions_username: 'orbit_champs', joined_date: '2025-01-01', is_creator: false, is_guest: false },
    headline: { total_matches: 2, total_wins: 1, total_losses: 1, win_rate: 50, total_kos_dealt: 4, unique_pokemon_used: 1, tournaments_entered: 0, tournaments_won: 0 },
    current_participations: [], past_participations: [], upcoming_matches: [], recent_matches: [],
    most_used_pokemon: [], best_kill_pokemon: [], recent_form: [], trophies: [], rating: null, streaks: null, signatures: [], achievements: [],
    live_pokemon_counters: [{ pokemon_name: 'Mew', total_games: 2, total_wins: 1, total_kos_dealt: 4, total_koed: 1 }],
  };
}

const historical: HistoricalProfileContribution = {
  record: { played: 3, wins: 2, draws: 1, losses: 0 },
  pokemon: [{ pokemonName: 'Mew', appearances: 3, wins: 2, kos: 8 }],
  honors: [], participations: [], coverage: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  h.readProfile.mockResolvedValue(profile());
  h.extensions.historicalProfile = undefined;
  h.extensions.supplementaryPlayerRecord = vi.fn(async () => null);
  h.extensions.ProfileSection = CareerSection;
});

describe('profile historical section composition', () => {
  it('keeps the generic supplementary section for a legacy-only provider and preserves the independent career extension', async () => {
    const tree = descendants(await PlayerProfilePage({ params: Promise.resolve({ id: 'trainer-orbit' }) }));
    expect(tree.find((element) => element.type === SupplementaryRecordSection)?.props.playerId).toBe('trainer-orbit');
    expect(tree.find((element) => element.type === CareerSection)?.props.playerId).toBe('trainer-orbit');
    expect(tree.find((element) => element.type === ProfileHeader)?.props.headline).toEqual(profile().headline);
    expect(h.loadSupplement).not.toHaveBeenCalled();
  });

  it('suppresses the contradictory generic section for a combined provider while passing the actual combined statistics and career extension', async () => {
    h.extensions.historicalProfile = vi.fn(async () => ({ state: 'ready' as const, data: historical }));
    h.loadSupplement.mockResolvedValue({ state: 'ready', value: { state: 'ready', data: historical } });
    const tree = descendants(await PlayerProfilePage({ params: Promise.resolve({ id: 'trainer-orbit' }) }));
    expect(tree.some((element) => element.type === SupplementaryRecordSection)).toBe(false);
    expect(tree.find((element) => element.type === CareerSection)?.props.playerId).toBe('trainer-orbit');
    expect(tree.find((element) => element.type === ProfileHeader)?.props.headline).toMatchObject({
      total_matches: 5, total_wins: 3, total_losses: 1, total_draws: 1, total_kos_dealt: 12,
    });
    expect(tree.find((element) => element.type === ProfilePokemonSpotlight)?.props.mostUsed).toEqual([
      expect.objectContaining({ pokemon_name: 'Mew', total_games: 5, total_kos_dealt: 12 }),
    ]);
    expect(h.loadSupplement).toHaveBeenCalledWith('historicalProfile', expect.any(Function));
  });
});
