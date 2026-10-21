/**
 * The public EXAMPLE format pack (design spec §B.4): a neutral league that demonstrates every
 * mechanic. A checkout without the private companion overlay builds and tests with it.
 *
 * Packs are client-safe data: they import only `@/types/*`, `@/i18n/define`, `@/i18n/types`,
 * `@/lib/format-pack/types`, `@/lib/format-pack/define` and their own files. Never import a pack
 * directly: read the active one through `@/lib/format-pack`.
 */
import type { FormatPack } from '@/lib/format-pack/types';
import { exampleCoreLiga } from './core-liga';
import { exampleDraftFormat } from './draft-format';
import { exampleEpb } from './epb';
import de from './messages/de';
import en from './messages/en';

const examplePack = {
  id: 'example',
  epb: exampleEpb,
  draftFormat: exampleDraftFormat,
  coreLiga: exampleCoreLiga,
  messages: { en, de },
} satisfies FormatPack;

export default examplePack;
