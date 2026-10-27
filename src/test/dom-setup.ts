/**
 * Setup for the DOM component tests (docs/dependencies.md, "DOM tests"). The suite runs in `node`; a test file that needs
 * a DOM opts in with a `@vitest-environment jsdom` docblock on its first lines. Testing Library unmounts what it rendered
 * after each test only when a global `afterEach` exists, and vitest exposes none, so this registers it. A node file has
 * no `document`, so it loads nothing from here.
 */
import { afterEach } from 'vitest';

if (typeof document !== 'undefined') {
  const { cleanup } = await import('@testing-library/react');
  afterEach(cleanup);
}
