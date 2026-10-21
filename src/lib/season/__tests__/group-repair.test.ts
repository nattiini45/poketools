import { describe, it, expect } from 'vitest';
import {
  planGroupRepair,
  type GroupRepairGroup,
  type GroupRepairInput,
  type GroupRepairSubstitution,
} from '../group-repair';

const PHASE_ID = 'phase-1';
const OTHER_PHASE_ID = 'phase-2';

/** Player ids double as names ("A1" is named "Name A1"). */
function group(id: string, groupNumber: number, memberIds: string[]): GroupRepairGroup {
  return {
    id,
    name: `Group ${id}`,
    group_number: groupNumber,
    members: memberIds.map((playerId) => ({ player_id: playerId, player_name: `Name ${playerId}` })),
  };
}

function enrolled(ids: string[]) {
  return ids.map((id) => ({ id, name: `Name ${id}` }));
}

function sub(
  out: string,
  into: string,
  createdAt: string,
  scope: string = 'league',
): GroupRepairSubstitution {
  return { out_player_id: out, in_player_id: into, scope, created_at: createdAt };
}

function match(player1: string, player2: string) {
  return { player_1_id: player1, player_2_id: player2 };
}

/**
 * Two groups of a phase. Group A: departed holder `A1` (substituted out
 * before the handover) and enrolled `X`, `Y`. Group B: enrolled `B1`, `Z`.
 * The substitute `S` is enrolled with no row.
 */
function baseInput(overrides: Partial<GroupRepairInput> = {}): GroupRepairInput {
  return {
    phaseId: PHASE_ID,
    groups: [group('A', 1, ['A1', 'X', 'Y']), group('B', 2, ['B1', 'Z'])],
    enrolled: enrolled(['S', 'X', 'Y', 'B1', 'Z']),
    substitutions: [],
    matches: [],
    ...overrides,
  };
}

