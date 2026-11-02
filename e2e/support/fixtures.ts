/* eslint-disable react-hooks/rules-of-hooks -- Playwright passes each fixture a callback named `use`; it is not a React hook */
import { test as base, expect, type BrowserContext, type Page } from '@playwright/test';
import { assertNoBucketEgress, assetOriginSummary } from '../../scripts/lib/look-evidence.mjs';

/** React's hydration diagnostics: the dev messages, and the minified error codes a production build reports. */
const HYDRATION_PROBLEM =
  /hydration|did not match|text content does not match|Minified React error #(418|419|422|423|425)\b/i;

/** A 1x1 transparent PNG. */
const BLANK_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const isLocal = (rawUrl: string): boolean => {
  const { protocol, hostname } = new URL(rawUrl);
  return protocol === 'data:' || protocol === 'blob:' || protocol === 'about:' || LOCAL_HOSTS.has(hostname);
};

interface Watcher {
  /** Starts watching a page: page errors, hydration warnings and every request it makes. */
  watch(page: Page): void;
  /** Aborts every request of the context that leaves the machine; one to Supabase also fails the test. */
  guard(context: BrowserContext): Promise<void>;
  /** A fresh browser context (cookies of its own) whose pages are watched too. */
  newPage(): Promise<Page>;
}

/**
 * Every page of a test is watched, and the test fails when one of them throws an uncaught error, logs ANY console
 * error (no allowlist), logs a hydration warning, or reaches a host outside the machine. Requests to a host that is
 * not loopback never leave it (the suite is hermetic): images get a blank stand-in, anything else is aborted; one to
 * Supabase, or any request for a Storage bucket object, fails the test.
 */
export const test = base.extend<{ watcher: Watcher; page: Page; newPage: () => Promise<Page> }>({
  watcher: async ({ browser, baseURL }, use, testInfo) => {
    const problems: string[] = [];
    const requests: Array<{ url: string }> = [];
    const contexts: BrowserContext[] = [];

    const guard = async (context: BrowserContext) => {
      await context.route('**/*', (route) => {
        const url = route.request().url();
        if (isLocal(url)) return route.continue();
        if (/\.supabase\.(co|in)$/i.test(new URL(url).hostname)) {
          problems.push(`request to Supabase: ${url}`);
          return route.abort();
        }
        // Sprites that production serves from public CDNs (the CSP allows them) are answered locally with a blank
        // image: an aborted request would make the browser log a console error that says nothing about the app.
        if (route.request().resourceType() === 'image') {
          return route.fulfill({ status: 200, contentType: 'image/png', body: BLANK_PNG });
        }
        return route.abort();
      });
    };
    const watch = (page: Page) => {
      page.on('pageerror', (error) => problems.push(`uncaught page error: ${error.message}`));
      page.on('console', (message) => {
        const text = message.text();
        if (message.type() === 'error') {
          const where = message.location().url;
          problems.push(`console error: ${text.slice(0, 300)}${where ? ` (${where})` : ''}`);
        } else if (message.type() === 'warning' && HYDRATION_PROBLEM.test(text)) {
          problems.push(`hydration problem: ${text.slice(0, 300)}`);
        }
      });
      page.on('request', (request) => requests.push({ url: request.url() }));
    };

    await use({
      watch,
      guard,
      newPage: async () => {
        // A context made by hand does not inherit the project's `use` options, so the base URL is passed on here.
        const context = await browser.newContext({ baseURL, locale: 'en-US' });
        contexts.push(context);
        await guard(context);
        const page = await context.newPage();
        watch(page);
        return page;
      },
    });

    for (const context of contexts) await context.close();
    try {
      assertNoBucketEgress(assetOriginSummary(requests, new URL(testInfo.project.use.baseURL ?? 'http://localhost').origin));
    } catch (error) {
      problems.push(error instanceof Error ? error.message : String(error));
    }
    expect(problems, 'page errors, hydration warnings and forbidden requests').toEqual([]);
  },

  page: async ({ context, watcher }, use) => {
    const page = await context.newPage();
    // The default context is not created by `watcher.newPage`, so it needs the same route guard.
    await watcher.guard(context);
    watcher.watch(page);
    await use(page);
  },

  newPage: async ({ watcher }, use) => {
    await use(() => watcher.newPage());
  },
});

export { expect };
