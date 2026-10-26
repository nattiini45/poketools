import Link from 'next/link';
import { notFound } from 'next/navigation';
import AdminGuard from '@/components/shared/AdminGuard';
import { RULESETS_HREF } from '@/components/ruleset-studio/hrefs';
import RulesView from '@/components/ruleset-studio/RulesView';
import ForkPresetButton from '@/components/ruleset-studio/starts/ForkPresetButton';
import Badge from '@/components/ui/Badge';
import PageContainer from '@/components/ui/PageContainer';
import { getLiveAccess } from '@/lib/auth/helpers';
import { getLocale, getT } from '@/i18n/server';
import { rulesetStudioSectionsMessages } from '@/i18n/messages/ruleset-studio/sections';
import { getRulesetPreset } from '@/lib/pkmn/ruleset-preset-catalog';
import { resolvePresetRules } from '@/lib/pkmn/preset-rules.server';
import { computeEffective } from '@/lib/ruleset-kit/effective';
import { describeResolved } from '@/lib/ruleset-studio/describe.server';
import { newRulesetDocument } from '@/lib/ruleset-studio/document';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ presetId: string }>;
}

const LINK = 'inline-flex min-h-11 items-center text-sm font-medium text-poke-blue hover:underline sm:min-h-0';

/**
 * `/admin/rulesets/catalog/[presetId]`: the read-only page of one catalog rule preset. An unknown preset is a 404; a
 * non-admin gets the guard. It shows the rules the preset implies in plain sentences (resolved for its mod and
 * universe on the server) and starts a private copy: "Create a ruleset from this preset", and for a draft preset with
 * documented Smogon tour extras a second start that adds them.
 */
export default async function RulesetPresetPage({ params }: PageProps) {
  const { presetId } = await params;
  const entry = getRulesetPreset(presetId);
  if (entry === undefined) notFound();
  const access = await getLiveAccess();
  if (!access?.isAnyAdmin) return <AdminGuard>{null}</AdminGuard>;

  const [t, locale] = await Promise.all([getT(rulesetStudioSectionsMessages), getLocale()]);
  const preset = resolvePresetRules(presetId);
  const described = preset === null ? null : describeResolved(computeEffective(newRulesetDocument(entry.name, 'en', presetId), preset), locale, entry.name);

  return (
    <AdminGuard>
      <PageContainer title={entry.name} subtitle={`${entry.genLabel} · ${entry.tierLabel}`} maxWidth="lg">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Badge variant="accent">{t('page.catalogBadge')}</Badge>
          {entry.source === 'smogon-draft' && <Badge variant="blue">{t('page.draftBadge')}</Badge>}
          <Link href={RULESETS_HREF} className={LINK}>
            {t('page.back')}
          </Link>
        </div>
        <p className="text-sm text-poke-text-secondary">{t('page.catalogIntro')}</p>
        <div className="flex flex-wrap items-start gap-3">
          <ForkPresetButton presetId={presetId} />
          {entry.tourOverlay && <ForkPresetButton presetId={presetId} tourOverlay />}
        </div>
        {described !== null && (
          <section className="space-y-3" aria-labelledby="preset-rules">
            <h2 id="preset-rules" className="font-heading text-lg font-bold text-poke-text-primary">
              {t('page.rulesHeading')}
            </h2>
            <RulesView rules={described} lang={locale} />
          </section>
        )}
      </PageContainer>
    </AdminGuard>
  );
}
