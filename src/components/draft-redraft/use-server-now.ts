'use client';

import { useEffect, useState } from 'react';

/**
 * The server clock (`Date.now() + offsetMs`), re-read every `intervalMs`.
 * null until mounted, so the server render and hydration never print a
 * countdown that differs from the client's.
 */
export function useServerNow(offsetMs: number, intervalMs = 1000): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const read = () => setNow(Date.now() + offsetMs);
    read();
    const id = setInterval(read, intervalMs);
    return () => clearInterval(id);
  }, [offsetMs, intervalMs]);
  return now;
}
