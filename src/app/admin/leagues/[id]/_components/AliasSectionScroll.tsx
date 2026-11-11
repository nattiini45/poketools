'use client';

import { useEffect } from 'react';

/**
 * Brings one section of the open tab into view once, when the page was opened through an earlier tab id that is
 * now a section (`?tab=danger` → the danger zone at the end of Settings, `?tab=rules` → the rules editors of
 * Format and rules). The server cannot add a fragment without a redirect, and the URLs stay as they are. Renders
 * nothing; a section the tab does not have (a format without rules editors) is left alone.
 */
export default function AliasSectionScroll({ sectionId }: { sectionId: string }) {
  useEffect(() => {
    document.getElementById(sectionId)?.scrollIntoView({ block: 'start' });
  }, [sectionId]);
  return null;
}
