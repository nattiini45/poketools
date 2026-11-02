"use client";

import { useEffect } from "react";
import ErrorState from "@/components/shared/ErrorState";
import { useT } from "@/i18n/client";
import { shellMessages } from "@/i18n/messages/shell";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useT(shellMessages);

  useEffect(() => {
    console.error("[PokéTools] Unhandled error:", error);
  }, [error]);

  // The raw error message is logged, not shown: it is English (or, in
  // production, Next's generic digest text) whatever the viewer's language.
  return (
    <ErrorState
      title={t("errorPage.title")}
      description={t("errorPage.fallback")}
      retryLabel={t("errorPage.retry")}
      backLabel={t("errorPage.back")}
      digest={error.digest}
      onRetry={reset}
    />
  );
}
