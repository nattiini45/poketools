import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import localFont from "next/font/local";
import "./globals.css";
import "./frozen-pins.css";
import "./frozen-scale.css";
import SessionProvider from "@/components/shared/SessionProvider";
import ThemeProvider from "@/components/shared/ThemeProvider";
import AppTooltipProvider from "@/components/ui/AppTooltipProvider";
import MotionProvider from "@/components/shared/MotionProvider";
import SiteExtras from "@/components/shared/SiteExtras";
import { SITE_PALETTE_PREPAINT_SCRIPT } from "@/lib/design/site-palette-script";
import { isVercelDeployment } from "@/lib/vercel-deployment";
import { I18nProvider } from "@/i18n/client";
import { getI18nProviderProps, getT } from "@/i18n/server";
import { metaMessages } from "@/i18n/messages/meta";
import { siteUrl } from "@/lib/site-url";
import { SpriteStyleProvider } from "@/components/shared/SpriteStyleProvider";
import SpriteStyleAccountSync from "@/components/shared/SpriteStyleAccountSync";
import { getSpriteStylePreference } from "@/lib/pkmn/sprite-style.server";

// Self-hosted (latin variable woff2 from Google Fonts) instead of
// next/font/google: that fetches font files from fonts.gstatic.com at build
// time, and Google rotating those files breaks cold-cache CI builds with
// 404s. Local files make the build hermetic.
const nunito = localFont({
  src: "./fonts/nunito-latin.woff2",
  variable: "--font-nunito",
  display: "swap",
  weight: "200 1000",
});

const dmSans = localFont({
  src: "./fonts/dm-sans-latin.woff2",
  variable: "--font-dm-sans",
  display: "swap",
  weight: "100 1000",
});

// Direction B (redesign F3): Geist Pixel Square for display and title text, Geist Sans for everything else,
// Geist Mono for number columns (OFL, src/app/fonts/OFL-Geist.txt). Nunito and DM Sans stay loaded for the
// frozen surfaces, which keep them (globals.css, "Fonts").
const geistPixel = localFont({
  src: "./fonts/geist-pixel-square.woff2",
  variable: "--font-geist-pixel",
  display: "swap",
  weight: "400",
});

const geist = localFont({
  src: "./fonts/geist-variable.woff2",
  variable: "--font-geist",
  display: "swap",
  weight: "100 900",
});

const geistMono = localFont({
  src: "./fonts/geist-mono-variable.woff2",
  variable: "--font-geist-mono",
  display: "swap",
  weight: "100 900",
});

// The root layout reads only the language cookies (i18n-core D6, §2.4) and the
// sprite-style cookie (docs/pkmn.md, "Sprite styles"), so every route renders
// dynamically by design. Never read the session here. The only request header it reads is the
// nonce that src/proxy.ts sets (the CSP nonce for the two inline scripts below), nothing about the viewer.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT(metaMessages);
  return {
    // Absolute base for canonical/OG URLs: the deployment's public origin.
    metadataBase: siteUrl(),
    title: { default: t("title"), template: t("titleTemplate") },
    description: t("description"),
    applicationName: "PokéTools",
    openGraph: { siteName: t("title"), type: "website" },
    twitter: { card: "summary" },
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
  const [i18n, spriteStyle, requestHeaders] = await Promise.all([getI18nProviderProps(), getSpriteStylePreference(), headers()]);
  const nonce = requestHeaders.get("x-nonce") ?? undefined;
  return (
    <html lang={i18n.locale} suppressHydrationWarning>
      <head>
        {/* Site palette before first paint (docs/design.md § Site palettes).
            Static constant built from module constants — no user content. */}
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: SITE_PALETTE_PREPAINT_SCRIPT }} />
      </head>
      <body
        className={`${nunito.variable} ${dmSans.variable} ${geistPixel.variable} ${geist.variable} ${geistMono.variable} font-body antialiased bg-poke-base text-poke-text-primary`}
      >
        <I18nProvider {...i18n}>
          <ThemeProvider nonce={nonce}>
            <SessionProvider>
              <SpriteStyleProvider initialPreference={spriteStyle}>
                <SpriteStyleAccountSync />
                <AppTooltipProvider>
                  <MotionProvider>
                    {children}
                    <SiteExtras analytics={isVercelDeployment()} />
                  </MotionProvider>
                </AppTooltipProvider>
              </SpriteStyleProvider>
            </SessionProvider>
          </ThemeProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
