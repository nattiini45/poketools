import type { XCredentials } from '@/types/social';
import { fetchImageAsBuffer } from '../image-fetch';

interface XPostResponse {
  data?: { id: string; text: string };
}

interface XMediaUploadResponse {
  media_id_string?: string;
}

async function uploadMedia(
  credentials: XCredentials,
  imageUrl: string,
): Promise<string> {
  const { buffer, contentType } = await fetchImageAsBuffer(imageUrl);

  const formData = new FormData();
  formData.append(
    'media',
    new Blob([new Uint8Array(buffer)], { type: contentType }),
    'social-image.png',
  );
  formData.append('media_category', 'tweet_image');

  const response = await fetch('https://upload.twitter.com/1.1/media/upload.json', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${credentials.access_token}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '(no body)');
    throw new Error(`[X] Media upload failed: ${response.status} ${body}`);
  }

  const parsed = (await response.json().catch(() => ({}))) as XMediaUploadResponse;
  if (!parsed.media_id_string) {
    throw new Error('[X] Media upload response missing media_id_string');
  }

  return parsed.media_id_string;
}

export async function postToX(
  credentials: XCredentials,
  text: string,
  imageUrl?: string,
): Promise<void> {
  const tweetBody: Record<string, unknown> = { text };

  if (imageUrl) {
    try {
      const mediaId = await uploadMedia(credentials, imageUrl);
      tweetBody.media = { media_ids: [mediaId] };
    } catch (err) {
      // Image upload failure should not prevent the text tweet
      console.error('[X] Image upload failed, posting text-only:', err);
    }
  }

  const response = await fetch('https://api.x.com/2/tweets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${credentials.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(tweetBody),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '(no body)');
    throw new Error(`[X] POST /2/tweets failed: ${response.status} ${body}`);
  }

  const parsed = (await response.json().catch(() => ({}))) as XPostResponse;
  if (!parsed.data?.id) {
    throw new Error('[X] Publish response missing post id');
  }
}
