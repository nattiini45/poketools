import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import config from '../../../../tailwind.config';

/**
 * Site palettes — components read the palette inks, not static Tailwind
 * (docs/design.md § Site palettes, review fixes).
 *
 * Static `text-red-500` / `text-red-400` / `text-amber-600` /
 * `text-yellow-700` were tuned against plaza's near-black dark surfaces and
 * fall under 4.5:1 on the dusk surfaces of the other palettes. These files
 * now use `poke-danger-ink` / `-danger-tint-ink` / `-amber-ink` /
 * `-yellow-ink`, whose plaza values equal the old statics (contrast:
 * site-palettes.test.ts § component inks). This walk keeps them there.
 */

const HERE = join(fileURLToPath(import.meta.url), '..');
const SRC = join(HERE, '..', '..', '..');
const read = (path: string) => readFileSync(join(SRC, path), 'utf8');

/**
 * A static status ink, bare or as a `hover:` variant (both paint on the same
 * palette surface). A `dark:` variant is left alone: it pairs with its own
 * dark fill, not with a palette surface.
 */
const STATIC_INK = /(?<![:\w-])(?:hover:)?text-(red-500|red-400|amber-600|yellow-700)\b/g;

const MIGRATED: Record<string, string> = {
  'app/admin/wiki/WikiModerationPanel.tsx': 'text-poke-danger-ink',
  'components/avatar/AiAvatarGenerator.tsx': 'text-poke-danger-ink',
  'components/avatar/AvatarBuilder.tsx': 'text-poke-danger-ink',
  'components/avatar/PhotoTransformPanel.tsx': 'text-poke-danger-ink',
  'components/avatar/ShowdownPicker.tsx': 'text-poke-danger-ink',
  'components/wiki/WikiNotesSection.tsx': 'text-poke-danger-ink',
  'components/creator/studio/CastStudio.tsx': 'text-poke-danger-tint-ink',
  'components/creator/studio/SessionManager.tsx': 'text-poke-danger-tint-ink',
  'components/discord/DiscordWebhookManager.tsx': 'text-poke-danger-tint-ink',
  'components/social/SocialIntegrationManager.tsx': 'text-poke-danger-tint-ink',
  'app/admin/test-players/TestPlayersConsole.tsx': 'text-poke-amber-ink',
  'components/league/LeagueRosterManager.tsx': 'text-poke-amber-ink',
  'components/teambuilder/LegalityBadge.tsx': 'text-poke-yellow-ink',
  'components/bracket/RoundRobinTable.tsx': 'text-poke-yellow-ink',
  'components/match/MatchHighlightCard.tsx': 'text-poke-yellow-ink',
  'components/tournament/TournamentReportCard.tsx': 'text-poke-yellow-ink',
  'components/ui/Alert.tsx': 'text-poke-yellow-ink',
};

describe('component inks', () => {
  for (const [file, token] of Object.entries(MIGRATED)) {
    it(`${file} uses ${token} and no static status ink`, () => {
      const source = read(file);
      expect(source).toContain(token);
      expect(source.match(STATIC_INK) ?? []).toEqual([]);
    });
  }
});

describe('error boundaries use the button recipe', () => {
  const BOUNDARIES = [
    'app/admin/error.tsx',
    'app/(player)/dashboard/broadcast/error.tsx',
    'app/(player)/teambuilder/error.tsx',
    'app/(public)/leagues/[id]/error.tsx',
    'app/(public)/tournaments/[id]/error.tsx',
  ];

  it('poke.primary / poke.card / poke.hover do not exist (those classes generate nothing)', () => {
    const extend = config.theme?.extend as { colors?: Record<string, Record<string, string>> } | undefined;
    const poke = extend?.colors?.poke ?? {};
    for (const key of ['primary', 'card', 'hover']) expect(poke[key], key).toBeUndefined();
  });

  for (const file of BOUNDARIES) {
    it(`${file}: primary + secondary buttonVariants, no undefined tokens or text-white`, () => {
      const source = read(file);
      expect(source).toContain('buttonVariants({ variant: "primary", size: "md" })');
      expect(source).toContain('buttonVariants({ variant: "secondary", size: "md" })');
      expect(source).not.toMatch(/poke-(primary|card|hover)\b/);
      expect(source).not.toContain('text-white');
    });
  }
});

describe('stored social image', () => {
  const source = read('components/match/CreateSocialImageButton.tsx');

  it('captures inside withDefaultSitePalette (never the admin palette)', () => {
    const WRAPPED = 'withDefaultSitePalette(() => captureNodeAsDataUrl(capture.id))';
    const calls = source.match(/captureNodeAsDataUrl\(/g) ?? [];
    const wrapped = source.split(WRAPPED).length - 1;
    // Both branches (off-screen content-language copy and the visible card).
    expect(wrapped).toBeGreaterThanOrEqual(2);
    // No bare capture: every call is the wrapped form (the import line has no call).
    expect(calls).toHaveLength(wrapped);
  });

  it('captures in the league content language (the target is built from contentLocale)', () => {
    expect(source).toMatch(
      /const capture = socialCaptureTarget\(\{[^}]*viewerLocale: locale,[^}]*contentLocale,[^}]*\}\)/,
    );
  });
});
