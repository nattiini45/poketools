/**
 * Direction B type roles (redesign F3). Sizes and line heights live in the Tailwind theme (globals.css,
 * `--text-<role>`); display and title set in Geist Pixel Square (font-heading), the rest in Geist Sans.
 * Weights are 400 and 550 only, so a heavier label never needs a synthesised face.
 */
export const TYPE_ROLES = ['display', 'title', 'subtitle', 'body', 'caption', 'micro'] as const;

export type TypeRole = (typeof TYPE_ROLES)[number];

const ROLE_CLASS: Record<TypeRole, string> = {
  display: 'font-heading text-display',
  title: 'font-heading text-title',
  subtitle: 'font-body text-subtitle font-[550]',
  body: 'font-body text-body',
  caption: 'font-body text-caption',
  micro: 'font-body text-micro',
};

export function typeClass(role: TypeRole): string {
  return ROLE_CLASS[role];
}
