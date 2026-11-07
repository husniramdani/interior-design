"""Parametric table collection, built by AI through Blender MCP.

Five designs share one toolkit. Every part is assigned a material *slot*
("Top", "Frame", "Accent"). The website swaps finishes per slot at runtime,
so colours stay customisable without re-exporting.

Run inside Blender:  ns = runpy.run_path(".../tables.py"); ns["build_all"]()
Units: meters, Z up, origin at floor centre.
"""
import bpy, bmesh, math, os, json
from mathutils import Vector

PROJECT = os.path.expanduser("~/Projects/interior-3d")
TEX = os.path.join(PROJECT, "public/textures")
CATALOG = json.load(open(os.path.join(PROJECT, "src/catalog.json")))
EXPORT_DIR = os.path.join(PROJECT, "blender/export")
TEX_TILE_M = 1.0  # world meters per texture tile (must match website)

# --------------------------------------------------------------------------- scene utils
def clear_scene():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.images, bpy.data.cameras, bpy.data.lights):
        for d in list(coll):
            if d.users == 0:
                coll.remove(d)

def hex_lin(h):
    h = h.lstrip("#"); c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    lin = [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]
    return (*lin, 1.0)

# --------------------------------------------------------------------------- materials
def finish_material(slot, finish_id):
    """Blender preview material for a slot (only used for renders/thumbnails)."""
    f = CATALOG["finishes"][finish_id]
    m = bpy.data.materials.get(slot) or bpy.data.materials.new(slot)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        if n.type not in ("BSDF_PRINCIPLED", "OUTPUT_MATERIAL"):
            nt.nodes.remove(n)
    bsdf = nt.nodes["Principled BSDF"]
    for l in [l for k in ("Base Color", "Normal", "Roughness") for l in bsdf.inputs[k].links]:
        nt.links.remove(l)
    if f["type"] == "wood":
        uv = nt.nodes.new("ShaderNodeTexCoord")
        mp = nt.nodes.new("ShaderNodeMapping")
        mp.inputs["Rotation"].default_value[2] = math.pi / 2 if f["rotate"] else 0
        nt.links.new(uv.outputs["UV"], mp.inputs["Vector"])
        def img(name, non_color):
            n = nt.nodes.new("ShaderNodeTexImage")
            n.image = bpy.data.images.load(os.path.join(TEX, name), check_existing=True)
            if non_color:
                n.image.colorspace_settings.name = "Non-Color"
            nt.links.new(mp.outputs["Vector"], n.inputs["Vector"])
            return n
        diff = img(f"{f['tex']}_diff.webp", False)
        nor = img(f"{f['tex']}_nor.webp", True)
        rgh = img(f"{f['tex']}_rough.webp", True)
        rmul = nt.nodes.new("ShaderNodeMath"); rmul.operation = "MULTIPLY"; rmul.inputs[1].default_value = 0.95
        nt.links.new(rgh.outputs["Color"], rmul.inputs[0])
        nt.links.new(rmul.outputs["Value"], bsdf.inputs["Roughness"])
        mix = nt.nodes.new("ShaderNodeMix"); mix.data_type = "RGBA"; mix.blend_type = "MULTIPLY"
        mix.inputs["Factor"].default_value = 1.0
        nt.links.new(diff.outputs["Color"], mix.inputs["A"])
        mix.inputs["B"].default_value = hex_lin(f["tint"])
        nt.links.new(mix.outputs["Result"], bsdf.inputs["Base Color"])
        nm = nt.nodes.new("ShaderNodeNormalMap"); nm.inputs["Strength"].default_value = 0.6
        nt.links.new(nor.outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
        bsdf.inputs["Metallic"].default_value = 0.0
    else:
        # flat colour + generated micro-surface (same maps/scales as the website)
        bsdf.inputs["Base Color"].default_value = hex_lin(f["color"])
        bsdf.inputs["Metallic"].default_value = f["metalness"]
        uv = nt.nodes.new("ShaderNodeTexCoord")
        mp = nt.nodes.new("ShaderNodeMapping")
        mp.inputs["Scale"].default_value = (1 / f["scale"], 1 / f["scale"], 1)
        nt.links.new(uv.outputs["UV"], mp.inputs["Vector"])
        def simg(k):
            n = nt.nodes.new("ShaderNodeTexImage")
            n.image = bpy.data.images.load(os.path.join(TEX, f"surf_{f['surface']}_{k}.webp"), check_existing=True)
            n.image.colorspace_settings.name = "Non-Color"
            nt.links.new(mp.outputs["Vector"], n.inputs["Vector"])
            return n
        rgh, nor = simg("rough"), simg("nor")
        rmul = nt.nodes.new("ShaderNodeMath"); rmul.operation = "MULTIPLY"
        rmul.inputs[1].default_value = f["roughness"]
        nt.links.new(rgh.outputs["Color"], rmul.inputs[0])
        nt.links.new(rmul.outputs["Value"], bsdf.inputs["Roughness"])
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nm.inputs["Strength"].default_value = {"brushed": 0.35, "powder": 0.22}.get(f["surface"], 0.07)
        nt.links.new(nor.outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    return m

def slot_mat(slot):
    return bpy.data.materials.get(slot) or bpy.data.materials.new(slot)

# --------------------------------------------------------------------------- UVs
def world_uv(obj, grain_axis):
    """Box-project UVs in world meters; U follows the wood grain axis."""
    me = obj.data
    bm = bmesh.new(); bm.from_mesh(me)
    uv = bm.loops.layers.uv.verify()
    mw = obj.matrix_world; s = 1.0 / TEX_TILE_M
    for f in bm.faces:
        n = (mw.to_3x3() @ f.normal).normalized()
        ax = max(range(3), key=lambda i: abs(n[i]))
        others = [i for i in range(3) if i != ax]
        u_ax = grain_axis if grain_axis in others else others[0]
        v_ax = [i for i in others if i != u_ax][0]
        for l in f.loops:
            co = mw @ l.vert.co
            l[uv].uv = (co[u_ax] * s, co[v_ax] * s)
    bm.to_mesh(me); bm.free()

# --------------------------------------------------------------------------- primitives
def _finish(obj, slot, grain, bevel=0.0, segs=3, angle=30):
    obj.data.materials.append(slot_mat(slot))
    if bevel > 0:
        b = obj.modifiers.new("Bevel", "BEVEL")
        b.width = bevel; b.segments = segs; b.limit_method = "ANGLE"
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier="Bevel")
    bpy.ops.object.select_all(action="DESELECT"); obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(angle))
    world_uv(obj, grain)
    return obj

