import 'server-only';
/**
 * The live side of staging: the reads `StagingSource` and `FingerprintSource` declare, wired to the existing query modules
 * and the routes' own shared functions, and the bound `StagerDeps` (`liveStagerDeps`). The only module of `proposals/`
 * that imports the app's data layer; every function here READS. Nothing writes a domain table.
 *
 * The same `liveFingerprints` is what the approve route's precondition recheck uses, so staging and execution cannot
 * disagree about what a read returns.
 *
 * `startup_checklist` and `channel_set` (the two reads a start or a bracket is guarded by) answer from `loadStartupInput` with
 * the pure `buildStartupChecklist`, and from `previewRecipients` over the senders' own matchers. A read the app cannot answer
 * still fails closed with `ReadUnavailable` (staging answers `tool_not_available`).
 */
import { requireEnv } from '@/lib/env';
import { requireAnyAdmin } from '@/lib/auth/helpers';
import { getSpeciesNatDex, getMoveNatDex, getItemNatDex, getAbilityNatDex } from '@/lib/pkmn/dex';
import { resolveTourOverlay } from '@/lib/pkmn/preset-rules.server';
import { isRulesetPresetId } from '@/lib/pkmn/ruleset-preset-catalog';
import { canEditDraft } from '@/lib/ruleset-studio/access';
import { checkDocument, MAX_OWNED_RULESETS } from '@/lib/ruleset-studio/library';
import { computePinImpact } from '@/lib/ruleset-studio/pin-impact.server';
import { pinTargetCompleted, pinTargetStarted } from '@/lib/ruleset-studio/pin-info';
import { pointBuyBattleRulesetInput } from '@/lib/season/point-buy-battle-ruleset';
import { getActiveListVersion } from '@/lib/supabase/queries/point-buy-lists';
import { getDraftPoolsBySeason } from '@/lib/supabase/queries/drafts';
import { getPlayersByIds } from '@/lib/supabase/queries/players';
import { getRoundsByTournament } from '@/lib/supabase/queries/rounds';
import { findHeadRulesetsByName } from '@/lib/supabase/queries/rulesets';
import {
  countOwnedRulesetDefinitions,
  getDefinitionOfVersion,
  getPinTargetStates,
  getRulesetDefinitionDraft,
  getRulesetDefinitionMeta,
  getRulesetVersion,
} from '@/lib/supabase/queries/ruleset-definitions';
import { getSeasonFormatSummary } from '@/lib/supabase/queries/season-formats';
import { getSeasonById, getSeasonParticipants, listSeasons, listSeasonsByIds } from '@/lib/supabase/queries/seasons';
import { getParticipants, getStagesBySeasonId, getTournamentById, listAllTournaments } from '@/lib/supabase/queries/tournaments';
import { previewRecipients } from '@/lib/admin/outward-recipients';
import { buildBracketStructureForParticipants } from '@/lib/tournament/bracket-structure';
import { buildStartupChecklist } from '@/lib/tournament/startup-checklist';
import { loadStartupInput, startupChecklistState } from '@/lib/tournament/startup-checklist.server';
import type { DiscordEventType } from '@/types/discord';
import type { JsonValue } from '@/lib/studio-core/json';
import { checkRateLimit } from '@/lib/utils/rate-limit';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { parseAdminAgentEnv } from '../env';
import { planFactNeeds, dexFactKey, type PlanFacts, type PlayerFact, type RefFact } from '../plans/facts';
import { hashJson } from '../plans/hash';
import { guardFor } from '../registry/guard';
import { toolErrorFromThrown } from '../registry/errors';
import { STAGED_TOOLS } from '../registry/staged';
import { adminAgentStore } from '../store';
import { draftDocState, draftLifeState, leagueAfterState, pinTargetsState, rosterMembersState, tournamentAfterState, type StepFacts } from './after-state';
import type { FingerprintSource, ReadName, ReadTarget } from './fingerprints';
import { createProposalStager } from './stage';
import type { EpbBattleRulesetHead, StagerDeps, StagingSource } from './types';

const DAY_MS = 24 * 60 * 60 * 1000;
const PIN_IMPACT_LIMIT = { limit: 60, windowSeconds: 60 * 60 } as const;

const sorted = <T>(items: readonly T[], key: (item: T) => string): T[] => [...items].sort((a, b) => key(a).localeCompare(key(b)));
const nameKey = (name: string): string => name.normalize('NFC').trim().toLowerCase();

