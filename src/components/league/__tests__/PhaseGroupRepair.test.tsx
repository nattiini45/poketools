/**
 * The admin control that repairs group rows left by substitutions from before
 * the group handover. Rendered through react-dom/server (vitest 'node' env, no
 * DOM): the plan list as a check or an apply returns it, what an apply wrote,
 * and the idle control. The apply flow itself runs against a fake request.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import PhaseGroupRepair, {
  GroupRepairHandedOver,
  GroupRepairPlanView,
  applyReviewedRepair,
  checkRepair,
  type GroupRepairRequest,
} from '../PhaseGroupRepair';
import type { GroupRepairMove, GroupRepairResult } from '@/lib/season/group-repair';
import { renderWithI18n } from '@/test/i18n';

const MARA_TO_JONAS: GroupRepairMove = {
  group_id: 'g-a',
  group_name: 'Group A',
  from_player_id: 'p-old',
  from_player_name: 'Mara',
  to_player_id: 'p-new',
  to_player_name: 'Cilan',
  basis: 'audit',
};

const ILKA_TO_TIMO: GroupRepairMove = {
  group_id: 'g-b',
  group_name: 'Group B',
  from_player_id: 'p-old-2',
  from_player_name: 'Ilka',
  to_player_id: 'p-new-2',
  to_player_name: 'Timo',
  basis: 'fixtures',
};

function result(overrides: Partial<GroupRepairResult> = {}): GroupRepairResult {
  return {
    grouped: true,
    moves: [],
    unresolved: { orphaned_rows: [], ungrouped_players: [] },
    applied: false,
    history: { substitutions: 0, unreadable: 0, truncated: false },
    fixtures: { matches: 0, truncated: false },
    ...overrides,
  };
}

/** Text content with tags stripped and whitespace collapsed. */
function textOf(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&gt;/g, '>')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

describe('GroupRepairPlanView', () => {
  it('lists each proposed handover with its group, players and basis', () => {
    const text = textOf(
      renderToStaticMarkup(<GroupRepairPlanView plan={result({ moves: [MARA_TO_JONAS, ILKA_TO_TIMO] })} />),
    );

    expect(text).toContain('Rows to hand over (2)');
    expect(text).toContain('Group A: Mara → Cilan (substitution log)');
    expect(text).toContain('Group B: Ilka → Timo (fixtures)');
    expect(text).not.toContain('Unresolved items');
  });

  it('lists what stays unresolved, with the reason', () => {
    const text = textOf(
      renderToStaticMarkup(
        <GroupRepairPlanView
          plan={result({
            unresolved: {
              orphaned_rows: [
                { group_id: 'g-a', group_name: 'Group A', player_id: 'p-1', player_name: 'Mara', reason: 'ambiguous' },
                { group_id: 'g-b', group_name: 'Group B', player_id: 'p-2', player_name: 'Ilka', reason: 'several_rows' },
              ],
              ungrouped_players: [{ player_id: 'p-3', player_name: 'Timo', reason: 'no_counterpart' }],
            },
          })}
        />,
      ),
    );

    expect(text).toContain('No group rows to hand over.');
    expect(text).toContain('Rows held by players no longer enrolled (2)');
    expect(text).toContain('Group A: Mara (more than one substitute fits)');
    expect(text).toContain('Group B: Ilka (holds rows in several groups)');
    expect(text).toContain('Enrolled players without a group (1)');
    expect(text).toContain('Timo (no departed slot traced)');
    expect(text).toContain('Unresolved items are left as they are.');
  });

  it('warns when the substitution history was cut short or partly unreadable', () => {
    const text = textOf(
      renderToStaticMarkup(
        <GroupRepairPlanView plan={result({ history: { substitutions: 2000, unreadable: 3, truncated: true } })} />,
      ),
    );

    expect(text).toContain('Only the newest substitution records were read');
    expect(text).toContain('3 substitution records could not be read');
  });

  it('warns when the fixture read stopped at its bound', () => {
    const text = textOf(
      renderToStaticMarkup(<GroupRepairPlanView plan={result({ fixtures: { matches: 20000, truncated: true } })} />),
    );

    expect(text).toContain('Only the oldest 20000 matches of this phase were read');
  });

  it('says nothing about the fixtures when they were read in full', () => {
    const text = textOf(renderToStaticMarkup(<GroupRepairPlanView plan={result({ fixtures: { matches: 12, truncated: false } })} />));

    expect(text).not.toContain('matches of this phase were read');
  });

  it('says so for a phase without groups', () => {
    const text = textOf(renderToStaticMarkup(<GroupRepairPlanView plan={result({ grouped: false })} />));

    expect(text).toBe('This phase has no groups.');
  });
});

