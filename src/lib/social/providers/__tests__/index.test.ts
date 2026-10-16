import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../x', () => ({ postToX: vi.fn() }));
vi.mock('../threads', () => ({ postToThreads: vi.fn() }));
vi.mock('../bluesky', () => ({ postToBluesky: vi.fn() }));

import { publishToProvider } from '../index';
import { postToX } from '../x';
import { postToThreads } from '../threads';
import { postToBluesky } from '../bluesky';
import type { SocialCredentials } from '@/types/social';

describe('publishToProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('dispatches to postToX for x provider', async () => {
    const creds: SocialCredentials = {
      provider: 'x',
      access_token: 'token-123',
    };

    await publishToProvider('x', creds, 'Hello X', 'https://img.png');

    expect(postToX).toHaveBeenCalledWith(creds, 'Hello X', 'https://img.png');
    expect(postToThreads).not.toHaveBeenCalled();
    expect(postToBluesky).not.toHaveBeenCalled();
  });

  it('dispatches to postToThreads for threads provider', async () => {
    const creds: SocialCredentials = {
      provider: 'threads',
      access_token: 'token-456',
      user_id: 'user-1',
    };

    await publishToProvider('threads', creds, 'Hello Threads');

    expect(postToThreads).toHaveBeenCalledWith(creds, 'Hello Threads', undefined);
    expect(postToX).not.toHaveBeenCalled();
    expect(postToBluesky).not.toHaveBeenCalled();
  });

  it('dispatches to postToBluesky for bluesky provider', async () => {
    const creds: SocialCredentials = {
      provider: 'bluesky',
      handle: 'test.bsky.social',
      app_password: 'pw',
    };

    await publishToProvider('bluesky', creds, 'Hello Bluesky', 'https://img.png');

    expect(postToBluesky).toHaveBeenCalledWith(creds, 'Hello Bluesky', 'https://img.png');
    expect(postToX).not.toHaveBeenCalled();
    expect(postToThreads).not.toHaveBeenCalled();
  });

  it('throws on credential provider mismatch', async () => {
    const creds: SocialCredentials = {
      provider: 'x',
      access_token: 'token-123',
    };

    await expect(
      publishToProvider('bluesky', creds, 'Test'),
    ).rejects.toThrow('Credentials provider mismatch: expected bluesky, got x');

    expect(postToX).not.toHaveBeenCalled();
    expect(postToThreads).not.toHaveBeenCalled();
    expect(postToBluesky).not.toHaveBeenCalled();
  });

  it('passes imageUrl as undefined when not provided', async () => {
    const creds: SocialCredentials = {
      provider: 'x',
      access_token: 'token',
    };

    await publishToProvider('x', creds, 'No image');

    expect(postToX).toHaveBeenCalledWith(creds, 'No image', undefined);
  });
});
