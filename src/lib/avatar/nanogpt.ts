/**
 * NanoGPT text-to-image API client (server-side only).
 * Uses the OpenAI-compatible endpoint at nano-gpt.com.
 */

const NANOGPT_API_URL = 'https://nano-gpt.com/v1/images/generations';
const DEFAULT_MODEL = 'hidream';
const DEFAULT_SIZE = '1024x1024';

function getApiKey(): string {
  const key = process.env.NANOGPT_API_KEY;
  if (!key) throw new Error('Missing NANOGPT_API_KEY environment variable');
  return key;
}

interface NanoGptImageResponse {
  data: Array<{
    url?: string;
    b64_json?: string;
  }>;
}

export interface GenerateImageOptions {
  prompt: string;
  model?: string;
  size?: string;
}

/**
 * Generate an image via NanoGPT and return it as a base64 data URL.
 * The image is either returned directly as base64, or fetched from a temporary URL.
 */
export async function generateImage(options: GenerateImageOptions): Promise<string> {
  const { prompt, model = DEFAULT_MODEL, size = DEFAULT_SIZE } = options;

  const response = await fetch(NANOGPT_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${getApiKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      prompt,
      n: 1,
      size,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    throw new Error(`NanoGPT API error (${response.status}): ${errorText}`);
  }

  const result = (await response.json()) as NanoGptImageResponse;
  const imageData = result.data?.[0];

  if (!imageData) {
    throw new Error('NanoGPT returned no image data');
  }

  // If we got base64 directly, return it as a data URL
  if (imageData.b64_json) {
    return `data:image/png;base64,${imageData.b64_json}`;
  }

  // If we got a URL, fetch the image and convert to base64
  if (imageData.url) {
    // Harden: validate URL before fetching
    const parsed = new URL(imageData.url);
    const ALLOWED_HOSTS = ['nano-gpt.com', 'cdn.nano-gpt.com', 'replicate.delivery'];
    if (parsed.protocol !== 'https:') {
      throw new Error('Image URL must use HTTPS');
    }
    if (!ALLOWED_HOSTS.some((h) => parsed.hostname === h || parsed.hostname.endsWith('.' + h))) {
      throw new Error(`Image URL host not allowed: ${parsed.hostname}`);
    }

    const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const imgResponse = await fetch(imageData.url, { signal: controller.signal });
      if (!imgResponse.ok) {
        throw new Error(`Failed to fetch generated image from URL: ${imgResponse.status}`);
      }
      const contentLength = parseInt(imgResponse.headers.get('content-length') ?? '0', 10);
      if (contentLength > MAX_IMAGE_BYTES) {
        throw new Error(`Image too large: ${contentLength} bytes`);
      }
      const buffer = await imgResponse.arrayBuffer();
      if (buffer.byteLength > MAX_IMAGE_BYTES) {
        throw new Error(`Image too large: ${buffer.byteLength} bytes`);
      }
      const base64 = Buffer.from(buffer).toString('base64');
      return `data:image/png;base64,${base64}`;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error('NanoGPT response contained neither b64_json nor url');
}
