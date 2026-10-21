import type { SocialCredentials, SocialProvider } from '@/types/social';
import { postToX } from './x';
import { postToThreads } from './threads';
import { postToBluesky } from './bluesky';

export async function publishToProvider(
  provider: SocialProvider,
  credentials: SocialCredentials,
  text: string,
  imageUrl?: string,
): Promise<void> {
  if (credentials.provider !== provider) {
    throw new Error(`Credentials provider mismatch: expected ${provider}, got ${credentials.provider}`);
  }

  if (credentials.provider === 'x') {
    await postToX(credentials, text, imageUrl);
    return;
  }

  if (credentials.provider === 'threads') {
    await postToThreads(credentials, text, imageUrl);
    return;
  }

  await postToBluesky(credentials, text, imageUrl);
}
