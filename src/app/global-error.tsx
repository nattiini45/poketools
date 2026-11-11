"use client";

import { useSyncExternalStore } from "react";

/**
 * Catches errors that occur in the root layout itself.
 * Must provide its own <html>/<body> since the root layout has crashed.
 *
 * It renders without providers (the I18nProvider may be what failed), so it
 * reads `plc_locale` from document.cookie and uses inline bilingual copy:
 * a sanctioned i18n exception (i18n-core §2.4, allowlisted in
 * scripts/i18n-allowlist.json). The hex colours stay, fixed to the sunlit tokens
 * of globals.css (--sunken #E8D9B5, --fg #241A0C, --fg-muted #5C4E37, --accent-fill #CF660B): the root CSS and the
 * theme may be gone when this renders, so the page is light sand in every theme, never dark. Contrast: ink on
 * ground 12.23:1, muted on ground 5.78:1, ink on the button 4.53:1.
 */

type GlobalErrorLocale = "en" | "de";

const COPY: Record<GlobalErrorLocale, { heading: string; fallback: string; retry: string; reference: string }> = {
  en: {
    heading: "Something went seriously wrong",
    fallback: "A critical error occurred.",
    retry: "Try again",
    reference: "Reference",
  },
  de: {
    heading: "Da ist etwas gründlich schiefgelaufen",
    fallback: "Ein schwerwiegender Fehler ist aufgetreten.",
    retry: "Erneut versuchen",
    reference: "Referenz",
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
      <body className="bg-[#E8D9B5] text-[#241A0C] font-sans antialiased">
        <div className="flex flex-col items-center justify-center min-h-screen gap-6 text-center px-4">
          <div className="text-5xl">💥</div>
          <div>
            <h2 className="text-xl font-bold mb-2">
              {copy.heading}
            </h2>
            <p className="text-sm text-[#5C4E37] max-w-md">
              {copy.fallback}
            </p>
            {error.digest ? (
              <p className="mt-2 text-xs text-[#5C4E37]">{copy.reference}: {error.digest}</p>
            ) : null}
          </div>
          <button
            onClick={() => reset()}
            className="px-4 py-2 rounded-lg bg-[#CF660B] text-[#241A0C] font-semibold text-sm hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#241A0C] transition-[filter]"
          >
            {copy.retry}
          </button>
        </div>
      </body>
    </html>
  );
}
