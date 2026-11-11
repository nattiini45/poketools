'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import ItemIcon from '@/components/ui/ItemIcon';
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage } from '@/components/ui/fluid/breadcrumb';
import { useT } from '@/i18n/client';
import { shellMessages } from '@/i18n/messages/shell';
import type { ItemIconId } from '@/lib/pkmn/item-icons';
import { adminBreadcrumb, type AdminCrumb } from './admin-breadcrumb';
import { useAdminCrumbName } from './admin-crumb-names';
import type { VisibleAdminNavGroup } from './adminNav';

function CrumbLabel({ crumb }: { crumb: AdminCrumb }) {
  const t = useT(shellMessages);
  const name = useAdminCrumbName(crumb.href);
  if (crumb.named && name !== undefined) return name;
  if (crumb.nav !== undefined) return t(`admin.items.${crumb.nav}`);
  if (crumb.crumb !== undefined) return t(`admin.crumbs.${crumb.crumb}`);
  return crumb.label;
}

/**
 * Where the page sits in the admin: the sidebar item (with its item icon), then the steps below it. On a phone only
 * the last two steps show, so the bar never wraps.
 */
export default function AdminBreadcrumb({ groups }: { groups: readonly VisibleAdminNavGroup[] }) {
  const t = useT(shellMessages);
  const pathname = usePathname();
  const items = groups.flatMap((group) => group.items.filter((item) => !item.sub));
  const trail = adminBreadcrumb(pathname, items);
  if (trail.length === 0) return null;

  const first = trail[0];
  const icon: ItemIconId | undefined =
    items.find((item) => item.href === first.href)?.icon ?? groups.find((group) => group.items.some((item) => item.href === first.href))?.icon;

  return (
    <Breadcrumb aria-label={t('admin.breadcrumbLabel')} className="min-w-0">
      <BreadcrumbList className="flex-nowrap">
        {trail.map((crumb, i) => {
          const last = i === trail.length - 1;
          const lead = i === 0 && icon ? <ItemIcon item={icon} /> : null;
          return (
            <BreadcrumbItem key={crumb.href + i} className={i < trail.length - 2 ? 'hidden sm:flex' : 'min-w-0'}>
              {last ? (
                <BreadcrumbPage className="min-w-0 truncate font-[550] text-fg">
                  {lead}
                  <CrumbLabel crumb={crumb} />
                </BreadcrumbPage>
              ) : (
                <BreadcrumbLink render={<Link href={crumb.href} />} className="whitespace-nowrap">
                  {lead}
                  <CrumbLabel crumb={crumb} />
                </BreadcrumbLink>
              )}
            </BreadcrumbItem>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
