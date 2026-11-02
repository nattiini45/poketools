"use client";

import { useEffect } from "react";
import ErrorState from "@/components/shared/ErrorState";
import { useT } from "@/i18n/client";
import { tournamentsMessages } from "@/i18n/messages/tournaments";

export default function TournamentError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useT(tournamentsMessages);

  useEffect(() => {
    console.error("[Tournament] Unhandled error:", error);
  }, [error]);

  // The raw error message is logged, not shown: it is English (or, in
  // production, Next's generic digest text) whatever the viewer's language.
  return (
    <ErrorState
      title={t("error.title")}
      description={t("error.fallback")}
      retryLabel={t("error.retry")}
      backLabel={t("error.back")}
      digest={error.digest}
      onRetry={reset}
    />
  );
}
