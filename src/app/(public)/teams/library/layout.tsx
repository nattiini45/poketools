import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { getT } from '@/i18n/server';
import { teamsLibraryMessages } from '@/i18n/messages/teams-library';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT(teamsLibraryMessages);
  return { title: t('library.title') };
}

export default function TeamLibraryLayout({ children }: { children: ReactNode }) {
  return children;
}