describe('planGroupRepair', () => {
  it('skips a phase without groups', () => {
    const plan = planGroupRepair(baseInput({ groups: [], substitutions: [sub('A1', 'S', '2026-09-01T10:00:00Z')] }));

    expect(plan).toEqual({
      grouped: false,
      moves: [],
      unresolved: { orphaned_rows: [], ungrouped_players: [] },
    });
  });

  it('judges nothing in a phase with no enrollment rows (legacy data)', () => {
    const plan = planGroupRepair(baseInput({ enrolled: [], substitutions: [sub('A1', 'S', '2026-09-01T10:00:00Z')] }));

    expect(plan.grouped).toBe(true);
    expect(plan.moves).toEqual([]);
    expect(plan.unresolved).toEqual({ orphaned_rows: [], ungrouped_players: [] });
  });

  describe('pairing from the substitution history', () => {
    it("hands the departed player's row to the recorded substitute", () => {
      const plan = planGroupRepair(baseInput({ substitutions: [sub('A1', 'S', '2026-09-01T10:00:00Z')] }));

      expect(plan.moves).toEqual([
        {
          group_id: 'A',
          group_name: 'Group A',
          from_player_id: 'A1',
          from_player_name: 'Name A1',
          to_player_id: 'S',
          to_player_name: 'Name S',
          basis: 'audit',
        },
      ]);
      expect(plan.unresolved).toEqual({ orphaned_rows: [], ungrouped_players: [] });
    });

    it('follows a chain of substitutions forward in time to the enrolled player, whatever the input order', () => {
      const plan = planGroupRepair(
        baseInput({
          enrolled: enrolled(['C', 'X', 'Y', 'B1', 'Z']),
          // Newest first, as the audit log returns them.
          substitutions: [sub('S', 'C', '2026-09-10T10:00:00Z'), sub('A1', 'S', '2026-09-01T10:00:00Z')],
        }),
      );

      expect(plan.moves).toEqual([
        expect.objectContaining({ from_player_id: 'A1', to_player_id: 'C', basis: 'audit' }),
      ]);
      expect(plan.unresolved.ungrouped_players).toEqual([]);
    });

    it('does not follow a substitution of the successor that happened before the slot reached them', () => {
      // S was substituted out of some earlier slot before taking A1's: that
      // older record does not move A1's slot on.
      const plan = planGroupRepair(
        baseInput({
          substitutions: [sub('S', 'Q', '2026-08-01T10:00:00Z'), sub('A1', 'S', '2026-09-01T10:00:00Z')],
        }),
      );

      expect(plan.moves).toEqual([expect.objectContaining({ from_player_id: 'A1', to_player_id: 'S' })]);
    });

    it('counts league-scope substitutions and those scoped to this phase only', () => {
      const scopedHere = planGroupRepair(
        baseInput({ substitutions: [sub('A1', 'S', '2026-09-01T10:00:00Z', PHASE_ID)] }),
      );
      expect(scopedHere.moves).toEqual([expect.objectContaining({ from_player_id: 'A1', to_player_id: 'S', basis: 'audit' })]);

      const scopedElsewhere = planGroupRepair(
        baseInput({ substitutions: [sub('A1', 'S', '2026-09-01T10:00:00Z', OTHER_PHASE_ID)] }),
      );
      expect(scopedElsewhere.moves).toEqual([]);
      expect(scopedElsewhere.unresolved).toEqual({
        orphaned_rows: [
          { group_id: 'A', group_name: 'Group A', player_id: 'A1', player_name: 'Name A1', reason: 'no_counterpart' },
        ],
        ungrouped_players: [{ player_id: 'S', player_name: 'Name S', reason: 'no_counterpart' }],
      });
    });

    it('ignores a chain that comes back to the departed player', () => {
      const plan = planGroupRepair(
        baseInput({
          substitutions: [sub('A1', 'S', '2026-09-01T10:00:00Z'), sub('S', 'A1', '2026-09-02T10:00:00Z')],
        }),
      );

      expect(plan.moves).toEqual([]);
      expect(plan.unresolved.orphaned_rows).toEqual([expect.objectContaining({ player_id: 'A1', reason: 'no_counterpart' })]);
    });

    it('never moves a row to an enrolled player who already holds one', () => {
      // A1 -> X recorded, but X holds a row in group A already.
      const plan = planGroupRepair(
        baseInput({
          enrolled: enrolled(['X', 'Y', 'B1', 'Z']),
          substitutions: [sub('A1', 'X', '2026-09-01T10:00:00Z')],
        }),
      );

      expect(plan.moves).toEqual([]);
      expect(plan.unresolved.orphaned_rows).toEqual([expect.objectContaining({ player_id: 'A1', reason: 'no_counterpart' })]);
    });

    it('leaves the rows of enrolled holders alone, whatever the history says', () => {
      // X was substituted out by a league-scope substitution while this phase
      // was completed: their enrollment (and row) stayed.
      const plan = planGroupRepair(
        baseInput({
          groups: [group('A', 1, ['X', 'Y']), group('B', 2, ['B1', 'Z'])],
          substitutions: [sub('X', 'S', '2026-09-01T10:00:00Z')],
        }),
      );

      expect(plan.moves).toEqual([]);
      expect(plan.unresolved.orphaned_rows).toEqual([]);
      expect(plan.unresolved.ungrouped_players).toEqual([
        { player_id: 'S', player_name: 'Name S', reason: 'no_counterpart' },
      ]);
    });

    it('moves no row when two departed holders trace to the same player', () => {
      const plan = planGroupRepair(
        baseInput({
          groups: [group('A', 1, ['A1', 'X']), group('B', 2, ['A2', 'Z'])],
          enrolled: enrolled(['S', 'X', 'Z']),
          substitutions: [sub('A1', 'S', '2026-09-01T10:00:00Z'), sub('A2', 'S', '2026-09-02T10:00:00Z')],
        }),
      );

      expect(plan.moves).toEqual([]);
      expect(plan.unresolved).toEqual({
        orphaned_rows: [
          expect.objectContaining({ player_id: 'A1', reason: 'ambiguous' }),
          expect.objectContaining({ player_id: 'A2', reason: 'ambiguous' }),
        ],
        ungrouped_players: [{ player_id: 'S', player_name: 'Name S', reason: 'ambiguous' }],
      });
    });

    it('lets the fixtures settle two holders that trace to the same player', () => {
      const plan = planGroupRepair(
        baseInput({
          groups: [group('A', 1, ['A1', 'X']), group('B', 2, ['A2', 'Z'])],
          enrolled: enrolled(['S', 'X', 'Z']),
          substitutions: [sub('A1', 'S', '2026-09-01T10:00:00Z'), sub('A2', 'S', '2026-09-02T10:00:00Z')],
          matches: [match('S', 'Z')],
        }),
      );

      expect(plan.moves).toEqual([expect.objectContaining({ from_player_id: 'A2', to_player_id: 'S', basis: 'fixtures' })]);
      // A1's record still points at S: the conflict is reported, not dropped.
      expect(plan.unresolved.orphaned_rows).toEqual([expect.objectContaining({ player_id: 'A1', reason: 'ambiguous' })]);
    });

    it('leaves a departed player holding rows in several groups alone', () => {
      const plan = planGroupRepair(
        baseInput({
          groups: [group('A', 1, ['A1', 'X', 'Y']), group('B', 2, ['A1', 'B1', 'Z'])],
          substitutions: [sub('A1', 'S', '2026-09-01T10:00:00Z')],
        }),
      );

      expect(plan.moves).toEqual([]);
      expect(plan.unresolved.orphaned_rows).toEqual([
        expect.objectContaining({ group_id: 'A', player_id: 'A1', reason: 'several_rows' }),
        expect.objectContaining({ group_id: 'B', player_id: 'A1', reason: 'several_rows' }),
      ]);
      expect(plan.unresolved.ungrouped_players).toEqual([expect.objectContaining({ player_id: 'S' })]);
    });
  });

  describe('fallback to the fixtures', () => {
    it("places the substitute in the group of most of their opponents, in the departed player's slot", () => {
      const plan = planGroupRepair(
        baseInput({ matches: [match('S', 'X'), match('Y', 'S'), match('B1', 'Z')] }),
      );

      expect(plan.moves).toEqual([
        expect.objectContaining({ group_id: 'A', from_player_id: 'A1', to_player_id: 'S', basis: 'fixtures' }),
      ]);
      expect(plan.unresolved).toEqual({ orphaned_rows: [], ungrouped_players: [] });
    });

    it('covers a substitution whose audit record is missing from a chain', () => {
      // A1 -> S recorded, S -> C not: the chain ends at S, who is gone.
      const plan = planGroupRepair(
        baseInput({
          enrolled: enrolled(['C', 'X', 'Y', 'B1', 'Z']),
          substitutions: [sub('A1', 'S', '2026-09-01T10:00:00Z')],
          matches: [match('C', 'X'), match('C', 'Y')],
        }),
      );

      expect(plan.moves).toEqual([expect.objectContaining({ from_player_id: 'A1', to_player_id: 'C', basis: 'fixtures' })]);
    });

    it('decides nothing when the votes tie between groups', () => {
      const plan = planGroupRepair(baseInput({ matches: [match('S', 'X'), match('S', 'Z')] }));

      expect(plan.moves).toEqual([]);
      expect(plan.unresolved.ungrouped_players).toEqual([
        { player_id: 'S', player_name: 'Name S', reason: 'ambiguous' },
      ]);
      expect(plan.unresolved.orphaned_rows).toEqual([expect.objectContaining({ player_id: 'A1', reason: 'no_counterpart' })]);
    });

    it('leaves two open slots in the voted group unresolved', () => {
      const plan = planGroupRepair(
        baseInput({
          groups: [group('A', 1, ['A1', 'A2', 'X', 'Y']), group('B', 2, ['B1', 'Z'])],
          matches: [match('S', 'X'), match('S', 'Y')],
        }),
      );

      expect(plan.moves).toEqual([]);
      expect(plan.unresolved).toEqual({
        orphaned_rows: [
          expect.objectContaining({ player_id: 'A1', reason: 'ambiguous' }),
          expect.objectContaining({ player_id: 'A2', reason: 'ambiguous' }),
        ],
        ungrouped_players: [{ player_id: 'S', player_name: 'Name S', reason: 'ambiguous' }],
      });
    });

    it('rules out the departed player the substitute met, which settles the slot', () => {
      // S played A2 before A2 left, so S cannot have taken A2's slot.
      const plan = planGroupRepair(
        baseInput({
          groups: [group('A', 1, ['A1', 'A2', 'X', 'Y']), group('B', 2, ['B1', 'Z'])],
          matches: [match('S', 'X'), match('S', 'Y'), match('S', 'A2')],
        }),
      );

      expect(plan.moves).toEqual([expect.objectContaining({ from_player_id: 'A1', to_player_id: 'S', basis: 'fixtures' })]);
      expect(plan.unresolved.orphaned_rows).toEqual([expect.objectContaining({ player_id: 'A2', reason: 'no_counterpart' })]);
    });

    it('leaves one slot to two substitutes unresolved', () => {
      const plan = planGroupRepair(
        baseInput({
          enrolled: enrolled(['S', 'T', 'X', 'Y', 'B1', 'Z']),
          matches: [match('S', 'X'), match('T', 'Y')],
        }),
      );

      expect(plan.moves).toEqual([]);
      expect(plan.unresolved.ungrouped_players).toEqual([
        { player_id: 'S', player_name: 'Name S', reason: 'ambiguous' },
        { player_id: 'T', player_name: 'Name T', reason: 'ambiguous' },
      ]);
    });

    it('never gives a player whose substitution was recorded a second row from the fixtures', () => {
      const plan = planGroupRepair(
        baseInput({
          groups: [group('A', 1, ['A1', 'A2', 'X']), group('B', 2, ['B1', 'Z'])],
          substitutions: [sub('A1', 'S', '2026-09-01T10:00:00Z')],
          matches: [match('S', 'X')],
        }),
      );

      expect(plan.moves).toEqual([expect.objectContaining({ from_player_id: 'A1', to_player_id: 'S', basis: 'audit' })]);
      expect(plan.unresolved.orphaned_rows).toEqual([expect.objectContaining({ player_id: 'A2', reason: 'no_counterpart' })]);
    });
  });

  describe('history that ran past this phase (S4-1, S4-2)', () => {
    /**
     * Groups G1 [A, x1, x2] and G2 [D, y1, y2]. While the phase was active,
     * A -> B (league) ran before the handover, and D -> C (phase scope) too,
     * its audit record lost. After the phase completed, B -> C ran at league
     * scope: it never touched this phase. Enrolled: B, C, x1, x2, y1, y2.
     */
    const overshoot = (substitutions: GroupRepairSubstitution[]): GroupRepairInput => ({
      phaseId: PHASE_ID,
      groups: [group('G1', 1, ['A', 'x1', 'x2']), group('G2', 2, ['D', 'y1', 'y2'])],
      enrolled: enrolled(['B', 'C', 'x1', 'x2', 'y1', 'y2']),
      substitutions,
      matches: [match('B', 'x1'), match('B', 'x2'), match('C', 'y1'), match('C', 'y2')],
    });

    it('stops the chain at the first player enrolled in the phase (old records without phase ids)', () => {
      const plan = planGroupRepair(
        overshoot([sub('A', 'B', '2026-09-01T10:00:00Z'), sub('B', 'C', '2026-09-20T10:00:00Z')]),
      );

      expect(plan.moves.map((m) => [m.group_id, m.from_player_id, m.to_player_id, m.basis])).toEqual([
        ['G1', 'A', 'B', 'audit'],
        ['G2', 'D', 'C', 'fixtures'],
      ]);
      expect(plan.unresolved).toEqual({ orphaned_rows: [], ungrouped_players: [] });
    });

    it('follows a record that names its phases only through those phases', () => {
      const plan = planGroupRepair({
        ...overshoot([
          sub('A', 'B', '2026-09-01T10:00:00Z'),
          { ...sub('B', 'C', '2026-09-20T10:00:00Z'), phase_ids: [OTHER_PHASE_ID] },
        ]),
        // Here C is not enrolled yet, so only the phase ids keep A's row from C.
        enrolled: enrolled(['B', 'x1', 'x2', 'y1', 'y2']),
      });

      expect(plan.moves).toEqual([expect.objectContaining({ from_player_id: 'A', to_player_id: 'B', basis: 'audit' })]);
    });

    it('counts a record that names this phase whatever its scope', () => {
      const plan = planGroupRepair(
        baseInput({
          substitutions: [{ ...sub('A1', 'S', '2026-09-01T10:00:00Z', OTHER_PHASE_ID), phase_ids: [PHASE_ID] }],
        }),
      );

      expect(plan.moves).toEqual([expect.objectContaining({ from_player_id: 'A1', to_player_id: 'S', basis: 'audit' })]);
    });

    it("never hands a recorded substitute an unrelated withdrawn player's row from the fixtures", () => {
      // A holds stale rows in two groups; the audit ties A -> B. E withdrew
      // with no substitute and never met B.
      const plan = planGroupRepair({
        phaseId: PHASE_ID,
        groups: [group('G1', 1, ['A', 'E', 'x1', 'x2']), group('G2', 2, ['A', 'y1'])],
        enrolled: enrolled(['B', 'x1', 'x2', 'y1']),
        substitutions: [sub('A', 'B', '2026-09-01T10:00:00Z')],
        matches: [match('B', 'x1'), match('B', 'x2'), match('E', 'x1')],
      });

      expect(plan.moves).toEqual([]);
      expect(plan.unresolved.orphaned_rows.map((row) => [row.player_id, row.reason])).toEqual([
        ['A', 'several_rows'],
        ['E', 'no_counterpart'],
        ['A', 'several_rows'],
      ]);
      expect(plan.unresolved.ungrouped_players).toEqual([
        { player_id: 'B', player_name: 'Name B', reason: 'ambiguous' },
      ]);
    });

    it('keeps a substitute tied to a departed player with no row in this phase out of the fixtures', () => {
      // Q never held a row here; a record that names this phase ties S to Q's
      // slot in it, not to A1's.
      for (const record of [
        { ...sub('Q', 'S', '2026-09-01T10:00:00Z'), phase_ids: [PHASE_ID] },
        sub('Q', 'S', '2026-09-01T10:00:00Z', PHASE_ID),
      ]) {
        const plan = planGroupRepair(
          baseInput({ substitutions: [record], matches: [match('S', 'X'), match('S', 'Y')] }),
        );

        expect(plan.moves).toEqual([]);
        expect(plan.unresolved.ungrouped_players).toEqual([
          { player_id: 'S', player_name: 'Name S', reason: 'no_counterpart' },
        ]);
      }
    });

    it('lets the fixtures place a substitute an old league-scope record ties to a player never in this phase', () => {
      // Q -> S (league scope, no phase ids) came from another phase Q played
      // in; here S took A1's slot and that record was lost.
      const plan = planGroupRepair(
        baseInput({
          substitutions: [sub('Q', 'S', '2026-09-01T10:00:00Z')],
          matches: [match('S', 'X'), match('S', 'Y')],
        }),
      );

      expect(plan.moves).toEqual([
        expect.objectContaining({ group_id: 'A', from_player_id: 'A1', to_player_id: 'S', basis: 'fixtures' }),
      ]);
      expect(plan.unresolved).toEqual({ orphaned_rows: [], ungrouped_players: [] });
    });

    it('still keeps out a substitute an old league-scope record ties to a player holding rows in several groups', () => {
      const plan = planGroupRepair(
        baseInput({
          groups: [group('A', 1, ['A1', 'X', 'Y']), group('B', 2, ['Q', 'B1']), group('C', 3, ['Q', 'Z'])],
          substitutions: [sub('Q', 'S', '2026-09-01T10:00:00Z')],
          matches: [match('S', 'X'), match('S', 'Y')],
        }),
      );

      expect(plan.moves).toEqual([]);
      expect(plan.unresolved.ungrouped_players).toEqual([
        { player_id: 'S', player_name: 'Name S', reason: 'ambiguous' },
      ]);
    });
  });

  it('orders moves and unresolved rows by group number, then member order, whatever the input order', () => {
    const plan = planGroupRepair({
      phaseId: PHASE_ID,
      groups: [group('B', 2, ['B9', 'Z']), group('A', 1, ['A9', 'A1', 'X'])],
      enrolled: enrolled(['T', 'S', 'X', 'Z']),
      substitutions: [sub('B9', 'T', '2026-09-02T10:00:00Z'), sub('A1', 'S', '2026-09-01T10:00:00Z')],
      matches: [],
    });

    expect(plan.moves.map((move) => [move.group_id, move.from_player_id, move.to_player_id])).toEqual([
      ['A', 'A1', 'S'],
      ['B', 'B9', 'T'],
    ]);
    expect(plan.unresolved.orphaned_rows.map((row) => row.player_id)).toEqual(['A9']);
  });
});
