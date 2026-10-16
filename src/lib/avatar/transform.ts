/**
 * Photo-to-trainer-sprite transform pipeline.
 *
 * Server-side only — wraps Azure Content Safety (moderation)
 * and Replicate (image generation via Pokemon Trainer LoRA).
 */

import Replicate from 'replicate';
import type { ApiErrorCode } from '@/i18n/messages/errors';

// ── Constants ──────────────────────────────────────────────────

const AZURE_ENDPOINT = process.env.AZURE_ENDPOINT_URL ?? '';
const AZURE_KEY = process.env.AZURE_ENDPOINT_KEY ?? '';
const REPLICATE_TOKEN = process.env.REPLICATE_API_TOKEN ?? process.env.REPLICATE_API_TOKE ?? '';

const MODERATION_REQUIRED = process.env.AVATAR_MODERATION_REQUIRED
  ? process.env.AVATAR_MODERATION_REQUIRED !== 'false'
  : process.env.NODE_ENV === 'production';

const REPLICATE_OUTPUT_HOST_ALLOWLIST = (
  process.env.REPLICATE_OUTPUT_HOST_ALLOWLIST
  ?? 'replicate.delivery,*.replicate.delivery'
).split(',').map((value) => value.trim().toLowerCase()).filter(Boolean);

/** Azure severity threshold — reject if any category >= this. Scale 0-6. */
const MODERATION_THRESHOLD = 4;

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2 MB
const MAX_REPLICATE_IMAGE_SIZE = 5 * 1024 * 1024; // 5 MB
const REPLICATE_IMAGE_FETCH_TIMEOUT_MS = 20_000;

let hasWarnedAboutLegacyReplicateEnv = false;

// Magic bytes for image format validation
const MAGIC_BYTES: Record<string, number[][]> = {
  'image/jpeg': [[0xff, 0xd8, 0xff]],
  'image/png': [[0x89, 0x50, 0x4e, 0x47]],
  'image/webp': [[0x52, 0x49, 0x46, 0x46]], // "RIFF" — WebP container
};

// ── Types ──────────────────────────────────────────────────────

export interface ModerationResult {
  safe: boolean;
  /** Which category triggered rejection, if any */
  rejectedCategory?: string;
  /** Whether moderation could not run due to configuration or service errors */
  unavailable?: boolean;
}

export interface TransformResult {
  /** Base64 data URL of the generated sprite */
  image: string;
}

/** `validateUpload` failure codes (`errors/players` catalog). */
export type UploadErrorCode = Extract<
  ApiErrorCode,
  | 'avatar_image_invalid_base64'
  | 'avatar_file_too_large'
  | 'avatar_image_too_small'
  | 'avatar_image_format_unsupported'
  | 'avatar_image_format_mismatch'
>;

export interface ValidationResult {
  valid: boolean;
  /** English message: the log line and the client's fallback text. */
  error?: string;
  /** Set with `error`: the catalog code that translates it. */
  code?: UploadErrorCode;
  /** Values for the code's `{placeholders}` (`{ max }` for `avatar_file_too_large`). */
  params?: Record<string, string | number>;
  mimeType?: string;
  buffer?: Buffer;
}

export function isModerationRequired(): boolean {
  return MODERATION_REQUIRED;
}

// ── Validation ─────────────────────────────────────────────────

/**
 * Validate and decode a base64 image upload.
 * Checks size, MIME type, and magic bytes.
 */
