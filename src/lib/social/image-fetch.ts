import { supabasePublicOrigin } from '@/lib/avatar/thumbnail-path';

/**
 * Fetch a match social card as a Buffer, for re-upload by the X and Bluesky
 * providers.
 *
 * The URL comes from `matches.social_image_url`, which the admin upload route
 * fills with a public object URL of the project's `social-images` bucket. The
 * fetch is still a server-side fetch of a stored URL, so it is bounded on
 * every axis instead of trusting the row:
 * - only a public `social-images` object on the project's Supabase origin
 *   (`NEXT_PUBLIC_SUPABASE_URL`) is fetched; an unset origin fails closed;
 * - redirects are refused, so the allowlist cannot be bounced elsewhere;
 * - one deadline covers the response and the body read;
 * - the body is capped at the upload route's 5 MB limit, both by the declared
 *   length and while streaming;
 * - a non-image content type is rejected.
 * Each failure throws its own message; the providers log it and post text-only.
 */

/** The bucket the admin upload route writes (`SOCIAL_IMAGE_BUCKET`; a test pins the two together). */
export const SOCIAL_IMAGE_FETCH_BUCKET = 'social-images';
/** Same cap as the admin upload route (`SOCIAL_IMAGE_MAX_BYTES`; a test pins the two together). */
export const SOCIAL_IMAGE_FETCH_MAX_BYTES = 5 * 1024 * 1024;
/** Same budget as `/api/proxy-image`. */
export const SOCIAL_IMAGE_FETCH_TIMEOUT_MS = 10_000;

const PUBLIC_PATH_MARKER = `/storage/v1/object/public/${SOCIAL_IMAGE_FETCH_BUCKET}/`;

/**
 * The URL to fetch when `imageUrl` is a public object of the project's
 * `social-images` bucket, else null: another origin, another bucket or a
 * non-public path, embedded credentials, a path that escapes the bucket, or
 * malformed input. A null `origin` yields null (fail closed).
 */
export function allowedSocialImageUrl(
  imageUrl: string,
  origin: string | null = supabasePublicOrigin()
): string | null {
  if (!origin) return null;

  let parsed: URL;
  try {
    parsed = new URL(imageUrl);
  } catch {
    return null;
  }
  if (parsed.origin !== origin || parsed.username || parsed.password) return null;
  if (!parsed.pathname.startsWith(PUBLIC_PATH_MARKER)) return null;

  let objectPath: string;
  try {
    objectPath = decodeURIComponent(parsed.pathname.slice(PUBLIC_PATH_MARKER.length));
  } catch {
    return null;
  }
  // The URL parser already collapses literal `..` segments; an encoded one
  // (`%2e%2e`, `%2F`) survives it, so check the decoded object path too.
  if (objectPath === '' || objectPath.split(/[\\/]/).some((seg) => seg === '..' || seg === '.')) return null;

  return parsed.href;
}

async function readCappedBody(response: Response, maxBytes: number): Promise<Buffer> {
  if (!response.body) return Buffer.alloc(0);

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`Social image exceeds ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, total);
}

export async function fetchImageAsBuffer(imageUrl: string): Promise<{
  buffer: Buffer;
  contentType: string;
}> {
  const url = allowedSocialImageUrl(imageUrl);
  if (!url) {
    throw new Error(
      `Social image URL is not a public ${SOCIAL_IMAGE_FETCH_BUCKET} object on the project's Supabase origin`
    );
  }

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(SOCIAL_IMAGE_FETCH_TIMEOUT_MS),
      redirect: 'error',
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch social image: ${response.status}`);
    }

    const contentType = response.headers.get('content-type') || 'image/png';
    if (!contentType.toLowerCase().startsWith('image/')) {
      throw new Error(`Social image has a non-image content type: ${contentType}`);
    }

    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > SOCIAL_IMAGE_FETCH_MAX_BYTES) {
      throw new Error(`Social image exceeds ${SOCIAL_IMAGE_FETCH_MAX_BYTES} bytes (${declared} declared)`);
    }

    const buffer = await readCappedBody(response, SOCIAL_IMAGE_FETCH_MAX_BYTES);
    return { buffer, contentType };
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') {
      throw new Error(`Social image fetch timed out after ${SOCIAL_IMAGE_FETCH_TIMEOUT_MS} ms`, { cause: err });
    }
    throw err;
  }
}