/** The catalogued code a guard or lookup refused with, or rethrows what is not a refusal. */
async function codeOf(run: () => Promise<unknown>, where: string): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (err) {
    const mapped = toolErrorFromThrown(err, where);
    if (mapped.code === 'agent_harness_error' || mapped.code === 'upstream_timeout') throw err;
    return mapped.code;
  }
}

/**
 * How a refused guard reads as a Plan fact: an absent entity, a forbidden one, or `null` for any other refusal
 * (`unauthenticated`, `rate_limited`, `ruleset_locked`, ...). A `null` leaves the fact out, which `planReadiness` reports as
 * `fact_unavailable`, so a refusal that says nothing about the entity never reads as "it does not exist".
 */
export function refusalFact(code: string, where: string): 'not_found' | 'forbidden' | null {
  if (code.endsWith('not_found')) return 'not_found';
  if (code === 'forbidden' || code.endsWith('_forbidden')) return 'forbidden';
  console.warn(`[admin-agent] ${where}: refused with ${code}; the fact stays unavailable`);
  return null;
}

async function epbHead(): Promise<EpbBattleRulesetHead | null> {
  const [head] = await findHeadRulesetsByName(pointBuyBattleRulesetInput().name);
  return head === undefined ? null : { versionId: head.id, versionNo: head.version?.version_no ?? 0, slug: head.name };
}

// ─── Plan facts ──────────────────────────────────────────────────────────────

async function dexFact(category: 'pokemon' | 'moves' | 'items' | 'abilities', id: string): Promise<'ok' | 'unknown'> {
  const found = { pokemon: getSpeciesNatDex, moves: getMoveNatDex, items: getItemNatDex, abilities: getAbilityNatDex }[category](id);
  return found === null || found === undefined ? 'unknown' : 'ok';
}

function playerFact(player: Awaited<ReturnType<typeof getPlayersByIds>> extends Map<string, infer P> ? P : never, now: number): PlayerFact {
  if (player.status === 'banned') return { status: 'banned' };
  if (player.status === 'suspended' && (player.suspended_until === null || new Date(player.suspended_until).getTime() > now)) return { status: 'suspended' };
  if (player.is_test_account) return { status: 'test' };
  return { status: 'ok', isGuest: player.is_guest, name: player.name };
}

async function refFact(refKey: string, entityType: string, entityId: string): Promise<RefFact> {
  if (entityType === 'tournament' || entityType === 'tournament_roster') {
    if ((await getTournamentById(entityId)) === null) return 'gone';
    return (await codeOf(() => guardFor({ kind: 'tournament', id: entityId }), 'ref tournament')) === null ? 'live' : 'no_access';
  }
  if (entityType === 'draft_pool') {
    // A read that fails says nothing about the pool: it propagates (the staging refusal mapping logs and answers a harness error)
    // instead of reading as an empty list, which would tell the admin the pool he built is gone.
    let pools: Awaited<ReturnType<typeof getDraftPoolsBySeason>>;
    try {
      pools = await getDraftPoolsBySeason(entityId);
    } catch (error) {
      console.error(`[admin-agent] ref fact ${refKey}: the draft pool read failed`, error);
      throw error;
    }
    return pools.length > 0 ? 'live' : 'gone';
  }
  // season, season_roster, season_groups: all hang off the league.
  if ((await getSeasonById(entityId)) === null) return 'gone';
  return (await codeOf(() => guardFor({ kind: 'season', id: entityId }), 'ref season')) === null ? 'live' : 'no_access';
}

