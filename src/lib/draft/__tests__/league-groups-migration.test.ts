/**
 * League groups in SQL (20261018180000_league_groups.sql). No DB: reads the migration text. The behaviour is proven
 * on the local stack (two groups draft the same line, per-group completability and redraft, an ungrouped league
 * unchanged); this guard keeps every LATER redefinition of a draft function group-scoped: a migration that copies a
 * pre-groups body would silently bring back season-wide line ownership.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../../supabase/migrations');
const FILE = '20261018180000_league_groups.sql';

function stripComments(text: string): string {
  return text
    .split('\n')
    .map((line) => (line.includes('--') ? line.slice(0, line.indexOf('--')) : line))
    .join('\n');
}

const files = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => ({ file: f, sql: stripComments(readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8').replace(/\r\n/g, '\n')) }));
const migration = files.find((f) => f.file === FILE);

/** The body of the latest `CREATE OR REPLACE FUNCTION public.<name>(` across the migrations, and its file. */
function latest(name: string): { file: string; body: string } {
  const head = `CREATE OR REPLACE FUNCTION public.${name}(`;
  for (let i = files.length - 1; i >= 0; i--) {
    const start = files[i].sql.lastIndexOf(head);
    if (start === -1) continue;
    const bodyStart = files[i].sql.indexOf('$$', start);
    const bodyEnd = files[i].sql.indexOf('$$', bodyStart + 2);
    return { file: files[i].file, body: files[i].sql.slice(start, bodyEnd + 2) };
  }
  throw new Error(`no definition of public.${name}`);
}

/** Every statement fragment of a body that reads evolution_tracker by season. */
function trackerSeasonReads(body: string): string[] {
  const out: string[] = [];
  const re = /evolution_tracker\b/g;
  for (const m of body.matchAll(re)) {
    const from = m.index ?? 0;
    const end = body.indexOf(';', from);
    const stmt = body.slice(from, end === -1 ? undefined : end);
    if (/season_id\s*=/.test(stmt) && !/^evolution_tracker\s*;/.test(body.slice(from))) out.push(stmt);
  }
  return out;
}

