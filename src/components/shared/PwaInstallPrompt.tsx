'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { useT } from '@/i18n/client';
import { shellMessages } from '@/i18n/messages/shell';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

interface PwaInstallPromptProps {
  className?: string;
}

const PWA_ENABLED = process.env.NEXT_PUBLIC_PWA_ENABLED === 'true';
const subscribe = () => () => {};

function getShowIosGuideSnapshot() {
  if (typeof window === 'undefined' || !PWA_ENABLED) {
    return false;
  }

  const userAgent = window.navigator.userAgent.toLowerCase();
  const isIos = /iphone|ipad|ipod/.test(userAgent);
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true;

  return isIos && !isStandalone;
}

export default function PwaInstallPrompt({ className = '' }: PwaInstallPromptProps) {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const showIosGuide = useSyncExternalStore(subscribe, getShowIosGuideSnapshot, () => false);
  const t = useT(shellMessages);

  useEffect(() => {
    if (typeof window === 'undefined' || !PWA_ENABLED) {
      return;
    }

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    };
  }, []);

  if (!PWA_ENABLED) {
    return null;
  }

  const onInstallClick = async () => {
    if (!deferredPrompt) {
      return;
    }

    await deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
  };

  if (deferredPrompt) {
    return (
      <button
        onClick={() => void onInstallClick()}
        className={`w-full rounded-poke-lg bg-poke-accent px-4 py-2 text-sm font-heading font-semibold text-poke-surface transition-opacity hover:opacity-90 ${className}`}
      >
        {t('pwa.install')}
      </button>
    );
  }

  if (showIosGuide) {
    return (
      <p className={`text-xs text-poke-text-muted ${className}`}>
        {t('pwa.iosHint')}
      </p>
    );
  }

  return null;
}
