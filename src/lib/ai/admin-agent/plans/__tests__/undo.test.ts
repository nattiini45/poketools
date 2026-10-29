import { describe, expect, it } from 'vitest';
import { PLAN_OPS } from '../ops';
import { UNDO_MAX_STEPS, UNDO_OPS, deriveUndoPlan, undoability, type LedgerEntryView, type UndoLiveState } from '../undo';

let counter = 0;
const entry = (op: string, over: Partial<LedgerEntryView> = {}): LedgerEntryView => {
  counter += 1;
  return { actionId: `act-${counter}`, seq: counter, op, status: 'ok', entityType: 'season', entityId: `ent-${counter}`, afterFingerprint: `fp-${counter}`, ...over };
};
/** Live state where every listed entry still looks as the assistant left it. */
const unchanged = (entries: readonly LedgerEntryView[], locks: UndoLiveState['locks'] = {}): UndoLiveState => ({
  fingerprints: Object.fromEntries(entries.map((e) => [e.actionId, e.afterFingerprint])),
  locks,
});

describe('undoability (plan 4.7 table)', () => {
  it('archives a league and a tournament, and removes roster rows', () => {
    for (const [op, action] of [['league_create', 'archive_league'], ['tournament_create', 'archive_tournament'], ['roster_add', 'remove_roster'], ['groups_set', 'clear_groups']] as const) {
      const e = entry(op);
      expect(undoability(e, unchanged([e])), op).toEqual({ available: true, action, tier: 'B' });
    }
  });

  it('removes a tournament player, and refuses once the tournament has started', () => {
    const e = entry('tournament_participant_add', { entityType: 'tournament_roster' });
    expect(undoability(e, unchanged([e]))).toEqual({ available: true, action: 'remove_tournament_participant', tier: 'B' });
    expect(undoability(e, unchanged([e], { tournamentStarted: true }))).toEqual({ available: false, reason: 'locked_tournament' });
    // A started LEAGUE does not lock a tournament player, and a started tournament does not lock a league roster.
    expect(undoability(e, unchanged([e], { leagueStarted: true, roundsExist: true }))).toMatchObject({ available: true });
    const r = entry('roster_add');
    expect(undoability(r, unchanged([r], { tournamentStarted: true }))).toMatchObject({ available: true });
  });

  it('leaves phases and draft pools as residue of an archived league', () => {
    for (const op of ['phase_create', 'draft_pool_create']) {
      const e = entry(op);
      expect(undoability(e, unchanged([e]))).toEqual({ available: false, reason: 'residue' });
    }
  });

  it('never offers an immutable publish, an outward effect or the recycle bin', () => {
    for (const [op, reason] of [
      ['format_publish', 'immutable'], ['ruleset_publish', 'immutable'],
      ['generate_round', 'outward_effect'], ['generate_bracket', 'outward_effect'], ['start_phase', 'outward_effect'],
      ['advance_phase', 'outward_effect'], ['complete_round', 'outward_effect'], ['complete_tournament', 'outward_effect'], ['draft_start', 'outward_effect'],
      ['league_trash', 'needs_superadmin'], ['format_attach', 'separate_card'],
    ] as const) {
      const e = entry(op);
      expect(undoability(e, unchanged([e])), op).toEqual({ available: false, reason });
    }
  });

  it('is fail-closed for an unknown op and for rows that did not finish', () => {
    expect(undoability(entry('something_new'), { fingerprints: {} })).toEqual({ available: false, reason: 'unknown_op' });
    for (const status of ['failed', 'skipped', 'unknown', 'executing'] as const) {
      expect(undoability(entry('league_create', { status }), { fingerprints: {} })).toEqual({ available: false, reason: 'not_completed' });
    }
    expect(undoability(entry('league_create', { status: 'undone' }), { fingerprints: {} })).toEqual({ available: false, reason: 'already_undone' });
  });

  describe('state fingerprints', () => {
    it('leaves alone what changed outside the chat, and reports a gone entity', () => {
      const e = entry('league_create');
      expect(undoability(e, { fingerprints: { [e.actionId]: 'someone-else' } })).toEqual({ available: false, reason: 'edited_outside' });
      expect(undoability(e, { fingerprints: { [e.actionId]: null } })).toEqual({ available: false, reason: 'entity_gone' });
    });

    it('fails closed when the live state was not read', () => {
      expect(undoability(entry('league_create'), { fingerprints: {} })).toEqual({ available: false, reason: 'fingerprint_unavailable' });
    });

    it('does not need an entity for a plan edit', () => {
      const e = entry('plan_set', { entityType: null, entityId: null, afterFingerprint: null });
      expect(undoability(e, { fingerprints: {} })).toEqual({ available: true, action: 'restore_plan_revision', tier: 'D' });
    });
  });

  describe('locks', () => {
    it('refuses to clear groups once a round exists and to remove roster rows once groups are scheduled or rounds exist', () => {
      const g = entry('groups_set');
      expect(undoability(g, unchanged([g], { roundsExist: true }))).toEqual({ available: false, reason: 'locked_rounds' });
      const r = entry('roster_add');
      expect(undoability(r, unchanged([r], { groupsScheduled: true }))).toEqual({ available: false, reason: 'locked_groups' });
      expect(undoability(r, unchanged([r], { roundsExist: true }))).toEqual({ available: false, reason: 'locked_rounds' });
    });

    it('deletes a format only while it has no versions and is unattached (the Q24 carve-out)', () => {
      const f = entry('format_fork_preset');
      expect(undoability(f, unchanged([f]))).toEqual({ available: true, action: 'format_delete', tier: 'B' });
      expect(undoability(f, unchanged([f], { formatAttached: true }))).toEqual({ available: false, reason: 'format_in_use' });
      expect(undoability(f, unchanged([f], { formatHasVersions: true }))).toEqual({ available: false, reason: 'format_in_use' });
    });

    it('restores a draft save only while the draft is as we left it', () => {
      const d = entry('format_save_draft');
      expect(undoability(d, unchanged([d]))).toEqual({ available: true, action: 'format_draft_restore', tier: 'D' });
      expect(undoability(d, { fingerprints: { [d.actionId]: 'human-saved' } })).toEqual({ available: false, reason: 'edited_outside' });
      const r = entry('ruleset_patch_draft');
      expect(undoability(r, unchanged([r]))).toMatchObject({ available: true, action: 'ruleset_draft_restore' });
    });

    it('does not offer a gallery visibility change; a league one goes back to private', () => {
      const gallery = entry('format_set_visibility', { variant: 'gallery' });
      expect(undoability(gallery, unchanged([gallery]))).toEqual({ available: false, reason: 'not_offered' });
      const league = entry('format_set_visibility', { variant: 'league' });
      expect(undoability(league, unchanged([league]))).toEqual({ available: true, action: 'format_make_private', tier: 'G' });
    });

    it('moves a pin back unless the target is completed, and keeps re-attach before the start', () => {
      const pin = entry('ruleset_move_pin');
      expect(undoability(pin, unchanged([pin]))).toEqual({ available: true, action: 'pin_back', tier: 'G' });
      expect(undoability(pin, unchanged([pin], { pinLocked: true }))).toEqual({ available: false, reason: 'pin_locked' });
      const attach = entry('format_reattach');
      expect(undoability(attach, unchanged([attach], { leagueStarted: true }))).toEqual({ available: false, reason: 'locked_started' });
    });

    it('cannot invert a pin or league-type change once the league started', () => {
      const e = entry('league_update', { changedFields: ['ruleset_id', 'name'] });
      expect(undoability(e, unchanged([e]))).toMatchObject({ available: true });
      expect(undoability(e, unchanged([e], { leagueStarted: true }))).toEqual({ available: false, reason: 'locked_started' });
      const harmless = entry('league_update', { changedFields: ['description'] });
      expect(undoability(harmless, unchanged([harmless], { leagueStarted: true }))).toMatchObject({ available: true, action: 'inverse_patch' });
      const status = entry('league_status');
      expect(undoability(status, unchanged([status]))).toEqual({ available: true, action: 'inverse_patch', tier: 'G' });
    });

    it('does not delete pool entries from a pool in progress', () => {
      const e = entry('draft_entries_add');
      expect(undoability(e, unchanged([e], { poolInProgress: true }))).toEqual({ available: false, reason: 'locked_in_progress' });
    });
  });

  it('knows every op the Plan derives', () => {
    for (const op of PLAN_OPS) expect(UNDO_OPS).toContain(op);
  });
});

