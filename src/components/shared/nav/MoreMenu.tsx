'use client';

import { ChevronDown } from 'lucide-react';
import { usePathname } from 'next/navigation';
import ItemIcon from '@/components/ui/ItemIcon';
import SkewPlate from '@/components/ui/SkewPlate';
import { useT } from '@/i18n/client';
import { navMessages } from '@/i18n/messages/nav';
import { useRegisterFluidHoverItem } from '@/hooks/fluid/use-fluid-hover';
import { cn } from '@/lib/utils/cn';
import { MORE_NAV_LINKS, extensionLinkIcon, isNavPathActive } from './links';
import NavMenuLink from './NavMenuLink';
import { useNavDisclosure } from './use-nav-disclosure';

/** "More" in the desktop link row: Replays, Players and the pack's extension pages (History), inside `#site-nav`. */
export default function MoreMenu({
  extraLinks,
  iconClassName,
  hoverIndex,
  registerHover,
}: {
  extraLinks: readonly { href: string; label: string }[];
  /** When the row shows its item icons (it hides them where the links would not fit). */
  iconClassName: string;
  hoverIndex: number;
  registerHover: (index: number, element: HTMLElement | null) => void;
}) {
  const t = useT(navMessages);
  const pathname = usePathname();
  const { open, setOpen, panelId, wrapperRef, triggerRef } = useNavDisclosure();
  const links = [
    ...MORE_NAV_LINKS.map((link) => ({ href: link.href, label: t(`links.${link.labelKey}`), icon: link.icon, also: link.also })),
    ...extraLinks.map((link) => ({ href: link.href, label: link.label, icon: extensionLinkIcon(link.href), also: undefined })),
  ];
  useRegisterFluidHoverItem(registerHover, hoverIndex, triggerRef);
  const active = links.some((link) => isNavPathActive(pathname, link.href, link.also));

  return (
    <div ref={wrapperRef} className="relative">
      <button
        ref={triggerRef}
        data-fluid-hover-index={hoverIndex}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(!open)}
        className="relative inline-flex cursor-pointer whitespace-nowrap rounded-[3px] text-body"
      >
        <SkewPlate
          variant="nav"
          active={active}
          glideId="site-nav-plate"
          icon={<ItemIcon item="poke-doll" className={iconClassName} />}
        >
          <span className="inline-flex items-center gap-1">
            {t('links.more')}
            <ChevronDown aria-hidden="true" className={cn('size-3.5 transition-transform duration-[160ms]', open && 'rotate-180')} />
          </span>
        </SkewPlate>
      </button>
      {open && (
        <div
          id={panelId}
          className="absolute left-0 top-full z-50 mt-2 flex min-w-52 flex-col gap-0.5 rounded-poke-lg border border-hairline bg-surface p-1.5 shadow-poke-lg"
        >
          {links.map((link) => (
            <NavMenuLink
              key={link.href}
              href={link.href}
              icon={<ItemIcon item={link.icon} />}
              active={isNavPathActive(pathname, link.href, link.also)}
              onNavigate={() => setOpen(false)}
            >
              {link.label}
            </NavMenuLink>
          ))}
        </div>
      )}
    </div>
  );
}
