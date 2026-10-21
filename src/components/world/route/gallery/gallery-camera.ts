/**
 * D42 gallery (dev-only): where the gallery camera stands for a pose. Pure
 * math, no three.js: the scene writes the result into the default camera.
 *
 * The figure is framed by its fitted bounds (metres, grounded at y = 0 and
 * centred on x/z, as `Figure` reports them through `onMeasure`):
 *
 *  - outside views orbit the bounds' enclosing sphere. `azimuthDeg` turns
 *    about +Y from +Z (0 = the camera on +Z, looking toward -Z), and
 *    `elevationDeg` lifts the camera above (+) or below (-) the horizon,
 *    clamped to ±GALLERY_ELEVATION_MAX_DEG so the view never degenerates
 *    (a "top view" is 90 → 89.5). The distance makes the sphere's silhouette
 *    exactly `sizePx` CSS pixels across, vertically, at the image centre:
 *    tan(alpha) = (sizePx / viewportHeightPx) · tan(fov / 2) and
 *    distance = radius / sin(alpha), with alpha the sphere's angular radius;
 *  - an `inside` view stands at the bounds' centre and looks OUT along the
 *    orbit direction, at the inner side of the shell an outside camera at the
 *    same azimuth would face (the doubleSided flips); `sizePx` does not apply.
 *
 * The camera never moves between `set` calls (frozen cameras).
 */

export type Vec3 = [number, number, number];

export interface GalleryBounds {
  min: Vec3;
  max: Vec3;
}

export interface GalleryCameraInput {
  azimuthDeg: number;
  elevationDeg: number;
  sizePx: number;
  inside?: boolean;
}

export interface GalleryCameraPose {
  position: Vec3;
  target: Vec3;
  fov: number;
  near: number;
  far: number;
}

/** Vertical field of view of the outside views (degrees). */
export const GALLERY_FOV_DEG = 30;
/** Vertical field of view of the inside-out view (degrees). */
export const GALLERY_INSIDE_FOV_DEG = 70;
/** The elevation clamp (degrees): the camera never sits exactly on the pole. */
export const GALLERY_ELEVATION_MAX_DEG = 89.5;

const DEG = Math.PI / 180;

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

/** Unit vector from the target toward the camera for an azimuth / elevation. */
export function orbitDirection(azimuthDeg: number, elevationDeg: number): Vec3 {
  const az = finite(azimuthDeg, 0) * DEG;
  const el = Math.min(Math.max(finite(elevationDeg, 0), -GALLERY_ELEVATION_MAX_DEG), GALLERY_ELEVATION_MAX_DEG) * DEG;
  return [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)];
}

/** Centre and radius of the sphere enclosing the bounds (radius never 0). */
export function boundsSphere(bounds: GalleryBounds): { center: Vec3; radius: number } {
  const center: Vec3 = [
    (bounds.min[0] + bounds.max[0]) / 2,
    (bounds.min[1] + bounds.max[1]) / 2,
    (bounds.min[2] + bounds.max[2]) / 2,
  ];
  const dx = bounds.max[0] - bounds.min[0];
  const dy = bounds.max[1] - bounds.min[1];
  const dz = bounds.max[2] - bounds.min[2];
  return { center, radius: Math.max(0.5 * Math.hypot(dx, dy, dz), 1e-3) };
}

/** The angular radius (radians) that makes a sphere `sizePx` tall in a `viewportPx`-tall view of `fovDeg`. */
export function angularRadiusFor(sizePx: number, viewportPx: number, fovDeg: number): number {
  const ratio = Math.max(finite(sizePx, 1), 1) / Math.max(finite(viewportPx, 1), 1);
  const alpha = Math.atan(ratio * Math.tan((fovDeg * DEG) / 2));
  // Never wider than the camera can hold without standing inside the sphere.
  return Math.min(alpha, 85 * DEG);
}

export function galleryCameraPose(bounds: GalleryBounds, input: GalleryCameraInput, viewportHeightPx: number): GalleryCameraPose {
  const { center, radius } = boundsSphere(bounds);
  const dir = orbitDirection(input.azimuthDeg, input.elevationDeg);
  if (input.inside === true) {
    return {
      position: [...center],
      target: [center[0] + dir[0] * radius, center[1] + dir[1] * radius, center[2] + dir[2] * radius],
      fov: GALLERY_INSIDE_FOV_DEG,
      near: radius * 0.002,
      far: radius * 8,
    };
  }
  const alpha = angularRadiusFor(input.sizePx, viewportHeightPx, GALLERY_FOV_DEG);
  const distance = radius / Math.sin(alpha);
  return {
    position: [center[0] + dir[0] * distance, center[1] + dir[1] * distance, center[2] + dir[2] * distance],
    target: [...center],
    fov: GALLERY_FOV_DEG,
    near: Math.max(distance - radius * 1.1, distance * 0.01),
    far: distance + radius * 4,
  };
}
