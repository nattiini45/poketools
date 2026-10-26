/**
 * Standalone tournament admin page: the Settings section comes first and is
 * handed the rulesets and the started flag (not upcoming, or any round).
 */
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ID = '0b9f1c2e-5d4a-4c3b-9a8e-7f6d5c4b3a21';
const RULESET_ID = '11111111-1111-4111-8111-111111111111';

const mocks = vi.hoisted(() => ({
  getTournamentWithDetails: vi.fn(),
  getRoundsByTournament: vi.fn(),
  getGroupsByTournament: vi.fn(),
  listRulesetOptionsFor: vi.fn(),
  getRulesetPinInfo: vi.fn(),
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
vi.mock('@/lib/supabase/queries/tournaments', () => ({ getTournamentWithDetails: mocks.getTournamentWithDetails }));
vi.mock('@/lib/supabase/queries/rounds', () => ({ getRoundsByTournament: mocks.getRoundsByTournament }));
vi.mock('@/lib/supabase/queries/tournament-groups', () => ({ getGroupsByTournament: mocks.getGroupsByTournament }));
vi.mock('@/lib/supabase/queries/rulesets', () => ({ listRulesetOptionsFor: mocks.listRulesetOptionsFor }));
vi.mock('@/lib/ruleset-studio/pin-info.server', () => ({ getRulesetPinInfo: mocks.getRulesetPinInfo }));
vi.mock('@/components/ruleset/RulesetPinCard', () => stub('RulesetPinCard'));
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
import RulesetPinCard from '@/components/ruleset/RulesetPinCard';

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
    ruleset_name: 'Standard Rules',
    participant_count: 4,
    ...overrides,
  };
}

const render = () => LegacyRoundsPage({ id: ID, playerId: 'admin-1', isSiteAdmin: true });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getTournamentWithDetails.mockResolvedValue(tournament());
  mocks.getRoundsByTournament.mockResolvedValue([]);
  mocks.getGroupsByTournament.mockResolvedValue([]);
  mocks.getRulesetPinInfo.mockResolvedValue(null);
  mocks.listRulesetOptionsFor.mockResolvedValue(rulesets);
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
    mocks.getTournamentWithDetails.mockResolvedValue(tournament({ status: 'active' }));
    const [editor] = findByType(await render(), TournamentSettingsEditor);
    expect(editor.props.started).toBe(true);
  });

  it('is started for a completed tournament', async () => {
    mocks.getTournamentWithDetails.mockResolvedValue(tournament({ status: 'completed' }));
    const [editor] = findByType(await render(), TournamentSettingsEditor);
    expect(editor.props.started).toBe(true);
  });

  it('is started for an upcoming tournament that already has a round', async () => {
    mocks.getRoundsByTournament.mockResolvedValue([{ id: 'r1' }]);
    const [editor] = findByType(await render(), TournamentSettingsEditor);
    expect(editor.props.started).toBe(true);
  });

  it('names the reason for the lock: the tournament started, or its rounds were generated', async () => {
    const [open] = findByType(await render(), TournamentSettingsEditor);
    expect(open.props.lockReason).toBeNull();

    mocks.getRoundsByTournament.mockResolvedValue([{ id: 'r1' }]);
    const [withRound] = findByType(await render(), TournamentSettingsEditor);
    expect(withRound.props.lockReason).toBe('rounds');

    mocks.getTournamentWithDetails.mockResolvedValue(tournament({ status: 'active' }));
    const [active] = findByType(await render(), TournamentSettingsEditor);
    expect(active.props.lockReason).toBe('started');
  });

  it('lists the rulesets of the viewer with the pin of the tournament kept in, and shows its pin card under the settings', async () => {
    const pin = { definition_id: 'def-1', name: 'Standard Rules', version_id: RULESET_ID, version_no: 2, update: null, can_view: true };
    mocks.getRulesetPinInfo.mockResolvedValue(pin);
    const tree = await render();
    expect(mocks.listRulesetOptionsFor).toHaveBeenCalledWith({ actor: { playerId: 'admin-1', isAdmin: true }, seasonId: null, keep: [RULESET_ID] });
    expect(mocks.getRulesetPinInfo).toHaveBeenCalledWith(RULESET_ID, { playerId: 'admin-1', isAdmin: true });
    const [first] = findByType(tree, Section);
    const [card] = findByType(first, RulesetPinCard);
    expect(card.props).toEqual({ kind: 'standalone', target: { kind: 'tournament', id: ID, name: 'Spring Cup', status: 'upcoming' }, pin });
  });

  it('keeps the other sections after the settings', async () => {
    const titles = findByType(await render(), Section).map((s) => s.props.title);
    expect(titles).toEqual(['Settings', 'Description', 'Participants', 'Rounds', 'Tournament Admins']);
  });

  it('reads the rulesets once and 404s for a missing tournament before any other read', async () => {
    await render();
    expect(mocks.listRulesetOptionsFor).toHaveBeenCalledTimes(1);

    mocks.getTournamentWithDetails.mockResolvedValue(null);
    mocks.listRulesetOptionsFor.mockClear();
    await expect(render()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.listRulesetOptionsFor).not.toHaveBeenCalled();
  });
});
