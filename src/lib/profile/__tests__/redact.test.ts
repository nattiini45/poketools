import { describe, expect, it } from 'vitest';
import { redactPlayer } from '../redact';
import { PUBLIC_PLAYER_FIELDS } from '@/lib/players/public-player';
import { expectNoPrivatePlayerData, fullPlayerRow } from '@/lib/players/__tests__/private-player-fields';
import type { Player } from '@/types/player';

describe('redactPlayer', () => {
  it('is an allowlist: exactly the profile card fields survive', () => {
    const result = redactPlayer(fullPlayerRow());

    expect(Object.keys(result)).toEqual([...PUBLIC_PLAYER_FIELDS]);
    expectNoPrivatePlayerData(result);
  });

  it('a column added to players later cannot leak through (no spread)', () => {
    const withFutureColumn = { ...fullPlayerRow(), email: 'SECRET@example.test' } as Player;

    expect(redactPlayer(withFutureColumn)).not.toHaveProperty('email');
  });
});
