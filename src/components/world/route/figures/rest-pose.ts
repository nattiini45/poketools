import * as THREE from 'three';

/**
 * Sketchfab-sourced rips ship bipeds in a T-pose whenever no animation is
 * baked in (241 of 285 plaza figures have no clips). The rigs share
 * Mixamo-style joint names (`LShoulder → LArm → LForeArm → LHand`, optional
 * `_NN` suffix), which is enough to lower the arms procedurally: each upper
 * arm that points sideways is rotated to hang beside the body, then the
 * forearm gets a small forward bend. Quadrupeds (front legs already point
 * down) and figures without these joints are left untouched.
 */

const UPPER_ARM = /^(L|R)Arm(_\d+)?$/;
const FOREARM = /^(L|R)ForeArm(_\d+)?$/;
const HAND = /^(L|R)Hand(_\d+)?$/;

/** Above this |y| component an arm already hangs (or is raised) — not a T-pose. */
const SIDEWAYS_LIMIT = 0.55;

const scratch = {
  from: new THREE.Vector3(),
  to: new THREE.Vector3(),
  dir: new THREE.Vector3(),
  target: new THREE.Vector3(),
  q: new THREE.Quaternion(),
  parent: new THREE.Quaternion(),
  parentInv: new THREE.Quaternion(),
};

function findChild(bone: THREE.Object3D, pattern: RegExp): THREE.Object3D | null {
  let found: THREE.Object3D | null = null;
  bone.traverse((node) => {
    if (!found && node !== bone && pattern.test(node.name)) found = node;
  });
  return found;
}

/**
 * Rotate `bone` so the world-space segment bone→child points along `target`.
 * With `onlyIfSideways` the bone is left alone unless it currently sticks out
 * horizontally — the T-pose signature.
 */
function aimSegment(
  bone: THREE.Object3D,
  child: THREE.Object3D,
  target: THREE.Vector3,
  onlyIfSideways: boolean,
): boolean {
  bone.getWorldPosition(scratch.from);
  child.getWorldPosition(scratch.to);
  scratch.dir.subVectors(scratch.to, scratch.from);
  if (scratch.dir.lengthSq() < 1e-8) return false;
  scratch.dir.normalize();
  if (onlyIfSideways && Math.abs(scratch.dir.y) > SIDEWAYS_LIMIT) return false;

  scratch.q.setFromUnitVectors(scratch.dir, target);
  if (bone.parent) {
    bone.parent.getWorldQuaternion(scratch.parent);
  } else {
    scratch.parent.identity();
  }
  scratch.parentInv.copy(scratch.parent).invert();
  // World-space delta → bone-local: Ql' = Qp⁻¹ · Qw · Qp · Ql
  bone.quaternion.premultiply(scratch.parent).premultiply(scratch.q).premultiply(scratch.parentInv);
  bone.updateMatrixWorld(true);
  return true;
}

/**
 * Lower T-posed arms in place. Returns how many arms were relaxed so callers
 * can tell a fixed biped from an untouched quadruped.
 */
export function relaxTPose(root: THREE.Object3D): number {
  root.updateMatrixWorld(true);
  const upperArms: THREE.Object3D[] = [];
  root.traverse((node) => {
    if (UPPER_ARM.test(node.name)) upperArms.push(node);
  });

  let relaxed = 0;
  for (const arm of upperArms) {
    const forearm = findChild(arm, FOREARM);
    if (!forearm) continue;
    arm.getWorldPosition(scratch.from);
    forearm.getWorldPosition(scratch.to);
    const side = Math.sign(scratch.to.x - scratch.from.x) || 1;

    // Upper arm: down, a little out from the body, a touch forward.
    scratch.target.set(side * 0.26, -0.94, 0.1).normalize();
    if (!aimSegment(arm, forearm, scratch.target, true)) continue;

    // Forearm: continue down with a slight forward bend at the elbow.
    const hand = findChild(forearm, HAND);
    if (hand) {
      scratch.target.set(side * 0.12, -0.82, 0.55).normalize();
      aimSegment(forearm, hand, scratch.target, false);
    }
    relaxed += 1;
  }
  return relaxed;
}
