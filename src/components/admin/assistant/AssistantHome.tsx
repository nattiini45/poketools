'use client';

import { useRouter } from 'next/navigation';
import ConversationBrowser from './ConversationBrowser';

/** The body of `/admin/assistant`: the conversation list; a new conversation opens on its own page. */
export default function AssistantHome() {
  const router = useRouter();
  const open = (id: string) => router.push(`/admin/assistant/${id}`);
  return <ConversationBrowser hrefFor={(id) => `/admin/assistant/${id}`} onCreated={open} seed={{ area: 'admin' }} />;
}