describe(FILE, () => {
  it('exists', () => {
    expect(migration).toBeDefined();
  });

  const GROUP_SCOPED = [
    'draft__legal_lines',
    'draft__pool_completable',
    'draft__commit_pick',
    'draft_end',
    'draft_admin_void_pick',
    'redraft__publish_locked',
    'redraft_admin_restore_drop',
    'redraft_set_submission',
    'draft__build_snapshot',
  ];

  it.each(GROUP_SCOPED)('%s (latest definition) reads trackers of the pool group only', (name) => {
    const { body } = latest(name);
    const reads = trackerSeasonReads(body);
    expect(reads.length, `${name} reads evolution_tracker by season`).toBeGreaterThan(0);
    for (const stmt of reads) {
      if (/^evolution_tracker\s*\(/.test(stmt) || /INSERT INTO public\.evolution_tracker/.test(stmt)) continue;
      expect(stmt, `${name}: ${stmt.slice(0, 120)}`).toMatch(/season_group_id IS NOT DISTINCT FROM/);
    }
  });

  it.each(['draft__commit_pick', 'redraft_admin_restore_drop'])('%s writes the pool group on the tracker it inserts', (name) => {
    const { body } = latest(name);
    const insert = body.slice(body.indexOf('INSERT INTO public.evolution_tracker'));
    const columns = insert.slice(0, insert.indexOf(')'));
    expect(columns).toMatch(/season_group_id/);
    expect(insert.slice(0, insert.indexOf('RETURNING'))).toMatch(/\.season_group_id\)/);
  });

  it("the season ledger, token purchase and comeback spend resolve the trainer's group (no multi-row scalar)", () => {
    expect(latest('epb__season_remaining_points').body).toMatch(
      /kind = 'initial'\s+AND season_group_id IS NOT DISTINCT FROM public\.draft__player_group\(p_season_id, p_player_id\)/,
    );
    expect(latest('epb_purchase_draft_token').body).toMatch(
      /kind = 'initial'\s+AND season_group_id IS NOT DISTINCT FROM public\.draft__player_group\(p_season_id, p_player_id\)/,
    );
    expect(latest('epb_spend_comeback_tokens').body).toMatch(/AND season_group_id IS NOT DISTINCT FROM v_group/);
    expect(latest('epb_set_comeback_spend_open').body).toMatch(/kind = 'initial'\s+AND season_group_id IS NULL\)/);
  });

  it('draft_create_pool takes the group, checks it and keys every lookup by it', () => {
    const { body } = latest('draft_create_pool');
    expect(body).toMatch(/p_season_group_id uuid DEFAULT NULL\)/);
    expect(body).toMatch(/RAISE EXCEPTION 'SEASON_GROUP_REQUIRED'/);
    expect(body).toMatch(/RAISE EXCEPTION 'SEASON_GROUP_INVALID'/);
    expect(body.match(/season_group_id IS NOT DISTINCT FROM p_season_group_id/g)?.length).toBe(3);
    expect(migration?.sql).toMatch(/DROP FUNCTION public\.draft_create_pool\(uuid, text, uuid, jsonb, jsonb\);/);
  });

  it('draft_configure keeps a group pool seated by exactly the group members', () => {
    expect(latest('draft_configure').body).toMatch(/v_pool\.season_group_id IS NOT NULL[\s\S]*RAISE EXCEPTION 'SEATS_INVALID'/);
  });

  it('pools and lines are unique per (season, group), NULLS NOT DISTINCT', () => {
    const sql = migration?.sql ?? '';
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX uq_draft_pools_season_initial ON public\.draft_pools \(season_id, season_group_id\) NULLS NOT DISTINCT\s+WHERE kind = 'initial';/,
    );
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX uq_draft_pools_season_redraft ON public\.draft_pools \(season_id, season_group_id\) NULLS NOT DISTINCT\s+WHERE kind = 'redraft' AND phase <> 'cancelled';/,
    );
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX uq_evolution_tracker_season_group_line ON public\.evolution_tracker \(season_id, season_group_id, line_id\)\s+NULLS NOT DISTINCT WHERE line_id IS NOT NULL;/,
    );
    expect(sql).toMatch(/DROP INDEX public\.uq_evolution_tracker_season_line;/);
  });

  it('the group keys restrict deletes; members are league participants', () => {
    const sql = migration?.sql ?? '';
    expect(sql).toMatch(/tournament_groups\s+ADD COLUMN season_group_id uuid REFERENCES public\.season_groups\(id\) ON DELETE RESTRICT/);
    expect(sql).toMatch(/draft_pools_season_group_fkey FOREIGN KEY \(season_group_id, season_id\)\s+REFERENCES public\.season_groups \(id, season_id\) ON DELETE RESTRICT/);
    expect(sql).toMatch(/PRIMARY KEY \(season_id, player_id\)/);
    expect(sql).toMatch(/REFERENCES public\.season_participants \(season_id, player_id\) ON UPDATE CASCADE ON DELETE CASCADE/);
  });

  it('new tables: RLS on, no policy, service_role only', () => {
    const sql = migration?.sql ?? '';
    expect(sql).toMatch(/ALTER TABLE public\.season_groups ENABLE ROW LEVEL SECURITY;/);
    expect(sql).toMatch(/ALTER TABLE public\.season_group_members ENABLE ROW LEVEL SECURITY;/);
    expect(sql).toMatch(/GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public\.season_groups, public\.season_group_members TO service_role;/);
    expect(sql).not.toMatch(/CREATE POLICY/i);
    expect(sql).not.toMatch(/\bGRANT\b[^;]*\bTO\s+(anon|authenticated|PUBLIC)\b/i);
  });

  it('the snapshot never carries a refused publish (one read path: draft-publish-refusals.ts, lead ruling round 5)', () => {
    const { body } = latest('draft__build_snapshot');
    expect(body).toMatch(/'taken'/);
    expect(body).not.toMatch(/publish_refused/);
  });
});

