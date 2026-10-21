import { describe, it, expect } from 'vitest';
import {
  PRIVATE_TEAM_FIELDS,
  PUBLIC_TEAM_FIELDS,
  toPublicTeam,
  toPublicTeamWithContext,
} from '../public-team';
import { expectNoPrivateTeamData, PRIVATE_TEAM_SENTINELS, teamRowWithShareSecrets } from './private-team-fields';

describe('toPublicTeam (C1 allowlist)', () => {
  it('copies exactly the public fields, in the allowlist', () => {
    const row = teamRowWithShareSecrets({ id: 'team-9', name: 'Sun' });
    const out = toPublicTeam(row);

    expect(Object.keys(out)).toEqual([...PUBLIC_TEAM_FIELDS]);
    for (const field of PUBLIC_TEAM_FIELDS) {
      expect(out[field]).toEqual(row[field]);
    }
  });

  it('drops the share columns of a raw row, by key and by value', () => {
    const row = teamRowWithShareSecrets();
    // The fixture really carries the secrets (otherwise the test proves nothing).
    expect(JSON.stringify(row)).toContain(PRIVATE_TEAM_SENTINELS.share_token);

    expectNoPrivateTeamData(toPublicTeam(row));
  });

  it('drops any unknown extra property (no spread)', () => {
    const row = Object.assign(teamRowWithShareSecrets(), { future_secret_column: 'x' });
    expect(toPublicTeam(row)).not.toHaveProperty('future_secret_column');
  });

  it('toPublicTeamWithContext adds only the tournament name', () => {
    const row = Object.assign(teamRowWithShareSecrets(), { tournament_name: 'Spring Cup' });
    const out = toPublicTeamWithContext(row);

    expect(Object.keys(out)).toEqual([...PUBLIC_TEAM_FIELDS, 'tournament_name']);
    expect(out.tournament_name).toBe('Spring Cup');
    expectNoPrivateTeamData(out);
  });

  it('the private list names exactly the share columns', () => {
    expect([...PRIVATE_TEAM_FIELDS].sort()).toEqual(['share_enabled_at', 'share_token']);
  });
});
