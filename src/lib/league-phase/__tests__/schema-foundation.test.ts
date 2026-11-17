import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { phaseStorageMachine } from '../storage-state';
import { lastFunctionBody, replayTriggers } from '@/lib/league-trash/__tests__/fk-replay';

const schemaPath = 'supabase/migrations/20261117100000_phase_owned_schema.sql';
const fencePath = 'supabase/migrations/20261117102000_phase_storage_fence.sql';
const tables = [
  "league_phases",
  "phase_participants",
  "phase_groups",
  "phase_group_members",
  "phase_rounds",
  "phase_reports",
  "phase_matches",
  "phase_match_outcomes",
  "phase_games",
  "phase_battle_stats",
  "phase_match_analyses",
  "phase_match_prep_analyses",
  "phase_match_prep_teams",
  "phase_match_proposals",
  "phase_match_evolution_snapshots",
  "phase_epb_animation_views",
  "phase_broadcast_moments",
  "phase_teams",
  "phase_cast_sessions",
  "phase_admins",
  "phase_discord_webhooks",
  "phase_social_integrations",
  "phase_wiki_notes",
  "phase_wiki_note_reports",
  "phase_aggregates",
  "phase_player_aggregates",
  "phase_aggregate_jobs",
  "phase_rating_history"
] as const;

describe('phase storage foundation', () => {
  it('declares separate secured storage for the complete phase graph', () => {
    const sql = readFileSync(schemaPath, 'utf8');
    for (const table of tables) {
      expect(sql).toContain(`CREATE TABLE public.${table} (`);
      expect(sql).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
      const revoked = new RegExp(`REVOKE ALL ON (?:TABLE )?public\\.${table} FROM ([^;]+)`, 'i').exec(sql)?.[1];
      expect(revoked?.split(',').map((role) => role.trim().toLowerCase()).sort()).toEqual(['anon', 'authenticated', 'public']);
      expect(sql).toMatch(new RegExp(`GRANT [^;]+ ON (?:TABLE )?public\\.${table} TO service_role`, 'i'));
    }
    expect(sql).not.toMatch(/CREATE\s+TABLE[^;]*\bLIKE\b/i);
    expect(sql).not.toMatch(/INSERT\s+INTO\s+public\.(?:league_phases|phase_\w+)/i);
    expect(sql).not.toMatch(/DROP\s+TABLE|DELETE\s+FROM\s+public\.(?:tournaments|matches|games)/i);
  });

  it('fences phase rows without blocking empty legacy cascades', () => {
    const sql = readFileSync(fencePath, 'utf8');
    const triggers = replayTriggers();
    for (const table of tables) {
      expect(triggers.get(`${table}.trg_phase_storage_guard`)?.events).toEqual(['INSERT', 'UPDATE', 'DELETE']);
      expect(sql).toContain(`ON public.${table}\nFOR EACH ROW`);
    }
    expect(sql).toContain("v_mode IS DISTINCT FROM 'phase'");
    expect(sql).toContain("current_user <> 'postgres'");
    expect(sql).toContain("WHERE id FOR SHARE");
    expect(sql).toContain('GRANT SELECT ON TABLE public.phase_storage_state TO service_role');
    expect(sql).not.toMatch(/GRANT (?:ALL|UPDATE|INSERT)[^;]*phase_storage_state/i);
  });

  it('keeps the operator SQL transition graph equal to the registry', () => {
    const body = lastFunctionBody('phase_storage_transition');
    const expected = new Set([
      'legacy:frozen_legacy', 'frozen_legacy:legacy', 'frozen_legacy:frozen_phase',
      'frozen_phase:frozen_legacy', 'frozen_phase:phase', 'phase:frozen_phase',
    ]);
    const actual = new Set(phaseStorageMachine.spec.transitions.flatMap((t) => t.from.map((from) => `${from}:${t.to}`)));
    expect(actual).toEqual(expected);
    for (const from of phaseStorageMachine.spec.states) {
      expect(body).toContain(`expected_mode = '${from}'`);
    }
    expect(body).toContain('FOR UPDATE');
    expect(body).toContain('mode = expected_mode');
    expect(body).toContain('phase_storage_changed');
    expect(readFileSync(fencePath, 'utf8')).toContain(
      'REVOKE ALL ON FUNCTION public.phase_storage_transition(text, text) FROM PUBLIC, anon, authenticated, service_role',
    );
  });

  it('extends trash deadline, queue and expiry handling for both stores', () => {
    const shift = lastFunctionBody('league_trash__shift');
    for (const table of ['phase_matches', 'phase_match_proposals', 'phase_rounds']) expect(shift).toContain(`'${table}'`);
    const restore = lastFunctionBody('league_trash_restore');
    expect(restore).toContain('INSERT INTO public.phase_aggregate_jobs');
    expect(restore).toContain('v_jobs := v_jobs + v_n');
    expect(restore).toContain("public.phase_games g WHERE g.replay_hash = x ->> 'replay_hash'");
    expect(lastFunctionBody('league_trash_expire')).toContain("lt.rel IN ('matches', 'phase_matches')");
    expect(lastFunctionBody('league_trash__x')).toContain("'{native_phases}'");
  });
});