/** Everything `planReadiness` looks up for this Plan, as the live admin sees it (`planFactNeeds` says what). */
async function loadPlanFacts(input: Parameters<StagingSource['loadPlanFacts']>[0]): Promise<PlanFacts> {
  const { admin, plan } = input;
  const needs = planFactNeeds(plan);
  const now = Date.now();

  const rulesetVersions: NonNullable<PlanFacts['rulesetVersions']> = {};
  for (const versionId of needs.rulesetVersionIds) {
    const code = await codeOf(() => guardFor({ kind: 'rulesetUsable', versionId }), 'facts ruleset version');
    const fact = code === null ? 'usable' : refusalFact(code, 'facts ruleset version');
    if (fact !== null) rulesetVersions[versionId] = fact;
  }

  const rulesetDefinitions: NonNullable<PlanFacts['rulesetDefinitions']> = {};
  for (const definitionId of needs.rulesetDefinitionIds) {
    try {
      const guarded = await guardFor({ kind: 'rulesetViewer', id: definitionId });
      const draft = canEditDraft(guarded.ruleset.actor, guarded.ruleset.definition) ? await getRulesetDefinitionDraft(definitionId) : null;
      const errors = draft === null ? 0 : checkDocument(draft.document).diagnostics.filter((d) => d.severity === 'error').length;
      rulesetDefinitions[definitionId] = { state: 'ok', diagnosticsErrors: errors };
    } catch (err) {
      const mapped = toolErrorFromThrown(err, 'facts ruleset definition');
      if (mapped.code === 'agent_harness_error' || mapped.code === 'upstream_timeout') throw err;
      const fact = refusalFact(mapped.code, 'facts ruleset definition');
      if (fact !== null) rulesetDefinitions[definitionId] = { state: fact };
    }
  }

  const rulesetPresets: NonNullable<PlanFacts['rulesetPresets']> = {};
  for (const presetId of needs.presetIds) {
    rulesetPresets[presetId] = isRulesetPresetId(presetId) ? { known: true, hasTourOverlay: resolveTourOverlay(presetId) !== null } : { known: false };
  }

  const dex: NonNullable<PlanFacts['dex']> = {};
  for (const entry of needs.dex) dex[dexFactKey(entry.category, entry.id)] = await dexFact(entry.category, entry.id);

  const players: NonNullable<PlanFacts['players']> = {};
  if (needs.playerIds.length > 0) {
    const found = await getPlayersByIds(needs.playerIds);
    for (const id of needs.playerIds) {
      const player = found.get(id) ?? [...found.values()].find((candidate) => candidate.id.toLowerCase() === id);
      players[id] = player === undefined ? { status: 'not_found' } : playerFact(player, now);
    }
  }

  const formats: NonNullable<PlanFacts['formats']> = {};
  for (const formatId of needs.formatDefinitionIds) {
    const code = await codeOf(() => guardFor({ kind: 'formatViewer', id: formatId }), 'facts format');
    const state = code === null ? 'ok' : refusalFact(code, 'facts format');
    if (state !== null) formats[formatId] = { state };
  }

  // Round names for `bo_overrides`: only an elimination bracket names its rounds. The participant count is the previous
  // phase's advancement when it has one, else the roster; without a count nothing can be checked and the list stays empty.
  const rosterCount = plan.slots.roster?.entries.filter((entry) => entry.state === 'resolved').length ?? plan.slots.roster?.target_count ?? 0;
  const unknownBoOverrideKeys: NonNullable<PlanFacts['unknownBoOverrideKeys']> = {};
  for (const check of needs.boOverrideChecks) {
    const index = (plan.slots.phases ?? []).findIndex((phase) => phase.key === check.key);
    const previous = index > 0 ? plan.slots.phases?.[index - 1] : undefined;
    const participants = previous?.advancement_rule?.count ?? rosterCount;
    if ((check.bracketType === 'single_elim' || check.bracketType === 'double_elim') && participants >= 2) {
      const structure = buildBracketStructureForParticipants(check.bracketType, Array.from({ length: participants }, (_, i) => ({ seed: i + 1 })));
      const names = new Set((structure?.rounds ?? []).map((round) => round.name));
      unknownBoOverrideKeys[check.key] = check.overrideKeys.filter((key) => !names.has(key));
    } else {
      unknownBoOverrideKeys[check.key] = [];
    }
  }

  const refs: NonNullable<PlanFacts['refs']> = {};
  for (const key of needs.refKeys) {
    const ref = plan.refs[key];
    if (ref !== undefined) refs[key] = await refFact(key, ref.entity_type, ref.entity_id);
  }

  const facts: PlanFacts = { rulesetVersions, rulesetDefinitions, rulesetPresets, dex, players, formats, unknownBoOverrideKeys, refs };
  if (needs.needsRulesetQuota) facts.rulesetQuota = { owned: await countOwnedRulesetDefinitions(admin.id), max: MAX_OWNED_RULESETS };
  if (needs.needsEpbListFact) facts.epbActiveListAvailable = (await getActiveListVersion()) !== null;
  if (plan.slots.league !== undefined) {
    const wanted = nameKey(plan.slots.league.name);
    facts.leagueNameInUse = (await listSeasons({ includeTestSeasons: true })).some((season) => nameKey(season.name) === wanted);
  }
  const builtLeague = plan.refs.league?.entity_id;
  if (builtLeague !== undefined) {
    const roster = await getSeasonParticipants(builtLeague);
    facts.enrolledPlayerIds = roster.map((participant) => participant.id.toLowerCase());
    facts.liveRosterCount = roster.length;
  }
  // The roster of a standalone tournament built earlier: its status (players join while it is `upcoming`) and who is already in.
  const builtTournament = plan.slots.league === undefined ? plan.refs.tournament?.entity_id : undefined;
  if (builtTournament !== undefined && plan.slots.roster !== undefined) {
    const [row, participants] = await Promise.all([getTournamentById(builtTournament), getParticipants(builtTournament)]);
    if (row !== null) {
      facts.tournamentStatus = row.status;
      facts.enrolledPlayerIds = participants.map((participant) => participant.id.toLowerCase());
    }
  }
  return facts;
}

