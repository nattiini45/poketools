/**
 * ParticipantManager enrols players through a server-side search
 * (`GET /api/admin/player-search`) scoped to the tournament, instead of
 * preloading `GET /api/players` (site-admin only, first page only). The search
 * URL, parser and greyed-out rules are tested in
 * `src/lib/players/__tests__/player-search.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { enrolledParticipant } from '../ParticipantManager';

describe('enrolledParticipant', () => {
  it('builds the admin participant row of a pick: unseeded, winners bracket, no full player row', () => {
    expect(enrolledParticipant({ id: 'p1', name: 'Zed', is_guest: true })).toEqual({
      id: 'p1',
      name: 'Zed',
      avatar_url: null,
      seed: null,
      starting_bracket: 'winners',
      is_guest: true,
    });
  });
});