def box(name, size, center, slot, bevel=0.002, grain=None):
    bpy.ops.mesh.primitive_cube_add(size=1, location=center)
    o = bpy.context.object; o.name = name; o.scale = size
    bpy.ops.object.transform_apply(scale=True)
    if grain is None:
        grain = max(range(3), key=lambda i: size[i])
    return _finish(o, slot, grain, bevel)

def disc(name, radius, thick, z_bottom, slot, bevel=0.004, verts=128):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=radius, depth=thick,
                                        location=(0, 0, z_bottom + thick / 2))
    o = bpy.context.object; o.name = name
    return _finish(o, slot, 0, bevel)

def rod(name, p0, p1, r0, r1, slot, verts=32):
    """Tapered round rod from p0 (radius r0) to p1 (radius r1)."""
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r0, radius2=r1, depth=d.length,
                                    location=(p0 + p1) / 2)
    o = bpy.context.object; o.name = name
    o.rotation_euler = Vector((0, 0, 1)).rotation_difference(d.normalized()).to_euler()
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    return _finish(o, slot, 2, 0, angle=50)

def lathe(name, profile, slot, segs=96):
    """Revolve a list of (radius, z) points around Z."""
    bm = bmesh.new()
    vs = [bm.verts.new((r, 0, z)) for r, z in profile]
    for a, b in zip(vs, vs[1:]):
        bm.edges.new((a, b))
    bmesh.ops.spin(bm, geom=bm.verts[:] + bm.edges[:], cent=(0, 0, 0), axis=(0, 0, 1),
                   angle=2 * math.pi, steps=segs, use_duplicate=False)
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me); bpy.context.collection.objects.link(o)
    return _finish(o, slot, 2, 0, angle=35)

def join(name, objs):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    t = bpy.context.object; t.name = name
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return t

