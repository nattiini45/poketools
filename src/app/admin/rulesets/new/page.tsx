import { redirect } from 'next/navigation';
import { RULESETS_HREF } from '@/components/ruleset-studio/hrefs';

export const dynamic = 'force-dynamic';

/**
 * `/admin/rulesets/new` used to be the wizard. A new ruleset now starts from the "New ruleset" dialog on the gallery (blank,
 * from a rule preset, from a shared ruleset, from a file), so the old address leads there.
 */
export default function NewRulesetPage() {
  redirect(RULESETS_HREF);
}
