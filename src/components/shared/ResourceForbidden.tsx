import { getT } from '@/i18n/server';
import { shellMessages } from '@/i18n/messages/shell';

interface ResourceForbiddenProps {
  /** Already-translated text naming the resource; defaults to the generic shell text. */
  children?: React.ReactNode;
  /** Already-translated page heading; defaults to the shell's "Access Denied", as the admin guards use. */
  title?: React.ReactNode;
}

/**
 * What a page renders when `gateResourceAdmin()` says `forbidden`: an admin,
 * but not of this season or tournament. Render it inside `AdminGuard`, like
 * the other gate outcomes. It is the page's only content, so it carries the
 * page's `h1`.
 */
export default async function ResourceForbidden({ children, title }: ResourceForbiddenProps) {
  const t = await getT(shellMessages);
  const message = children ?? t('guards.resourceForbidden');
  return (
    <div className="p-8 text-center">
      <h1 className="mb-2 text-2xl font-bold">{title ?? t('guards.accessDenied')}</h1>
      <p className="text-poke-text-secondary">{message}</p>
    </div>
  );
}
