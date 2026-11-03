"use client";

import { useEffect } from "react";
import ErrorState from "@/components/shared/ErrorState";
import { useT } from "@/i18n/client";
import { commonMessages } from "@/i18n/messages/common";
import { leaguesMessages } from "@/i18n/messages/leagues";

export default function LeagueError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useT(leaguesMessages);
  const common = useT(commonMessages);

  useEffect(() => {
    console.error("[League] Unhandled error:", error);
  }, [error]);

  // The raw error message is logged, not shown: it is English (or, in
  // production, Next's generic digest text) whatever the viewer's language.
  return (
    <ErrorState
      title={t("error.title")}
      description={t("error.description")}
      retryLabel={common("actions.retry")}
      backLabel={t("error.goBack")}
      digest={error.digest}
      onRetry={reset}
    />
  );
}
