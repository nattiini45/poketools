"""
Blender-first world props: headless generator for the world inventory's
wave-2 mesh assets.

Project rule: build in Blender where possible; the Meshy fallback is capped.
Every asset here is a hard-surface architectural/natural form, so ALL nine
inventory mesh rows are Blender-built (0 credits); the Meshy fallback tooling
exists (props-c107-meshy.mjs) but no call was justified.

Assets (slug -> theme row):
  sakura-torii-hero            myojin torii, hero mass (inventory ~18k tris)
  sakura-stone-lantern-tall    kasuga-style lantern (inventory ~14k ea)
  sakura-stone-lantern-low     yukimi (snow-viewing) lantern
  mountain-ridge-arch          stone ridge arch hero (inventory ~20k)
  mountain-cairn-small         cairn marker set 1/3 (inventory 3-8k)
  mountain-cairn-medium        cairn marker set 2/3
  mountain-cairn-tall          cairn marker set 3/3
  clouds-airship-hull          broadside airship hull (inventory 10-15k;
                               [C-095 r1] hullYaw law: long axis X, face -Y)
  clouds-halo-gate             floating halo gate hero (inventory ~20k)

Authoring conventions (mirror facade-kit.py):
  - Blender Z-up, base at z=0 (the airship hull is the one centered-at-origin
    body: it flies, and placement code seats bounds anyway);
  - the exporter's Y-up conversion turns Blender -Y (the prop's face) into
    glTF +Z, so faces read forward in three.js;
  - named material slots (wood_red, wood_dark, stone, stone_dark, stone_light,
    moss, lichen, gold, brass, canvas, glass, warmglow, cloud) so theme
    reworks (C-102..104 textureRoles upgrades) can rebind materials;
  - NO textures, NO Draco — plain GLB; transform.mjs keeps it that way
    (the browser loads plain GLB, no decoder worker).

Usage:
  blender -b --python-exit-code 1 -P world-props-c107.py -- <out dir> [slugs...]
"""

import math
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Vector

# --- material palette -------------------------------------------------------
# (base color RGBA, roughness, metallic)
MATERIALS = {
    "wood_red": ((0.550, 0.145, 0.078, 1.0), 0.62, 0.0),
    "wood_dark": ((0.115, 0.075, 0.058, 1.0), 0.58, 0.0),
    "stone": ((0.585, 0.575, 0.545, 1.0), 0.92, 0.0),
    "stone_dark": ((0.395, 0.395, 0.380, 1.0), 0.94, 0.0),
    "stone_light": ((0.720, 0.705, 0.665, 1.0), 0.90, 0.0),
    "moss": ((0.235, 0.330, 0.140, 1.0), 0.95, 0.0),
    "lichen": ((0.420, 0.470, 0.255, 1.0), 0.95, 0.0),
    "gold": ((0.830, 0.640, 0.220, 1.0), 0.35, 0.85),
    "brass": ((0.640, 0.520, 0.300, 1.0), 0.38, 0.85),
    "canvas": ((0.870, 0.845, 0.780, 1.0), 0.85, 0.0),
    "glass": ((0.640, 0.760, 0.800, 1.0), 0.15, 0.0),
    "warmglow": ((0.980, 0.760, 0.420, 1.0), 0.60, 0.0),
    "cloud": ((0.930, 0.940, 0.965, 1.0), 0.98, 0.0),
}


def material(name):
    mat = bpy.data.materials.get(name)
    if mat is None:
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
        bsdf = mat.node_tree.nodes.get("Principled BSDF")
        if bsdf is not None:
            color, roughness, metallic = MATERIALS[name]
            if "Base Color" in bsdf.inputs:
                bsdf.inputs["Base Color"].default_value = color
            if "Roughness" in bsdf.inputs:
                bsdf.inputs["Roughness"].default_value = roughness
            if "Metallic" in bsdf.inputs:
                bsdf.inputs["Metallic"].default_value = metallic
    return mat


def jitter(seed, i, j=0.0):
    """Deterministic hash noise in [-1, 1] (glsl-style fract(sin) hash)."""
    v = math.sin(i * 12.9898 + j * 78.233 + seed * 37.719) * 43758.5453
    return (v - math.floor(v)) * 2.0 - 1.0


