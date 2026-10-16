'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Badge from '@/components/ui/Badge';
import { FOCUS_RING } from '@/components/ui/panel';
import { useT } from '@/i18n/client';
import { shellMessages } from '@/i18n/messages/shell';
import { visibleAdminNav, type AdminRoles } from './adminNav';

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Admin workflow rail: grouped, role-filtered navigation with an accent
 * marker on the active item. Desktop renders a sticky side rail; below `lg`
 * the same config renders as a compact horizontally-scrolling chip row per
 * group so the workflow stays one tap away.
 */
export default function AdminSidebar({ roles }: { roles: AdminRoles }) {
  const pathname = usePathname();
  const t = useT(shellMessages);
  const groups = visibleAdminNav(roles);

  return (
    <>
      {/* Desktop rail */}
      <nav
        aria-label={t('admin.navLabel')}
        className="hidden lg:block sticky top-20 self-start w-56 shrink-0 space-y-6"
      >
        {groups.map((group) => (
          <div key={group.id}>
            <h2 className="px-3 text-xs font-heading font-semibold uppercase tracking-wide text-poke-text-muted">
              {t(`admin.groups.${group.id}`)}
            </h2>
            <ul className="mt-2 space-y-0.5 border-l border-poke-border">
              {group.items.map((item) => {
                const active = isActive(pathname, item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? 'page' : undefined}
                      className={`flex items-center gap-2 -ml-px border-l-2 py-1.5 pr-2 text-sm font-heading font-semibold transition-colors ${
                        item.sub ? 'pl-7' : 'pl-3'
                      } ${FOCUS_RING} ${
                        active
                          ? 'border-poke-accent text-poke-accent bg-poke-accent-light/60'
                          : 'border-transparent text-poke-text-secondary hover:text-poke-text-primary hover:bg-poke-elevated'
                      }`}
                    >
                      <span className="truncate">{t(`admin.items.${item.labelKey}`)}</span>
                      {item.deprecated && (
                        <Badge variant="gray" size="xs">
                          {t('admin.legacy')}
                        </Badge>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* Mobile chip rows: stacked above the content by the admin layout.
          min-w-0 w-full cap the nav at the column width, so each row
          scrolls inside it instead of widening the page. */}
      <nav aria-label={t('admin.navLabel')} className="lg:hidden min-w-0 w-full space-y-3">
        {groups.map((group) => (
          <div key={group.id}>
            <h2 className="text-xs font-heading font-semibold uppercase tracking-wide text-poke-text-muted mb-1">
              {t(`admin.groups.${group.id}`)}
            </h2>
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {group.items.map((item) => {
                const active = isActive(pathname, item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={`whitespace-nowrap rounded-full border px-3 py-1 text-xs font-heading font-semibold transition-colors ${FOCUS_RING} ${
                      active
                        ? 'border-poke-accent/40 bg-poke-accent-light text-poke-accent-strong'
                        : 'border-poke-border bg-poke-surface text-poke-text-secondary hover:border-poke-accent hover:text-poke-text-primary'
                    }`}
                  >
                    {t(`admin.items.${item.labelKey}`)}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
    </>
  );
}
