'use client';

import { useEffect } from 'react';
import { watchSitePaletteAttribute } from '@/lib/design/site-palette-store';

/**
 * Keeps the viewer's site palette on `<html data-palette>` for every page
 * (docs/design.md § Site palettes). React strips attributes it did not render
 * from the `<html>` singleton when it releases or re-acquires it, which drops
 * the pre-paint script's value; this puts it back. Renders nothing.
 */
export default function SitePaletteGuard() {
  useEffect(() => watchSitePaletteAttribute(), []);
  return null;
}
