'use client';

import { useEffect, useMemo, useRef } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useWorldState } from '../WorldStateProvider';
import { focusStore, useFocusRegistryVersion, useFocusState } from './focus-store';
import { DEFAULT_FOCUS_VOCABULARY } from '@/lib/route-world/focus';
import { INITIAL_URL_SYNC, storeToUrl, urlToStore, type UrlSyncState } from './url-sync';

/**
 * Keeps the focus store and the panel search params in step (ADR-0003).
 *
 * Store → URL: focusing a subject with a panel writes its theme-declared
 * search param (plaza: `?team=` / `?mon=` / `?board=` / `?rules=`), which
 * opens the existing docked overlay; releasing clears the param we wrote.
 * URL → store: a deep link or a panel that closed itself (close button)
 * focuses or releases the matching subject.
 *
 * `sync` remembers the panel we last wrote and whether the URL has been seen
 * carrying it, which is what tells an external close apart from our own
 * write that has not landed yet — and (review r5) every panel we wrote
 * that must still leave the URL, so a cross-tap closed before B's write
 * landed can never be re-read as a deep link that focuses B again. The
 * decisions are pure (`url-sync.ts`, tested).
 *
 * Route tier only — Lite keeps its modal dialogs and never touches the store.
 * Uses `useSearchParams`, so the consumer wraps it in `<Suspense>`.
 */
export default function FocusUrlSync() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { tier, theme } = useWorldState();
  // Panel vocabulary comes from the theme; DOM-only worlds (no theme) keep
  // the pre-theme default list so deep links behave exactly as before.
  const panelParams = useMemo(
    () => theme?.focusVocabulary.panelParams ?? DEFAULT_FOCUS_VOCABULARY.panelParams,
    [theme],
  );
  const focus = useFocusState();
  const registryVersion = useFocusRegistryVersion();
  const sync = useRef<UrlSyncState>(INITIAL_URL_SYNC);

  const live = focus.phase === 'focusing' || focus.phase === 'focused';
  const panel = focus.subject?.panel ?? null;

  // Store → URL.
  useEffect(() => {
    if (tier !== 'route') return;
    const params = new URLSearchParams(searchParams.toString());
    const result = storeToUrl({ live, panel, params, panelParams, sync: sync.current });
    sync.current = result.sync;
    if (result.write !== null) {
      router.replace(result.write ? `${pathname}?${result.write}` : pathname, { scroll: false });
    }
  }, [tier, live, panel, panelParams, searchParams, pathname, router]);

  // URL → store.
  useEffect(() => {
    if (tier !== 'route') return;
    const params = new URLSearchParams(searchParams.toString());
    const result = urlToStore({
      live,
      panel,
      params,
      panelParams,
      sync: sync.current,
      hasSubject: (incoming) => focusStore.findByPanel(incoming.param, incoming.value) !== null,
    });
    sync.current = result.sync;
    if (result.action?.kind === 'focus') {
      const subject = focusStore.findByPanel(result.action.panel.param, result.action.panel.value);
      if (subject) focusStore.focus(subject);
    } else if (result.action?.kind === 'release') {
      focusStore.release();
    }
    // registryVersion: a deep link waits for its subject to register.
  }, [tier, live, panel, panelParams, searchParams, registryVersion]);

  return null;
}
