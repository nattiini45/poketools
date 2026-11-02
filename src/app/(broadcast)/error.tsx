"use client";

import { useEffect } from "react";
import { createErrorRetryTracker } from "@/lib/broadcast/error-retry";

const tracker = createErrorRetryTracker();

/**
 * An overlay that throws renders nothing and tries again on its own: it is a
 * browser source on a live stream, so no message (the raw one is English and may
 * name internals) and no button nobody can click. The background stays
 * transparent because the layout's <style> is outside this boundary.
 */
export default function BroadcastOverlayError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[Broadcast] Overlay error:", error);
    const timer = setTimeout(reset, tracker.nextDelayMs());
    return () => clearTimeout(timer);
  }, [error, reset]);

  return null;
}
