"use client";

import { useSyncExternalStore } from "react";

/**
 * Catches errors that occur in the root layout itself.
 * Must provide its own <html>/<body> since the root layout has crashed.
 *
 * It renders without providers (the I18nProvider may be what failed), so it
 * reads `plc_locale` from document.cookie and uses inline bilingual copy:
 * a sanctioned i18n exception (i18n-core §2.4, allowlisted in
 * scripts/i18n-allowlist.json). The hex colours stay: the root CSS may be
 * gone when this renders, and the page is a full-screen error, not a slab.
 */

type GlobalErrorLocale = "en" | "de";

const COPY: Record<GlobalErrorLocale, { heading: string; fallback: string; retry: string }> = {
  en: {
    heading: "Something went seriously wrong",
    fallback: "A critical error occurred.",
    retry: "Try again",
  },
  de: {
    heading: "Da ist etwas gründlich schiefgelaufen",
    fallback: "Ein schwerwiegender Fehler ist aufgetreten.",
    retry: "Erneut versuchen",
  },
};

const noopSubscribe = () => () => {};

function readCookieLocale(cookie: string): GlobalErrorLocale {
  for (const part of cookie.split(";")) {
    const eq = part.indexOf("=");
    if (eq >= 0 && part.slice(0, eq).trim() === "plc_locale") {
      return part.slice(eq + 1).trim() === "de" ? "de" : "en";
    }
  }
  return "en";
}

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const locale = useSyncExternalStore(
    noopSubscribe,
    () => readCookieLocale(document.cookie),
    () => "en" as GlobalErrorLocale,
  );
  const copy = COPY[locale];
  return (
    <html lang={locale}>
      <body className="bg-[#0E0B06] text-[#F5EDDD] font-sans antialiased">
        <div className="flex flex-col items-center justify-center min-h-screen gap-6 text-center px-4">
          <div className="text-5xl">💥</div>
          <div>
            <h2 className="text-xl font-bold mb-2">
              {copy.heading}
            </h2>
            <p className="text-sm text-[#C4B596] max-w-md">
              {error.message || copy.fallback}
            </p>
          </div>
          <button
            onClick={() => reset()}
            className="px-4 py-2 rounded-lg bg-[#C05E0A] text-[#FFF8E9] font-semibold text-sm hover:bg-[#8F4206] transition-colors"
          >
            {copy.retry}
          </button>
        </div>
      </body>
    </html>
  );
}
