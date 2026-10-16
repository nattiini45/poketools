/**
 * Pokepaste publishing agent tool (PRD §5): `createPokepaste`.
 *
 * POSTs a Showdown-format team export to https://pokepast.es/create as
 * URL-encoded form data, follows the 303 redirect manually to capture the
 * created paste's URL, and returns it. No API key required. 10s timeout.
 */
import type { CreatePokepasteInput } from './schemas';

const POKEPASTE_BASE = 'https://pokepast.es';
const CREATE_URL = `${POKEPASTE_BASE}/create`;
const TIMEOUT_MS = 10_000;

export interface CreatePokepasteResult {
  url: string;
}

export async function createPokepaste(
  input: CreatePokepasteInput,
): Promise<CreatePokepasteResult> {
  const form = new URLSearchParams();
  form.set('paste', input.paste);
  if (input.title) form.set('title', input.title);
  if (input.author) form.set('author', input.author);
  if (input.notes) form.set('notes', input.notes);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(CREATE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      redirect: 'manual', // capture the 303 Location instead of following it
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  // On success pokepaste replies 303 See Other with the new paste in Location.
  // Only trust a Location header on a real redirect status — a 200 page that
  // happens to carry a Location is not a created paste.
  const isRedirect = response.status >= 300 && response.status < 400;
  const location = response.headers.get('location');
  if (!isRedirect || !location) {
    throw new Error(`Pokepaste did not return a paste URL (status ${response.status})`);
  }

  // Location may be absolute or a site-relative path ("/abc123").
  const url = new URL(location, POKEPASTE_BASE).toString();
  return { url };
}