export function validateUpload(base64Input: string): ValidationResult {
  // Strip data URL prefix if present
  const match = base64Input.match(/^data:(image\/[a-z+]+);base64,(.+)$/);
  const mimeFromHeader = match?.[1];
  const rawBase64 = match?.[2] ?? base64Input;

  let buffer: Buffer;
  try {
    buffer = Buffer.from(rawBase64, 'base64');
  } catch {
    return { valid: false, error: 'Invalid base64 encoding', code: 'avatar_image_invalid_base64' };
  }

  if (buffer.length > MAX_FILE_SIZE) {
    const maxMb = MAX_FILE_SIZE / 1024 / 1024;
    return {
      valid: false,
      error: `File too large (max ${maxMb}MB)`,
      code: 'avatar_file_too_large',
      params: { max: maxMb },
    };
  }

  if (buffer.length < 12) {
    return { valid: false, error: 'File too small to be a valid image', code: 'avatar_image_too_small' };
  }

  // Detect MIME from magic bytes
  let detectedMime: string | null = null;
  for (const [mime, signatures] of Object.entries(MAGIC_BYTES)) {
    for (const sig of signatures) {
      if (sig.every((byte, i) => buffer[i] === byte)) {
        detectedMime = mime;
        break;
      }
    }
    if (detectedMime) break;
  }

  if (!detectedMime) {
    return {
      valid: false,
      error: 'Unsupported image format. Use JPEG, PNG, or WebP.',
      code: 'avatar_image_format_unsupported',
    };
  }

  // If the header claimed a MIME, make sure it matches
  if (mimeFromHeader && mimeFromHeader !== detectedMime) {
    return { valid: false, error: 'Image format mismatch', code: 'avatar_image_format_mismatch' };
  }

  if (!ALLOWED_MIME_TYPES.has(detectedMime)) {
    return {
      valid: false,
      error: 'Unsupported image format. Use JPEG, PNG, or WebP.',
      code: 'avatar_image_format_unsupported',
    };
  }

  return { valid: true, mimeType: detectedMime, buffer };
}

// ── Azure Content Safety ───────────────────────────────────────

/**
 * Moderate an image buffer via Azure Content Safety.
 * Returns safe:true if no category exceeds the threshold.
 */
export async function moderateImage(buffer: Buffer): Promise<ModerationResult> {
  if (!AZURE_ENDPOINT || !AZURE_KEY) {
    console.warn('Azure Content Safety not configured');
    return { safe: false, unavailable: true };
  }

  const base64 = buffer.toString('base64');
  const url = `${AZURE_ENDPOINT.replace(/\/$/, '')}/contentsafety/image:analyze?api-version=2024-09-01`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Ocp-Apim-Subscription-Key': AZURE_KEY,
      },
      body: JSON.stringify({
        image: { content: base64 },
        categories: ['Hate', 'SelfHarm', 'Sexual', 'Violence'],
      }),
    });
  } catch (error) {
    console.error('Azure Content Safety request failed:', error);
    return { safe: false, unavailable: true };
  }

  if (!response.ok) {
    const text = await response.text();
    console.error('Azure Content Safety error:', response.status, text);
    return { safe: false, unavailable: true };
  }

  let data: {
    categoriesAnalysis: Array<{ category: string; severity: number }>;
  };
  try {
    data = await response.json() as {
      categoriesAnalysis: Array<{ category: string; severity: number }>;
    };
  } catch (error) {
    console.error('Azure Content Safety response parse failed:', error);
    return { safe: false, unavailable: true };
  }

  for (const category of data.categoriesAnalysis) {
    if (category.severity >= MODERATION_THRESHOLD) {
      return { safe: false, rejectedCategory: category.category };
    }
  }

  return { safe: true };
}

// ── Replicate (Retro Diffusion RD-Plus) ────────────────────────

/**
 * Transform a photo into a Pokemon trainer sprite via Replicate.
 * Uses retro-diffusion/rd-plus with img2img (input_image + strength).
 * Synchronous v1 — awaits the result directly (works on Vercel Pro 900s timeout).
 */
