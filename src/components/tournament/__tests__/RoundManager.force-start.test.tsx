/**
 * RoundManager's way out of a 409 `format_not_ready`: the pure pieces behind the "Start anyway?" dialog. The override is
 * the `?force=true` query the generate routes read (`wantsForcedStart`); without these helpers no client could send it.
 * Pure pieces only (vitest 'node' env); the click, the dialog and the forced retry are driven in
 * RoundManager.force-start-flow.test.tsx and ManualRoundForm.force-start.test.tsx.
 */
import { describe, expect, it } from 'vitest';
import { formatNotReadyReasons, generateEndpoint } from '../RoundManager';
import { formatNotReadyReasons as sharedReasons } from '../force-start';
import { manualRoundEndpoint } from '../ManualRoundForm';
import { tournamentsAdminMessages } from '@/i18n/messages/tournaments/admin';

describe('generateEndpoint', () => {
  it('points Generate at the generate-round route and Generate all at generate-all-rounds', () => {
    expect(generateEndpoint('t-1', 'next')).toBe('/api/generate-round/t-1');
    expect(generateEndpoint('t-1', 'all')).toBe('/api/tournaments/t-1/generate-all-rounds');
  });

  it('adds the force flag as a query, only when asked', () => {
    expect(generateEndpoint('t-1', 'next', true)).toBe('/api/generate-round/t-1?force=true');
    expect(generateEndpoint('t-1', 'all', true)).toBe('/api/tournaments/t-1/generate-all-rounds?force=true');
    expect(generateEndpoint('t-1', 'next', false)).not.toContain('force');
  });
});

describe('formatNotReadyReasons', () => {
  it('reads the reasons of a format_not_ready answer', () => {
    expect(formatNotReadyReasons({ code: 'format_not_ready', params: { reasons: 'relation_undrawn,action_incomplete', open_checks: 2 } })).toEqual([
      'relation_undrawn',
      'action_incomplete',
    ]);
    expect(formatNotReadyReasons({ code: 'format_not_ready', params: { reasons: 'action_incomplete' } })).toEqual(['action_incomplete']);
  });

  it('still opens the dialog, without reasons, when the server sent none or only unknown ones', () => {
    expect(formatNotReadyReasons({ code: 'format_not_ready' })).toEqual([]);
    expect(formatNotReadyReasons({ code: 'format_not_ready', params: { reasons: 'something_new' } })).toEqual([]);
  });

  it('is null for every other answer, so no dialog opens for them', () => {
    expect(formatNotReadyReasons({ code: 'rounds_all_generated' })).toBeNull();
    expect(formatNotReadyReasons({})).toBeNull();
  });
});

describe('the force-start dialog text', () => {
  it('exists in English and German with the same keys', () => {
    expect(Object.keys(tournamentsAdminMessages.de.rounds.forceStart).sort()).toEqual(Object.keys(tournamentsAdminMessages.en.rounds.forceStart).sort());
    expect(tournamentsAdminMessages.en.rounds.forceStart.message).toContain('{reasons}');
    expect(tournamentsAdminMessages.de.rounds.forceStart.message).toContain('{reasons}');
  });
});

describe('manualRoundEndpoint', () => {
  it('points the manual editor at the manual-round route', () => {
    expect(manualRoundEndpoint('t-1')).toBe('/api/tournaments/t-1/rounds/manual');
    expect(manualRoundEndpoint('t-1', false)).not.toContain('force');
  });

  it('adds the force flag as a query for the confirmed retry, so the editor can override a format_not_ready', () => {
    expect(manualRoundEndpoint('t-1', true)).toBe('/api/tournaments/t-1/rounds/manual?force=true');
  });

  it('shares the reason parsing with RoundManager', () => {
    expect(sharedReasons).toBe(formatNotReadyReasons);
  });
});
