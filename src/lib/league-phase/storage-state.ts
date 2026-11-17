import { defineMachine } from '@/lib/state-machine/machine';

const writer = 'supabase/migrations/20261117102000_phase_storage_fence.sql#phase_storage_transition';

export const phaseStorageMachine = defineMachine({
  id: 'phase_storage',
  title: 'Phase storage generation',
  storage: 'phase_storage_state.mode',
  summary: 'Operator-only storage generation for the phase migration. New phase writes are dormant in legacy mode. Frozen modes are maintenance boundaries; P6 supplies the complete write freeze before any live transfer.',
  doc: 'docs/phase-separation.md',
  states: ['legacy', 'frozen_legacy', 'frozen_phase', 'phase'],
  initial: ['legacy'],
  terminal: [],
  actors: ['operator'],
  transitions: [
    { event: 'freeze_legacy', from: ['legacy'], to: 'frozen_legacy', actors: ['operator'], writers: [writer] },
    { event: 'cancel', from: ['frozen_legacy'], to: 'legacy', actors: ['operator'], writers: [writer] },
    { event: 'transfer', from: ['frozen_legacy'], to: 'frozen_phase', actors: ['operator'], writers: [writer] },
    { event: 'reverse_transfer', from: ['frozen_phase'], to: 'frozen_legacy', actors: ['operator'], writers: [writer] },
    { event: 'open', from: ['frozen_phase'], to: 'phase', actors: ['operator'], writers: [writer] },
    { event: 'freeze_phase', from: ['phase'], to: 'frozen_phase', actors: ['operator'], writers: [writer] },
  ],
});
