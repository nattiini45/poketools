'use client';

import { useEffect, useSyncExternalStore } from 'react';

/**
 * Names for the breadcrumb's `named` steps (one league, format, match …). The shell's breadcrumb lives in the admin
 * layout, which never sees a page's data, so the page that has the name mounts `<AdminCrumbName>` and the breadcrumb
 * reads it from here. Without one the step shows its generic label ("League").
 */
const names = new Map<string, string>();
const listeners = new Set<() => void>();
let version = 0;

function emit() {
  version += 1;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The name a page gave the step at `href`, or undefined. */
export function useAdminCrumbName(href: string): string | undefined {
  useSyncExternalStore(
    subscribe,
    () => version,
    () => 0,
  );
  return names.get(href);
}

/** Names the breadcrumb step at `href` (an admin path such as `/admin/leagues/<id>`) while the page is mounted. */
export default function AdminCrumbName({ href, name }: { href: string; name: string }) {
  useEffect(() => {
    names.set(href, name);
    emit();
    return () => {
      if (names.get(href) === name) {
        names.delete(href);
        emit();
      }
    };
  }, [href, name]);
  return null;
}
