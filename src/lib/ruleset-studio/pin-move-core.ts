import { diffResolved } from '@/lib/ruleset-kit/effective';
import type { ResolvedRules } from '@/lib/ruleset-kit/types';
import type { SessionPlayer } from '@/types/auth';
import type { RulesetDefinitionMeta, RulesetVersionSummary } from './library-types';
import type { MovedPin } from './pin-info';
import { pinTargetStarted } from './pin-info';
import { MAX_VERSIONS_PER_RULESET, RulesetStudioError } from './errors';

export interface PinMoveState<K extends string> {
  kind: K;
  id: string;
  name: string;
  season_id: string | null;
  status: string;
  ruleset_id: string | null;
}

export type PinMoveEntry<K extends string> = Omit<MovedPin, 'kind'> & { kind: K };

export interface PinMoveInput<K extends string> {
  actor: SessionPlayer;
  definition: RulesetDefinitionMeta;
  toVersionNo: number;
  targets: readonly { kind: K; id: string }[];
  confirmStarted: readonly string[];
  onMoved?: (moved: PinMoveEntry<K>, to: { version_id: string; version_no: number }) => void;
}

export interface PinMoveStorage<K extends string, S extends PinMoveState<K>> {
  version(definitionId: string, versionNo: number): Promise<{ id: string; version_no: number; resolved: ResolvedRules } | null>;
  versions(definitionId: string, limit: number): Promise<RulesetVersionSummary[]>;
  targets(actor: SessionPlayer, targets: PinMoveInput<K>['targets'], versions: readonly Pick<RulesetVersionSummary, 'id'>[]): Promise<S[]>;
  repin(state: S, to: string): Promise<boolean>;
}

export async function movePinsWithStorage<K extends string, S extends PinMoveState<K>>(
  input: PinMoveInput<K>,
  storage: PinMoveStorage<K, S>,
): Promise<{ version_id: string; version_no: number; moved: PinMoveEntry<K>[] }> {
  const { actor, definition } = input;
  const version = await storage.version(definition.id, input.toVersionNo);
  if (version === null) throw new RulesetStudioError('ruleset_not_found');
  const versions = await storage.versions(definition.id, MAX_VERSIONS_PER_RULESET);
  const confirmed = new Set(input.confirmStarted);
  const plan: S[] = [];
  const needConfirmation: string[] = [];
  for (const state of await storage.targets(actor, input.targets, versions)) {
    if (state.ruleset_id === version.id) continue;
    if (pinTargetStarted(state.status) && !confirmed.has(state.id)) needConfirmation.push(state.name);
    plan.push(state);
  }
  if (needConfirmation.length > 0) {
    throw new RulesetStudioError('ruleset_pin_confirm_required', { targets: needConfirmation.join(', ') });
  }
  const numberOf = new Map(versions.map((v) => [v.id, v.version_no] as const));
  const sources = new Map<string, ResolvedRules | null>();
  const sourceRules = async (versionId: string): Promise<ResolvedRules | null> => {
    if (!sources.has(versionId)) {
      const no = numberOf.get(versionId);
      sources.set(versionId, no === undefined ? null : ((await storage.version(definition.id, no))?.resolved ?? null));
    }
    return sources.get(versionId) ?? null;
  };
  const to = { version_id: version.id, version_no: version.version_no };
  const moved: PinMoveEntry<K>[] = [];
  for (const state of plan) {
    const from = state.ruleset_id === null ? null : await sourceRules(state.ruleset_id);
    const entry: PinMoveEntry<K> = {
      kind: state.kind, id: state.id, name: state.name, season_id: state.season_id,
      from_version_id: state.ruleset_id, started: pinTargetStarted(state.status),
      difference: from === null ? null : diffResolved(from, version.resolved),
    };
    if (!await storage.repin(state, version.id)) throw new RulesetStudioError('ruleset_pin_moved', { target: state.name });
    moved.push(entry);
    input.onMoved?.(entry, to);
  }
  return { ...to, moved };
}
