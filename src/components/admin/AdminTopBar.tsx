'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { MessageSquare, PanelLeft, Search } from 'lucide-react';
import NotificationBell from '@/components/notifications/NotificationBell';
import Button from '@/components/ui/Button';
import { useSidebar } from '@/components/ui/fluid/sidebar';
import { useT } from '@/i18n/client';
import { adminAssistantMessages } from '@/i18n/messages/admin-assistant';
import { shellMessages } from '@/i18n/messages/shell';
import AdminBreadcrumb from './AdminBreadcrumb';
import { refocusWhenReleased } from './refocus';
import type { VisibleAdminNavGroup } from './adminNav';
import { ASSISTANT_LAUNCHER_ATTR, openAdminAssistant } from './assistant/AssistantDrawer';

/**
 * The bar above every admin page: the sidebar toggle (the drawer's menu button on a phone), the breadcrumb, and on
 * the right the command-menu button, the assistant launcher and the notification bell.
 */
export default function AdminTopBar({
  groups,
  assistantEnabled,
  onOpenCommand,
}: {
  groups: readonly VisibleAdminNavGroup[];
  assistantEnabled: boolean;
  onOpenCommand: () => void;
}) {
  const t = useT(shellMessages);
  const ta = useT(adminAssistantMessages);
  const pathname = usePathname();
  const { toggleSidebar, open, openMobile, isMobile } = useSidebar();
  const expanded = isMobile ? openMobile : open;
  // The phone drawer closes on Escape or on its backdrop: focus goes back to the menu button that opened it.
  const menuButton = useRef<HTMLButtonElement>(null);
  const wasOpenMobile = useRef(false);
  useEffect(() => {
    const closed = wasOpenMobile.current && !openMobile;
    wasOpenMobile.current = openMobile;
    if (closed) return refocusWhenReleased(menuButton.current);
  }, [openMobile]);
  const toggleLabel = isMobile ? t('admin.sidebar.openMenu') : expanded ? t('admin.sidebar.collapse') : t('admin.sidebar.expand');

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-hairline bg-page px-3 sm:px-5">
      <Button ref={menuButton} variant="ghost" size="sm" onClick={toggleSidebar} aria-label={toggleLabel} aria-expanded={expanded} title={toggleLabel} className="max-md:h-11 max-md:w-11">
        <PanelLeft className="h-4 w-4" aria-hidden="true" />
      </Button>
      <AdminBreadcrumb groups={groups} />
      <span className="flex-1" />
      <Button variant="ghost" size="sm" onClick={onOpenCommand} aria-label={t('admin.command.trigger')} title={t('admin.command.trigger')} className="max-md:h-11 max-md:w-11">
        <Search className="h-4 w-4" aria-hidden="true" />
      </Button>
      {/* The full page has everything the drawer has, so the launcher leaves with the drawer there. */}
      {assistantEnabled && !pathname?.startsWith('/admin/assistant') && (
        <Button
          variant="ghost"
          size="sm"
          onClick={openAdminAssistant}
          aria-label={ta('drawer.open')}
          title={ta('drawer.shortcutHint')}
          className="max-md:h-11 max-md:w-11"
          {...{ [ASSISTANT_LAUNCHER_ATTR]: '' }}
        >
          <MessageSquare className="h-4 w-4" aria-hidden="true" />
          <span className="hidden lg:inline">{ta('name')}</span>
        </Button>
      )}
      <NotificationBell />
    </header>
  );
}
