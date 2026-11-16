/**
 * Direction B type roles (redesign F3). Sizes and line heights live in the Tailwind theme (globals.css,
 * `--text-<role>`); display and title set in Geist Sans (font-heading) at 600, the rest in Geist Sans at 400
 * and 550. Every weight is a real face of the variable font, so a heavier label never needs a synthesised one.
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
