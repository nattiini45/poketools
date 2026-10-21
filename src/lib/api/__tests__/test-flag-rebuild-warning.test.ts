/**
 * `toTestFlagRebuildWarning`: the `data.rebuild_warning` of a test-league flag
 * change whose rating rebuild failed. A catalogued refusal keeps its own code
 * and params; any other failure gets one fixed code, never the internal message.
 * `testFlagRebuildUnsettledWarning`: the one for a rebuild that hit its pass cap.
 */
import { describe, expect, it } from 'vitest';
import { testFlagRebuildUnsettledWarning, toTestFlagRebuildWarning } from '../delete-rebuild-warning';
import { UserFacingError } from '../user-facing-error';
import { RatingRebuildPlanTooLargeError } from '@/lib/rating/updateRatings';
import { errorsAdmin } from '@/i18n/messages/errors/admin';

describe('toTestFlagRebuildWarning', () => {
  it('keeps a catalogued rebuild refusal with its params', () => {
    expect(toTestFlagRebuildWarning(new RatingRebuildPlanTooLargeError(2000))).toEqual({
      code: 'rating_rebuild_plan_too_large',
      error: expect.stringContaining('more than 2000 players'),
      params: { limit: 2000 },
    });
  });

  it('keeps the code of any other user-facing domain error', () => {
    const err = new UserFacingError('Rating history has gaps', {
      code: 'rating_history_incomplete',
      params: { count: 2, players: 'Ash' },
      status: 409,
    });
    expect(toTestFlagRebuildWarning(err)).toMatchObject({ code: 'rating_history_incomplete', params: { count: 2 } });
  });

  it('maps an unexpected failure to test_flag_rating_rebuild_failed with a fixed message', () => {
    const warning = toTestFlagRebuildWarning(new Error('connection reset by peer'));

    expect(warning.code).toBe('test_flag_rating_rebuild_failed');
    expect(warning.error).toBe(errorsAdmin.en.test_flag_rating_rebuild_failed);
    expect(warning.error).not.toContain('connection reset');
    expect(warning).not.toHaveProperty('params');
  });
});

describe('testFlagRebuildUnsettledWarning', () => {
  it('is the catalogued unsettled warning, telling the admin to repeat the repair', () => {
    expect(testFlagRebuildUnsettledWarning()).toEqual({
      code: 'test_flag_rating_rebuild_unsettled',
      error: errorsAdmin.en.test_flag_rating_rebuild_unsettled,
    });
    expect(errorsAdmin.en.test_flag_rating_rebuild_unsettled).toContain(
      'repeating the repair until its dry run lists no rating mismatch',
    );
    expect(errorsAdmin.en.test_flag_rating_rebuild_failed).toContain(
      'repeating the repair until its dry run lists no rating mismatch',
    );
  });
});
