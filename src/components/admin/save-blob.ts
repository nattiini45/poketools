/**
 * Hands a blob to the browser as a file download through a short-lived blob URL.
 */

/**
 * How long the blob URL stays valid after the click. Revoking it right away can cancel the download in some browsers,
 * which start reading the URL only after the click handler returned.
 */
export const BLOB_URL_REVOKE_DELAY_MS = 10_000;

/** Downloads `blob` as `fileName`. The blob URL is revoked after `BLOB_URL_REVOKE_DELAY_MS`, at once if the click throws. */
export function saveBlob(blob: Blob, fileName: string): void {
  const anchor = document.createElement('a');
  const url = URL.createObjectURL(blob);
  try {
    anchor.href = url;
    anchor.download = fileName;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
  } catch (err) {
    // No download started, so nothing can still need the URL.
    URL.revokeObjectURL(url);
    throw err;
  } finally {
    anchor.remove();
  }
  setTimeout(() => URL.revokeObjectURL(url), BLOB_URL_REVOKE_DELAY_MS);
}
