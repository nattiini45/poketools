/**
 * `definePackEn` (design spec §E.1): checks a pack's English message tree against the contract
 * (the example pack's `messages/en.ts`), with the same rules `defineDe` applies to a German
 * namespace: a missing key, an extra key, a renamed placeholder or tag, or a string-vs-plural
 * mismatch fails `tsc`. The texts may differ freely.
 *
 * `utility` is excluded from the key-equality check: its keys are the pack's own utility keys
 * (a `Record<string, string>` in the contract); the runtime schema checks them (§B.2 rule 11).
 *
 * The checked tree is returned typed as the contract (`PackMessagesEn<E>`), not as its own
 * literal type: public code then type-checks the same against every pack. Its placeholders and
 * tags equal the contract's (checked above), which is all the message types are used for.
 *
 * ```ts
 * // src/format-packs/<pack>/messages/en.ts
 * import type ExampleEn from '@/format-packs/example/messages/en';
 * export default definePackEn<typeof ExampleEn>()({ ... } as const);
 * ```
 */
import type { CheckDe, DeShape } from '@/i18n/types';

type Utility = { readonly utility: Readonly<Record<string, string>> };

/** The contract type of a pack's English tree (`E` = the example pack's `typeof en`). */
export type PackEn<E> = Omit<E, 'utility'> & Utility;

export function definePackEn<E extends { readonly utility: unknown }>() {
  return <const D extends DeShape<Omit<E, 'utility'>> & Utility>(
    en: D & CheckDe<Omit<E, 'utility'>, Omit<D, 'utility'>>,
  ): PackEn<E> => en as unknown as PackEn<E>;
}
