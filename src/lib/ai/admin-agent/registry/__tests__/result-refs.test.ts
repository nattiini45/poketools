import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

vi.mock('@/auth', () => ({ auth: vi.fn(), loadSessionPlayer: vi.fn() }));

import { code, id, label, userText } from '../atoms';
import { ALL_TOOLS, type RunnableTool } from '../index';
import { extractResultRefs, RESULT_REFS_MAX } from '../result-refs';

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const C = '00000000-0000-4000-8000-00000000000c';
const tool = (name: string): RunnableTool => ALL_TOOLS.find((entry): entry is RunnableTool => entry.name === name && (entry.class === 'R' || entry.class === 'P'))!;

describe('extractResultRefs: the typed id fields of a result (plan 6.3)', () => {
  it('finds the ids of a real reader result, names what each is an id of, and keeps the fenced label', () => {
    const roster = tool('league_roster_get');
    const data = { players: { items: [{ id: A, label: 'Mara', gym_type: null, group_id: B }], total: 1, truncated: false, cap: 128 } };
    expect(roster.output.safeParse(data).success).toBe(true);
    expect(extractResultRefs(roster, data)).toEqual([
      { kind: 'player', id: A, label: 'Mara' },
      { kind: 'group', id: B, label: null },
    ]);
  });

  it('follows nullable ids and nested lists of league_get', () => {
    const league = tool('league_get');
    const result = league.output.safeParse({
      found: true,
      trash: null,
      league: {
        id: A,
        label: 'Autumn League',
        ruleset_id: B,
        groups: { items: [{ id: C, label: 'Group A', member_count: 6 }], total: 1, truncated: false, cap: 20 },
      },
    });
    // Whatever the real shape needs besides this is the reader's own business; the walk only needs the schema.
    const data = result.success ? result.data : { league: { id: A, label: 'Autumn League', ruleset_id: B, groups: { items: [{ id: C, label: 'Group A', member_count: 6 }] } } };
    const refs = extractResultRefs(league, data);
    expect(refs.map((ref) => ref.id).sort()).toEqual([A, B, C].sort());
    expect(refs.find((ref) => ref.id === B)?.kind).toBe('ruleset');
    expect(refs.find((ref) => ref.id === C)).toMatchObject({ kind: 'group', label: 'Group A' });
  });

  it('records only fields declared with id(): a code or a text that looks like a uuid is not an id', () => {
    const fake = {
      name: 'thing_get',
      output: z.strictObject({ id: id(), slug: code(), note_user_text: userText(), label: label() }),
    };
    const refs = extractResultRefs(fake, { id: A, slug: B, note_user_text: C, label: 'x' });
    expect(refs).toEqual([{ kind: 'thing', id: A, label: 'x' }]);
  });

  it('lower-cases, de-duplicates and skips null and missing fields', () => {
    const fake = { name: 'thing_list', output: z.strictObject({ ids: z.array(id()), first: id().nullable(), other: id().nullable() }) };
    expect(extractResultRefs(fake, { ids: [A.toUpperCase(), A, B], first: null, other: undefined as never })).toEqual([
      { kind: 'thing', id: A, label: null },
      { kind: 'thing', id: B, label: null },
    ]);
  });

  it('is bounded', () => {
    const fake = { name: 'thing_list', output: z.strictObject({ ids: z.array(id()) }) };
    const many = Array.from({ length: RESULT_REFS_MAX + 50 }, (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
    expect(extractResultRefs(fake, { ids: many })).toHaveLength(RESULT_REFS_MAX);
  });

  it('every runnable tool has an output schema the walk can read', () => {
    for (const entry of ALL_TOOLS.filter((candidate): candidate is RunnableTool => candidate.class === 'R' || candidate.class === 'P')) {
      expect(() => extractResultRefs(entry, {}), entry.name).not.toThrow();
    }
  });
});
