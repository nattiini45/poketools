import type { BlueskyCredentials } from '@/types/social';
import { fetchImageAsBuffer } from '../image-fetch';

interface BlueskySessionResponse {
  did?: string;
  accessJwt?: string;
}

interface BlueskyCreateRecordResponse {
  uri?: string;
}

interface BlueskyUploadBlobResponse {
  blob?: {
    $type: string;
    ref: { $link: string };
    mimeType: string;
    size: number;
  };
}

function normalizeServiceUrl(value?: string): string {
  if (!value) return 'https://bsky.social';
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

export async function postToBluesky(
  credentials: BlueskyCredentials,
  text: string,
  imageUrl?: string,
): Promise<void> {
  const serviceUrl = normalizeServiceUrl(credentials.service_url);

  // Create session
  const sessionResponse = await fetch(`${serviceUrl}/xrpc/com.atproto.server.createSession`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      identifier: credentials.handle,
      password: credentials.app_password,
    }),
  });

  if (!sessionResponse.ok) {
    const body = await sessionResponse.text().catch(() => '(no body)');
    throw new Error(`[Bluesky] Session creation failed: ${sessionResponse.status} ${body}`);
  }

  const session = (await sessionResponse.json().catch(() => ({}))) as BlueskySessionResponse;
  if (!session.did || !session.accessJwt) {
    throw new Error('[Bluesky] Session response missing did/accessJwt');
  }

  // Upload image blob if provided
  let embed: Record<string, unknown> | undefined;
  if (imageUrl) {
    try {
      const { buffer, contentType } = await fetchImageAsBuffer(imageUrl);

      const blobResponse = await fetch(`${serviceUrl}/xrpc/com.atproto.repo.uploadBlob`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.accessJwt}`,
          'Content-Type': contentType,
        },
        body: new Uint8Array(buffer),
      });

      if (!blobResponse.ok) {
        const body = await blobResponse.text().catch(() => '(no body)');
        throw new Error(`[Bluesky] uploadBlob failed: ${blobResponse.status} ${body}`);
      }

      const uploaded = (await blobResponse.json().catch(() => ({}))) as BlueskyUploadBlobResponse;
      if (uploaded.blob) {
        embed = {
          $type: 'app.bsky.embed.images',
          images: [{
            alt: text.substring(0, 200),
            image: uploaded.blob,
          }],
        };
      }
    } catch (err) {
      // Image upload failure should not prevent the text post
      console.error('[Bluesky] Image upload failed, posting text-only:', err);
    }
  }

  // Create post record
  const record: Record<string, unknown> = {
    $type: 'app.bsky.feed.post',
    text,
    createdAt: new Date().toISOString(),
  };
  if (embed) {
    record.embed = embed;
  }

  const recordResponse = await fetch(`${serviceUrl}/xrpc/com.atproto.repo.createRecord`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.accessJwt}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      repo: session.did,
      collection: 'app.bsky.feed.post',
      record,
    }),
  });

  if (!recordResponse.ok) {
    const body = await recordResponse.text().catch(() => '(no body)');
    throw new Error(`[Bluesky] createRecord failed: ${recordResponse.status} ${body}`);
  }

  const created = (await recordResponse.json().catch(() => ({}))) as BlueskyCreateRecordResponse;
  if (!created.uri) {
    throw new Error('[Bluesky] createRecord response missing uri');
  }
}
