import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import Button from '@/components/ui/Button';
import { createTranslator } from '@/i18n/core';
import { adminTestPlayersMessages } from '@/i18n/messages/admin-test-players';
import type { Player } from '@/types/player';
import { buildPlayerColumns, removeFromSeasonPayload } from '../TestPlayersConsole';

function player(id: string, name: string): Player {
  return { id, name, ps_username: null, auth_user_id: null } as unknown as Player;
}

/** Depth-first search of a React element tree for elements matching `match`. */
function findElements(node: ReactNode, match: (element: ReactElement<Record<string, unknown>>) => boolean): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap((child) => findElements(child as ReactNode, match));
  if (!isValidElement(node)) return [];
  const element = node as ReactElement<Record<string, unknown>>;
  return [
    ...(match(element) ? [element] : []),
    ...findElements(element.props.children as ReactNode, match),
  ];
}

function removeButtons(node: ReactNode) {
  return findElements(node, (el) => el.type === Button && el.props.children === 'Remove from Season');
}

function actionsOf(columns: ReturnType<typeof buildPlayerColumns>, row: Player): ReactNode {
  const column = columns.find((c) => c.key === 'actions');
  if (!column?.render) throw new Error('actions column missing');
  return column.render(row, 0);
}

function columnsWith(overrides: { seasonId?: string; onRemoveFromSeason?: (p: Player) => void } = {}) {
  return buildPlayerColumns({
    t: createTranslator(adminTestPlayersMessages, 'en'),
    busyAction: null,
    seasonId: overrides.seasonId ?? 'season-1',
    onPlayerAction: vi.fn(),
    onRemoveFromSeason: overrides.onRemoveFromSeason ?? vi.fn(),
  });
}

describe('removeFromSeasonPayload', () => {
  it('targets the given player and trims the season id', () => {
    expect(removeFromSeasonPayload({ id: 'p7' }, ' s1 ')).toEqual({
      action: 'remove_from_league',
      player_id: 'p7',
      season_id: 's1',
    });
  });
});

describe('buildPlayerColumns', () => {
  it('gives every row a Remove from Season button that acts on that row\'s player', () => {
    const spy = vi.fn();
    const columns = columnsWith({ onRemoveFromSeason: spy });
    const first = player('p1', 'EvoTest01');
    const second = player('p2', 'EvoTest02');

    const [secondButton] = removeButtons(actionsOf(columns, second));
    expect(secondButton).toBeDefined();
    (secondButton.props.onClick as () => void)();
    expect(spy).toHaveBeenLastCalledWith(second);

    const [firstButton] = removeButtons(actionsOf(columns, first));
    (firstButton.props.onClick as () => void)();
    expect(spy).toHaveBeenLastCalledWith(first);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('disables the buttons until a season id is entered', () => {
    const row = player('p1', 'EvoTest01');
    const [disabled] = removeButtons(actionsOf(columnsWith({ seasonId: '' }), row));
    const [blank] = removeButtons(actionsOf(columnsWith({ seasonId: '   ' }), row));
    const [enabled] = removeButtons(actionsOf(columnsWith({ seasonId: 'season-1' }), row));

    expect(disabled.props.disabled).toBe(true);
    expect(blank.props.disabled).toBe(true);
    expect(enabled.props.disabled).toBe(false);
  });

  it('names the player in each row\'s accessible label', () => {
    const columns = columnsWith();
    const html = renderToStaticMarkup(<>{actionsOf(columns, player('p2', 'EvoTest02'))}</>);

    expect(html).toContain('aria-label="Remove from Season: EvoTest02"');
    expect(html).toContain('Remove from Season');
  });

  it('shows the enable hint as a tooltip only while the button is disabled', () => {
    const row = player('p2', 'EvoTest02');
    const [disabled] = removeButtons(actionsOf(columnsWith({ seasonId: '' }), row));
    const [enabled] = removeButtons(actionsOf(columnsWith({ seasonId: 'season-1' }), row));

    expect(disabled.props.title).toBe('Enter a season UUID below to enable this');
    expect(enabled.props.title).toBeUndefined();
  });
});
