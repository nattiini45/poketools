/**
 * Shared fixtures for the avatar thumbnail tests: an in-memory `avatars`
 * bucket (no network) and real, sharp-encoded test images.
 */
import { vi } from 'vitest';
import sharp from 'sharp';
import type { AvatarBucket } from '../thumbnail';

/**
 * The project URL the tests run under. Tests that touch URL → path helpers stub
 * it with `vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', TEST_SUPABASE_URL)`: the
 * helpers only accept URLs of this origin.
 */
export const TEST_SUPABASE_URL = 'https://proj.supabase.co';
export const TEST_AVATAR_PUBLIC_BASE = `${TEST_SUPABASE_URL}/storage/v1/object/public/avatars`;

/** UUIDs shaped like real player / file ids, so paths pass the original-path whitelist. */
export function testUuid(n: number): string {
  return `00000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;
}

export function publicAvatarUrl(path: string): string {
  return `${TEST_AVATAR_PUBLIC_BASE}/${path}`;
}

interface UploadOptions {
  contentType?: string;
  cacheControl?: string;
  upsert?: boolean;
}

/** In-memory stand-in for `supabase.storage.from('avatars')`. */
export function createFakeAvatarBucket(initial: Record<string, Buffer> = {}) {
  const objects = new Map<string, Buffer>(Object.entries(initial));

  const upload = vi.fn(async (path: string, body: Buffer, options?: UploadOptions) => {
    if (!options?.upsert && objects.has(path)) {
      return {
        data: null,
        error: { message: 'The resource already exists', statusCode: '409', status: 400 },
      };
    }
    objects.set(path, body);
    return { data: { path }, error: null };
  });

  const remove = vi.fn(async (paths: string[]) => {
    for (const path of paths) objects.delete(path);
    return { data: [], error: null };
  });

  const exists = vi.fn(async (path: string) => (
    objects.has(path)
      ? { data: true, error: null }
      : { data: false, error: { message: 'Object not found', status: 404 } }
  ));

  const download = vi.fn(async (path: string) => {
    const body = objects.get(path);
    return body
      ? { data: new Blob([new Uint8Array(body)]), error: null }
      : { data: null, error: { message: 'Object not found', status: 404 } };
  });

  const getPublicUrl = vi.fn((path: string) => ({ data: { publicUrl: publicAvatarUrl(path) } }));

  const api = { upload, remove, exists, download, getPublicUrl };
  return { objects, api, bucket: api as unknown as AvatarBucket };
}

/** A real PNG with a gradient (so it does not compress to nothing). */
export async function makeTestPng(width: number, height: number): Promise<Buffer> {
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      raw[i] = x % 256;
      raw[i + 1] = y % 256;
      raw[i + 2] = ((x * y) >> 6) % 256;
    }
  }
  return sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

export async function makeTestJpeg(width: number, height: number): Promise<Buffer> {
  return sharp(await makeTestPng(width, height)).jpeg({ quality: 90 }).toBuffer();
}

export function toDataUrl(mime: string, data: Buffer): string {
  return `data:${mime};base64,${data.toString('base64')}`;
}
