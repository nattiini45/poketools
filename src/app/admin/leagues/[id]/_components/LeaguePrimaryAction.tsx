import Link from 'next/link';
import ItemIcon from '@/components/ui/ItemIcon';
import SkewPlate from '@/components/ui/SkewPlate';
import type { ItemIconId } from '@/lib/pkmn/item-icons';
import type { LeaguePrimaryAction as PrimaryAction } from '@/lib/league-admin/primary-action';
import type { SeasonStatus } from '@/types/season';
import { cn } from '@/lib/utils/cn';
import LeagueActivateButton from './LeagueActivateButton';
import { LEAGUE_ADMIN_TAB_ICONS } from './tab-icons';
import { PRIMARY_ACTION_PLATE, PRIMARY_ACTION_TARGET } from './primary-action-classes';

/** The item icon on the plate: the tab the action leads to, the readiness candy for Activate. */
const ACTION_ICON: Readonly<Record<PrimaryAction['id'], ItemIconId>> = {
  activate: 'rare-candy',
  attachFormat: LEAGUE_ADMIN_TAB_ICONS.format,
  addParticipants: LEAGUE_ADMIN_TAB_ICONS.participants,
  addPhase: LEAGUE_ADMIN_TAB_ICONS.phases,
  manageRounds: LEAGUE_ADMIN_TAB_ICONS.phases,
  reviewChecks: LEAGUE_ADMIN_TAB_ICONS.live,
  publicPage: LEAGUE_ADMIN_TAB_ICONS.overview,
};

interface LeaguePrimaryActionProps {
  action: PrimaryAction;
  /** The translated label (`action.<id>`). */
  label: string;
  seasonId: string;
  currentStatus: SeasonStatus;
  /** Fills its row (the phone action bar). */
  block?: boolean;
}

/**
 * The league workspace's one primary action (`leaguePrimaryAction`) on the amber skewed plate: a status move is a
 * button that writes it, everything else a link to the tab where the step is done.
 */
export default function LeaguePrimaryAction({ action, label, seasonId, currentStatus, block = false }: LeaguePrimaryActionProps) {
  const content = (
    <span className="flex items-center gap-2">
      <ItemIcon item={ACTION_ICON[action.id]} />
      {label}
    </span>
  );
  if (action.kind === 'status') {
    return (
      <LeagueActivateButton seasonId={seasonId} currentStatus={currentStatus} to={action.to} block={block}>
        {content}
      </LeagueActivateButton>
    );
  }
  return (
    <Link href={action.href} data-admin-primary-action={action.id} className={cn(PRIMARY_ACTION_TARGET, block && 'flex w-full')}>
      <SkewPlate variant="button" tone="primary" className={cn(PRIMARY_ACTION_PLATE, block && 'w-full')}>
        {content}
      </SkewPlate>
    </Link>
  );
}
