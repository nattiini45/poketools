import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import ThemeProvider from '../ThemeProvider';

describe('ThemeProvider (#37)', () => {
  it('puts the request nonce on the next-themes inline script', () => {
    const html = renderToStaticMarkup(<ThemeProvider nonce="abc123==">x</ThemeProvider>);
    const script = /<script[^>]*>/.exec(html)?.[0] ?? '';
    expect(script).toContain('nonce="abc123=="');
  });

  it('renders the script without a nonce when the proxy did not run', () => {
    const html = renderToStaticMarkup(<ThemeProvider>x</ThemeProvider>);
    expect(/<script[^>]*>/.exec(html)?.[0] ?? '').not.toContain('nonce');
  });
});
