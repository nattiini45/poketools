"use client";

import { useEffect } from "react";
import ErrorState from "@/components/shared/ErrorState";
import { useT } from "@/i18n/client";
import { creatorMessages } from "@/i18n/messages/creator";

export default function BroadcastError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useT(creatorMessages);

  useEffect(() => {
    console.error("[Broadcast] Unhandled error:", error);
  }, [error]);

  // The raw error message is logged, not shown: it is English (or, in
  // production, Next's generic digest text) whatever the viewer's language.
  return (
    <ErrorState
      title={t("broadcastError.title")}
      description={t("broadcastError.fallback")}
      retryLabel={t("broadcastError.tryAgain")}
      backLabel={t("broadcastError.goBack")}
      digest={error.digest}
      onRetry={reset}
    />
  );
}
