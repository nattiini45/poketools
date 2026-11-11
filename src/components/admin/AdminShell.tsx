'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { SidebarProvider } from '@/components/ui/fluid/sidebar';
import AdminCommandMenu from './AdminCommandMenu';
import AdminSidebar from './AdminSidebar';
import AdminTopBar from './AdminTopBar';
import { visibleAdminNav, type AdminNavExtraItem, type AdminRoles } from './adminNav';

/**
 * The admin shell (redesign A1): the sidebar, the top bar and the command menu around the page. The admin layout
 * renders it only for a live admin and hands it the live roles; `children` is the layout's `<main>`.
 */
export default function AdminShell({
  roles,
  extraItems,
  defaultSidebarOpen = true,
  children,
}: {
  roles: AdminRoles;
  /** Admin pages of the active pack extension (docs/format-packs.md), labels already localized. */
  extraItems?: readonly AdminNavExtraItem[];
  /** The desktop sidebar's remembered state (the `sidebar_state` cookie the sidebar writes). */
  defaultSidebarOpen?: boolean;
  children: ReactNode;
}) {
  const [commandOpen, setCommandOpen] = useState(false);
  const { isSiteAdmin, isSuperadmin, assistantEnabled = false } = roles;
  // The server sends fresh arrays on every render; the nav only changes when the roles or the extension pages do.
  const extraKey = JSON.stringify(extraItems ?? []);
  const groups = useMemo(
    () => visibleAdminNav({ isSiteAdmin, isSuperadmin, assistantEnabled }, JSON.parse(extraKey) as AdminNavExtraItem[]),
    [isSiteAdmin, isSuperadmin, assistantEnabled, extraKey],
  );
  const openCommand = () => setCommandOpen(true);

  return (
    <SidebarProvider defaultOpen={defaultSidebarOpen}>
      <AdminSidebar groups={groups} onOpenCommand={openCommand} />
      <div className="flex min-h-svh min-w-0 flex-1 flex-col">
        <AdminTopBar groups={groups} assistantEnabled={assistantEnabled} onOpenCommand={openCommand} />
        {children}
      </div>
      <AdminCommandMenu open={commandOpen} onOpenChange={setCommandOpen} groups={groups} assistantEnabled={assistantEnabled} />
    </SidebarProvider>
  );
}
