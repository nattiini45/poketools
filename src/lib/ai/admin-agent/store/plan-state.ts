import { defineMachine } from '@/lib/state-machine/machine';

/**
 * `admin_agent_plans.status`: the lifecycle of a conversation's Plan (spec §4.14, §18.3).
 *
 * The lifecycle is defined but not wired yet: `setPlanStatus` has no caller, so every plan stays `drafting` today and
 * `propose_build` treats a plan as buildable while it is drafting, ready or partial. The readers already act on the
 * machine (`propose_build` stages from `sourcesOf('building')`, `plan_create` starts a new plan only once the active one
 * is terminal, the Plan panel offers Build only where `building` is reachable). Every write is guarded with
 * `.in('status', planMachine.sourcesOf(to))` in `store/plans.ts`. The guard trigger only keeps `revision` monotonic.
 */
export const planMachine = defineMachine({
  id: 'admin_agent_plan',
  title: 'Admin Assistant plan',
  storage: 'admin_agent_plans.status',
  summary:
    'The Plan document of a conversation from drafting to built or abandoned. Not wired yet: no code moves a plan out of drafting (setPlanStatus has no caller), so these transitions describe the intended lifecycle and guard any future writer.',
  doc: 'docs/poketools-spec.md',
  states: ['drafting', 'ready', 'building', 'partial', 'built', 'abandoned'],
  initial: ['drafting'],
  terminal: ['built', 'abandoned'],
  actors: ['system'],
  transitions: [
    {
      event: 'mark_ready',
      from: ['drafting'],
      to: 'ready',
      actors: ['system'],
      writers: ['src/lib/ai/admin-agent/store/plans.ts'],
      note: 'Readiness has no blockers (setPlanStatus, or a revision write that names the status). No caller yet.',
    },
    {
      event: 'reopen',
      from: ['ready'],
      to: 'drafting',
      actors: ['system'],
      writers: ['src/lib/ai/admin-agent/store/plans.ts'],
      note: 'An edit gives a ready plan blockers again. No caller yet.',
    },
    {
      event: 'start_build',
      from: ['drafting', 'ready', 'partial'],
      to: 'building',
      actors: ['system'],
      writers: ['src/lib/ai/admin-agent/store/plans.ts'],
      note: 'A Build proposal of the plan is claimed (stamps build_started_at). No caller yet; propose_build stages only from these states.',
    },
    {
      event: 'complete_build',
      from: ['building'],
      to: 'built',
      actors: ['system'],
      writers: ['src/lib/ai/admin-agent/store/plans.ts'],
      note: 'The Build proposal completed (stamps build_finished_at). No caller yet.',
    },
    {
      event: 'finish_partial',
      from: ['building'],
      to: 'partial',
      actors: ['system'],
      writers: ['src/lib/ai/admin-agent/store/plans.ts'],
      note: 'The Build ended with some steps written; a fresh Build covers the rest. No caller yet.',
    },
    {
      event: 'release_build',
      from: ['building'],
      to: 'drafting',
      actors: ['system'],
      writers: ['src/lib/ai/admin-agent/store/plans.ts'],
      note: 'The Build was refused or wrote nothing (stale, failed before a step). No caller yet.',
    },
    {
      event: 'abandon',
      from: ['drafting', 'ready', 'partial'],
      to: 'abandoned',
      actors: ['system'],
      writers: ['src/lib/ai/admin-agent/store/plans.ts'],
      note: 'The admin gives the plan up; a new plan_create is allowed afterwards. No caller yet.',
    },
  ],
});
