/**
 * The groups panel on the phase page: the group count select reaches the API's 26 groups, and a
 * serpentine assign over existing groups asks first (the route deletes the phase's groups, their
 * members and manual moves, then draws new ones from the seeds). Rendered with react-dom/server
 * (vitest 'node' env), so the loading state is the only panel state reachable; the confirm gate is the
 * pure `redrawNeedsConfirm` rule plus the catalog wording.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { renderWithI18n } from '@/test/i18n';
import { createTranslator } from '@/i18n/core';
import { leaguePhasesMessages } from '@/i18n/messages/league-phases';
import { redrawNeedsConfirm } from '@/lib/league-admin/phase-controls';

vi.mock('next/link', () => ({ default: ({ children }: { children?: unknown }) => children ?? null }));

const { default: PhaseGroupsPanel, GroupCountSelect, EmptyGroupsNote } = await import('../PhaseGroupsPanel');

function optionValues(html: string): string[] {
  return [...html.matchAll(/<option value="([^"]*)"/g)].map((m) => m[1]);
}

describe('PhaseGroupsPanel', () => {
  it('renders the loading state first', () => {
    const html = renderToStaticMarkup(<PhaseGroupsPanel seasonId="s1" phaseId="p1" />);

    expect(html).toContain('role="status"');
    expect(html).toContain('Loading groups...');
  });
});

describe('GroupCountSelect', () => {
  it('offers every group count from 2 to 26 with the stored count selected', () => {
    const html = renderWithI18n(<GroupCountSelect value={12} onChange={() => {}} />);
    const values = optionValues(html);

    expect(values).toHaveLength(25);
    expect(values[0]).toBe('2');
    expect(values[values.length - 1]).toBe('26');
    expect(html).toMatch(/<option value="12" selected="">12 groups<\/option>/);
    expect(html).toContain('2 groups');
  });

  it('labels the options in German', () => {
    const html = renderWithI18n(<GroupCountSelect value={2} onChange={() => {}} />, { locale: 'de' });

    expect(html).toContain('Anzahl der Gruppen');
    expect(html).toContain('26 Gruppen');
  });
});

describe('EmptyGroupsNote', () => {
  it('tells an admin who can draw groups to seed and serpentine-assign', () => {
    const html = renderWithI18n(<EmptyGroupsNote leagueManaged={false} />);

    expect(html).toContain('No groups yet. Seed participants, then serpentine-assign');
  });

  it('says nothing about drawing on a league-managed phase, which has no draw controls', () => {
    expect(renderWithI18n(<EmptyGroupsNote leagueManaged />)).toBe('');
    expect(renderWithI18n(<EmptyGroupsNote leagueManaged />, { locale: 'de' })).toBe('');
  });
});

describe('group re-draw confirm', () => {
  it('asks only when the phase already has groups', () => {
    expect(redrawNeedsConfirm(0)).toBe(false);
    expect(redrawNeedsConfirm(4)).toBe(true);
  });

  it('names the groups that are replaced, in both languages', () => {
    const en = createTranslator(leaguePhasesMessages, 'en');
    const de = createTranslator(leaguePhasesMessages, 'de');

    expect(en('groups.redrawConfirm', { count: 1 })).toContain('deletes the 1 current group and');
    expect(en('groups.redrawConfirm', { count: 4 })).toContain('deletes the 4 current groups and');
    expect(en('groups.redrawConfirm', { count: 4 })).toContain('Manual moves are lost');
    expect(de('groups.redrawConfirm', { count: 4 })).toContain('die 4 aktuellen Gruppen gelöscht');
    expect(de('groups.redrawConfirmLabel')).toBe('Neu auslosen');
  });

  it('is wired to the serpentine button, not to the assign itself', () => {
    const src = readFileSync(path.join(__dirname, '..', 'PhaseGroupsPanel.tsx'), 'utf8');

    expect(src).toMatch(/onClick=\{requestAssign\}/);
    expect(src).toMatch(/redrawNeedsConfirm\(groups\.length\)/);
    expect(src).not.toMatch(/onClick=\{handleSerpentineAssign\}/);
  });
});
