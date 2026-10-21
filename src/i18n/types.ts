/**
 * Message, leaf, plural, param and tag type machinery (i18n-core §1.3).
 *
 * `en` is the source of truth. A `de` that is missing a key, has an extra
 * key, or uses a different placeholder or tag set fails `tsc` through
 * `defineDe<typeof en>()(de)` (`define.ts`). `parity.test.ts` repeats the
 * checks at runtime to catch `as` casts.
 */
import type { ReactNode } from 'react';

export interface PluralForms {
  readonly zero?: string;
  readonly one: string;
  readonly other: string;
}
export type MessageLeaf = string | PluralForms;
export interface MessageTree {
  readonly [key: string]: MessageLeaf | MessageTree;
}

/** Placeholder names in a template: `'{a} and {b}'` -> `'a' | 'b'`. */
export type ParamNames<S extends string> = S extends `${string}{${infer P}}${infer R}`
  ? P | ParamNames<R>
  : never;
/** Opening rich-tag names in a template: `'<b>x</b>'` -> `'b'`. */
export type TagNames<S extends string> = S extends `${string}<${infer T}>${infer R}`
  ? T extends `/${string}`
    ? TagNames<R>
    : T | TagNames<R>
  : never;

type LeafParams<L> = L extends string
  ? ParamNames<L>
  : L extends PluralForms
    ? ParamNames<L['other']> | ParamNames<L['one']>
    : never;
type LeafTags<L> = L extends string ? TagNames<L> : L extends PluralForms ? TagNames<L['other']> : never;

/** Every dotted leaf path of a message tree. */
export type Leaves<T> = {
  [K in keyof T & string]: T[K] extends MessageLeaf ? K : `${K}.${Leaves<T[K]>}`;
}[keyof T & string];
/** The value at a dotted path. */
export type At<T, P extends string> = P extends `${infer H}.${infer R}`
  ? H extends keyof T
    ? At<T[H], R>
    : never
  : P extends keyof T
    ? T[P]
    : never;

/** Numbers are formatted with `Intl.NumberFormat(locale)`. */
export type ParamValue = string | number;
export type ArgsFor<L> = L extends PluralForms
  ? [params: { count: number } & { [K in Exclude<LeafParams<L>, 'count'>]: ParamValue }]
  : [LeafParams<L>] extends [never]
    ? []
    : [params: { [K in LeafParams<L>]: ParamValue }];
/** Values for `t.rich`: placeholders may be ReactNode; one renderer per tag. */
export type RichArgsFor<L> = { [K in LeafParams<L>]: ParamValue | ReactNode } & {
  [T in LeafTags<L>]: (chunks: ReactNode) => ReactNode;
} & (L extends PluralForms ? { count: number } : unknown);

/** The structural shape every non-source language must have. */
export type DeShape<E> = {
  readonly [K in keyof E]: E[K] extends string ? string : E[K] extends PluralForms ? PluralForms : DeShape<E[K]>;
};

/**
 * A failed check. An object brand instead of a bare message literal: a
 * literal would intersect with the de literal to `never`, which TypeScript
 * then spreads over the whole dictionary (every key reported). The brand
 * keeps the error on the offending key, with the reason in the message.
 */
export interface I18nCheckError<M extends string> {
  readonly __i18nError: M;
}

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type CheckString<EL extends string, DL> = DL extends string
  ? string extends DL
    ? DL // widened (inference fell back to the constraint): the missing-key error reports instead
    : Same<ParamNames<EL>, ParamNames<DL>> extends true
      ? Same<TagNames<EL>, TagNames<DL>> extends true
        ? DL
        : I18nCheckError<`tags must be: ${TagNames<EL> & string}`>
      : I18nCheckError<`placeholders must be: ${ParamNames<EL> & string}`>
  : I18nCheckError<'expected a string'>;
type CheckPlural<EL extends PluralForms, DL> = DL extends PluralForms
  ? {
      [F in keyof DL]: F extends 'zero' | 'one' | 'other'
        ? DL[F] extends string
          ? string extends DL[F]
            ? DL[F]
            : ParamNames<DL[F]> extends LeafParams<EL> | 'count'
              ? DL[F]
              : I18nCheckError<'unknown placeholder'>
          : I18nCheckError<'expected a string'>
        : I18nCheckError<'plural forms are zero, one and other'>;
    }
  : I18nCheckError<'expected a plural object'>;
type CheckLeaf<EL, DL> = EL extends string
  ? CheckString<EL, DL>
  : EL extends PluralForms
    ? CheckPlural<EL, DL>
    : CheckDe<EL, DL>;
/** Per-key validation of `de` against `en`; an extra key is an error. */
export type CheckDe<E, D> = {
  [K in keyof D]: K extends keyof E ? CheckLeaf<E[K], D[K]> : I18nCheckError<'unknown key'>;
};

/** A namespace: one directory under `src/i18n/messages/` holding both languages. */
export interface Namespace<E extends MessageTree> {
  readonly id: string;
  readonly en: E;
  readonly de: DeShape<E>;
}