# --------------------------------------------------------------------------- designs
def build_lisa():
    L, W, H, T = 1.40, 0.78, 0.74, 0.028
    parts = [box("top", (L, W, T), (0, 0, H - T / 2), "Top", bevel=0.004, grain=0)]
    xi, yi, splay = L / 2 - 0.08, W / 2 - 0.08, 0.05  # splay: horizontal foot offset (m)
    for sx in (-1, 1):
        for sy in (-1, 1):
            top = (sx * xi, sy * yi, H - T + 0.004)  # tuck 4 mm into the top
            foot = (sx * (xi + splay * 0.9), sy * (yi + splay * 0.6), 0)
            leg = rod("leg", foot, top, 0.016, 0.024, "Frame")
            sit_on_floor(leg)
            parts.append(leg)
    return join("lisa", parts)

def sit_on_floor(o):
    """Tilted rods dip their cap edge below z=0; lift so the lowest point touches the floor."""
    minz = min((o.matrix_world @ v.co).z for v in o.data.vertices)
    o.location.z -= minz
    bpy.context.view_layer.update()

def build_studio():
    L, W, H, T = 1.20, 0.60, 0.75, 0.025
    parts = [box("top", (L, W, T), (0, 0, H - T / 2), "Top", bevel=0.003, grain=0)]
    uh = H - T                      # unit / leg height
    uw, ud = 0.40, 0.56             # drawer unit width, depth
    ux = L / 2 - 0.01 - uw / 2      # unit centre x
    parts.append(box("unit", (uw, ud, uh), (ux, 0.0, uh / 2), "Frame", bevel=0.002, grain=2))
    # three drawer fronts (proud of the body), gaps 4 mm, plinth 3 cm
    plinth, gap, ft = 0.03, 0.004, 0.018
    fh = (uh - plinth - gap * 4) / 3
    front_y = -ud / 2 - ft / 2
    for i in range(3):
        z0 = plinth + gap + i * (fh + gap)
        parts.append(box(f"front{i}", (uw - 2 * gap, ft, fh), (ux, front_y, z0 + fh / 2), "Frame", bevel=0.0025, grain=0))
        hz = z0 + fh - 0.045
        hy = front_y - ft / 2 - 0.022
        parts.append(box(f"handle{i}", (0.14, 0.012, 0.012), (ux, hy, hz), "Accent", bevel=0.003))
        for px in (-0.055, 0.055):
            parts.append(box(f"post{i}", (0.008, 0.024, 0.008), (ux + px, hy + 0.012, hz), "Accent", bevel=0.002))
    # two square legs on the left and a back rail
    lx = -L / 2 + 0.035
    for sy in (-1, 1):
        parts.append(box("leg", (0.04, 0.04, uh), (lx, sy * (W / 2 - 0.035), uh / 2), "Frame", bevel=0.003, grain=2))
    rail_len = (ux - uw / 2) - lx
    parts.append(box("rail", (rail_len, 0.02, 0.08), (lx + rail_len / 2, W / 2 - 0.045, uh - 0.04), "Frame", bevel=0.002))
    return join("studio", parts)

def build_tulip():
    R, H, T = 0.50, 0.74, 0.025
    parts = [disc("top", R, T, H - T, "Top", bevel=0.008)]
    zt = H - T
    def r(z):  # sculpted pedestal radius
        return 0.042 + 0.23 * math.exp(-(z - 0.008) / 0.05) + 0.075 * math.exp(-(zt - z) / 0.035)
    # denser samples near the flared ends, sparse along the straight column
    ts = [i / 34 for i in range(35)]
    zs = [0.008 + (zt - 0.008) * (0.5 - 0.5 * math.cos(math.pi * t)) for t in ts]
    prof = [(0.0, 0.0), (r(0.008), 0.0)] + [(r(z), z) for z in zs] + [(0.0, zt)]
    parts.append(lathe("pedestal", prof, "Frame", segs=72))
    return join("tulip", parts)

