"""
Haussmann façade kit — Blender headless generator.

Builds the bay modules `haussmann.ts` places on the plaza blocks and
exports each as a GLB with named material slots (`stone`, `iron`, `glass`,
`pane`, `zinc`) that the runtime rebinds to the block's shared materials:

  bay-ground      podium storey, tall arched window, rusticated joints
  bay-shopfront   podium storey, ground-floor shopfront / Poké Center corner
                  frontage: piers with plinth + capital, stall riser, recessed
                  glazing with the interior pane PROUD of the glass (C-050:
                  opaque runtime glass occludes a pane behind it) and a
                  front-glazing pane PROUD of the interior pane (C-062: a
                  measurable dark-glass surface at every lit bay), fascia sign
                  band (pane slot = lit sign at night)
  bay-balcony     standard storey, French window, moulded architrave, iron balcony
  bay-plain       standard storey, French window, architrave, console sill
  dormer          mansard dormer (zinc hood, small window)

Dimensions mirror HAUSSMANN in src/lib/route-world/haussmann.ts. Module origin:
x centred on the bay, y = storey floor line, z = 0 at the façade plane; the
exporter's Y-up conversion turns Blender -Y (toward the plaza) into glTF +Z.

Usage (from kit-assets.mjs):
  blender -b -P facade-kit.py -- <out dir>
"""

import math
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Vector

# --- HAUSSMANN mirror ---------------------------------------------------------
BAY_W = 2.55
FLOOR_H = 3.2
PODIUM_H = 3.55
WIN_W = 0.88
WIN_H = 1.62
SILL = 0.92  # window centre above floor line, upper storeys
GROUND_WIN_W = WIN_W + 0.08
GROUND_WIN_H = WIN_H + 0.28
GROUND_CENTRE = SILL + 0.62
JAMB = 0.22
ARCHITRAVE = 0.08
REVEAL_SPLAY = 0.12
WINDOW_RECESS = 0.26
BALCONY_DEPTH = 0.32
STONE_TILE = 1.55

MATERIALS = {
    "stone": (0.86, 0.80, 0.68, 1.0),
    "iron": (0.12, 0.11, 0.10, 1.0),
    "glass": (0.08, 0.09, 0.10, 1.0),
    "pane": (0.20, 0.16, 0.12, 1.0),
    "zinc": (0.36, 0.40, 0.45, 1.0),
}


def material(name):
    mat = bpy.data.materials.get(name)
    if mat is None:
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
        bsdf = mat.node_tree.nodes.get("Principled BSDF")
        if bsdf is not None:
            bsdf.inputs["Base Color"].default_value = MATERIALS[name]
            bsdf.inputs["Roughness"].default_value = 0.9 if name == "stone" else 0.5
            if name == "iron" or name == "zinc":
                bsdf.inputs["Metallic"].default_value = 0.6
    return mat