class Prop:
    """Accumulates parts into one bmesh; each face carries a material index."""

    def __init__(self, name, slots=None):
        self.name = name
        self.bm = bmesh.new()
        self.slots = list(slots) if slots else list(MATERIALS.keys())

    def _slot(self, mat_name):
        return self.slots.index(mat_name)

    def _append(self, part, mat_name, transform, smooth=False):
        for face in part.faces:
            face.material_index = self._slot(mat_name)
            face.smooth = smooth
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
            width = min(bevel, min(abs(sx), abs(sy), abs(sz)) * 0.45)
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

    def cylinder(self, mat_name, radius, height, centre, segments=16, rot=None, radius2=None):
        """Vertical (Z) cylinder or cone; radius2 tapers toward +Z."""
        part = bmesh.new()
        bmesh.ops.create_cone(
            part,
            cap_ends=True,
            segments=segments,
            radius1=radius,
            radius2=radius if radius2 is None else radius2,
            depth=height,
        )
        m = Matrix.Translation(Vector(centre))
        if rot is not None:
            m = m @ rot
        self._append(part, mat_name, m)

    def torus(self, mat_name, radius, thickness, centre, major=32, minor=8, rot=None):
        """Torus around the Z axis (a horizontal molding ring) by default."""
        part = bmesh.new()
        grid = []
        for i in range(major):
            a = 2 * math.pi * i / major
            row = []
            for j in range(minor):
                b = 2 * math.pi * j / minor
                r = radius + thickness * math.cos(b)
                row.append(part.verts.new((r * math.cos(a), r * math.sin(a), thickness * math.sin(b))))
            grid.append(row)
        for i in range(major):
            for j in range(minor):
                part.faces.new((
                    grid[i][j],
                    grid[i][(j + 1) % minor],
                    grid[(i + 1) % major][(j + 1) % minor],
                    grid[(i + 1) % major][j],
                ))
        part.normal_update()
        m = Matrix.Translation(Vector(centre))
        if rot is not None:
            m = m @ rot
        self._append(part, mat_name, m)

    def sphere(self, mat_name, radius, centre, u=16, v=12, jitter_amt=0.0, seed=0, scale=(1.0, 1.0, 1.0), smooth=True):
        """UV sphere with optional deterministic per-vertex radius jitter."""
        part = bmesh.new()
        rows = []
        for j in range(1, v):
            phi = math.pi * j / v
            z = math.cos(phi)
            r = math.sin(phi)
            row = []
            for i in range(u):
                a = 2 * math.pi * i / u
                jr = radius * (1.0 + jitter_amt * jitter(seed, i, j))
                row.append(part.verts.new((jr * r * math.cos(a), jr * r * math.sin(a), jr * z)))
            rows.append(row)
        top = part.verts.new((0.0, 0.0, radius))
        bottom = part.verts.new((0.0, 0.0, -radius))
        row = rows[0]  # bottom cap (fan from the first latitude ring only)
        part.faces.new((bottom, row[0], row[1 % u]))
        for i in range(1, u - 1):
            part.faces.new((bottom, row[i], row[(i + 1) % u]))
        for j in range(len(rows) - 1):  # quads
            r0, r1 = rows[j], rows[j + 1]
            for i in range(u):
                part.faces.new((r0[i], r1[i], r1[(i + 1) % u], r0[(i + 1) % u]))
        row = rows[-1]  # top cap
        part.faces.new((row[0], top, row[1 % u]))
        for i in range(1, u - 1):
            part.faces.new((row[i], top, row[(i + 1) % u]))
        part.normal_update()
        sx, sy, sz = scale
        m = Matrix.Translation(Vector(centre)) @ Matrix.Diagonal(Vector((sx, sy, sz, 1.0)))
        self._append(part, mat_name, m, smooth=smooth)

    def arch_band(self, mat_name, width, rise, thickness, depth, centre, segments=24):
        """Curved band over a span (extruded along Y) — kasagi beams, arch rings."""
        part = bmesh.new()
        half = width / 2
        radius = (half * half + rise * rise) / (2 * rise)
        cy = -(radius - rise)
        theta = math.asin(min(half / radius, 1.0))
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
            part.faces.new((fi0, fi1, fo1, fo0))
            part.faces.new((bo0, bo1, bi1, bi0))
            part.faces.new((fo0, fo1, bo1, bo0))
            part.faces.new((bi0, bi1, fi1, fi0))
        part.faces.new((front[0][0], front[0][1], back[0][1], back[0][0]))
        part.faces.new((back[-1][0], back[-1][1], front[-1][1], front[-1][0]))
        part.normal_update()
        self._append(part, mat_name, Matrix.Translation(Vector(centre)))

    def finish(self, tile=1.0):
        """Box-project UVs in metres and hand back a Blender object."""
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
                loop[uv_layer].uv = (u / tile, v / tile)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
        mesh = bpy.data.meshes.new(self.name)
        bm.to_mesh(mesh)
        tri = sum(len(p.vertices) - 2 for p in mesh.polygons)
        bm.free()
        for slot in self.slots:
            mesh.materials.append(material(slot))
        obj = bpy.data.objects.new(self.name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        print(f"c107: {self.name} ~{tri} tris (pre-export)")
        return obj


# --- sakura: torii gate hero --------------------------------------------------


def build_torii():
    p = Prop("sakura-torii-hero")
    half_span = 2.1  # pillar centres
    for sx in (-1, 1):
        x = sx * half_span
        p.box("stone", (1.15, 1.15, 0.14), (x, 0.0, 0.07), bevel=0.03)  # footing pad
        p.cylinder("stone", 0.50, 0.32, (x, 0.0, 0.30), segments=64, radius2=0.40)  # kamebara
        p.torus("stone", 0.44, 0.07, (x, 0.0, 0.50), major=72, minor=8)  # base molding
        p.cylinder("wood_red", 0.34, 2.95, (x, 0.0, 2.12), segments=64, radius2=0.29)  # shinbashira
        p.torus("wood_red", 0.315, 0.035, (x, 0.0, 1.30), major=72, minor=6)
        p.torus("wood_red", 0.30, 0.035, (x, 0.0, 2.35), major=72, minor=6)
        p.torus("wood_red", 0.31, 0.065, (x, 0.0, 3.55), major=72, minor=8)  # daiwa
        p.cylinder("wood_red", 0.28, 0.14, (x, 0.0, 3.68), segments=64)  # cap
    # nuki tie beams (the double-beam ryozuki), penetrating both pillars
    for z in (2.02, 1.52):
        p.box("wood_red", (5.0, 0.30, 0.34), (0.0, 0.0, z), bevel=0.04)
        for sx in (-1, 1):
            p.cylinder(
                "wood_red", 0.17, 0.36, (sx * 2.52, 0.0, z), segments=32,
                rot=Matrix.Rotation(math.pi / 2, 4, "Y"),  # axis along the beam (X)
            )
    # kusabi wedges decorating the upper nuki
    for sx in (-1, 1):
        p.box("wood_dark", (0.16, 0.42, 0.26), (sx * 2.3, 0.0, 2.02), bevel=0.02)
    # gakuzuka plaque column between nuki and shimaki
    p.box("wood_red", (0.46, 0.22, 0.62), (0.0, 0.0, 2.55), bevel=0.03)
    p.box("gold", (0.34, 0.05, 0.46), (0.0, -0.10, 2.55))
    p.box("wood_dark", (0.30, 0.02, 0.40), (0.0, -0.135, 2.55))
    p.sphere("gold", 0.055, (0.0, -0.14, 2.55), u=16, v=12)
    for dz in (-0.26, 0.0, 0.26):  # plaque frame bars
        p.box("wood_dark", (0.40, 0.045, 0.05), (0.0, -0.10, 2.55 + dz))
    for dx in (-0.185, 0.185):
        p.box("wood_dark", (0.045, 0.045, 0.57), (dx, -0.10, 2.55))
    # shimaki secondary beam + curved kasagi assembly
    p.box("wood_red", (4.3, 0.42, 0.30), (0.0, 0.0, 3.10), bevel=0.03)
    p.arch_band("wood_red", 4.7, 0.26, 0.20, 0.46, (0.0, 0.0, 3.42), segments=52)
    p.arch_band("wood_dark", 5.6, 0.34, 0.26, 0.54, (0.0, 0.0, 3.78), segments=64)  # kasagi
    p.arch_band("wood_dark", 5.2, 0.30, 0.09, 0.58, (0.0, 0.0, 3.60), segments=56)  # under-cove
    # sorimashi upturn blocks at the kasagi ends
    for sx in (-1, 1):
        for k, (w, h) in enumerate(((0.50, 0.10), (0.36, 0.09), (0.24, 0.08))):
            p.box(
                "wood_dark", (w, 0.50 - 0.04 * k, h),
                (sx * (2.35 + 0.12 * (2 - k)), 0.0, 4.02 + 0.14 * k + 0.16 * (2 - k)),
                bevel=0.02,
            )
    # rafter row under the kasagi
    for i in range(19):
        x = -2.1 + 4.2 * i / 18
        p.cylinder(
            "wood_red", 0.045, 0.34, (x, 0.0, 3.30), segments=12,
            rot=Matrix.Rotation(math.pi / 2, 4, "X"),
        )
    # hanging bell cords with small suzu bells
    for sx in (-1, 1):
        for k in range(6):
            p.cylinder("wood_dark", 0.012, 0.24, (sx * 0.62, 0.0, 3.02 - 0.24 * k), segments=6)
        p.sphere("gold", 0.075, (sx * 0.62, 0.0, 2.62), u=16, v=12, scale=(1.0, 1.0, 0.85))
        p.cylinder("gold", 0.016, 0.10, (sx * 0.62, 0.0, 2.76), segments=8)
    return p.finish()


# --- sakura: stone lanterns ---------------------------------------------------


def _lantern_roof(p, z, r, apex_h, major, minor, upturns=6):
    """Hexagonal kasa roof: brim torus, cone, upturned corners, ribs."""
    p.torus("stone", r, 0.075, (0.0, 0.0, z), major=major, minor=minor)
    p.cylinder("stone", r * 0.96, apex_h, (0.0, 0.0, z + apex_h / 2), segments=major, radius2=0.06)
    p.cylinder("stone_dark", r * 0.80, 0.05, (0.0, 0.0, z + 0.035), segments=major)
    for i in range(upturns):
        a = 2 * math.pi * i / upturns
        rot = Matrix.Rotation(a, 4, "Z") @ Matrix.Rotation(0.5, 4, "X")
        p.box("stone", (0.20, 0.09, 0.16), (r * 0.86 * math.cos(a), r * 0.86 * math.sin(a), z + 0.10), rot=rot)
        p.box(
            "stone_dark", (0.05, 0.04, apex_h * 0.9),
            (r * 0.55 * math.cos(a), r * 0.55 * math.sin(a), z + apex_h * 0.55),
            rot=Matrix.Rotation(a, 4, "Z"),
        )


def build_lantern_tall():
    p = Prop("sakura-stone-lantern-tall")
    # base: stacked slabs + hex plinth + grounding ring
    p.box("stone", (1.02, 1.02, 0.16), (0.0, 0.0, 0.08), bevel=0.03)
    p.box("stone", (0.86, 0.86, 0.14), (0.0, 0.0, 0.23), bevel=0.03)
    p.box("stone", (0.72, 0.72, 0.12), (0.0, 0.0, 0.36), bevel=0.03)
    p.cylinder("stone", 0.36, 0.20, (0.0, 0.0, 0.52), segments=12)
    p.cylinder("stone_dark", 0.38, 0.05, (0.0, 0.0, 0.645), segments=12)
    p.torus("stone", 0.50, 0.055, (0.0, 0.0, 0.16), major=56, minor=8)
    # sao shaft with flutes and collars
    p.cylinder("stone", 0.165, 0.92, (0.0, 0.0, 1.13), segments=24)
    p.torus("stone", 0.20, 0.045, (0.0, 0.0, 0.86), major=32, minor=6)
    p.torus("stone", 0.185, 0.04, (0.0, 0.0, 1.44), major=32, minor=6)
    for i in range(10):
        a = 2 * math.pi * i / 10
        p.box(
            "stone_dark", (0.05, 0.04, 0.78),
            (0.155 * math.cos(a), 0.155 * math.sin(a), 1.13),
            rot=Matrix.Rotation(a, 4, "Z"),
        )
    # chudai platform
    p.cylinder("stone", 0.40, 0.15, (0.0, 0.0, 1.68), segments=32)
    p.cylinder("stone_light", 0.34, 0.06, (0.0, 0.0, 1.785), segments=12)
    # hibukuro firebox: corner posts + slabs + framed windows + warm core
    p.cylinder("stone", 0.34, 0.06, (0.0, 0.0, 1.865), segments=12)
    for i in range(6):
        a = 2 * math.pi * i / 6
        px, pz = 0.29 * math.cos(a), 0.29 * math.sin(a)
        p.cylinder("stone", 0.062, 0.44, (px, pz, 2.115), segments=24)
        wa = a + math.pi / 6  # window centred between posts
        wx, wz = 0.29 * math.cos(wa), 0.29 * math.sin(wa)
        rot = Matrix.Rotation(wa, 4, "Z")
        for dz in (-0.15, 0.15):
            p.box("stone_dark", (0.045, 0.26, 0.05), (wx, wz, 2.115 + dz), rot=rot)
        p.box("stone_dark", (0.045, 0.26, 0.035), (wx, wz, 1.955), rot=rot)  # sill
        for dt in (-0.105, 0.105):
            off = Vector((math.cos(wa + dt), math.sin(wa + dt), 0.0)) * 0.13
            p.box("stone_dark", (0.045, 0.05, 0.35), (wx + off.x, wz + off.y, 2.115), rot=rot)
        p.box("stone_dark", (0.03, 0.04, 0.35), (wx, wz, 2.115), rot=rot)  # mullion
    p.box("warmglow", (0.40, 0.40, 0.34), (0.0, 0.0, 2.115))
    p.sphere("warmglow", 0.14, (0.0, 0.0, 2.06), u=10, v=7)
    p.cylinder("stone", 0.32, 0.06, (0.0, 0.0, 2.365), segments=12)
    # kasa roof two tiers + hoju jewel
    _lantern_roof(p, 2.46, 0.60, 0.30, major=56, minor=8)
    _lantern_roof(p, 2.74, 0.34, 0.20, major=48, minor=6, upturns=6)
    p.cylinder("stone_light", 0.075, 0.10, (0.0, 0.0, 3.02), segments=12)
    p.sphere("stone_light", 0.135, (0.0, 0.0, 3.20), u=40, v=28)
    p.torus("stone_light", 0.10, 0.03, (0.0, 0.0, 3.09), major=32, minor=6)
    # suzu bell chained under the eave
    p.cylinder("wood_dark", 0.012, 0.18, (0.30, -0.30, 2.32), segments=6)
    p.cylinder("brass", 0.055, 0.09, (0.30, -0.30, 2.18), segments=12, radius2=0.075)
    p.sphere("brass", 0.028, (0.30, -0.30, 2.125), u=10, v=7)
    # moss accents
    for i, (x, y, z, s) in enumerate((
        (0.30, 0.10, 0.30, 0.16), (-0.26, -0.20, 0.245, 0.13), (0.10, -0.32, 0.60, 0.11),
        (-0.31, 0.16, 0.70, 0.10), (0.34, -0.12, 1.66, 0.09), (-0.33, -0.05, 1.71, 0.08),
        (0.24, 0.24, 2.44, 0.10), (-0.18, 0.26, 2.47, 0.09), (0.40, 0.22, 0.10, 0.11),
        (-0.38, 0.28, 0.09, 0.10),
    )):
        p.sphere("moss", s, (x, y, z), u=14, v=10, jitter_amt=0.35, seed=40 + i, scale=(1.0, 1.0, 0.45))
    return p.finish()


def build_lantern_low():
    p = Prop("sakura-stone-lantern-low")
    # three curved yukimi legs with feet pads
    for i in range(3):
        a = math.pi / 2 + 2 * math.pi * i / 3
        ca, sa = math.cos(a), math.sin(a)
        p.cylinder("stone", 0.14, 0.05, (0.62 * ca, 0.62 * sa, 0.025), segments=24)
        for k, (rr, zz, lean) in enumerate(((0.58, 0.16, 0.55), (0.46, 0.34, 0.95), (0.36, 0.50, 1.35))):
            rot = Matrix.Rotation(a, 4, "Z") @ Matrix.Rotation(lean, 4, "Y")
            p.box("stone", (0.30 - 0.04 * k, 0.22 - 0.03 * k, 0.22), (rr * ca, rr * sa, zz), bevel=0.03, rot=rot)
        p.sphere("stone_dark", 0.06, (0.20 * ca, 0.20 * sa, 0.60), u=10, v=7)
    # body drum with rims and flutes
    p.cylinder("stone", 0.35, 0.30, (0.0, 0.0, 0.68), segments=56)
    p.torus("stone", 0.335, 0.045, (0.0, 0.0, 0.82), major=56, minor=6)
    p.torus("stone", 0.335, 0.045, (0.0, 0.0, 0.55), major=56, minor=6)
    p.cylinder("stone", 0.42, 0.10, (0.0, 0.0, 0.47), segments=24)
    p.torus("stone_dark", 0.40, 0.045, (0.0, 0.0, 0.44), major=48, minor=6)
    for i in range(12):
        a = 2 * math.pi * i / 12
        p.box(
            "stone_dark", (0.045, 0.035, 0.26),
            (0.315 * math.cos(a), 0.315 * math.sin(a), 0.68),
            rot=Matrix.Rotation(a, 4, "Z"),
        )
    # firebox: drum, three framed windows, warm core
    p.cylinder("stone_light", 0.30, 0.10, (0.0, 0.0, 0.88), segments=12)
    p.cylinder("stone", 0.28, 0.26, (0.0, 0.0, 1.06), segments=12)
    p.box("warmglow", (0.34, 0.34, 0.20), (0.0, 0.0, 1.06))
    p.sphere("warmglow", 0.10, (0.0, 0.0, 1.03), u=10, v=7)
    for i in range(3):
        a = math.pi / 2 + 2 * math.pi * i / 3
        wx, wz = 0.27 * math.cos(a), 0.27 * math.sin(a)
        rot = Matrix.Rotation(a, 4, "Z")
        for dz in (-0.07, 0.07):
            p.box("stone_dark", (0.04, 0.24, 0.04), (wx, wz, 1.06 + dz), rot=rot)
        p.box("stone_dark", (0.03, 0.24, 0.03), (wx, wz, 0.985), rot=rot)  # sill
        for dt in (-0.09, 0.09):
            off = Vector((math.cos(a + dt), math.sin(a + dt), 0.0)) * 0.115
            p.box("stone_dark", (0.04, 0.04, 0.22), (wx + off.x, wz + off.y, 1.06), rot=rot)
        p.box("stone_dark", (0.025, 0.04, 0.22), (wx, wz, 1.06), rot=rot)  # mullion
    p.cylinder("stone_light", 0.30, 0.07, (0.0, 0.0, 1.225), segments=12)
    # wide yukimi roof + small hoju
    _lantern_roof(p, 1.30, 0.72, 0.26, major=80, minor=8, upturns=6)
    p.cylinder("stone_light", 0.06, 0.09, (0.0, 0.0, 1.62), segments=10)
    p.sphere("stone_light", 0.10, (0.0, 0.0, 1.74), u=24, v=18)
    # suzu bell chained under the eave
    p.cylinder("wood_dark", 0.012, 0.16, (0.34, -0.34, 1.14), segments=6)
    p.cylinder("brass", 0.045, 0.08, (0.34, -0.34, 1.02), segments=12, radius2=0.065)
    p.sphere("brass", 0.024, (0.34, -0.34, 0.975), u=10, v=7)
    # moss + pebbles at the feet
    for i, (x, y, z, s) in enumerate((
        (0.42, 0.20, 0.12, 0.13), (-0.30, 0.38, 0.10, 0.12), (0.05, -0.48, 0.11, 0.14),
        (-0.44, -0.18, 0.60, 0.10), (0.36, -0.22, 0.86, 0.08), (0.50, 0.28, 0.05, 0.10),
        (-0.55, 0.10, 0.05, 0.09), (-0.15, -0.55, 0.04, 0.08), (0.62, -0.05, 0.04, 0.09),
        (-0.42, -0.42, 0.05, 0.08),
    )):
        p.sphere("moss" if i < 5 else "stone_dark", s, (x, y, z), u=14, v=10, jitter_amt=0.35, seed=70 + i, scale=(1.0, 1.0, 0.5))
    return p.finish()


# --- mountain: ridge arch + cairn set -----------------------------------------


def build_ridge_arch():
    p = Prop("mountain-ridge-arch")
    inner_r = 2.5
    depth = 1.7
    arch_cz = 3.2   # arch circle centre: the voussoir ring bottoms out at z=0
    deck_z = 5.8    # abutment-top / parapet spring line (clears the extrados)
    # voussoir ring: 19 beveled stones along the semicircle + keystone
    n_voussoirs = 19
    for i in range(n_voussoirs):
        t = math.pi * (i + 0.5) / n_voussoirs
        rr = inner_r + 0.42
        pos = (rr * math.sin(t), 0.0, arch_cz + rr * math.cos(t))
        p.box("stone", (0.62, depth, 0.52), pos, bevel=0.04, rot=Matrix.Rotation(-t, 4, "Y"))
    p.box("stone_light", (0.46, depth + 0.08, 0.66), (0.0, 0.0, arch_cz + inner_r + 0.44), bevel=0.05)
    # intrados shadow band inside the ring
    p.arch_band("stone_dark", inner_r * 2, inner_r, 0.10, depth - 0.12, (0.0, 0.0, arch_cz), segments=56)
    # abutments: stacked, jittered courses both sides
    for sx in (-1, 1):
        for c in range(9):
            z = 0.26 + c * 0.52
            w = 1.55 - 0.03 * c
            jx = jitter(11 + sx, c) * 0.05
            p.box("stone", (w, depth - 0.02 * c, 0.50), (sx * (2.9 + 0.10 * c) + jx, jitter(3, c) * 0.04, z), bevel=0.045)
        for c in range(4):  # protruding bond stones
            z = 1.0 + c * 0.9
            p.box("stone_dark", (0.34, depth + 0.10, 0.40), (sx * 2.62, jitter(5, c) * 0.2, z), bevel=0.03)
        # spandrel fill above the arch haunches (flush under the parapet)
        for c in range(2):
            z = 5.02 + c * 0.45
            p.box("stone", (1.35 - 0.06 * c, depth - 0.05 * c, 0.43), (sx * 1.05, 0.0, z), bevel=0.04)
    # parapets: an arched band springing from the abutment tops + studs on the arc
    rp = (inner_r * inner_r + 0.55 * 0.55) / (2 * 0.55)
    cyp = -(rp - 0.55)
    for sy in (-1, 1):
        y = sy * (depth / 2 + 0.12)
        p.arch_band("stone", inner_r * 2, 0.55, 0.30, 0.24, (0.0, y, deck_z), segments=44)
        for sx in (-1, 1):  # parapet end posts on the springs
            p.box("stone", (0.42, 0.30, 0.56), (sx * inner_r, y, deck_z + 0.26), bevel=0.04)
        for i in range(4):  # coping studs following the parapet arc
            x = 0.7 * i - 1.05
            zb = deck_z + cyp + math.sqrt(rp * rp - x * x) + 0.20
            p.box("stone_dark", (0.38, 0.26, 0.14), (x, y, zb), bevel=0.02)
    # approach path slabs
    for i, (x, w) in enumerate(((-3.4, 1.4), (-4.6, 1.2), (3.4, 1.4), (4.6, 1.2))):
        p.box("stone_dark", (w, depth + 0.5, 0.12), (x, jitter(7, i) * 0.15, 0.06), bevel=0.02)
    # rubble skirt + lichen + flanking boulders
    for i in range(36):
        a = math.pi * 0.15 + math.pi * 0.7 * i / 35
        side = -1 if i % 2 == 0 else 1
        x = side * (1.9 + 1.5 * abs(jitter(21, i)) + 0.8 * math.sin(a))
        r = 0.22 + 0.10 * abs(jitter(23, i))
        z = max(0.38 + 1.6 * abs(jitter(22, i)) * math.cos(a), 1.2 * r)
        p.sphere(
            "stone_dark", r, (x, jitter(24, i) * 0.55, z),
            u=12, v=9, jitter_amt=0.45, seed=30 + i, scale=(1.2, 0.9, 0.8),
        )
    for i in range(9):
        p.sphere(
            "lichen", 0.16 + 0.06 * abs(jitter(31, i)),
            ((i - 4) * 0.7, -(depth / 2 + 0.02), 1.2 + abs(jitter(32, i)) * 2.2),
            u=10, v=7, jitter_amt=0.3, seed=50 + i, scale=(1.0, 0.25, 1.0),
        )
    for i, x in enumerate((-4.5, -3.7, 3.8, 4.6, -5.2, 5.3)):
        r = 0.55 + 0.18 * abs(jitter(41, i))
        p.sphere(
            "stone", r, (x, jitter(42, i) * 0.4, r * 0.95 + 0.1),
            u=16, v=12, jitter_amt=0.4, seed=60 + i, scale=(1.25, 1.0, 0.8),
        )
    return p.finish()


def build_cairstone(slug, n_stones, seed, target_h, slab=True):
    p = Prop(slug)
    stones = []
    z = 0.0
    for i in range(n_stones):
        frac = i / max(n_stones - 1, 1)
        r = 0.30 - 0.16 * frac + 0.05 * abs(jitter(seed, i))
        x = jitter(seed + 1, i) * 0.10 * (1.0 - frac)
        y = jitter(seed + 2, i) * 0.10 * (1.0 - frac)
        z += r * 0.85
        stones.append([x, y, z, r])
        z += r * 0.55
    # normalize the stack to its authored real-world height (PB-166: props
    # carry authored metres; placement rescales from recorded bounds)
    raw_h = z - stones[-1][3] * 0.55 + stones[-1][3] * 0.85
    scale_z = target_h / raw_h
    for s in stones:
        s[2] *= scale_z
        s[3] *= min(1.0, 0.45 + 0.55 * scale_z)  # radii shrink less: keep caps chubby
    if slab:
        p.box("stone_dark", (0.95, 0.95, 0.14), (0.0, 0.0, 0.07), bevel=0.03)
    for i, (x, y, zz, r) in enumerate(stones):
        p.sphere(
            "stone", r, (x, y, zz + (0.14 if slab else 0.0)),
            u=16, v=12, jitter_amt=0.30, seed=seed + 3 + i, scale=(1.15, 0.95, 0.72),
        )
    # small wedges locking the top stone
    tx, ty, tz, tr = stones[-1]
    for i in range(3):
        a = 2 * math.pi * i / 3
        p.sphere(
            "stone_dark", tr * 0.45,
            (tx + math.cos(a) * tr * 0.9, ty + math.sin(a) * tr * 0.9, tz + (0.14 if slab else 0.0) + tr * 0.15),
            u=12, v=8, jitter_amt=0.35, seed=seed + 40 + i, scale=(1.0, 1.0, 0.6),
        )
    return p.finish()


def build_cairstone_small():
    return build_cairstone("mountain-cairn-small", 9, 101, 0.85)


def build_cairstone_medium():
    return build_cairstone("mountain-cairn-medium", 15, 201, 1.35)


def build_cairstone_tall():
    return build_cairstone("mountain-cairn-tall", 20, 301, 1.9)


# --- clouds: airship hull + halo gate -----------------------------------------


def build_airship_hull():
    """Broadside hull ([C-095 r1] hullYaw law): long axis X, face on -Y/+Z."""
    p = Prop("clouds-airship-hull")
    # gasbag hull: ellipsoid, long X (u rings around Y), centered at origin
    p.sphere("canvas", 1.0, (0.0, 0.0, 0.0), u=64, v=36, scale=(3.8, 1.32, 1.30))
    # brass band rings around the bag
    for x in (-2.1, -0.4, 1.3):
        rr = 1.32 * math.cos(math.asin(max(-1.0, min(1.0, x / 3.8))))
        p.torus("brass", rr * 0.99, 0.055, (x, 0.0, 0.0), major=48, minor=6, rot=Matrix.Rotation(math.pi / 2, 4, "Y"))
    # spine ridge along the top
    p.arch_band("brass", 5.4, 0.22, 0.08, 0.16, (0.0, 0.0, 1.26), segments=40)
    # stern fins (canvas over brass frames) — three, 120 deg apart, tail -X;
    # each fin is a plate in the YZ plane (local +Y is the radial span).
    for i in range(3):
        a = 2 * math.pi * i / 3 + math.pi / 6
        ca, sa = math.cos(a), math.sin(a)
        rot = Matrix.Rotation(a, 4, "X")
        p.box("canvas", (1.30, 0.80, 0.06), (-3.15, 0.52 * ca, 0.52 * sa), bevel=0.03, rot=rot)
        p.box("brass", (1.38, 0.10, 0.10), (-3.15, 0.92 * ca, 0.92 * sa), bevel=0.02, rot=rot)
        p.box("brass", (1.38, 0.10, 0.10), (-3.15, 0.22 * ca, 0.22 * sa), bevel=0.02, rot=rot)
    # bow ornament + bowsprit
    p.cylinder("brass", 0.34, 0.55, (3.85, 0.0, 0.0), segments=24, radius2=0.10,
               rot=Matrix.Rotation(math.pi / 2, 4, "Y"))
    p.sphere("gold", 0.12, (4.16, 0.0, 0.0), u=14, v=10)
    # gondola keel: cabin + glazed strip + suspension struts
    p.box("wood_dark", (2.3, 0.86, 0.62), (0.35, 0.0, -1.75), bevel=0.05)
    p.box("brass", (2.42, 0.94, 0.10), (0.35, 0.0, -2.11), bevel=0.03)
    for i in range(8):
        p.box("glass", (0.16, 0.05, 0.24), (-0.55 + 0.25 * i, -0.45, -1.69))
        p.box("brass", (0.05, 0.07, 0.30), (-0.55 + 0.25 * i, -0.47, -1.69))
    for sx in (-0.30, 1.0):
        for sy in (-0.30, 0.30):
            p.cylinder("brass", 0.045, 0.30, (sx, sy, -1.40), segments=8)
    # porthole rings on the bag flanks (hole axis along ±Y)
    for sy in (-1, 1):
        for i in range(5):
            x = -1.4 + 0.7 * i
            rr = 1.32 * math.sqrt(max(0.0, 1.0 - (x / 3.8) ** 2)) * 0.62
            rot = Matrix.Rotation(-math.pi / 2 if sy > 0 else math.pi / 2, 4, "X")
            p.torus("brass", 0.14, 0.035, (x, sy * rr, 0.18), major=16, minor=4, rot=rot)
            p.cylinder("glass", 0.125, 0.03, (x, sy * (rr + 0.005), 0.18), segments=12,
                       rot=Matrix.Rotation(math.pi / 2, 4, "X"))
    # stern propeller ring + hub + blades
    p.torus("brass", 0.52, 0.06, (-4.05, 0.0, 0.0), major=32, minor=5, rot=Matrix.Rotation(math.pi / 2, 4, "Y"))
    p.sphere("brass", 0.16, (-4.05, 0.0, 0.0), u=16, v=12)
    for i in range(3):
        a = 2 * math.pi * i / 3
        p.box("canvas", (0.06, 0.42, 0.14), (-4.05, 0.30 * math.cos(a), 0.30 * math.sin(a)),
              bevel=0.01, rot=Matrix.Rotation(a, 4, "X"))
    # tail lantern + bow hawse rings
    p.sphere("warmglow", 0.10, (-3.6, 0.0, -0.55), u=12, v=8)
    p.cylinder("brass", 0.015, 0.5, (-3.6, 0.0, -0.3), segments=6)
    for sy in (-1, 1):
        p.torus("brass", 0.09, 0.03, (3.0, sy * 0.68, -0.28), major=16, minor=4,
                rot=Matrix.Rotation(-math.pi / 2 if sy > 0 else math.pi / 2, 4, "X"))
    return p.finish()


def build_halo_gate():
    p = Prop("clouds-halo-gate")
    ring_z = 2.65
    # main gold ring + pale stone lips
    p.torus("gold", 1.95, 0.20, (0.0, 0.0, ring_z), major=88, minor=14)
    p.torus("stone_light", 1.72, 0.07, (0.0, 0.0, ring_z), major=80, minor=8)
    p.torus("stone_light", 2.16, 0.06, (0.0, 0.0, ring_z), major=80, minor=8)
    # beaded rim: small spheres strung around the outer edge
    for i in range(16):
        a = 2 * math.pi * i / 16
        p.sphere("gold", 0.085, (2.16 * math.cos(a), 2.16 * math.sin(a), ring_z), u=12, v=8)
    # floating inner ring with gems + outward spikes on the main ring
    p.torus("stone_light", 1.22, 0.085, (0.0, 0.0, ring_z), major=64, minor=8)
    for i in range(8):
        a = 2 * math.pi * i / 8
        p.sphere("gold", 0.16, (1.22 * math.cos(a), 1.22 * math.sin(a), ring_z), u=14, v=10)
        p.cylinder(
            "gold", 0.05, 0.30, (1.95 * math.cos(a), 1.95 * math.sin(a), ring_z),
            segments=10, radius2=0.0,
            rot=Matrix.Rotation(a, 4, "Z") @ Matrix.Rotation(math.pi / 2, 4, "Y"),
        )
    # emblem core
    p.sphere("gold", 0.30, (0.0, 0.0, ring_z), u=24, v=18)
    p.torus("stone_light", 0.44, 0.045, (0.0, 0.0, ring_z), major=32, minor=6)
    # cloud base: a drifting cumulus pedestal
    for i, (x, y, z, s) in enumerate((
        (0.0, 0.0, 0.34, 0.62), (0.55, 0.18, 0.22, 0.42), (-0.52, -0.14, 0.24, 0.44),
        (0.18, -0.48, 0.18, 0.38), (-0.24, 0.44, 0.16, 0.36), (0.72, -0.30, 0.10, 0.26),
        (-0.70, 0.30, 0.12, 0.28), (0.35, 0.35, 0.52, 0.30), (-0.38, 0.10, 0.50, 0.28),
    )):
        p.sphere("cloud", s, (x, y, z), u=14, v=10, jitter_amt=0.16, seed=80 + i, scale=(1.25, 1.05, 0.72))
    # tassels hanging from the main ring
    for i in range(6):
        a = 2 * math.pi * i / 6 + math.pi / 12
        bx, by = 1.95 * math.cos(a), 1.95 * math.sin(a)
        for k in range(4):
            drop = 0.30 + 0.24 * k
            sway = 0.03 * k
            p.sphere("gold", 0.055 - 0.005 * k,
                     (bx + sway * math.cos(a), by + sway * math.sin(a), ring_z - drop), u=10, v=7)
    return p.finish()


# --- export -------------------------------------------------------------------


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
    print(f"c107: wrote {path}")


BUILDERS = {
    "sakura-torii-hero": build_torii,
    "sakura-stone-lantern-tall": build_lantern_tall,
    "sakura-stone-lantern-low": build_lantern_low,
    "mountain-ridge-arch": build_ridge_arch,
    "mountain-cairn-small": build_cairstone_small,
    "mountain-cairn-medium": build_cairstone_medium,
    "mountain-cairn-tall": build_cairstone_tall,
    "clouds-airship-hull": build_airship_hull,
    "clouds-halo-gate": build_halo_gate,
}


def main():
    argv = sys.argv
    tail = argv[argv.index("--") + 1:] if "--" in argv else []
    out_dir = tail[0] if tail else "."
    slugs = tail[1:] if len(tail) > 1 else list(BUILDERS.keys())
    Path(out_dir).mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for slug in slugs:
        export(BUILDERS[slug](), out_dir)


main()