describe('GroupRepairHandedOver', () => {
  it('lists each row the apply handed over', () => {
    const text = textOf(renderToStaticMarkup(<GroupRepairHandedOver moves={[MARA_TO_JONAS, ILKA_TO_TIMO]} />));

    expect(text).toContain('Handed over 2 group rows:');
    expect(text).toContain('Group A: Mara → Cilan');
    expect(text).toContain('Group B: Ilka → Timo');
  });

  it('says so when nothing needed handing over', () => {
    const text = textOf(renderToStaticMarkup(<GroupRepairHandedOver moves={[]} />));

    expect(text).toBe('No group rows needed handing over.');
  });
});

describe('applyReviewedRepair', () => {
  const reviewed = result({ moves: [MARA_TO_JONAS, ILKA_TO_TIMO] });
  const stillOpen = result({ moves: [ILKA_TO_TIMO], history: { substitutions: 2, unreadable: 0, truncated: false } });

  it('applies exactly the reviewed moves, by id, and shows what was written', async () => {
    const request = vi.fn<GroupRepairRequest>(async () => ({
      success: true,
      data: result({ moves: [MARA_TO_JONAS, ILKA_TO_TIMO], applied: true }),
    }));
    const reloadGroups = vi.fn();

    const outcome = await applyReviewedRepair(reviewed, request, reloadGroups);

    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith({
      dry_run: false,
      moves: [
        { group_id: 'g-a', from_player_id: 'p-old', to_player_id: 'p-new' },
        { group_id: 'g-b', from_player_id: 'p-old-2', to_player_id: 'p-new-2' },
      ],
    });
    expect(outcome.handedOver).toEqual([MARA_TO_JONAS, ILKA_TO_TIMO]);
    expect(outcome.plan?.moves).toEqual([]);
    expect(outcome.error).toBeNull();
    expect(reloadGroups).toHaveBeenCalledTimes(1);
  });

  it('reloads the groups and checks again after an apply that failed partway', async () => {
    const request = vi.fn<GroupRepairRequest>(async (body) =>
      body.dry_run
        ? { success: true, data: stillOpen }
        : { success: false, error: 'The groups changed during the repair; check them again', code: 'GROUP_SLOT_CHANGED' },
    );
    const reloadGroups = vi.fn();

    const outcome = await applyReviewedRepair(reviewed, request, reloadGroups);

    expect(request).toHaveBeenLastCalledWith({ dry_run: true });
    expect(reloadGroups).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({
      handedOver: null,
      plan: stillOpen,
      // The server's refusal is kept whole (English text + code), and rendered by code.
      error: { api: { error: 'The groups changed during the repair; check them again', code: 'GROUP_SLOT_CHANGED' } },
    });
  });

  it('reloads the groups and checks again when the apply request itself throws', async () => {
    const request = vi.fn<GroupRepairRequest>(async (body) => {
      if (!body.dry_run) throw new TypeError('Failed to fetch');
      return { success: true, data: stillOpen };
    });
    const reloadGroups = vi.fn();

    const outcome = await applyReviewedRepair(reviewed, request, reloadGroups);

    expect(reloadGroups).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({ handedOver: null, plan: stillOpen, error: { key: 'repairFailed' } });
  });

  it('drops the stale plan when the check after a failed apply fails too', async () => {
    const request = vi.fn<GroupRepairRequest>(async () => ({ success: false, error: 'Failed to repair phase groups' }));
    const reloadGroups = vi.fn();

    const outcome = await applyReviewedRepair(reviewed, request, reloadGroups);

    expect(request).toHaveBeenCalledTimes(2);
    expect(reloadGroups).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({
      handedOver: null,
      plan: null,
      error: { api: { error: 'Failed to repair phase groups' } },
    });
  });
});

