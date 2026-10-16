import type { ThreadsCredentials } from '@/types/social';

interface ThreadsCreateResponse {
  id?: string;
}

interface ThreadsPublishResponse {
  id?: string;
}

function getThreadsBaseUrl(): string {
  return 'https://graph.threads.net/v1.0';
}

export async function postToThreads(
  credentials: ThreadsCredentials,
  text: string,
  imageUrl?: string,
): Promise<void> {
  const baseUrl = getThreadsBaseUrl();

  const createParams = new URLSearchParams({
    media_type: imageUrl ? 'IMAGE' : 'TEXT',
    text,
    access_token: credentials.access_token,
  });

  if (imageUrl) {
    createParams.set('image_url', imageUrl);
  }

  const createResponse = await fetch(
    `${baseUrl}/${credentials.user_id}/threads?${createParams.toString()}`,
    { method: 'POST' },
  );
  if (!createResponse.ok) {
    const body = await createResponse.text().catch(() => '(no body)');
    throw new Error(`[Threads] Create post failed: ${createResponse.status} ${body}`);
  }

  const created = (await createResponse.json().catch(() => ({}))) as ThreadsCreateResponse;
  if (!created.id) {
    throw new Error('[Threads] Create post response missing creation id');
  }

  const publishParams = new URLSearchParams({
    creation_id: created.id,
    access_token: credentials.access_token,
  });
  const publishResponse = await fetch(
    `${baseUrl}/${credentials.user_id}/threads_publish?${publishParams.toString()}`,
    { method: 'POST' },
  );
  if (!publishResponse.ok) {
    const body = await publishResponse.text().catch(() => '(no body)');
    throw new Error(`[Threads] Publish post failed: ${publishResponse.status} ${body}`);
  }

  const published = (await publishResponse.json().catch(() => ({}))) as ThreadsPublishResponse;
  if (!published.id) {
    throw new Error('[Threads] Publish response missing post id');
  }
}
