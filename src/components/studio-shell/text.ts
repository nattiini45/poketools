'use client';

import { useCallback } from 'react';
import { useT } from '@/i18n/client';
import { createTranslator } from '@/i18n/core';
import type { Locale } from '@/i18n/config';
import type { Leaves, MessageTree, Namespace } from '@/i18n/types';

/**
 * The words of the studio shell (toolbar, dialogs, save banners). The shell has no namespace of its own: each studio
 * keeps the same keys in its own editor namespace (`format-studio/editor`, `ruleset-studio/editor`) with its own
 * nouns, because German noun gender and case make a `{noun}` placeholder impossible ("Zurück zu Regelwerken" against
 * "Zurück zu Formaten"). A studio passes its namespace to `useShellText`; a namespace that lacks one of these keys does
 * not compile (`ShellNamespace`).
 */
export const SHELL_KEYS = [
  'toolbar.back',
  'toolbar.readOnly',
  'toolbar.actions',
  'toolbar.save',
  'toolbar.saving',
  'toolbar.saved',
  'toolbar.savedAt',
  'toolbar.unsaved',
  'toolbar.conflict',
  'toolbar.publish',
  'toolbar.share',
  'toolbar.fork',
  'toolbar.delete',
  'toolbar.visibility.private',
  'toolbar.visibility.league',
  'toolbar.visibility.gallery',
  'toolbar.version',
  'toolbar.draftOnly',
  'toolbar.noIssues',
  'toolbar.issues.errors',
  'toolbar.issues.warnings',
  'toolbar.issues.notes',
  'save.cancel',
  'save.failed',
  'save.retry',
  'save.guardConfirm',
  'save.conflictTitle',
  'save.conflictBody',
  'save.reload',
  'save.reloadConfirm',
  'save.reloadDiscard',
  'save.keepMine',
  'publish.title',
  'publish.doneTitle',
  'publish.creates',
  'publish.blocked',
  'publish.nothingNew',
  'publish.changelog',
  'publish.changelogEn',
  'publish.changelogDe',
  'publish.savesFirst',
  'publish.confirm',
  'publish.done',
  'publish.openReadOnly',
  'publish.shareHint',
  'publish.close',
  'share.title',
  'share.private',
  'share.privateHelp',
  'share.league',
  'share.leagueHelp',
  'share.gallery',
  'share.galleryHelp',
  'share.needPublish',
  'share.siteAdminOnly',
  'share.galleryOwned',
  'share.apply',
  'fork.title',
  'fork.body',
  'fork.confirm',
  'delete.title',
  'delete.body',
  'delete.confirm',
] as const;

export type ShellKey = (typeof SHELL_KEYS)[number];

/** Placeholder values of a shell message (`{n}`, `{count}`, `{time}`, `{rev}`). */
export type ShellParams = Readonly<Record<string, string | number>>;

/** Translates a shell key in the studio's own words. */
export type ShellText = (key: ShellKey, params?: ShellParams) => string;

/** A namespace that has every shell key; anything else is `never`, so passing it is a type error. */
export type ShellNamespace<E extends MessageTree> = Namespace<E> & (ShellKey extends Leaves<E> ? unknown : never);

/** The shell text of a studio, for a component. */
export function useShellText<E extends MessageTree>(ns: ShellNamespace<E>): ShellText {
  const t = useT<E>(ns);
  return useCallback<ShellText>((key, params) => t.dynamic(key, params), [t]);
}

/** The shell text of a studio in a fixed language, outside a component (tests, server output). */
export function createShellText<E extends MessageTree>(ns: ShellNamespace<E>, locale: Locale): ShellText {
  const t = createTranslator<E>(ns, locale);
  return (key, params) => t.dynamic(key, params);
}
