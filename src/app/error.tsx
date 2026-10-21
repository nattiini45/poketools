"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getButtonClasses } from "@/components/ui/buttonStyles";
import { useT } from "@/i18n/client";
import { shellMessages } from "@/i18n/messages/shell";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();
  const t = useT(shellMessages);

  useEffect(() => {
    console.error("[PokéTools] Unhandled error:", error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] gap-6 text-center">
      <div className="text-5xl">😵</div>
      <div>
        <h2 className="text-xl font-heading font-bold text-poke-text-primary mb-2">
          {t("errorPage.title")}
        </h2>
        <p className="text-sm text-poke-text-secondary max-w-md">
          {error.message || t("errorPage.fallback")}
        </p>
      </div>
      <div className="flex gap-3">
        <button
          onClick={() => reset()}
          className={getButtonClasses("primary", "sm")}
        >
          {t("errorPage.retry")}
        </button>
        <button
          onClick={() => router.back()}
          className={getButtonClasses("secondary", "sm")}
        >
          {t("errorPage.back")}
        </button>
      </div>
    </div>
  );
}