// ─── Fingerprint reads ───────────────────────────────────────────────────────

const idOf = (target: ReadTarget): string => {
  if (target.kind !== 'id') throw new Error('fingerprint read needs an id target');
  return target.id;
};
const paramsOf = (target: ReadTarget): Record<string, JsonValue> => {
  if (target.kind !== 'params' || typeof target.params !== 'object' || target.params === null || Array.isArray(target.params)) {
    throw new Error('fingerprint read needs a params target');
  }
  return target.params;
};

export const liveFingerprints: FingerprintSource = {
  async read(read: ReadName, target: ReadTarget): Promise<JsonValue> {
    switch (read) {
      case 'league_name_recent': {
        const wanted = nameKey(String(paramsOf(target).name ?? ''));
        const since = Date.now() - DAY_MS;
        const seasons = await listSeasons({ includeTestSeasons: true });
        return sorted(seasons.filter((s) => nameKey(s.name) === wanted && new Date(s.created_at).getTime() >= since).map((s) => s.id), (id) => id);
      }
      case 'tournament_name_recent': {
        const wanted = nameKey(String(paramsOf(target).name ?? ''));
        const since = Date.now() - DAY_MS;
        const all = await listAllTournaments();
        return sorted(all.filter((t) => t.season_id === null && nameKey(t.name) === wanted && new Date(t.created_at).getTime() >= since).map((t) => t.id), (id) => id);
      }
      case 'epb_battle_ruleset_head':
        return (await epbHead())?.versionId ?? null;
      case 'season_state': {
        const season = await getSeasonById(idOf(target));
        return season === null ? null : { status: season.status, archived: season.archived, start_date: season.start_date, end_date: season.end_date, updated_at: season.updated_at };
      }
      case 'phase_stage_order': {
        // Phase enrollment is derived state the admin UI rewrites on load: ids, order and status only.
        const stages = await getStagesBySeasonId(idOf(target));
        return sorted(stages.map((stage) => ({ id: stage.id, stage_order: stage.stage_order, status: stage.status })), (s) => `${String(s.stage_order).padStart(6, '0')}:${s.id}`);
      }
      case 'roster_hash':
        return sorted((await getSeasonParticipants(idOf(target))).map((p) => p.id.toLowerCase()), (id) => id);
      case 'tournament_roster_hash':
        return sorted((await getParticipants(idOf(target))).map((p) => p.id.toLowerCase()), (id) => id);
      case 'draft_pool_state': {
        const pools = await getDraftPoolsBySeason(idOf(target));
        return sorted(pools.map((pool) => ({ id: pool.id, engine: pool.engine, kind: pool.kind, phase: pool.phase, status: pool.status })), (p) => p.id);
      }
      case 'ruleset_draft': {
        const definition = await getRulesetDefinitionMeta(idOf(target));
        const draft = definition === null ? null : await getRulesetDefinitionDraft(definition.id);
        if (definition === null || draft === null) return null;
        const diagnostics = checkDocument(draft.document).diagnostics.map((d) => `${d.severity}:${d.code}:${d.path}`).sort();
        return { draft_rev: draft.draft_rev, diagnostics, current_version_id: definition.current_version_id, visibility: definition.visibility };
      }
      case 'pin_state': {
        const params = paramsOf(target);
        const targets = (params.targets as Array<{ kind: 'season' | 'tournament'; id: string }>) ?? [];
        const states = await getPinTargetStates(
          targets.filter((t) => t.kind === 'season').map((t) => t.id),
          targets.filter((t) => t.kind === 'tournament').map((t) => t.id),
        );
        const definitionId = String(params.definition_id);
        const definition = await getRulesetDefinitionMeta(definitionId);
        const player = await requireAnyAdmin();
        const impact =
          definition === null
            ? null
            : await computePinImpact({ actor: player, definition, toVersionNo: Number(params.to_version_no), targets });
        return {
          targets: sorted(
            states.map((s) => ({ kind: s.kind, id: s.id, ruleset_id: s.ruleset_id, started: pinTargetStarted(s.status), completed: pinTargetCompleted(s.status) })),
            (s) => `${s.kind}:${s.id}`,
          ),
          impact: impact === null ? null : { checked: impact.checked, would_break: impact.would_break },
        };
      }
      case 'phase_start_state': {
        const tournament = await getTournamentById(idOf(target));
        if (tournament === null) return null;
        const [participants, rounds, season] = await Promise.all([
          getParticipants(tournament.id),
          getRoundsByTournament(tournament.id),
          tournament.season_id === null ? Promise.resolve(null) : getSeasonById(tournament.season_id),
        ]);
        return {
          status: tournament.status,
          ruleset_id: tournament.ruleset_id,
          season_status: season?.status ?? null,
          round_count: rounds.length,
          participants: sorted(participants.map((p) => `${p.id.toLowerCase()}:${p.seed ?? ''}`), (entry) => entry),
        };
      }
      // The state a chat write left an entity in (slice 5): what an undo compares against. A missing entity reads `null`.
      case 'league_after': {
        const [season] = await listSeasonsByIds([idOf(target)]);
        // Only what an admin edits (`leagueAfterState`): a start by the chat or the site's normal play must not look like an edit.
        return season === undefined ? null : leagueAfterState(season);
      }
      case 'tournament_after': {
        const tournament = await getTournamentById(idOf(target));
        return tournament === null ? null : tournamentAfterState(tournament);
      }
      case 'roster_members': {
        const params = paramsOf(target);
        const wanted = Array.isArray(params.player_ids) ? params.player_ids.filter((id): id is string => typeof id === 'string') : [];
        const roster = new Set((await getSeasonParticipants(String(params.season_id))).map((participant) => participant.id.toLowerCase()));
        return rosterMembersState(wanted.filter((id) => roster.has(id.toLowerCase())));
      }
      case 'tournament_members': {
        const params = paramsOf(target);
        const wanted = Array.isArray(params.player_ids) ? params.player_ids.filter((id): id is string => typeof id === 'string') : [];
        const roster = new Set((await getParticipants(String(params.tournament_id))).map((participant) => participant.id.toLowerCase()));
        return rosterMembersState(wanted.filter((id) => roster.has(id.toLowerCase())));
      }
      case 'pin_targets': {
        const targets = (paramsOf(target).targets as Array<{ kind: 'season' | 'tournament'; id: string }>) ?? [];
        const states = await getPinTargetStates(
          targets.filter((t) => t.kind === 'season').map((t) => t.id),
          targets.filter((t) => t.kind === 'tournament').map((t) => t.id),
        );
        return pinTargetsState(states.map((state) => ({ kind: state.kind, id: state.id, ruleset_id: state.ruleset_id })));
      }
      case 'ruleset_draft_doc': {
        const draft = await getRulesetDefinitionDraft(idOf(target));
        return draft === null ? null : draftDocState(draft.draft_rev, hashJson(draft.document));
      }
      case 'ruleset_draft_state': {
        const definition = await getRulesetDefinitionMeta(idOf(target));
        const draft = definition === null ? null : await getRulesetDefinitionDraft(definition.id);
        return definition === null || draft === null ? null : draftLifeState(draft.draft_rev, definition.current_version_id !== null);
      }
      case 'startup_checklist': {
        // The state of the checklist the round manager would show for this phase (never a write: no roster sync).
        const input = await loadStartupInput(idOf(target));
        return input === null ? null : startupChecklistState(buildStartupChecklist(input));
      }
      case 'channel_set': {
        // The channels each posting event would reach: row ids only, so a webhook or integration added, removed, disabled or
        // re-filtered between the card and the click makes the card stale. Names and URLs are not part of it.
        const params = paramsOf(target);
        const tournament = await getTournamentById(String(params.tournament_id ?? ''));
        if (tournament === null) return null;
        const events = Array.isArray(params.events) ? params.events.filter((event): event is string => typeof event === 'string').sort() : [];
        const out: Record<string, JsonValue> = {};
        for (const eventType of events) {
          const reach = await previewRecipients({ eventType: eventType as DiscordEventType, tournamentId: tournament.id, seasonId: tournament.season_id });
          out[eventType] = { discord: [...reach.discord.ids], social: [...reach.social.ids] };
        }
        return out;
      }
    }
  },
};

