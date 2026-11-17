import * as legacy from '@/lib/supabase/queries/tournaments';
import * as legacyRounds from '@/lib/supabase/queries/rounds';
import * as native from '@/lib/supabase/queries/league-phases';
import * as nativeRounds from '@/lib/supabase/queries/phase-rounds';

export const legacyPhasePersistence = {
  getById: (...args: Parameters<typeof legacy.getTournamentById>) => legacy.getTournamentById(...args),
  getWithDetails: (...args: Parameters<typeof legacy.getTournamentWithDetails>) => legacy.getTournamentWithDetails(...args),
  listBySeason: (...args: Parameters<typeof legacy.getStagesBySeasonId>) => legacy.getStagesBySeasonId(...args),
  create: (...args: Parameters<typeof legacy.createTournament>) => legacy.createTournament(...args),
  remove: (...args: Parameters<typeof legacy.deleteTournament>) => legacy.deleteTournament(...args),
  shiftOrders: (...args: Parameters<typeof legacy.shiftStageOrders>) => legacy.shiftStageOrders(...args),
  reorder: (...args: Parameters<typeof legacy.reorderPhases>) => legacy.reorderPhases(...args),
  rounds: (...args: Parameters<typeof legacyRounds.getRoundsByTournament>) => legacyRounds.getRoundsByTournament(...args),
  participants: (...args: Parameters<typeof legacy.getParticipants>) => legacy.getParticipants(...args),
  addParticipant: (...args: Parameters<typeof legacy.addParticipant>) => legacy.addParticipant(...args),
  removeParticipant: (...args: Parameters<typeof legacy.removeParticipant>) => legacy.removeParticipant(...args),
  updateSeeds: (...args: Parameters<typeof legacy.updateParticipantSeeds>) => legacy.updateParticipantSeeds(...args),
};

export const nativePhasePersistence = {
  getById: (...args: Parameters<typeof native.getPhaseById>) => native.getPhaseById(...args),
  getWithDetails: (...args: Parameters<typeof native.getPhaseWithDetails>) => native.getPhaseWithDetails(...args),
  listBySeason: (...args: Parameters<typeof native.getPhasesBySeasonId>) => native.getPhasesBySeasonId(...args),
  create: (...args: Parameters<typeof native.createPhase>) => native.createPhase(...args),
  remove: (...args: Parameters<typeof native.deletePhase>) => native.deletePhase(...args),
  shiftOrders: (...args: Parameters<typeof native.shiftPhaseStageOrders>) => native.shiftPhaseStageOrders(...args),
  reorder: (...args: Parameters<typeof native.reorderPhases>) => native.reorderPhases(...args),
  rounds: (...args: Parameters<typeof nativeRounds.getRoundsByPhase>) => nativeRounds.getRoundsByPhase(...args),
  participants: (...args: Parameters<typeof native.getPhaseParticipants>) => native.getPhaseParticipants(...args),
  addParticipant: (...args: Parameters<typeof native.addPhaseParticipant>) => native.addPhaseParticipant(...args),
  removeParticipant: (...args: Parameters<typeof native.removePhaseParticipant>) => native.removePhaseParticipant(...args),
  updateSeeds: (...args: Parameters<typeof native.updatePhaseParticipantSeeds>) => native.updatePhaseParticipantSeeds(...args),
};
