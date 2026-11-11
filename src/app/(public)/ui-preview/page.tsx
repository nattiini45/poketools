import { notFound } from 'next/navigation';
import UiPreviewClient from './UiPreviewClient';

/**
 * Dev-only fixture page for the redesign primitives (redesign F4): the item icons, the skewed plates and the vendored
 * @fluid components, on the site's own theme and palette. It reads nothing from Supabase and 404s in production,
 * like `/draft-preview`. The visual harness captures it as a surface (scripts/visual/routes.json).
 */
export default function UiPreviewPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <UiPreviewClient />;
}
