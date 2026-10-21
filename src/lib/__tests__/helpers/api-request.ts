import { vi } from 'vitest';
import type { NextRequest } from 'next/server';

/**
 * Build a mock NextRequest for API route tests.
 *
 * @param body - JSON body (for POST/PATCH/PUT). Omit for GET requests.
 * @param searchParams - Query parameters (for GET requests).
 */
export function makeRequest(
  body?: Record<string, unknown>,
  searchParams?: Record<string, string>
): NextRequest {
  const url = new URL('http://localhost:3000/api/test');
  if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      url.searchParams.set(key, value);
    }
  }

  const headers = new Headers();
  headers.set('x-forwarded-for', '127.0.0.1');

  return {
    json: body !== undefined ? vi.fn().mockResolvedValue(body) : vi.fn(),
    url: url.toString(),
    nextUrl: url,
    headers,
  } as unknown as NextRequest;
}

/**
 * Wrap route params in a Promise (Next.js 16 async params pattern).
 *
 * Usage:
 *   const response = await GET(request, { params: makeParams({ id: '123' }) });
 */
export function makeParams<T extends Record<string, string>>(
  obj: T
): Promise<T> {
  return Promise.resolve(obj);
}
