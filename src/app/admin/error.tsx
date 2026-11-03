"use client";

import { useEffect } from "react";
import ErrorState from "@/components/shared/ErrorState";
import { useT } from "@/i18n/client";
import { adminCoreMessages } from "@/i18n/messages/admin-core";

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useT(adminCoreMessages);

  useEffect(() => {
    console.error("[Admin] Unhandled error:", error);
  }, [error]);

  // The raw message helps while developing; a production build (where it is Next's generic text or an
  // internal client message) shows the translated fallback only.
  return (
    <ErrorState
      title={t("error.title")}
      description={t("error.fallback")}
      retryLabel={t("error.tryAgain")}
      backLabel={t("error.goBack")}
      digest={error.digest}
      detail={process.env.NODE_ENV !== "production" ? error.message : undefined}
      onRetry={reset}
    />
  );
}
