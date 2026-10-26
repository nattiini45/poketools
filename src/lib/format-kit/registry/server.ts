/**
 * The server registry: for each AVAILABLE kind its manifest entry and the zod params schema.
 * SERVER ONLY (zod). The params schema is exactly the node schema from `schema/primitives.ts`,
 * which `schema/document.ts` composes the document from, so the registry and the document schema
 * cannot diverge. Reserved kinds have no server entry (they only exist in the manifest).
 */
import type { z } from 'zod';
import { PRIMITIVE_NODE_SCHEMAS } from '../schema/primitives';
import { AVAILABLE_KINDS, type PrimitiveKind } from './kinds';
import { manifestEntry, type ManifestEntry } from './manifest';

export interface ServerRegistryEntry {
  manifest: ManifestEntry;
  paramsSchema: z.ZodType<unknown>;
}

export const serverRegistry: ReadonlyMap<PrimitiveKind, ServerRegistryEntry> = new Map<PrimitiveKind, ServerRegistryEntry>(
  AVAILABLE_KINDS.map((kind): [PrimitiveKind, ServerRegistryEntry] => {
    const manifest = manifestEntry(kind);
    const paramsSchema = PRIMITIVE_NODE_SCHEMAS.get(kind);
    if (!manifest || !paramsSchema) throw new Error(`server registry: ${kind} is missing its manifest entry or schema`);
    return [kind, { manifest, paramsSchema }];
  }),
);
