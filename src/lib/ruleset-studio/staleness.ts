/**
 * Whether a published ruleset version was computed from older catalog data than the app has now.
 *
 * A version freezes its effective rules at publish (`resolved`), together with the version of the preset catalog they were
 * computed from (`catalog_version`, `PRESET_RULES_VERSION`). When the catalog is corrected later, a running league keeps the
 * frozen rules on purpose; the library says so, so the owner can publish again to pick up the new data. Only a ruleset based on
 * a catalog preset depends on the catalog: a blank base states everything itself, and a converted legacy ruleset (catalog version
 * `legacy`, blank base) never goes stale.
 *
 * Pure and client-safe: the caller passes the current catalog version.
 */

/** The two members of a version summary the test reads. */
export interface CatalogDependent {
  catalog_version: string;
  /** The catalog preset the document is based on, or null for a blank base. */
  base_preset: string | null;
}

export function isCatalogStale(version: CatalogDependent, currentCatalogVersion: string): boolean {
  return version.base_preset !== null && version.catalog_version !== currentCatalogVersion;
}
