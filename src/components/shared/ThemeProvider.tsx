'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';

/** `nonce` is the request's CSP nonce (`x-nonce`, set by `src/proxy.ts`): next-themes writes an inline script that needs it. */
export default function ThemeProvider({ children, nonce }: { children: React.ReactNode; nonce?: string }) {
  return (
    <NextThemesProvider attribute="data-theme" defaultTheme="system" enableSystem nonce={nonce}>
      {children}
    </NextThemesProvider>
  );
}