describe('20261018202000_league_groups_locks.sql (lead rulings round 4)', () => {
  const locks = files.find((f) => f.file === '20261018202000_league_groups_locks.sql');

  it('exists', () => {
    expect(locks).toBeDefined();
  });

  it('the editor write refuses once a phase has a round, and checks coverage and group size', () => {
    const { body } = latest('season_groups_replace');
    expect(body).toMatch(/IF public\.season_group__league_scheduled\(p_season_id\) THEN\s+RAISE EXCEPTION 'SEASON_GROUPS_SCHEDULED'/);
    expect(body).toMatch(/RAISE EXCEPTION 'SEASON_GROUP_TOO_SMALL'/);
    expect(body.match(/RAISE EXCEPTION 'SEASON_GROUP_MEMBERS_INVALID'/g)?.length).toBe(2);
    // Names swap through temporary names: no deferred constraint any more.
    expect(body).not.toMatch(/SET CONSTRAINTS/);
  });

  it('the membership guard refuses joins and moves once scheduled, small groups, and a substitution mid-draft', () => {
    const { body } = latest('season_group_members__guard');
    expect(body.match(/RAISE EXCEPTION 'SEASON_GROUPS_SCHEDULED'/g)?.length).toBe(2);
    expect(body).toMatch(/v_left < 2 THEN\s+RAISE EXCEPTION 'SEASON_GROUP_TOO_SMALL'/);
    // A Redraft in submissions locks too: its deadline publishes the outgoing trainer's drops on its own.
    expect(body).toMatch(/phase IN \('submissions', 'drafting'\)\) THEN\s+RAISE EXCEPTION 'SEASON_GROUP_SUBSTITUTION_LOCKED'/);
  });

  it('a group pool goes live only with seats = exactly the group members (draft_start and a Redraft publish alike)', () => {
    // On the move into 'drafting' from any other phase, for group pools only; the function is service_role only.
    expect(locks?.sql).toMatch(
      /CREATE TRIGGER trg_draft_pools_group_seats BEFORE UPDATE OF phase ON public\.draft_pools\s+FOR EACH ROW\s+WHEN \(NEW\.phase = 'drafting' AND OLD\.phase IS DISTINCT FROM 'drafting' AND NEW\.season_group_id IS NOT NULL\)\s+EXECUTE FUNCTION public\.draft_pools__guard_group_seats\(\);/,
    );
    const { body } = latest('draft_pools__guard_group_seats');
    // Both directions: a member without a seat, and a seat that is no longer a member.
    expect(body.match(/\bEXCEPT\b/g)).toHaveLength(2);
    expect(body).toMatch(/season_group_members m WHERE m\.group_id = NEW\.season_group_id\s+EXCEPT SELECT dp\.player_id/);
    expect(body).toMatch(/draft_participants dp WHERE dp\.draft_pool_id = NEW\.id\s+EXCEPT SELECT m\.player_id/);
    expect(body).toMatch(/RAISE EXCEPTION 'SEASON_GROUP_SEATS_STALE' USING ERRCODE = 'P0001'/);
    expect(locks?.sql).toMatch(/REVOKE ALL ON FUNCTION[^;]*public\.draft_pools__guard_group_seats\(\)[^;]*FROM PUBLIC, anon, authenticated;/);
    expect(locks?.sql).toMatch(/GRANT EXECUTE ON FUNCTION[^;]*public\.draft_pools__guard_group_seats\(\)[^;]*TO service_role;/);
  });

  it('a new group after the first round is refused too', () => {
    expect(latest('season_groups__guard').body).toMatch(/season_group__league_scheduled\(NEW\.season_id\) THEN\s+RAISE EXCEPTION 'SEASON_GROUPS_SCHEDULED'/);
  });

  it('group names are unique per league ignoring case and blanks', () => {
    expect(locks?.sql).toMatch(/DROP CONSTRAINT uq_season_groups_name;/);
    expect(locks?.sql).toMatch(/CREATE UNIQUE INDEX uq_season_groups_name_ci ON public\.season_groups \(season_id, lower\(btrim\(name\)\)\);/);
  });
});

