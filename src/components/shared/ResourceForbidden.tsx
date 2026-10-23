import { getT } from '@/i18n/server';
import { shellMessages } from '@/i18n/messages/shell';

interface ResourceForbiddenProps {
  /** Already-translated text naming the resource; defaults to the generic shell text. */
  children?: React.ReactNode;
}

/**
 * What a page renders when `gateResourceAdmin()` says `forbidden`: an admin,
 * but not of this season or tournament. Render it inside `AdminGuard`, like
 * the other gate outcomes.
 */
export default async function ResourceForbidden({ children }: ResourceForbiddenProps) {
  const message = children ?? (await getT(shellMessages))('guards.resourceForbidden');
  return <p className="p-8 text-center text-poke-text-secondary">{message}</p>;
}
