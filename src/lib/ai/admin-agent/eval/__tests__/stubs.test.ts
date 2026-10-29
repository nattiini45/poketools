import { afterEach, describe, expect, it } from 'vitest';

import { emitDiscordEvent } from '../stubs/discord-notify';
import { revalidatePath, revalidateTag, unstable_cache } from '../stubs/next-cache';
import { markApproveStarted, record, recordedCount, startRecording, stopRecording } from '../stubs/recorders';
import { emitSocialEvent, sendSocialTestMessage } from '../stubs/social-notify';
import { auth, loadSessionPlayer, installEvalSession, installSessionPlayerLoader } from '../stubs/auth';
import type { DiscordEventPayload } from '@/types/discord';
import type { SocialEventPayload } from '@/types/social';

/**
 * The recorders that stand in for the Discord sender, the social sender and cache expiry in the local-stack stages, and the
 * `@/auth` stub that carries the synthetic session. None of them sends, revalidates or signs anyone in.
 */
afterEach(() => {
  stopRecording();
  installEvalSession(null);
  installSessionPlayerLoader(null);
});

const discordPayload = (event_type: string) => ({ event_type }) as unknown as DiscordEventPayload;
const socialPayload = (event_type: string) => ({ event_type }) as unknown as SocialEventPayload;

describe('recorders', () => {
  it('drop calls outside a recording and collect them inside one', () => {
    record({ channel: 'discord', name: 'ignored' });
    expect(recordedCount()).toBe(0);
    startRecording();
    emitDiscordEvent(discordPayload('round_generated'));
    emitSocialEvent(socialPayload('round_generated'));
    revalidateTag('season:1', { expire: 0 });
    revalidatePath('/leagues');
    expect(recordedCount()).toBe(4);
    const { beforeApprove, afterApprove } = stopRecording();
    expect(beforeApprove.map((e) => `${e.channel}:${e.name}`)).toEqual(['discord:round_generated', 'social:round_generated', 'cache:tag:season:1', 'cache:path:/leagues']);
    expect(afterApprove).toEqual([]);
  });

  it('split at the first approve click, and keep the first mark', () => {
    startRecording();
    emitDiscordEvent(discordPayload('early'));
    markApproveStarted();
    emitDiscordEvent(discordPayload('late'));
    markApproveStarted();
    emitDiscordEvent(discordPayload('later'));
    const split = stopRecording();
    expect(split.beforeApprove.map((e) => e.name)).toEqual(['early']);
    expect(split.afterApprove.map((e) => e.name)).toEqual(['late', 'later']);
  });

  it('start clean every time', () => {
    startRecording();
    emitDiscordEvent(discordPayload('one'));
    startRecording();
    expect(recordedCount()).toBe(0);
  });
});

describe('the other stubs', () => {
  it('make the cache read-through the identity and refuse the social test message', async () => {
    const calls: number[] = [];
    const cached = unstable_cache(async (n: number) => {
      calls.push(n);
      return n * 2;
    });
    expect(await cached(2)).toBe(4);
    expect(await cached(2)).toBe(4);
    expect(calls).toEqual([2, 2]);
    await expect(sendSocialTestMessage()).rejects.toThrow(/not available in a run/);
  });
});

describe('the auth stub', () => {
  it('answers nobody until a session is installed, and the installed loader for the live player', async () => {
    expect(await auth()).toBeNull();
    expect(await loadSessionPlayer('discord', 'x')).toBeNull();
    const session = { user: { id: 'eval-discord-site-admin', name: 'Eval Site Admin' }, expires: '2999-01-01T00:00:00.000Z', provider: 'discord', player: null } as const;
    installEvalSession(session as never);
    expect(await auth()).toBe(session);
    installSessionPlayerLoader(async (provider, identityId) => ({ playerId: `${provider}:${identityId}` }) as never);
    expect(await loadSessionPlayer('discord', 'abc')).toEqual({ playerId: 'discord:abc' });
    installEvalSession(null);
    expect(await auth()).toBeNull();
  });
});
