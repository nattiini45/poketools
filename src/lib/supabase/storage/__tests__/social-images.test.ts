import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mock, resetQueryMock } from '../../queries/__tests__/query-mock';

vi.mock('@/lib/supabase/client', async () => ({
  supabase: (await import('../../queries/__tests__/query-mock')).mock.supabase,
}));

import { removeSocialImage, uploadSocialImage } from '../social-images';

beforeEach(resetQueryMock);

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

describe('uploadSocialImage', () => {
  it('uploads a new immutable PNG object and returns its public URL', async () => {
    const result = await uploadSocialImage('matches/m1/a.png', PNG);

    expect(result).toEqual({
      publicUrl: 'https://proj.supabase.co/storage/v1/object/public/social-images/matches/m1/a.png',
      error: null,
    });
    expect(mock.state.storage[0]).toEqual({
      bucket: 'social-images',
      method: 'upload',
      args: ['matches/m1/a.png', PNG, { contentType: 'image/png', cacheControl: '31536000', upsert: false }],
    });
  });

  it('returns the Storage error and asks for no URL when the upload fails', async () => {
    const failure = { message: 'quota' };
    mock.state.storageResults.push({ error: failure });

    await expect(uploadSocialImage('matches/m1/a.png', PNG)).resolves.toEqual({ publicUrl: null, error: failure });
    expect(mock.state.storage.map((call) => call.method)).toEqual(['upload']);
  });
});

describe('removeSocialImage', () => {
  it('removes one object from the social-images bucket', async () => {
    await expect(removeSocialImage('matches/m1/a.png')).resolves.toEqual({ error: null });
    expect(mock.state.storage).toEqual([{ bucket: 'social-images', method: 'remove', args: [['matches/m1/a.png']] }]);
  });

  it('returns the Storage error of a failed removal', async () => {
    const failure = { message: 'denied' };
    mock.state.storageResults.push({ error: failure });
    await expect(removeSocialImage('matches/m1/a.png')).resolves.toEqual({ error: failure });
  });
});
