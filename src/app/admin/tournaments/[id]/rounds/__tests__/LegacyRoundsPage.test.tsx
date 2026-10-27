/**
 * Standalone tournament page: what it hands the round manager for the start-up checklist, and when the
 * participants section starts open (the checklist sends the admin there while there are too few players).
 * The server component is called directly and its element tree inspected (vitest 'node' env, no DOM).
 */
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ID = '0b9f1c2e-5d4a-4c3b-9a8e-7f6d5c4b3a21';

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
  return {
    getT: async (ns: Parameters<typeof createTranslator>[0]) => createTranslator(ns, 'en'),
  };
});
vi.mock('@/lib/supabase/queries/tournaments', () => ({ getTournamentWithDetails: mocks.getTournamentWithDetails }));
vi.mock('@/lib/supabase/queries/rounds', () => ({ getRoundsByTournament: mocks.getRoundsByTournament }));
vi.mock('@/lib/supabase/queries/rulesets', () => ({ listRulesetOptionsFor: mocks.listRulesetOptionsFor }));
vi.mock('@/lib/ruleset-studio/pin-info.server', () => ({ getRulesetPinInfo: mocks.getRulesetPinInfo }));
vi.mock('@/components/ruleset/RulesetPinCard', () => stub('RulesetPinCard'));
vi.mock('@/lib/supabase/queries/tournament-groups', () => ({ getGroupsByTournament: mocks.getGroupsByTournament }));
vi.mock('@/components/shared/AdminGuard', () => stub('AdminGuard'));
vi.mock('@/components/ui/PageContainer', () => stub('PageContainer'));
vi.mock('@/components/ui/Section', () => stub('Section'));
vi.mock('@/components/tournament/RoundManager', () => stub('RoundManager'));
vi.mock('@/components/tournament/ParticipantManager', () => stub('ParticipantManager'));
vi.mock('@/components/shared/ResourceAdminManager', () => stub('ResourceAdminManager'));
vi.mock('@/components/tournament/TournamentLifecycleActions', () => stub('TournamentLifecycleActions'));
vi.mock('@/components/shared/EditableDescription', () => stub('EditableDescription'));
vi.mock('@/components/tournament/TournamentSettingsEditor', () => stub('TournamentSettingsEditor'));

import LegacyRoundsPage from '../LegacyRoundsPage';
import Section from '@/components/ui/Section';
import RoundManager from '@/components/tournament/RoundManager';

type El = ReactElement<Record<string, unknown>>;

function findByType(node: ReactNode, type: unknown): El[] {
  const found: El[] = [];
  const walk = (n: ReactNode): void => {
    if (Array.isArray(n)) n.forEach((c) => walk(c as ReactNode));
    else if (isValidElement<Record<string, unknown>>(n)) {
      if (n.type === type) found.push(n);
      walk(n.props.children as ReactNode);
      if (n.props.action) walk(n.props.action as ReactNode);
    }
  };
  walk(node);
  return found;
}

function sectionById(tree: ReactNode, id: string): El {
  const section = findByType(tree, Section).find((el) => el.props.id === id);
  if (!section) throw new Error(`no section ${id}`);
  return section;
}

function tournament(participantCount: number) {
  return {
    id: ID,
    season_id: null,
    name: 'Cup',
    description: null,
    bracket_type: 'swiss',
    best_of_default: 3,
    status: 'upcoming',
    archived: false,
    ruleset_name: 'Standard OU',
    participant_count: participantCount,
  };
}

const render = (isSiteAdmin = true) => LegacyRoundsPage({ id: ID, playerId: 'admin-1', isSiteAdmin });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getTournamentWithDetails.mockResolvedValue(tournament(8));
  mocks.getRoundsByTournament.mockResolvedValue([]);
  mocks.getGroupsByTournament.mockResolvedValue([]);
  mocks.getRulesetPinInfo.mockResolvedValue(null);
  mocks.listRulesetOptionsFor.mockResolvedValue([]);
});

describe('standalone tournament page: start-up checklist inputs', () => {
  it('reads the tournament with its details and gives the round manager the ruleset and the groups flag', async () => {
    const tree = await render();
    expect(mocks.getTournamentWithDetails).toHaveBeenCalledWith(ID);
    expect(mocks.getGroupsByTournament).toHaveBeenCalledWith(ID);
    const props = findByType(tree, RoundManager)[0].props;
    expect(props.rulesetName).toBe('Standard OU');
    expect(props.groupsInUse).toBe(false);
    // A standalone tournament has no settings editor, so there is no overview link.
    expect(props.checklistLinks).toEqual({ participants: '#tournament-participants', rounds: '#tournament-rounds' });
  });

  it('a tournament with its own groups counts as grouped', async () => {
    mocks.getGroupsByTournament.mockResolvedValue([{ id: 'g1' }]);
    expect(findByType(await render(), RoundManager)[0].props.groupsInUse).toBe(true);
  });

  it('an unknown tournament is a 404', async () => {
    mocks.getTournamentWithDetails.mockResolvedValue(null);
    await expect(render()).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('gives the participants and rounds sections the anchor ids the links use', async () => {
    const tree = await render();
    expect(sectionById(tree, 'tournament-participants')).toBeDefined();
    expect(sectionById(tree, 'tournament-rounds')).toBeDefined();
  });
});

describe('standalone tournament page: participants section', () => {
  it.each([0, 1])('is open with %i participants', async (count) => {
    mocks.getTournamentWithDetails.mockResolvedValue(tournament(count));
    const section = sectionById(await render(), 'tournament-participants');
    expect(section.props.defaultCollapsed).toBe(false);
    expect(section.props.collapsible).toBe(true);
  });

  it('is collapsed with 8 participants', async () => {
    const section = sectionById(await render(), 'tournament-participants');
    expect(section.props.defaultCollapsed).toBe(true);
  });
});
