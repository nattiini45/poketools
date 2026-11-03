import type { Metadata } from 'next';
import { getT } from '@/i18n/server';
import { teamsLibraryMessages } from '@/i18n/messages/teams-library';
import LibraryClient from './LibraryClient';

/**
 * The index owns its title instead of a `layout.tsx` above `[id]`: Next hands a child segment only the title template
 * the segment above it resolved, and a layout with a plain string title resolves none, so the entry pages lost the
 * root template's brand suffix.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT(teamsLibraryMessages);
  return { title: t('library.title') };
}

export default function LibraryPage() {
  return <LibraryClient />;
}
