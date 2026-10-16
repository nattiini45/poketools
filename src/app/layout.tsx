import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import SessionProvider from "@/components/shared/SessionProvider";
import ThemeProvider from "@/components/shared/ThemeProvider";
import AppTooltipProvider from "@/components/ui/AppTooltipProvider";
import PwaRegistrar from "@/components/shared/PwaRegistrar";
import SitePaletteGuard from "@/components/shared/SitePaletteGuard";
import { SITE_PALETTE_PREPAINT_SCRIPT } from "@/lib/design/site-palette-script";
import { Analytics } from '@vercel/analytics/next';
import { I18nProvider } from "@/i18n/client";
import { getI18nProviderProps, getT } from "@/i18n/server";
import { metaMessages } from "@/i18n/messages/meta";
import { siteUrl } from "@/lib/site-url";

// Self-hosted (latin variable woff2 from Google Fonts) instead of
// next/font/google: that fetches font files from fonts.gstatic.com at build
// time, and Google rotating those files breaks cold-cache CI builds with
// 404s. Local files make the build hermetic.
const nunito = localFont({
  src: "./fonts/nunito-latin.woff2",
  variable: "--font-heading",
  display: "swap",
  weight: "200 1000",
});

const dmSans = localFont({
  src: "./fonts/dm-sans-latin.woff2",
  variable: "--font-body",
  display: "swap",
  weight: "100 1000",
});

// The root layout reads only the language cookies (i18n-core D6, §2.4), so
// every route renders dynamically by design. Never read the session here.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT(metaMessages);
  return {
    // Absolute base for canonical/OG URLs: the deployment's public origin.
    metadataBase: siteUrl(),
    title: "PokéTools",
    description: t("description"),
    applicationName: "PokéTools",
    manifest: "/manifest.webmanifest",
    formatDetection: {
      telephone: false,
    },
    appleWebApp: {
      capable: true,
      statusBarStyle: "default",
      title: t("appleTitle"),
    },
    icons: {
      icon: [
        { url: "/pwa/icon-192.png", sizes: "192x192", type: "image/png" },
        { url: "/pwa/icon-512.png", sizes: "512x512", type: "image/png" },
      ],
      apple: [{ url: "/pwa/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
    },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#E8D9B5" },
    { media: "(prefers-color-scheme: dark)", color: "#0E0B06" },
  ],
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const i18n = await getI18nProviderProps();
  return (
    <html lang={i18n.locale} suppressHydrationWarning>
      <head>
        {/* Site palette before first paint (docs/design.md § Site palettes).
            Static constant built from module constants — no user content. */}
        <script dangerouslySetInnerHTML={{ __html: SITE_PALETTE_PREPAINT_SCRIPT }} />
      </head>
      <body
        className={`${nunito.variable} ${dmSans.variable} font-body antialiased bg-poke-base text-poke-text-primary`}
      >
        <I18nProvider {...i18n}>
          <ThemeProvider>
            <SessionProvider>
              <AppTooltipProvider>
                {children}
                <PwaRegistrar />
                <SitePaletteGuard />
              </AppTooltipProvider>
            </SessionProvider>
          </ThemeProvider>
        </I18nProvider>
        <Analytics />
      </body>
    </html>
  );
}
