import type { Object3D } from 'three';
import type {
  ActorRegistration,
  FigureDirectorSource,
  FigureRegistration as DirectorFigureRegistration,
} from '@/lib/route-world/figure-director';

export type { ActorRegistration } from '@/lib/route-world/figure-director';

/**
 * The frozen `FigureRegistration` (figure-director.ts, structural three
 * types) with its root narrowed to a real `THREE.Object3D`: every mounted
 * figure registers its group, and the scene-side readers (bridges,
 * ContactBlobs) walk it as one.
 */
export type FigureRegistration = Omit<DirectorFigureRegistration, 'object'> & {
  object: { readonly current: Object3D | null };
};

/**
 * Figure registry — the module-level lists of the figures and actors mounted
 * in the route world.
 *
 * POKEMON-CORE A1: `Figure.tsx` registers every figure (one effect, with its
 * mixer, pre-created actions, clip durations from `gltf.animations`, role,
 * subjectId and dormancy getter), and actors (D's water residents and lane
 * flyers, the plaza Walker) register a step with `registerActor`. The figure
 * director (`FigureDirector.tsx` → `figure-director.ts`) reads both lists as
 * its `FigureDirectorSource`; the debug bridges (`EvidenceBridges.tsx`'s
 * `__routeWorldFigures` / `__routeWorldOcclusion`) read the figure rows.
 *
 * Registration is a cheap Map insert, always on. It holds getters and refs,
 * never copies, so a row is always the live state at the moment it is read.
 * The registration TYPES are frozen in `figure-director.ts`.
 */

// Keyed by a per-registration token, not the id: two mounts can share a
// name (a remount overlapping its predecessor's cleanup), and each
// unregister must remove exactly its own entry.
const registry = new Map<symbol, FigureRegistration>();
const actorRegistry = new Map<symbol, ActorRegistration>();
let version = 0;

/** Register a figure; returns its unregister function (an effect cleanup). */
export function registerFigure(registration: FigureRegistration): () => void {
  const token = Symbol(registration.id);
  registry.set(token, registration);
  version += 1;
  return () => {
    if (registry.delete(token)) version += 1;
  };
}

/** Register an actor (one `ActorStep` in the director's loop); returns its unregister function. */
export function registerActor(registration: ActorRegistration): () => void {
  const token = Symbol(registration.id);
  actorRegistry.set(token, registration);
  version += 1;
  return () => {
    if (actorRegistry.delete(token)) version += 1;
  };
}

// The lists are rebuilt only when the registry changes: ContactBlobs and the
// director read them every frame, and an unchanged registry must cost no
// allocation (a fresh copy per frame was ~60 entries of GC churn at plaza).
let figureList: readonly FigureRegistration[] = [];
let figureListVersion = 0;
let actorList: readonly ActorRegistration[] = [];
let actorListVersion = 0;

/** Row order: by id (a stable sort, so rows sharing an id keep their registration order). */
function byId(a: { id: string }, b: { id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * The registered figures, ordered by id (a shared, read-only snapshot; a new
 * array after every change). A1 fix-2 (R15): NOT registration order — that
 * follows the order the GLBs happened to resolve in, so it changed from one
 * load to the next, and so did everything iterating the list: ContactBlobs'
 * instance order (overlapping blobs blend in that order: ±1 in 8 bits) and
 * which figures its capacity keeps, and the director's figure order.
 */
export function listFigures(): readonly FigureRegistration[] {
  if (figureListVersion !== version) {
    figureList = [...registry.values()].sort(byId);
    figureListVersion = version;
  }
  return figureList;
}

/** The registered actors, ordered by id like the figures (a shared, read-only snapshot; a new array after every change). */
export function listActors(): readonly ActorRegistration[] {
  if (actorListVersion !== version) {
    actorList = [...actorRegistry.values()].sort(byId);
    actorListVersion = version;
  }
  return actorList;
}

/** The most recent registration with this id (an actor finding the figure it drives). */
export function findFigure(id: string): FigureRegistration | null {
  let found: FigureRegistration | null = null;
  for (const entry of registry.values()) if (entry.id === id) found = entry;
  return found;
}

/** Bumps on every register / unregister of a figure or an actor (cheap change detection for readers). */
export function figureRegistryVersion(): number {
  return version;
}

/** The module registry as the director's source. */
export const moduleFigureSource: FigureDirectorSource = {
  figures: listFigures,
  actors: listActors,
  version: figureRegistryVersion,
};