describe('checkRepair', () => {
  it('returns the fresh plan and reloads the groups', async () => {
    const plan = result({ moves: [MARA_TO_JONAS] });
    const request = vi.fn<GroupRepairRequest>(async () => ({ success: true, data: plan }));
    const reloadGroups = vi.fn();

    expect(await checkRepair(request, reloadGroups)).toEqual({ plan, error: null });
    expect(request).toHaveBeenCalledWith({ dry_run: true });
    expect(reloadGroups).toHaveBeenCalledTimes(1);
  });

  it('clears the plan when the check fails, so no stale Apply stays next to the error', async () => {
    const request = vi.fn<GroupRepairRequest>(async () => ({ success: false, error: 'Failed to repair phase groups' }));
    const reloadGroups = vi.fn();

    expect(await checkRepair(request, reloadGroups)).toEqual({
      plan: null,
      error: { api: { error: 'Failed to repair phase groups' } },
    });
    expect(reloadGroups).toHaveBeenCalledTimes(1);
  });

  it('clears the plan when the request throws', async () => {
    const request = vi.fn<GroupRepairRequest>(async () => {
      throw new TypeError('Failed to fetch');
    });

    expect(await checkRepair(request, vi.fn())).toEqual({ plan: null, error: { key: 'checkFailed' } });
  });
});

describe('PhaseGroupRepair', () => {
  it('starts with the check only: nothing to apply before a dry run', () => {
    const html = renderToStaticMarkup(
      <PhaseGroupRepair seasonId="season-1" phaseId="phase-1" reloadGroups={() => {}} />,
    );

    expect(textOf(html)).toContain('Check group rows');
    expect(html).not.toContain('Apply repair');
  });
});

describe('PhaseGroupRepair in German', () => {
  it('renders the plan, its reasons and the stored group names in German', () => {
    const text = textOf(
      renderWithI18n(
        <GroupRepairPlanView
          plan={result({
            moves: [MARA_TO_JONAS],
            unresolved: {
              orphaned_rows: [
                { group_id: 'g-b', group_name: 'Group B', player_id: 'p-2', player_name: 'Ilka', reason: 'several_rows' },
              ],
              ungrouped_players: [{ player_id: 'p-3', player_name: 'Timo', reason: 'ambiguous' }],
            },
            history: { substitutions: 4, unreadable: 1, truncated: false },
          })}
        />,
        { locale: 'de' },
      ),
    );

    expect(text).toContain('Zu übergebende Einträge (1)');
    expect(text).toContain('Gruppe A: Mara → Cilan (Wechselprotokoll)');
    expect(text).toContain('Gruppe B: Ilka (hat Einträge in mehreren Gruppen)');
    expect(text).toContain('Timo (mehr als ein Platz passt)');
    expect(text).toContain('1 Wechseleintrag konnte nicht gelesen werden');
    expect(text).not.toContain('Rows to hand over');
  });

  it('pluralizes what an apply handed over', () => {
    expect(textOf(renderWithI18n(<GroupRepairHandedOver moves={[MARA_TO_JONAS]} />, { locale: 'de' }))).toContain(
      '1 Gruppeneintrag übergeben:',
    );
    expect(
      textOf(renderWithI18n(<GroupRepairHandedOver moves={[MARA_TO_JONAS, ILKA_TO_TIMO]} />, { locale: 'de' })),
    ).toContain('2 Gruppeneinträge übergeben:');
  });

  it('labels the idle control in German', () => {
    const text = textOf(
      renderWithI18n(<PhaseGroupRepair seasonId="season-1" phaseId="phase-1" reloadGroups={() => {}} />, {
        locale: 'de',
      }),
    );

    expect(text).toContain('Gruppeneinträge nach Spielerwechseln');
    expect(text).toContain('Gruppeneinträge prüfen');
  });
});
