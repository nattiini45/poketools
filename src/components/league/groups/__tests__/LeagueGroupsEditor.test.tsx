/**
 * The league groups editor's markup (rendered through react-dom/server, vitest 'node' env, no DOM): the split
 * controls, the group cards with their member selects, the lock state and the unplaced participants, in English
 * and German. The container's requests and their answers are pinned in editor-requests.test.ts (no DOM here: the
 * rename form's Escape and focus return are browser behaviour, checked in the lead's browser pass).
 */
import { describe, expect, it, vi } from 'vitest';
import { LeagueGroupsEditorView, type LeagueGroupsEditorViewProps } from '../LeagueGroupsEditor';
import { renderWithI18n } from '@/test/i18n';
import type { LeagueGroupsEditorDTO } from '@/types/league-groups-editor';

const DATA: LeagueGroupsEditorDTO = {
  groups: [
    { id: 'g-a', name: 'Group A', sort_order: 1, player_ids: ['p1', 'p4'], locked: true },
    { id: 'g-b', name: 'Nord', sort_order: 2, player_ids: ['p2', 'p3', 'p6'], locked: false },
  ],
  participants: [
    { id: 'p1', name: 'Ash', seed: 1 },
    { id: 'p2', name: 'Brock', seed: 2 },
    { id: 'p3', name: 'Cilan', seed: 3 },
    { id: 'p4', name: 'Dawn', seed: 4 },
    { id: 'p5', name: 'Erika', seed: null },
    { id: 'p6', name: 'Fantina', seed: 5 },
  ],
  replaceLocked: false,
  scheduleLocked: false,
};

function props(overrides: Partial<LeagueGroupsEditorViewProps> = {}): LeagueGroupsEditorViewProps {
  return {
    data: DATA,
    error: null,
    saved: false,
    groupCount: 2,
    countId: 'count',
    onGroupCount: vi.fn(),
    splitting: false,
    onSplit: vi.fn(),
    confirmClear: false,
    onAskClear: vi.fn(),
    onCloseClear: vi.fn(),
    onClear: vi.fn(),
    clearing: false,
    moving: null,
    onPlace: vi.fn(),
    onRename: vi.fn(async () => true),
    ...overrides,
  };
}

const textOf = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

describe('LeagueGroupsEditorView', () => {
  it('shows each group with its members, seeds and a labelled move select; group names are translated', () => {
    const html = renderWithI18n(<LeagueGroupsEditorView {...props()} />);
    const text = textOf(html);
    expect(text).toContain('Group A');
    expect(text).toContain('Nord');
    expect(text).toContain('#1 Ash');
    expect(html).toContain('aria-label="Group of Ash"');
    expect(text).toContain('2 trainers');
    expect(text).toContain('3 trainers');
    const de = textOf(renderWithI18n(<LeagueGroupsEditorView {...props()} />, { locale: 'de' }));
    expect(de).toContain('Gruppe A');
    expect(de).toContain('Nord');
  });

  it('a group with a draft is marked and frozen: its selects are disabled, it is no target elsewhere', () => {
    const html = renderWithI18n(<LeagueGroupsEditorView {...props()} />);
    expect(textOf(html)).toContain('Has a draft');
    // Ash (in the locked group A) cannot be moved.
    expect(html).toMatch(/<select[^>]*disabled=""[^>]*aria-label="Group of Ash"/);
    // Brock (group B) cannot pick group A either.
    expect(html).toMatch(/aria-label="Group of Brock"[^>]*>(?:(?!<\/select>).)*<option value="g-a" disabled=""/s);
  });

  it('offers split by seed (counts up to half the roster) and remove; lists the unplaced participant', () => {
    const text = textOf(renderWithI18n(<LeagueGroupsEditorView {...props()} />));
    expect(text).toContain('Split again by seed');
    expect(text).toContain('Remove groups');
    expect(text).toContain('3 groups');
    expect(text).not.toContain('4 groups');
    expect(text).toContain('Not in a group');
    expect(text).toContain('Erika');
  });

  it('once a group drafts, no re-split or remove, and the reason is shown', () => {
    const text = textOf(renderWithI18n(<LeagueGroupsEditorView {...props({ data: { ...DATA, replaceLocked: true } })} />));
    expect(text).toContain('A group already has a draft');
    expect(text).not.toContain('Split again by seed');
    expect(text).not.toContain('Remove groups');
  });

  it('once the league has rounds: the reason, every group fixed, no split, no move, no placement (EN/DE)', () => {
    const scheduled: LeagueGroupsEditorDTO = {
      ...DATA,
      groups: DATA.groups.map((g) => ({ ...g, locked: true })),
      replaceLocked: true,
      scheduleLocked: true,
    };
    const html = renderWithI18n(<LeagueGroupsEditorView {...props({ data: scheduled })} />);
    const text = textOf(html);
    expect(text).toContain('This league already has rounds, so its groups are final');
    expect(text).not.toContain('A group already has a draft');
    expect(text).toContain('Fixed');
    expect(text).not.toContain('Has a draft');
    expect(text).not.toContain('Split again by seed');
    expect(text).not.toContain('Remove groups');
    expect(text).toContain('they can no longer join a group');
    // Every member select and the unplaced trainer's select are disabled; rename stays.
    const selects = html.match(/<select[^>]*>/g) ?? [];
    expect(selects.length).toBe(6);
    for (const select of selects) expect(select).toContain('disabled=""');
    expect(html).toContain('aria-label="Rename Nord"');
    const de = textOf(renderWithI18n(<LeagueGroupsEditorView {...props({ data: scheduled })} />, { locale: 'de' }));
    expect(de).toContain('Diese Liga hat schon Runden');
    expect(de).toContain('Fest');
  });

  it('a group at the minimum size keeps its trainers: its selects are disabled and say why', () => {
    const html = renderWithI18n(
      <LeagueGroupsEditorView
        {...props({ data: { ...DATA, groups: DATA.groups.map((g) => ({ ...g, locked: false })) } })}
      />,
    );
    expect(textOf(html)).toContain('A group keeps at least 2 trainers');
    // Ash (group A, two trainers) cannot move; Brock (Nord, three trainers) can.
    expect(html).toMatch(/<select[^>]*disabled=""[^>]*aria-label="Group of Ash"[^>]*aria-describedby="[^"]+"/);
    expect(html).toMatch(/<select(?:(?!disabled="")[^>])*aria-label="Group of Brock"/);
  });

  it('a league without groups says so and offers the first split', () => {
    const text = textOf(
      renderWithI18n(<LeagueGroupsEditorView {...props({ data: { ...DATA, groups: [] } })} />, { locale: 'de' }),
    );
    expect(text).toContain('Diese Liga hat keine Gruppen');
    expect(text).toContain('Nach Setzplatz aufteilen');
  });
});