describe('20261018202100_league_groups_participant_lock.sql (round-4 gate: the roster honours the group rules)', () => {
  const lock = files.find((f) => f.file === '20261018202100_league_groups_participant_lock.sql');

  it('exists', () => {
    expect(lock).toBeDefined();
  });

  it('removing a grouped trainer is refused once scheduled, with a live pool or drafted lines, and below two', () => {
    const { body } = latest('season_participant_remove');
    expect(body).toMatch(/pg_advisory_xact_lock\(hashtext\(p_season_id::text\)\)/);
    expect(body).toMatch(/season_group__league_scheduled\(p_season_id\) THEN\s+RAISE EXCEPTION 'SEASON_GROUPS_SCHEDULED'/);
    expect(body).toMatch(/season_group__has_live_pool\(v_group\)/);
    expect(body).toMatch(/RAISE EXCEPTION 'SEASON_GROUP_LOCKED'/);
    expect(body).toMatch(/v_left < 2 THEN\s+RAISE EXCEPTION 'SEASON_GROUP_TOO_SMALL'/);
    expect(body).toMatch(/DELETE FROM public\.season_participants WHERE season_id = p_season_id AND player_id = p_player_id/);
  });

  it('no DELETE guard on the memberships or the roster: a league delete still cascades', () => {
    for (const f of files) {
      expect(f.sql).not.toMatch(/BEFORE[A-Z ]*DELETE[A-Z ]* ON public\.season_group_members/);
      expect(f.sql).not.toMatch(/BEFORE[A-Z ]*DELETE[A-Z ]* ON public\.season_participants/);
    }
  });

  it('adding a trainer to a grouped league with rounds is refused (INSERT only, substitutions unaffected)', () => {
    expect(lock?.sql).toMatch(/BEFORE INSERT ON public\.season_participants\s+FOR EACH ROW EXECUTE FUNCTION public\.season_participants__group_guard\(\)/);
    expect(latest('season_participants__group_guard').body).toMatch(
      /season_group__league_scheduled\(NEW\.season_id\) THEN\s+RAISE EXCEPTION 'SEASON_GROUPS_SCHEDULED'/,
    );
  });

  it('both functions are service_role only', () => {
    expect(lock?.sql).toMatch(/REVOKE ALL ON FUNCTION\s+public\.season_participant_remove\(uuid, uuid\),\s+public\.season_participants__group_guard\(\)\s+FROM PUBLIC, anon, authenticated;/);
    expect(lock?.sql).toMatch(/TO service_role;/);
  });
});

describe('20261019110000_league_groups_first_round_guard.sql (round-4 gate: the mirror-to-first-round window)', () => {
  const guard = files.find((f) => f.file === '20261019110000_league_groups_first_round_guard.sql');

  it('exists', () => {
    expect(guard).toBeDefined();
  });

  it("a mirrored phase's first round takes the season lock and is refused when its groups differ from the league groups", () => {
    expect(guard?.sql).toMatch(/BEFORE INSERT ON public\.rounds\s+FOR EACH ROW EXECUTE FUNCTION public\.rounds__league_groups_guard\(\)/);
    const { body } = latest('rounds__league_groups_guard');
    // Only phases whose groups mirror league groups, only before their first round.
    expect(body).toMatch(/g\.season_group_id IS NOT NULL\) THEN\s+RETURN NEW;/);
    expect(body).toMatch(/EXISTS \(SELECT 1 FROM public\.rounds r WHERE r\.tournament_id = NEW\.tournament_id\) THEN\s+RETURN NEW;/);
    // The same advisory key as the membership guard (draft__lock), taken before the comparison.
    expect(body.indexOf('pg_advisory_xact_lock(hashtext(v_season::text))')).toBeGreaterThan(-1);
    expect(body.indexOf('pg_advisory_xact_lock(hashtext(v_season::text))')).toBeLessThan(body.search(/\bEXCEPT\b/));
    expect(latest('season_group_members__guard').body).toMatch(/pg_advisory_xact_lock\(hashtext\(NEW\.season_id::text\)\)/);
    // Both directions of the comparison, enrollment joined with the league membership.
    expect(body.match(/\bEXCEPT\b/g)).toHaveLength(2);
    expect(body).toMatch(/LEFT JOIN public\.season_group_members s ON s\.season_id = v_season AND s\.player_id = p\.player_id/);
    expect(body).toMatch(/RAISE EXCEPTION 'PHASE_GROUPS_STALE' USING ERRCODE = 'P0001'/);
  });

  it('the trigger function is service_role only', () => {
    expect(guard?.sql).toMatch(/REVOKE ALL ON FUNCTION public\.rounds__league_groups_guard\(\) FROM PUBLIC, anon, authenticated;/);
    expect(guard?.sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.rounds__league_groups_guard\(\) TO service_role;/);
  });
});
