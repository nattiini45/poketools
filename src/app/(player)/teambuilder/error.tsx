"use client";

import { useEffect } from "react";
import ErrorState from "@/components/shared/ErrorState";
import { useT } from "@/i18n/client";
import { teambuilderMessages } from "@/i18n/messages/teambuilder";

export default function TeambuilderError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useT(teambuilderMessages);

  useEffect(() => {
    console.error("[Teambuilder] Unhandled error:", error);
  }, [error]);

  // The raw error message is logged, not shown: it is English (or, in
  // production, Next's generic digest text) whatever the viewer's language.
  return (
    <ErrorState
      title={t("page.errorTitle")}
      description={t("page.errorFallback")}
      retryLabel={t("page.tryAgain")}
      backLabel={t("page.goBack")}
      digest={error.digest}
      onRetry={reset}
    />
  );
}