def build_loft():
    L, W, H, T = 1.60, 0.80, 0.75, 0.04
    parts = [box("top", (L, W, T), (0, 0, H - T / 2), "Top", bevel=0.004, grain=0)]
    zt = H - T; t = 0.04  # steel tube size
    for sx in (-1, 1):
        x = sx * (L / 2 - 0.10)
        yi = W / 2 - 0.06
        for sy in (-1, 1):
            parts.append(box("post", (t, t, zt), (x, sy * yi, zt / 2), "Frame", bevel=0.003, grain=2))
        parts.append(box("toprail", (t, 2 * yi + t, t), (x, 0, zt - t / 2), "Frame", bevel=0.003, grain=1))
        parts.append(box("foot", (t, 2 * yi + t, t), (x, 0, t / 2), "Frame", bevel=0.003, grain=1))
    span = L - 0.20 - t
    for sy in (-1, 1):
        parts.append(box("stretcher", (span, 0.02, 0.06), (0, sy * (W / 2 - 0.10), zt - 0.03), "Frame", bevel=0.002))
    return join("loft", parts)

def build_orbit():
    R, H, T = 0.40, 0.45, 0.025
    parts = [disc("top", R, T, H - T, "Top", bevel=0.006)]
    parts.append(disc("shelf", 0.31, 0.018, 0.11, "Top", bevel=0.004))
    for k in range(4):
        a = math.pi / 4 + k * math.pi / 2
        x, y = 0.27 * math.cos(a), 0.27 * math.sin(a)
        parts.append(rod("leg", (x, y, 0), (x, y, H - T), 0.016, 0.019, "Frame"))
    return join("orbit", parts)

BUILDERS = {"lisa": build_lisa, "studio": build_studio, "tulip": build_tulip,
            "loft": build_loft, "orbit": build_orbit}

# --------------------------------------------------------------------------- export / render
def apply_colorway(table_id, idx=0):
    t = next(t for t in CATALOG["tables"] if t["id"] == table_id)
    for slot, fid in t["colorways"][idx]["slots"].items():
        finish_material(slot, fid)

def export_glb(obj, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT"); obj.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True,
                              export_yup=True, export_apply=True,
                              export_image_format="NONE")  # textures are applied by the website

def stats(obj):
    bb = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
    return {"tris": sum(len(p.vertices) - 2 for p in obj.data.polygons),
            "size_cm": [round((max(v[i] for v in bb) - min(v[i] for v in bb)) * 100, 1) for i in range(3)],
            "min_z": round(min(v.z for v in bb), 4),
            "slots": [m.name for m in obj.data.materials]}

def render(obj, path, res=(960, 720), samples=48, transparent=True):
    """Studio render framed on the object's bounding box."""
    sc = bpy.context.scene
    bb = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
    ctr = sum(bb, Vector()) / 8
    rad = max((v - ctr).length for v in bb)
    tmp = []
    bpy.ops.mesh.primitive_plane_add(size=20); fl = bpy.context.object; tmp.append(fl)
    fl.is_shadow_catcher = transparent
    fm = bpy.data.materials.new("QA_Floor"); fm.use_nodes = True
    fm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.8, 0.79, 0.77, 1)
    fl.data.materials.append(fm)
    bpy.ops.object.light_add(type="AREA", location=(ctr.x + 0.3, ctr.y - 0.3, 3.2)); k = bpy.context.object; tmp.append(k)
    k.data.energy = 300; k.data.size = 4.0  # big, nearly overhead => soft contact shadow only
    k.rotation_euler = (ctr - k.location).to_track_quat("-Z", "Y").to_euler()
    d = Vector((1.0, -1.05, 0.62)).normalized()
    bpy.ops.object.camera_add(location=ctr + d * rad * 3.7); cam = bpy.context.object; tmp.append(cam)
    cam.rotation_euler = (ctr - cam.location).to_track_quat("-Z", "Y").to_euler()
    cam.data.lens = 50; sc.camera = cam
    w = sc.world or bpy.data.worlds.new("World"); sc.world = w; w.use_nodes = True
    bg = w.node_tree.nodes["Background"]
    bg.inputs["Strength"].default_value = 0.45; bg.inputs["Color"].default_value = (0.9, 0.9, 0.92, 1)
    sc.render.engine = "CYCLES"; sc.cycles.samples = samples; sc.cycles.device = "CPU"
    sc.cycles.use_denoising = True
    sc.render.film_transparent = transparent
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA" if transparent else "RGB"
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.view_settings.view_transform = "AgX"
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    for o in tmp:
        bpy.data.objects.remove(o, do_unlink=True)

def build_one(table_id):
    clear_scene()
    obj = BUILDERS[table_id]()
    apply_colorway(table_id, 0)
    return obj
