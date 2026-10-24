/**
 * Standalone tournament admin page: the Settings section comes first and is
 * handed the rulesets and the started flag (not upcoming, or any round).
 */
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ID = '0b9f1c2e-5d4a-4c3b-9a8e-7f6d5c4b3a21';
const RULESET_ID = '11111111-1111-4111-8111-111111111111';

const mocks = vi.hoisted(() => ({
  getTournamentById: vi.fn(),
  getRoundsByTournament: vi.fn(),
  listRulesets: vi.fn(),
}));

function stub(name: string) {
  const C = function Stub({ children }: { children?: ReactNode }) {
    return children ?? null;
  };
  Object.defineProperty(C, 'name', { value: name });
  return { default: C };
}

vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));
vi.mock('@/i18n/server', async () => {
  const { createTranslator } = await import('@/i18n/core');
  return { getT: async (ns: Parameters<typeof createTranslator>[0]) => createTranslator(ns, 'en') };
});
vi.mock('@/lib/supabase/queries/tournaments', () => ({ getTournamentById: mocks.getTournamentById }));
vi.mock('@/lib/supabase/queries/rounds', () => ({ getRoundsByTournament: mocks.getRoundsByTournament }));
vi.mock('@/lib/supabase/queries/rulesets', () => ({ listRulesets: mocks.listRulesets }));
vi.mock('@/components/shared/AdminGuard', () => stub('AdminGuard'));
vi.mock('@/components/shared/ResourceAdminManager', () => stub('ResourceAdminManager'));
vi.mock('@/components/shared/EditableDescription', () => stub('EditableDescription'));
vi.mock('@/components/tournament/RoundManager', () => stub('RoundManager'));
vi.mock('@/components/tournament/ParticipantManager', () => stub('ParticipantManager'));
vi.mock('@/components/tournament/TournamentLifecycleActions', () => stub('TournamentLifecycleActions'));
vi.mock('@/components/tournament/TournamentSettingsEditor', () => stub('TournamentSettingsEditor'));

import LegacyRoundsPage from '../LegacyRoundsPage';
import Section from '@/components/ui/Section';
import TournamentSettingsEditor from '@/components/tournament/TournamentSettingsEditor';

type El = ReactElement<Record<string, unknown>>;

function findByType(node: ReactNode, type: unknown): El[] {
  const found: El[] = [];
  const visit = (n: ReactNode): void => {
    if (Array.isArray(n)) {
      n.forEach(visit);
      return;
    }
    if (isValidElement<Record<string, unknown>>(n)) {
      if (n.type === type) found.push(n);
      visit(n.props.children as ReactNode);
    }
  };
  visit(node);
  return found;
}

const rulesets = [{ id: RULESET_ID, name: 'Standard Rules' }];

function tournament(overrides: Record<string, unknown> = {}) {
  return {
    id: ID,
    name: 'Spring Cup',
    description: 'A cup',
    season_id: null,
    bracket_type: 'double_elim',
    ruleset_id: RULESET_ID,
    best_of_default: 3,
    bo_overrides: { Finals: 5 },
    is_doubles: false,
    team_visibility: 'hidden_until_match',
    bracket_reset_enabled: true,
    status: 'upcoming',
    archived: false,
    ...overrides,
  };
}

const render = () => LegacyRoundsPage({ id: ID, isSiteAdmin: true });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getTournamentById.mockResolvedValue(tournament());
  mocks.getRoundsByTournament.mockResolvedValue([]);
  mocks.listRulesets.mockResolvedValue(rulesets);
});

describe('LegacyRoundsPage settings section', () => {
  it('puts the Settings section first, uncollapsible, with its hint', async () => {
    const [first] = findByType(await render(), Section);
    expect(first.props.title).toBe('Settings');
    expect(first.props.subtitle).toContain('lock once the tournament has started');
    expect(first.props.collapsible).toBe(false);
    expect(findByType(first, TournamentSettingsEditor)).toHaveLength(1);
  });

  it('hands the editor the rulesets and only the editable fields', async () => {
    const [editor] = findByType(await render(), TournamentSettingsEditor);
    expect(editor.props.rulesets).toEqual(rulesets);
    expect(editor.props.tournament).toEqual({
      id: ID,
      name: 'Spring Cup',
      bracket_type: 'double_elim',
      ruleset_id: RULESET_ID,
      best_of_default: 3,
      bo_overrides: { Finals: 5 },
      is_doubles: false,
      team_visibility: 'hidden_until_match',
      bracket_reset_enabled: true,
    });
  });

  it('is not started for an upcoming tournament without rounds', async () => {
    const [editor] = findByType(await render(), TournamentSettingsEditor);
    expect(editor.props.started).toBe(false);
  });

  it('is started for an active tournament', async () => {
    mocks.getTournamentById.mockResolvedValue(tournament({ status: 'active' }));
    const [editor] = findByType(await render(), TournamentSettingsEditor);
    expect(editor.props.started).toBe(true);
  });

  it('is started for a completed tournament', async () => {
    mocks.getTournamentById.mockResolvedValue(tournament({ status: 'completed' }));
    const [editor] = findByType(await render(), TournamentSettingsEditor);
    expect(editor.props.started).toBe(true);
  });

  it('is started for an upcoming tournament that already has a round', async () => {
    mocks.getRoundsByTournament.mockResolvedValue([{ id: 'r1' }]);
    const [editor] = findByType(await render(), TournamentSettingsEditor);
    expect(editor.props.started).toBe(true);
  });

  it('keeps the other sections after the settings', async () => {
    const titles = findByType(await render(), Section).map((s) => s.props.title);
    expect(titles).toEqual(['Settings', 'Description', 'Participants', 'Rounds', 'Tournament Admins']);
  });

  it('reads the rulesets once and 404s for a missing tournament before any other read', async () => {
    await render();
    expect(mocks.listRulesets).toHaveBeenCalledTimes(1);

    mocks.getTournamentById.mockResolvedValue(null);
    mocks.listRulesets.mockClear();
    await expect(render()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.listRulesets).not.toHaveBeenCalled();
  });
});