class Bay:
    """Accumulates parts into one bmesh; each part carries a material index."""

    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.slots = list(MATERIALS.keys())

    def _slot(self, mat_name):
        return self.slots.index(mat_name)

    def _append(self, part, mat_name, transform):
        for face in part.faces:
            face.material_index = self._slot(mat_name)
            face.smooth = False
        bmesh.ops.transform(part, matrix=transform, verts=part.verts)
        tmp = bpy.data.meshes.new("tmp")
        part.to_mesh(tmp)
        part.free()
        self.bm.from_mesh(tmp)
        bpy.data.meshes.remove(tmp)

    def box(self, mat_name, size, centre, bevel=0.0, rot=None):
        sx, sy, sz = size
        part = bmesh.new()
        bmesh.ops.create_cube(part, size=1.0)
        bmesh.ops.scale(part, vec=Vector((sx, sy, sz)), verts=part.verts)
        if bevel > 0:
            width = min(bevel, min(sx, sy, sz) * 0.45)
            bmesh.ops.bevel(
                part,
                geom=list(part.edges),
                offset=width,
                segments=2,
                profile=0.7,
                affect="EDGES",
            )
        m = Matrix.Translation(Vector(centre))
        if rot is not None:
            m = m @ rot
        self._append(part, mat_name, m)

    def cylinder(self, mat_name, radius, height, centre, segments=10, rot=None):
        part = bmesh.new()
        bmesh.ops.create_cone(
            part,
            cap_ends=True,
            segments=segments,
            radius1=radius,
            radius2=radius,
            depth=height,
        )
        m = Matrix.Translation(Vector(centre))
        if rot is not None:
            m = m @ rot
        self._append(part, mat_name, m)

    def ring(self, mat_name, radius, thickness, centre, segments=16):
        """Torus lying in the XZ plane (façade plane) for balcony scrollwork."""
        part = bmesh.new()
        prof = 6
        verts = []
        for i in range(segments):
            a = 2 * math.pi * i / segments
            ring = []
            for j in range(prof):
                b = 2 * math.pi * j / prof
                r = radius + thickness * math.cos(b)
                ring.append(part.verts.new((r * math.cos(a), thickness * math.sin(b), r * math.sin(a))))
            verts.append(ring)
        for i in range(segments):
            for j in range(prof):
                a0 = verts[i][j]
                a1 = verts[i][(j + 1) % prof]
                b0 = verts[(i + 1) % segments][j]
                b1 = verts[(i + 1) % segments][(j + 1) % prof]
                part.faces.new((a0, b0, b1, a1))
        part.normal_update()
        self._append(part, mat_name, Matrix.Translation(Vector(centre)))

    def quad(self, mat_name, a, b, c, d):
        part = bmesh.new()
        va, vb, vc, vd = (part.verts.new(p) for p in (a, b, c, d))
        part.faces.new((va, vb, vc, vd))
        part.normal_update()
        self._append(part, mat_name, Matrix.Identity(4))

    def arch_slab(self, mat_name, width, rise, thickness, depth, centre, segments=12):
        """Segmental arch head: a curved band over a window (extruded along Y)."""
        part = bmesh.new()
        half = width / 2
        radius = (half * half + rise * rise) / (2 * rise)
        cy = -(radius - rise)
        theta = math.asin(half / radius)
        inner = []
        outer = []
        for i in range(segments + 1):
            t = -theta + 2 * theta * i / segments
            x = radius * math.sin(t)
            z = cy + radius * math.cos(t)
            xo = (radius + thickness) * math.sin(t)
            zo = cy + (radius + thickness) * math.cos(t)
            inner.append((x, z))
            outer.append((xo, zo))
        front = []
        back = []
        for (xi, zi), (xo, zo) in zip(inner, outer):
            front.append((part.verts.new((xi, -depth / 2, zi)), part.verts.new((xo, -depth / 2, zo))))
            back.append((part.verts.new((xi, depth / 2, zi)), part.verts.new((xo, depth / 2, zo))))
        for i in range(segments):
            fi0, fo0 = front[i]
            fi1, fo1 = front[i + 1]
            bi0, bo0 = back[i]
            bi1, bo1 = back[i + 1]
            part.faces.new((fi0, fi1, fo1, fo0))  # front face
            part.faces.new((bo0, bo1, bi1, bi0))  # back face
            part.faces.new((fo0, fo1, bo1, bo0))  # outer curve
            part.faces.new((bi0, bi1, fi1, fi0))  # inner curve
        # end caps
        part.faces.new((front[0][0], front[0][1], back[0][1], back[0][0]))
        part.faces.new((back[-1][0], back[-1][1], front[-1][1], front[-1][0]))
        part.normal_update()
        self._append(part, mat_name, Matrix.Translation(Vector(centre)))

    def finish(self):
        """Box-project UVs in metres / STONE_TILE and hand back a Blender object."""
        bm = self.bm
        uv_layer = bm.loops.layers.uv.new("UVMap")
        for face in bm.faces:
            n = face.normal
            ax = max(range(3), key=lambda i: abs(n[i]))
            for loop in face.loops:
                co = loop.vert.co
                if ax == 0:
                    u, v = co.y, co.z
                elif ax == 1:
                    u, v = co.x, co.z
                else:
                    u, v = co.x, co.y
                loop[uv_layer].uv = (u / STONE_TILE, v / STONE_TILE)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
        mesh = bpy.data.meshes.new(self.name)
        bm.to_mesh(mesh)
        bm.free()
        for slot in self.slots:
            mesh.materials.append(material(slot))
        obj = bpy.data.objects.new(self.name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        return obj


# --- shared assemblies ----------------------------------------------------------


def window_assembly(bay, cx, cz, w, h, recess=WINDOW_RECESS, mullions=True):
    """Splayed reveal + timber frame + glass + interior pane, inside a wall hole w×h."""
    splay = REVEAL_SPLAY
    # reveal: four trapezoids from the hole edge (y=0) to the recessed frame (y=recess)
    xl, xr = cx - w / 2, cx + w / 2
    zb, zt = cz - h / 2, cz + h / 2
    xl1, xr1 = xl + splay, xr - splay
    zb1, zt1 = zb + splay, zt - splay
    y0, y1 = -0.02, recess
    bay.quad("stone", (xl, y0, zb), (xl, y0, zt), (xl1, y1, zt1), (xl1, y1, zb1))
    bay.quad("stone", (xr, y0, zb), (xr1, y1, zb1), (xr1, y1, zt1), (xr, y0, zt))
    bay.quad("stone", (xl, y0, zt), (xr, y0, zt), (xr1, y1, zt1), (xl1, y1, zt1))
    bay.quad("stone", (xl, y0, zb), (xl1, y1, zb1), (xr1, y1, zb1), (xr, y0, zb))
    fw, fh = xr1 - xl1, zt1 - zb1
    # frame
    t = 0.07
    fy = recess + 0.02
    bay.box("iron", (fw, 0.06, t), (cx, fy, zb1 + t / 2))
    bay.box("iron", (fw, 0.06, t), (cx, fy, zt1 - t / 2))
    bay.box("iron", (t, 0.06, fh), (xl1 + t / 2, fy, cz))
    bay.box("iron", (t, 0.06, fh), (xr1 - t / 2, fy, cz))
    if mullions:
        bay.box("iron", (0.05, 0.06, fh), (cx, fy, cz))
        bay.box("iron", (fw, 0.06, 0.05), (cx, fy, cz + fh * 0.18))
    # glass + pane behind
    bay.box("glass", (fw - 0.06, 0.012, fh - 0.06), (cx, fy + 0.03, cz))
    bay.box("pane", (fw - 0.1, 0.02, fh - 0.1), (cx, fy + 0.14, cz))


def architrave(bay, cx, cz, w, h, proud=ARCHITRAVE, band=JAMB):
    """Moulded surround on the wall face; bevelled so the light catches an edge."""
    d = proud
    bay.box("stone", (band, d, h + band * 2), (cx - w / 2 - band / 2, -d / 2, cz), bevel=0.02)
    bay.box("stone", (band, d, h + band * 2), (cx + w / 2 + band / 2, -d / 2, cz), bevel=0.02)
    bay.box("stone", (w + band * 2, d, band), (cx, -d / 2, cz + h / 2 + band / 2), bevel=0.02)
    # entablature: a second, slimmer lintel step above the head
    bay.box("stone", (w + band * 2 + 0.16, d + 0.05, 0.1), (cx, -(d + 0.05) / 2, cz + h / 2 + band + 0.05), bevel=0.015)


def sill(bay, cx, cz, w, h, depth=0.18, thick=0.09):
    bay.box("stone", (w + 0.36, depth, thick), (cx, -depth / 2, cz - h / 2 - thick / 2), bevel=0.02)
    # two consoles under the sill
    for ox in (-w / 2 - 0.02, w / 2 + 0.02):
        bay.box("stone", (0.12, 0.12, 0.2), (cx + ox, -0.06, cz - h / 2 - thick - 0.1), bevel=0.02)


def balcony(bay, cx, cz_floor, w):
    depth = BALCONY_DEPTH
    slab_w = w + 0.7
    z = cz_floor + 0.04
    bay.box("stone", (slab_w, depth, 0.08), (cx, -depth / 2, z), bevel=0.015)
    # consoles under the slab
    for ox in (-slab_w * 0.38, slab_w * 0.38):
        bay.box("stone", (0.14, depth * 0.8, 0.22), (cx + ox, -depth * 0.4, z - 0.15), bevel=0.02)
    # railing
    rail_z = z + 0.92
    y = -depth + 0.03
    bay.box("iron", (slab_w - 0.04, 0.03, 0.03), (cx, y, rail_z))
    bay.box("iron", (slab_w - 0.04, 0.025, 0.025), (cx, y, z + 0.1))
    bars = 11
    for i in range(bars):
        x = cx - (slab_w - 0.12) / 2 + (slab_w - 0.12) * i / (bars - 1)
        bay.cylinder("iron", 0.011, rail_z - z - 0.1, (x, y, (rail_z + z + 0.1) / 2), segments=6)
    # scroll rings between bar pairs
    step = (slab_w - 0.12) / (bars - 1)
    for i in range(0, bars - 1, 2):
        x = cx - (slab_w - 0.12) / 2 + step * (i + 0.5)
        bay.ring("iron", step * 0.36, 0.009, (x, y, z + 0.5))
    # side returns
    for sx in (-1, 1):
        x = cx + sx * (slab_w - 0.04) / 2
        bay.box("iron", (0.03, depth - 0.02, 0.03), (x, -depth / 2, rail_z))
        bay.cylinder("iron", 0.011, rail_z - z - 0.1, (x, -0.03, (rail_z + z + 0.1) / 2), segments=6)


def rustication(bay, height, joint_every=0.55):
    """Horizontal joint grooves on the podium wall, as thin recessed strips."""
    z = joint_every
    while z < height - 0.2:
        bay.box("pane", (BAY_W - 0.02, 0.02, 0.025), (0, 0.005, z))
        z += joint_every


# --- the four bays ---------------------------------------------------------------


def build_ground():
    bay = Bay("bay-ground")
    w, h, cz = GROUND_WIN_W, GROUND_WIN_H, GROUND_CENTRE
    rustication(bay, PODIUM_H)
    window_assembly(bay, 0, cz, w, h, recess=WINDOW_RECESS + 0.06)
    # pilaster-like jambs and a segmental arch head instead of a flat lintel
    d = ARCHITRAVE + 0.02
    bay.box("stone", (JAMB, d, h + 0.1), (-w / 2 - JAMB / 2, -d / 2, cz - 0.05), bevel=0.02)
    bay.box("stone", (JAMB, d, h + 0.1), (w / 2 + JAMB / 2, -d / 2, cz - 0.05), bevel=0.02)
    bay.arch_slab("stone", w + JAMB * 2, 0.22, 0.2, d, (0, -d / 2, cz + h / 2))
    # keystone
    bay.box("stone", (0.16, d + 0.04, 0.3), (0, -(d + 0.04) / 2, cz + h / 2 + 0.3), bevel=0.02)
    sill(bay, 0, cz, w, h, depth=0.16, thick=0.1)
    return bay.finish()


# --- shopfront / Poké Center corner ground module (card C-029) -------------------
# Mirrors emitShopfront in HaussmannBlock.tsx: same bay, pier, stall-riser and
# fascia dimensions so the procedural fallback and the GLB are interchangeable.
PIER_W = 0.5
PIER_H = 3.42
SHOP_GLASS_W = BAY_W - PIER_W * 2 - 0.16
RISER_H = 0.5
SHOP_GLASS_Z0 = RISER_H
SHOP_GLASS_Z1 = 2.78
SHOP_RECESS = 0.42
SHOP_SPLAY = 0.1
FASCIA_Z = 3.1
FASCIA_H = 0.64


def shopfront_reveal(bay):
    """Splayed reveal quads from the opening edge back to the glazing plane."""
    w = SHOP_GLASS_W
    xl, xr = -w / 2, w / 2
    zb, zt = SHOP_GLASS_Z0, SHOP_GLASS_Z1
    xl1, xr1 = xl + SHOP_SPLAY, xr - SHOP_SPLAY
    zb1, zt1 = zb + SHOP_SPLAY, zt - SHOP_SPLAY
    y0, y1 = -0.02, SHOP_RECESS
    bay.quad("stone", (xl, y0, zb), (xl, y0, zt), (xl1, y1, zt1), (xl1, y1, zb1))
    bay.quad("stone", (xr, y0, zb), (xr1, y1, zb1), (xr1, y1, zt1), (xr, y0, zt))
    bay.quad("stone", (xl, y0, zt), (xr, y0, zt), (xr1, y1, zt1), (xl1, y1, zt1))
    bay.quad("stone", (xl, y0, zb), (xl1, y1, zb1), (xr1, y1, zb1), (xr, y0, zb))


def build_shopfront():
    bay = Bay("bay-shopfront")
    cx_pier = BAY_W / 2 - PIER_W / 2 - 0.04
    # Piers: shaft with plinth and capital, rusticated joints for coursing.
    for sx in (-1, 1):
        bay.box("stone", (PIER_W, 0.2, PIER_H), (sx * cx_pier, 0.02, PIER_H / 2), bevel=0.02)
        bay.box("stone", (PIER_W + 0.1, 0.26, 0.6), (sx * cx_pier, -0.04, 0.3), bevel=0.02)
        bay.box("stone", (PIER_W + 0.1, 0.26, 0.18), (sx * cx_pier, -0.04, PIER_H - 0.09), bevel=0.015)
        for z in (1.2, 2.0):
            bay.box("glass", (PIER_W - 0.06, 0.03, 0.035), (sx * cx_pier, -0.075, z))
    # Stall riser between the piers, slightly recessed.
    bay.box("stone", (SHOP_GLASS_W, 0.2, RISER_H), (0, 0.03, RISER_H / 2), bevel=0.015)
    shopfront_reveal(bay)
    glass_h = SHOP_GLASS_Z1 - SHOP_GLASS_Z0
    glass_cz = (SHOP_GLASS_Z0 + SHOP_GLASS_Z1) / 2
    # Iron shopfront frame: outer case, centre mullion, transom bar.
    bay.box("iron", (SHOP_GLASS_W, 0.07, glass_h), (0, SHOP_RECESS - 0.02, glass_cz))
    bay.box("iron", (0.06, 0.05, glass_h), (0, SHOP_RECESS - 0.05, glass_cz))
    bay.box("iron", (SHOP_GLASS_W - 0.04, 0.05, 0.07), (0, SHOP_RECESS - 0.05, 2.12))
    # Glazing + interior pane (pane = lit sign / warm room). The pane rides
    # PROUD of the glazing front face (2 cm clear), not behind it: the runtime
    # rebinds the pane slot to an opaque lamp/glass material, so a pane behind
    # the opaque glass sheet can never read — lit interiors were invisible and
    # only the proud fascia strip pane showed (PB-180, card C-050). Rays from
    # the plaza now first-hit the pane, the glass bordering it behind.
    glass_y = SHOP_RECESS - 0.09
    bay.box("glass", (SHOP_GLASS_W - 0.1, 0.012, glass_h - 0.1), (0, glass_y, glass_cz))
    bay.box("pane", (SHOP_GLASS_W - 0.16, 0.02, glass_h - 0.16), (0, glass_y - 0.02, glass_cz))
    # Front-glazing pane (card C-062): a dark-glass display pane across the
    # opening's west half, PROUD of the interior lamp pane (whose C-050 lit
    # read-through keeps the east slot east of FRONT_SPLIT). The runtime glass
    # material is opaque, so this pane is the surface rays from the plaza
    # first-hit as glass at every lit bay — without it a lit bay exposed only
    # its #191309 lamp pane and no raycast/luma classifier could call
    # "glass" there (PB-283). Same glazing band and 1 cm standoff as the
    # interior pane, edges buried in the splayed reveal like the glass sheet.
    front_split = 0.12  # the lit display slot keeps the opening east of this
    front_w = (SHOP_GLASS_W - 0.1) / 2 + front_split
    bay.box(
        "glass",
        (front_w, 0.02, glass_h - 0.1),
        (-(SHOP_GLASS_W - 0.1) / 4 + front_split / 2, glass_y - 0.05, glass_cz),
    )
    # Fascia sign band between the pier capitals; pane strip sits proud on it.
    bay.box("stone", (BAY_W - 0.24, 0.18, FASCIA_H), (0, -0.03, FASCIA_Z), bevel=0.02)
    bay.box("pane", (BAY_W - 1.5, 0.05, 0.34), (0, -0.145, FASCIA_Z), bevel=0.01)
    for sx in (-1, 1):
        bay.box("stone", (0.16, 0.2, 0.24), (sx * (BAY_W / 2 - PIER_W - 0.12), -0.05, 2.66), bevel=0.015)
    return bay.finish()


def build_balcony():
    bay = Bay("bay-balcony")
    w, h, cz = WIN_W, WIN_H, SILL
    window_assembly(bay, 0, cz, w, h)
    architrave(bay, 0, cz, w, h)
    balcony(bay, 0, cz - h / 2 - 0.06, w)
    return bay.finish()


def build_plain():
    bay = Bay("bay-plain")
    w, h, cz = WIN_W, WIN_H, SILL
    window_assembly(bay, 0, cz, w, h)
    architrave(bay, 0, cz, w, h)
    sill(bay, 0, cz, w, h)
    # low iron guard instead of a balcony
    y = -0.06
    bay.box("iron", (w + 0.1, 0.025, 0.025), (0, y, cz - h / 2 + 0.72))
    for i in range(7):
        x = -w / 2 + w * i / 6
        bay.cylinder("iron", 0.009, 0.7, (x, y, cz - h / 2 + 0.36), segments=6)
    return bay.finish()


def build_dormer():
    bay = Bay("dormer")
    w, h = 0.72, 0.9
    body_d = 0.55
    # body sits on the mansard slope; origin at its footing, front at y=0
    bay.box("stone", (w + 0.2, body_d, h + 0.15), (0, body_d / 2, (h + 0.15) / 2), bevel=0.01)
    window_assembly(bay, 0, h / 2 + 0.05, w - 0.16, h - 0.2, recess=0.1, mullions=True)
    # zinc hood: two pitched slabs and a small pediment
    rot_l = Matrix.Rotation(math.radians(38), 4, "Y")
    rot_r = Matrix.Rotation(math.radians(-38), 4, "Y")
    bay.box("zinc", (0.62, body_d + 0.2, 0.04), (-0.2, body_d / 2 - 0.02, h + 0.36), rot=rot_l)
    bay.box("zinc", (0.62, body_d + 0.2, 0.04), (0.2, body_d / 2 - 0.02, h + 0.36), rot=rot_r)
    bay.box("zinc", (w + 0.3, 0.05, 0.08), (0, -0.02, h + 0.19))
    return bay.finish()


def export(obj, out_dir):
    for o in bpy.data.objects:
        o.select_set(o is obj)
    bpy.context.view_layer.objects.active = obj
    path = str(Path(out_dir) / f"{obj.name}.glb")
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_materials="EXPORT",
        export_image_format="NONE",
        export_yup=True,
        export_normals=True,
        export_texcoords=True,
        export_animations=False,
        export_skins=False,
        export_morph=False,
        export_lights=False,
        export_cameras=False,
    )
    print(f"kit: wrote {path}")


def main():
    argv = sys.argv
    out_dir = argv[argv.index("--") + 1] if "--" in argv else "."
    Path(out_dir).mkdir(parents=True, exist_ok=True)
    # Empty scene — the factory startup file carries a cube, camera and lamp.
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for builder in (build_ground, build_shopfront, build_balcony, build_plain, build_dormer):
        export(builder(), out_dir)


main()