describe('a ruleset draft created in the conversation (the second carve-out, spec §18.8)', () => {
  it('is deleted by an undo while it has never been published', () => {
    const e = entry('ruleset_create_draft');
    expect(undoability(e, unchanged([e]))).toEqual({ available: true, action: 'delete_ruleset_draft', tier: 'G' });
  });

  it('is residue once any version exists: not offered, and listed as residue', () => {
    const e = entry('ruleset_create_draft');
    expect(undoability(e, unchanged([e], { rulesetPublished: true }))).toEqual({ available: false, reason: 'ruleset_published' });
    const plan = deriveUndoPlan([e], unchanged([e], { rulesetPublished: true }));
    expect(plan.steps).toEqual([]);
    expect(plan.residue).toEqual([expect.objectContaining({ op: 'ruleset_create_draft', reason: 'ruleset_published' })]);
  });

  it('is left alone when it was saved by somebody else after the last chat write', () => {
    const e = entry('ruleset_create_draft');
    const plan = deriveUndoPlan([e], { fingerprints: { [e.actionId]: 'saved-by-a-human' } });
    expect(plan.steps).toEqual([]);
    expect(plan.leftAlone).toEqual([expect.objectContaining({ op: 'ruleset_create_draft', reason: 'edited_outside' })]);
  });

  it('is gone, not deleted twice, once the definition no longer exists', () => {
    const e = entry('ruleset_create_draft');
    expect(undoability(e, { fingerprints: { [e.actionId]: null } })).toEqual({ available: false, reason: 'entity_gone' });
  });
});