// ─── The source ──────────────────────────────────────────────────────────────

export const liveSource: StagingSource = {
  loadPlanFacts,

  async existingPhaseNames(seasonId) {
    return (await getStagesBySeasonId(seasonId)).map((stage) => stage.name);
  },

  epbBattleRulesetHead: epbHead,

  async rulesetDraft(definitionId) {
    const definition = await getRulesetDefinitionMeta(definitionId);
    const draft = definition === null ? null : await getRulesetDefinitionDraft(definition.id);
    if (definition === null || draft === null) return null;
    const check = checkDocument(draft.document);
    const diagnostics = check.diagnostics.map((d) => `${d.severity}:${d.code}:${d.path}`).sort();
    return {
      draftRev: draft.draft_rev,
      errorDiagnostics: check.diagnostics.filter((d) => d.severity === 'error').length,
      diagnosticsHash: diagnostics.join('|'),
      currentVersionId: definition.current_version_id,
      visibility: definition.visibility,
      slug: definition.slug,
    };
  },

  async rulesetVersionExists(definitionId, versionNo) {
    return (await getRulesetVersion(definitionId, versionNo)) !== null;
  },

  async pinTargets(targets) {
    const states = await getPinTargetStates(
      targets.filter((t) => t.kind === 'season').map((t) => t.id),
      targets.filter((t) => t.kind === 'tournament').map((t) => t.id),
    );
    const out = [];
    for (const state of states) {
      const pinned = state.ruleset_id === null ? null : await getDefinitionOfVersion(state.ruleset_id);
      out.push({
        kind: state.kind,
        id: state.id,
        name: state.name,
        started: pinTargetStarted(state.status),
        completed: pinTargetCompleted(state.status),
        pinnedVersionId: state.ruleset_id,
        pinnedDefinitionId: pinned?.definition.id ?? null,
      });
    }
    return out;
  },

  async pinImpact({ definitionId, toVersionNo, targets }) {
    const player = await requireAnyAdmin();
    const definition = await getRulesetDefinitionMeta(definitionId);
    if (definition === null) throw new UserFacingError('Ruleset not found', { code: 'ruleset_not_found', status: 404 });
    // The same hourly bucket as the admin page (60 per hour, shared with the human).
    const rate = await checkRateLimit('ruleset-pin-impact', player.playerId, PIN_IMPACT_LIMIT);
    if (!rate.allowed) throw new UserFacingError('Rate limit exceeded', { code: 'rate_limited', params: { seconds: rate.retryAfterSeconds }, status: 429 });
    const impact = await computePinImpact({ actor: player, definition, toVersionNo, targets: [...targets] });
    return { checked: impact.checked, wouldBreak: impact.would_break, truncated: impact.truncated };
  },

  async phaseStart(tournamentId) {
    const tournament = await getTournamentById(tournamentId);
    if (tournament === null) return null;
    const [participants, rounds, season] = await Promise.all([
      getParticipants(tournament.id),
      getRoundsByTournament(tournament.id),
      tournament.season_id === null ? Promise.resolve(null) : getSeasonById(tournament.season_id),
    ]);
    // Only a custom league needs an attached format (the routes' own `assertSeasonFormatAttached`).
    const formatAttached = season === null || season.format_type !== 'custom' ? true : (await getSeasonFormatSummary(season.id)) !== null;
    return {
      tournamentId: tournament.id,
      tournamentName: tournament.name,
      seasonId: season?.id ?? null,
      seasonName: season?.name ?? null,
      seasonFormatType: season?.format_type ?? null,
      formatAttached,
      bracketType: tournament.bracket_type,
      roundCount: rounds.length,
      participantCount: participants.length,
    };
  },

  async startupChecklist(tournamentId) {
    const input = await loadStartupInput(tournamentId);
    return input === null ? null : buildStartupChecklist(input);
  },

  async recipients({ eventType, tournamentId, seasonId }) {
    // Masked names and counts only; the ids are for the fingerprint (`channel_set`) and stay here.
    if (tournamentId === null) return { discord: { count: 0, names: [] }, social: { count: 0, names: [] } };
    const reach = await previewRecipients({ eventType: eventType as DiscordEventType, tournamentId, seasonId });
    return { discord: { count: reach.discord.ids.length, names: reach.discord.names }, social: { count: reach.social.ids.length, names: reach.social.names } };
  },

  async undoFacts({ leagueIds, playerIds, tournamentIds = [] }) {
    // A round in any phase of a league locks the roster; a league that left `upcoming` has started.
    let roundsExist = false;
    let leagueStarted = false;
    for (const leagueId of leagueIds) {
      const [season, stages] = await Promise.all([getSeasonById(leagueId), getStagesBySeasonId(leagueId)]);
      if (season !== null && season.status !== 'upcoming') leagueStarted = true;
      for (const stage of stages) {
        if ((await getRoundsByTournament(stage.id)).length > 0) roundsExist = true;
      }
    }
    const playerNames: Record<string, string> = {};
    if (playerIds.length > 0) {
      const found = await getPlayersByIds([...playerIds]);
      for (const id of playerIds) {
        const player = found.get(id) ?? [...found.values()].find((candidate) => candidate.id.toLowerCase() === id.toLowerCase());
        if (player !== undefined) playerNames[id.toLowerCase()] = player.name;
      }
    }
    // A tournament takes and loses players only while it is `upcoming` (and, for an elimination bracket, before its rounds).
    let tournamentStarted = false;
    for (const tournamentId of tournamentIds) {
      const [tournament, rounds] = await Promise.all([getTournamentById(tournamentId), getRoundsByTournament(tournamentId)]);
      if ((tournament !== null && tournament.status !== 'upcoming') || rounds.length > 0) tournamentStarted = true;
    }
    return { locks: { roundsExist, leagueStarted: leagueStarted || roundsExist, ...(tournamentIds.length > 0 ? { tournamentStarted } : {}) }, playerNames };
  },

  fingerprints: liveFingerprints,
};