export async function transformToTrainer(imageBuffer: Buffer): Promise<TransformResult> {
  if (!REPLICATE_TOKEN) {
    throw new Error('REPLICATE_API_TOKEN is not configured');
  }

  if (!process.env.REPLICATE_API_TOKEN && process.env.REPLICATE_API_TOKE && !hasWarnedAboutLegacyReplicateEnv) {
    hasWarnedAboutLegacyReplicateEnv = true;
    console.warn('Using deprecated REPLICATE_API_TOKE env var. Please migrate to REPLICATE_API_TOKEN.');
  }

  // useFileOutput: false returns plain URLs instead of FileOutput/ReadableStream objects
  const replicate = new Replicate({ auth: REPLICATE_TOKEN, useFileOutput: false });

  // Convert buffer to a data URL for the Replicate API
  const base64 = imageBuffer.toString('base64');
  const dataUrl = `data:image/jpeg;base64,${base64}`;

  // Run retro-diffusion/rd-plus in img2img mode
  // strength 0.65 keeps likeness while pushing toward pixel art style
  const output = await replicate.run(
    'retro-diffusion/rd-plus' as `${string}/${string}`,
    {
      input: {
        input_image: dataUrl,
        prompt: 'pokemon trainer character portrait, pixel art sprite, full body, bold outlines, vibrant colors, game character',
        style: 'character_turnaround',
        strength: 0.65,
        width: 256,
        height: 256,
        num_images: 1,
        remove_bg: true,
      },
    }
  );

  // With useFileOutput: false, the SDK returns plain URL strings.
  // rd-plus returns an array of URLs (one per num_images).
  let imageUrl: string;

  if (typeof output === 'string') {
    imageUrl = output;
  } else if (Array.isArray(output) && output.length > 0) {
    imageUrl = String(output[0]);
  } else {
    console.error('Unexpected Replicate output:', typeof output, output);
    throw new Error(`Unexpected Replicate output format: ${JSON.stringify(output).slice(0, 200)}`);
  }

  // If it's already a data URL, return it directly
  if (imageUrl.startsWith('data:')) {
    return { image: imageUrl };
  }

  // Otherwise fetch the image from the URL and convert to base64.
  // Hardening: HTTPS-only, host allowlist, timeout, and response size limits.
  const parsedUrl = new URL(imageUrl);
  if (parsedUrl.protocol !== 'https:') {
    throw new Error('Generated image URL must use HTTPS');
  }

  if (!isAllowedReplicateOutputHost(parsedUrl.hostname)) {
    throw new Error(`Generated image host is not allowed: ${parsedUrl.hostname}`);
  }

  const timeoutController = new AbortController();
  const timeout = setTimeout(() => timeoutController.abort(), REPLICATE_IMAGE_FETCH_TIMEOUT_MS);

  let imageResponse: Response;
  try {
    imageResponse = await fetch(parsedUrl, { signal: timeoutController.signal });
  } finally {
    clearTimeout(timeout);
  }

  if (!imageResponse.ok) {
    throw new Error('Failed to download generated image from Replicate');
  }

  const contentType = imageResponse.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('image/')) {
    throw new Error('Replicate output was not an image');
  }

  const contentLengthHeader = imageResponse.headers.get('content-length');
  if (contentLengthHeader) {
    const contentLength = Number(contentLengthHeader);
    if (!Number.isNaN(contentLength) && contentLength > MAX_REPLICATE_IMAGE_SIZE) {
      throw new Error('Generated image exceeds size limit');
    }
  }

  const resultBuffer = Buffer.from(await imageResponse.arrayBuffer());
  if (resultBuffer.byteLength > MAX_REPLICATE_IMAGE_SIZE) {
    throw new Error('Generated image exceeds size limit');
  }

  const resultBase64 = `data:image/png;base64,${resultBuffer.toString('base64')}`;

  return { image: resultBase64 };
}

function isAllowedReplicateOutputHost(hostname: string): boolean {
  const normalizedHost = hostname.toLowerCase();
  return REPLICATE_OUTPUT_HOST_ALLOWLIST.some((allowedHost) => {
    if (allowedHost.startsWith('*.')) {
      const suffix = allowedHost.slice(1);
      return normalizedHost.endsWith(suffix);
    }
    return normalizedHost === allowedHost;
  });
}
