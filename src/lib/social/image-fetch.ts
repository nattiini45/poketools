/**
 * Fetch a social image from a public URL as a Buffer.
 * Shared by X and Bluesky providers (both need to re-upload the image).
 */
export async function fetchImageAsBuffer(imageUrl: string): Promise<{
  buffer: Buffer;
  contentType: string;
}> {
  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch social image: ${response.status}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  const contentType = response.headers.get('content-type') || 'image/png';
  return { buffer: Buffer.from(arrayBuffer), contentType };
}
