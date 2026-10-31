/**
 * `liveBeforeState`: the only producer of the `before.pins` a pin-move undo moves each target back to, and `refusalFact`, how a
 * refused guard reads as a Plan fact. The data layer is mocked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), loadSessionPlayer: vi.fn() }));
vi.mock('@/lib/supabase/queries/ruleset-definitions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/supabase/queries/ruleset-definitions')>()),
  getPinTargetStates: vi.fn(),
  getDefinitionOfVersion: vi.fn(),
}));

import { getDefinitionOfVersion, getPinTargetStates } from '@/lib/supabase/queries/ruleset-definitions';
import { liveBeforeState, refusalFact } from '../live';

const SEASON = '00000000-0000-4000-8000-00000000AB01';
const TOURNAMENT = '00000000-0000-4000-8000-00000000AB02';
const VERSION = '00000000-0000-4000-8000-0000000000F1';

const facts = (op: string, body: unknown) => ({ step: { op }, call: { params: {}, body } }) as never;

beforeEach(() => {
  vi.resetAllMocks();
});

describe('liveBeforeState', () => {
  it('is null for any step but a pin move, and reads nothing', async () => {
    expect(await liveBeforeState(facts('publish_ruleset', { targets: [] }))).toBeNull();
    expect(getPinTargetStates).not.toHaveBeenCalled();
  });

  it('records each target with a lower-cased id, its pinned version and that version\'s number', async () => {
    vi.mocked(getPinTargetStates).mockResolvedValue([
      { kind: 'season', id: SEASON, ruleset_id: VERSION },
      { kind: 'tournament', id: TOURNAMENT, ruleset_id: null },
    ] as never);
    vi.mocked(getDefinitionOfVersion).mockResolvedValue({ version_no: 4 } as never);

    const before = await liveBeforeState(
      facts('move_pin', { targets: [{ kind: 'season', id: SEASON }, { kind: 'tournament', id: TOURNAMENT }] }),
    );

    expect(getPinTargetStates).toHaveBeenCalledWith([SEASON], [TOURNAMENT]);
    expect(before).toEqual({
      pins: [
        { kind: 'season', id: SEASON.toLowerCase(), version_id: VERSION, version_no: 4 },
        { kind: 'tournament', id: TOURNAMENT.toLowerCase(), version_id: null, version_no: null },
      ],
    });
  });

  it('propagates a failed read instead of recording an empty before-state', async () => {
    vi.mocked(getPinTargetStates).mockRejectedValue(new Error('read failed'));
    await expect(liveBeforeState(facts('move_pin', { targets: [{ kind: 'season', id: SEASON }] }))).rejects.toThrow('read failed');
  });
});

describe('refusalFact', () => {
  it('reads not-found and forbidden codes as such, and any other refusal as unavailable', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(refusalFact('ruleset_not_found', 'x')).toBe('not_found');
    expect(refusalFact('not_found', 'x')).toBe('not_found');
    expect(refusalFact('forbidden', 'x')).toBe('forbidden');
    expect(refusalFact('ruleset_forbidden', 'x')).toBe('forbidden');
    expect(refusalFact('rate_limited', 'x')).toBeNull();
    expect(refusalFact('unauthenticated', 'x')).toBeNull();
    expect(refusalFact('ruleset_locked', 'x')).toBeNull();
  });
});
