import 'server-only';
import { AuthError } from '@/lib/auth/helpers';
import { isPhaseAdminFor } from '@/lib/supabase/queries/phase-admins';
import { getPhasePinStates, listPhasePins, repinPhaseTarget, isVersionPhasePinned, type PhasePinState } from '@/lib/supabase/queries/phase-ruleset-pins';
import { getRulesetVersion, listRulesetVersions, repinTarget, isVersionPinned, type PinTargetState } from '@/lib/supabase/queries/ruleset-definitions';
import type { SessionPlayer } from '@/types/auth';
import type { RulesetVersionSummary, RulesetDefinitionMeta } from './library-types';
import type { RulesetActor } from './access';
import { RulesetStudioError, MAX_VERSIONS_PER_RULESET } from './errors';
import { loadMoveTargets, listUsage } from './pins';
import { movePinsWithStorage, type PinMoveInput } from './pin-move-core';
import { pinTargetCompleted } from './pin-info';
import { readExposedRulesetWithStorage } from './exposure';

export type NativePinKind = 'season' | 'tournament' | 'phase';
export type NativePinState = PinTargetState | PhasePinState;
export type NativePinTarget = { kind: NativePinKind; id: string };

export async function readExposedRulesetWithPhases(versionId: string) {
  return readExposedRulesetWithStorage(versionId, async (id) => await isVersionPinned(id) || await isVersionPhasePinned(id));
}

export async function loadMoveTargetsWithPhases(
  actor: SessionPlayer,
  targets: readonly NativePinTarget[],
  versions: readonly Pick<RulesetVersionSummary, 'id'>[],
): Promise<NativePinState[]> {
  const legacy = targets.flatMap((target) => target.kind === 'phase' ? [] : [{ kind: target.kind, id: target.id }]);
  const legacyStates = await loadMoveTargets(actor, legacy, versions);
  if (legacyStates.some(state => state.kind === 'tournament' && state.season_id !== null)) {
    throw new RulesetStudioError('ruleset_not_found');
  }
  const phaseStates = await getPhasePinStates(targets.filter((target) => target.kind === 'phase').map((target) => target.id));
  const byKey = new Map<string, NativePinState>([...legacyStates, ...phaseStates].map((state) => [`${state.kind}:${state.id}`, state]));
  const ownVersionIds = new Set(versions.map((version) => version.id));
  const checked: NativePinState[] = [];
  for (const target of targets) {
    const state = byKey.get(`${target.kind}:${target.id}`);
    if (!state) throw new RulesetStudioError('ruleset_not_found');
    if (state.kind === 'phase') {
      if (!actor.isAdmin && !await isPhaseAdminFor(actor.playerId, state.id)) {
        throw new AuthError('Admin access required for this league or phase', 403, 'forbidden');
      }
      if (!ownVersionIds.has(state.ruleset_id)) throw new RulesetStudioError('ruleset_pin_mismatch');
      if (state.archived || pinTargetCompleted(state.status)) throw new RulesetStudioError('ruleset_pin_locked');
    }
    checked.push(state);
  }
  return checked;
}

export async function movePinsWithPhases(input: PinMoveInput<NativePinKind>) {
  return movePinsWithStorage<NativePinKind, NativePinState>(input, {
    version: (...args) => getRulesetVersion(...args),
    versions: (...args) => listRulesetVersions(...args),
    targets: (...args) => loadMoveTargetsWithPhases(...args),
    repin: (state, to) => state.kind === 'phase'
      ? repinPhaseTarget(state, to)
      : repinTarget(state.kind, state.id, state.ruleset_id, to),
  });
}

export async function listUsageWithPhases(actor: RulesetActor, definition: RulesetDefinitionMeta) {
  const [legacy, versions] = await Promise.all([
    listUsage(actor, definition),
    listRulesetVersions(definition.id, MAX_VERSIONS_PER_RULESET),
  ]);
  const phases = await listPhasePins(versions.map((version) => version.id));
  const numberOf = new Map(versions.map((version) => [version.id, version.version_no]));
  const counts = new Map(legacy.counts.map((count) => [count.version_no, { ...count, phases: 0 }]));
  for (const phase of phases) {
    const versionNo = numberOf.get(phase.ruleset_id);
    if (versionNo === undefined) continue;
    const count = counts.get(versionNo) ?? { version_no: versionNo, seasons: 0, tournaments: 0, phases: 0 };
    count.phases++;
    counts.set(versionNo, count);
  }
  const targets = phases.filter((phase) => actor.isAdmin || actor.leagueIds?.has(phase.season_id) === true)
    .map((phase) => ({
      kind: 'phase' as const, id: phase.id, name: phase.name, season_id: phase.season_id,
      version_id: phase.ruleset_id, version_no: numberOf.get(phase.ruleset_id) ?? 0, status: phase.status,
    }));
  return {
    counts: [...counts.values()].sort((a, b) => a.version_no - b.version_no),
    targets: actor.isAdmin || legacy.targets !== null || targets.length > 0 ? [...(legacy.targets ?? []), ...targets] : null,
  };
}
