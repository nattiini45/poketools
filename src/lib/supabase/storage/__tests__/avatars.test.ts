import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mock, resetQueryMock } from '../../queries/__tests__/query-mock';

vi.mock('@/lib/supabase/client', async () => ({
  supabase: (await import('../../queries/__tests__/query-mock')).mock.supabase,
}));

import { galleryObjectPath, getAvatarBucket, removeGalleryObject } from '../avatars';

beforeEach(resetQueryMock);

const BASE = 'https://proj.supabase.co/storage/v1/object/public/avatars';

describe('getAvatarBucket', () => {
  it('hands out the avatars bucket', async () => {
    await getAvatarBucket().remove(['x.png']);
    expect(mock.state.storage).toEqual([{ bucket: 'avatars', method: 'remove', args: [['x.png']] }]);
  });
});

describe('galleryObjectPath', () => {
  it('reads the object path out of a public avatars URL and decodes it', () => {
    expect(galleryObjectPath(`${BASE}/gallery/p1/file%20one.png`)).toBe('gallery/p1/file one.png');
  });

  it('answers null for a URL with no avatars path, an empty path or garbage', () => {
    expect(galleryObjectPath('https://example.com/img.png')).toBeNull();
    expect(galleryObjectPath(`${BASE}/`)).toBeNull();
    expect(galleryObjectPath('not a url')).toBeNull();
    expect(galleryObjectPath(`${BASE}/%E0%A4%A`)).toBeNull();
  });
});

describe('removeGalleryObject', () => {
  it('removes the named object from the avatars bucket', async () => {
    const result = await removeGalleryObject(`${BASE}/gallery/p1/file.png`);

    expect(result).toEqual({ attempted: true, error: null });
    expect(mock.state.storage).toEqual([{ bucket: 'avatars', method: 'remove', args: [['gallery/p1/file.png']] }]);
  });

  it('does not call Storage for a URL that names no object', async () => {
    await expect(removeGalleryObject('https://example.com/img.png')).resolves.toEqual({ attempted: false, error: null });
    expect(mock.state.storage).toEqual([]);
  });

  it('returns the Storage error of a failed removal', async () => {
    const failure = { message: 'denied' };
    mock.state.storageResults.push({ error: failure });

    await expect(removeGalleryObject(`${BASE}/gallery/p1/file.png`)).resolves.toEqual({ attempted: true, error: failure });
  });
});