/**
 * The ledger's `before` for the steps that need one (slice 5): the version each target of a pin move pins right before the move,
 * with its number, so the undo moves each target back to the version it had. Read after the step's preconditions passed, so it
 * is the state staging showed. Other ops store nothing.
 */
export async function liveBeforeState(facts: Pick<StepFacts, 'step' | 'call'>) {
  if (facts.step.op !== 'move_pin') return null;
  const body = typeof facts.call?.body === 'object' && facts.call.body !== null ? (facts.call.body as { targets?: Array<{ kind: 'season' | 'tournament'; id: string }> }) : {};
  const targets = body.targets ?? [];
  const states = await getPinTargetStates(
    targets.filter((t) => t.kind === 'season').map((t) => t.id),
    targets.filter((t) => t.kind === 'tournament').map((t) => t.id),
  );
  const numbers = new Map<string, number | null>();
  for (const state of states) {
    if (state.ruleset_id !== null && !numbers.has(state.ruleset_id)) numbers.set(state.ruleset_id, (await getDefinitionOfVersion(state.ruleset_id))?.version_no ?? null);
  }
  return {
    pins: states.map((state) => ({ kind: state.kind, id: state.id.toLowerCase(), version_id: state.ruleset_id, version_no: state.ruleset_id === null ? null : (numbers.get(state.ruleset_id) ?? null) })),
  };
}

/** The bound dependencies of the chat loop's `stageProposal` and of the card and token routes. */
export function liveStagerDeps(): StagerDeps {
  return {
    store: adminAgentStore,
    config: () => parseAdminAgentEnv(),
    tools: STAGED_TOOLS,
    guard: guardFor,
    source: liveSource,
    tokenKey: () => requireEnv('NEXTAUTH_SECRET'),
    now: () => new Date(),
    newId: () => crypto.randomUUID(),
  };
}

export const liveStager = createProposalStager(liveStagerDeps());
