import type { Metadata } from 'next';
import { cookies, headers } from 'next/headers';
import { NOINDEX } from '@/lib/seo/robots';
import SkipToContent from '@/components/shared/SkipToContent';
import { MAIN_CONTENT_ID } from '@/lib/ui/main-content';
import PageTransitionWrapper from '@/components/shared/PageTransitionWrapper';
import AdminGuard from '@/components/shared/AdminGuard';
import AdminShell from '@/components/admin/AdminShell';
import AssistantDrawer from '@/components/admin/assistant/AssistantDrawer';
import { SIDEBAR_COOKIE_NAME } from '@/components/ui/fluid/sidebar-core';
import { getLiveAccess } from '@/lib/auth/helpers';
import { REQUEST_PATH_HEADER } from '@/lib/auth/request-path';
import { canAdministerPhaseAccess } from '@/lib/auth/phase-access';
import { agentEnabledFor, parseAdminAgentEnv } from '@/lib/ai/admin-agent/env';
import { ENABLE_ADMIN_ASSISTANT } from '@/lib/feature-flags';
import { extensionAdminLinks } from '@/lib/pack-extensions';
import { getPhaseRouteMode } from '@/lib/league-phase/route-mode';
import { isValidUuid } from '@/lib/utils/uuid';
import type { SessionPlayer } from '@/types/auth';
import { readNativeAdminMatchOwner } from './matches/[id]/match-target';

export const metadata: Metadata = { robots: NOINDEX };

const MAIN_CLASS =
  'mx-auto w-full max-w-[1440px] flex-1 px-4 py-6 sm:px-6 lg:px-8 focus:outline-2 focus:outline-offset-2 focus:outline-transparent';

async function isPhaseCorrectionEntry(player: SessionPlayer | null) {
  if (player?.status !== 'active') return false;
  const path = (await headers()).get(REQUEST_PATH_HEADER)?.split('?', 1)[0];
  const route = path?.match(/^\/admin\/matches\/([^/]+)(?:\/games\/([^/]+)\/edit)?\/?$/);
  if (!route || !isValidUuid(route[1]) || (route[2] && !isValidUuid(route[2]))) return false;
  if (await getPhaseRouteMode() !== 'phase') return false;
  const owner = await readNativeAdminMatchOwner(route[1].toLowerCase());
  return owner !== null && await canAdministerPhaseAccess(player, owner.phase_id);
}

export default async function AdminLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // D37: both flags come from the live read (one memoised read, shared with
  // AdminGuard below), not the up-to-5-minute-old session copy. The superadmin
  // is the configured identity with a live site-admin row in good standing.
  const [access, extraItems, cookieStore] = await Promise.all([
    getLiveAccess(),
    // Admin pages of the active pack extension; a failing provider propagates (never fails open).
    extensionAdminLinks(),
    cookies(),
  ]);

  // The shell (sidebar, top bar, command menu) is the admin IA: only a live admin gets it. Everyone else gets the
  // guard alone, which redirects a signed-out viewer and tells a player the pages are admin-only.
  if (!access?.isAnyAdmin) {
    // A reused layout is not an authorization boundary: the two correction pages gate their own rows.
    // Never mount the general admin shell or its tools through this entry.
    const phaseCorrectionEntry = await isPhaseCorrectionEntry(access?.player ?? null);
    return (
      <>
        <SkipToContent />
        <main id={MAIN_CONTENT_ID} tabIndex={-1} className={MAIN_CLASS}>
          {phaseCorrectionEntry ? <PageTransitionWrapper>{children}</PageTransitionWrapper> : <AdminGuard>{null}</AdminGuard>}
        </main>
      </>
    );
  }

  const roles = {
    isSiteAdmin: access.isSiteAdmin,
    isSuperadmin: access.isSuperadmin,
    // The assistant's nav item and launcher: the UI flag AND the server switch, the audience and the allow-list
    // for this live viewer (the routes and pages gate again; the shell only hides a dead link).
    assistantEnabled:
      ENABLE_ADMIN_ASSISTANT &&
      agentEnabledFor(parseAdminAgentEnv(), {
        playerId: access.player?.playerId,
        isSiteAdmin: access.isSiteAdmin,
        isAnyAdmin: access.isAnyAdmin,
      }),
  };

  return (
    <>
      <SkipToContent />
      {/* The admin has its own shell instead of the public NavBar (redesign A1): sidebar, top bar with breadcrumb,
          command menu. The sidebar remembers whether it was collapsed in a cookie it writes itself. */}
      <AdminShell roles={roles} extraItems={extraItems} defaultSidebarOpen={cookieStore.get(SIDEBAR_COOKIE_NAME)?.value !== 'false'}>
        <main id={MAIN_CONTENT_ID} tabIndex={-1} className={MAIN_CLASS}>
          {/* The per-page guards remain as defense-in-depth for the content column. */}
          <AdminGuard>
            <PageTransitionWrapper>{children}</PageTransitionWrapper>
            {/* The assistant drawer sits beside the page transition, not inside it, so a conversation survives navigation.
                It renders only where the assistant is on for this live viewer (UI flag, server switch, audience). */}
            {roles.assistantEnabled && <AssistantDrawer />}
          </AdminGuard>
        </main>
      </AdminShell>
    </>
  );
}
