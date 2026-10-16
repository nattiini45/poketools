import { getAllTimePlayerAggregates } from '@/lib/supabase/queries/aggregates';
import {
  getPlayerSignatures,
  upsertPlayerSignatures,
} from '@/lib/supabase/queries/signatures';
import { SIGNATURE_THRESHOLDS, type SignaturePokemon } from '@/types/signature';

function computeWinRate(totalWins: number, totalGames: number): number {
  if (totalGames <= 0) return 0;
  return Number((totalWins / totalGames).toFixed(4));
}

export async function updateSignatures(playerId: string): Promise<SignaturePokemon[]> {
  const allTimeStats = await getAllTimePlayerAggregates(playerId);

  const eligible = allTimeStats
    .filter((stat) => stat.total_brought >= SIGNATURE_THRESHOLDS[0])
    .sort((a, b) => {
      if (b.total_brought !== a.total_brought) {
        return b.total_brought - a.total_brought;
      }
      return computeWinRate(b.total_wins, b.total_games) - computeWinRate(a.total_wins, a.total_games);
    });

  const existing = await getPlayerSignatures(playerId);
  const existingBySlot = new Map<number, SignaturePokemon>(
    (existing?.signatures ?? []).map((s) => [s.slot_number, s])
  );

  const nowIso = new Date().toISOString();
  const nextSignatures: SignaturePokemon[] = [];

  for (let index = 0; index < SIGNATURE_THRESHOLDS.length; index += 1) {
    const slotNumber = index + 1;
    const threshold = SIGNATURE_THRESHOLDS[index];
    const candidate = eligible[index];

    if (!candidate || candidate.total_brought < threshold) {
      continue;
    }

    const previousSlot = existingBySlot.get(slotNumber);
    const unlockedAt = previousSlot?.pokemon_name === candidate.pokemon_name
      ? previousSlot.unlocked_at
      : nowIso;

    nextSignatures.push({
      pokemon_name: candidate.pokemon_name,
      games_played: candidate.total_brought,
      win_rate: computeWinRate(candidate.total_wins, candidate.total_games),
      total_kos: candidate.total_kos_dealt,
      slot_number: slotNumber,
      unlocked_at: unlockedAt,
    });
  }

  const saved = await upsertPlayerSignatures(playerId, nextSignatures);
  return saved.signatures;
}