describe('deriveUndoPlan: "Undo build" of the worked example (plan 4.10 step 9)', () => {
  const build = () => {
    const league = entry('league_create', { entityId: 'league-1' });
    const roster = entry('roster_add');
    const p1 = entry('phase_create');
    const p2 = entry('phase_create');
    return [league, roster, p1, p2];
  };

  it('lists the roster and the league, newest first, and the phases as residue', () => {
    const entries = build();
    const plan = deriveUndoPlan(entries, unchanged(entries));
    expect(plan.steps.map((s) => [s.op, s.action])).toEqual([['roster_add', 'remove_roster'], ['league_create', 'archive_league']]);
    expect(plan.residue.map((n) => n.op)).toEqual(['phase_create', 'phase_create']);
    expect(plan.leftAlone).toEqual([]);
    expect(plan.notUndoable).toEqual([]);
    expect(plan.truncated).toBe(false);
    expect(plan.steps[0]).toMatchObject({ key: `undo.${entries[1].actionId}`, afterFingerprint: entries[1].afterFingerprint, tier: 'B' });
  });

  it('reports the league as left alone after the admin edited it by hand', () => {
    const entries = build();
    const live = unchanged(entries);
    const edited: UndoLiveState = { ...live, fingerprints: { ...live.fingerprints, [entries[0].actionId]: 'edited' } };
    const plan = deriveUndoPlan(entries, edited);
    expect(plan.steps.map((s) => s.op)).toEqual(['roster_add']);
    expect(plan.leftAlone).toEqual([expect.objectContaining({ op: 'league_create', reason: 'edited_outside' })]);
  });

  it('explains what cannot be undone once the league started, and never silently drops it', () => {
    const entries = [...build(), entry('generate_round', { entityId: 'round-1' })];
    const plan = deriveUndoPlan(entries, unchanged(entries, { roundsExist: true, groupsScheduled: true }));
    expect(plan.notUndoable.map((n) => [n.op, n.reason])).toEqual([['generate_round', 'outward_effect'], ['roster_add', 'locked_groups']]);
    expect(plan.steps.map((s) => s.op)).toEqual(['league_create']);
  });

  it('only considers rows the conversation finished: failed, skipped, running and undone rows are not part of it', () => {
    const done = entry('league_create');
    const rows = [done, entry('roster_add', { status: 'failed' }), entry('groups_set', { status: 'skipped' }), entry('phase_create', { status: 'executing' }), entry('tournament_create', { status: 'undone' })];
    const plan = deriveUndoPlan(rows, unchanged(rows));
    expect(plan.steps.map((s) => s.op)).toEqual(['league_create']);
    expect([plan.leftAlone, plan.residue, plan.notUndoable].flat()).toEqual([]);
    // An outcome that is not known goes to notUndoable so a human decides.
    const unknown = entry('roster_add', { status: 'unknown' });
    expect(deriveUndoPlan([unknown], unchanged([unknown])).notUndoable).toEqual([expect.objectContaining({ reason: 'not_completed' })]);
  });

  it('caps one proposal at 20 steps and says the rest is left', () => {
    const rows = Array.from({ length: UNDO_MAX_STEPS + 5 }, () => entry('roster_add'));
    const plan = deriveUndoPlan(rows, unchanged(rows));
    expect(plan.steps).toHaveLength(UNDO_MAX_STEPS);
    expect(plan.truncated).toBe(true);
    // Newest first: the oldest five are the ones left for a second proposal.
    expect(plan.steps[0].actionId).toBe(rows.at(-1)!.actionId);
    expect(plan.steps.map((s) => s.actionId)).not.toContain(rows[0].actionId);
    expect(deriveUndoPlan(rows, unchanged(rows), 3).steps).toHaveLength(3);
  });

  it('does not reorder or mutate its input', () => {
    const rows = build();
    const copy = JSON.stringify(rows);
    deriveUndoPlan(rows, unchanged(rows));
    expect(JSON.stringify(rows)).toBe(copy);
  });
});
