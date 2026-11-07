"""Book assets for table styling, built by AI through Blender MCP.

Each book is one object, lying flat, origin at bottom centre, spine on -X,
head on +Y. Sizes and colours come from src/catalog.json -> "books".
Exported together as public/models/books.glb (one node per book id, textures embedded).

Run inside Blender:
    ns = runpy.run_path(".../books.py")
    ns["export_books"]()            # build + export books.glb
    ns["stage_table"]("lisa")       # build a table (for renders / shadow bakes)
    ns["place_books"]("lisa", [("art_sage", 0.1, 0.05, 20)])  # preview a website arrangement
"""
import bpy, bmesh, math, os, runpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__)) if "__file__" in dir() else os.path.expanduser("~/Projects/interior-3d/blender")
T = runpy.run_path(os.path.join(HERE, "tables.py"))  # shared helpers + catalog
CATALOG = T["CATALOG"]
BOOKS = CATALOG["books"]
TEX = os.path.join(HERE, "book_textures")
PAGES_TILE = 0.06   # meters per page-texture tile (page lines ~0.5 mm apart: readable at viewing distance)
LINEN_TILE = 0.04   # meters per linen-weave tile


# ------------------------------------------------------------------ materials
def _img(name, non_color):
    im = bpy.data.images.load(os.path.join(TEX, name), check_existing=True)
    if non_color:
        im.colorspace_settings.name = "Non-Color"
    return im

def _tex_node(nt, image, uv_scale):
    uv = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (uv_scale, uv_scale, 1)
    n = nt.nodes.new("ShaderNodeTexImage"); n.image = image
    nt.links.new(uv.outputs["UV"], mp.inputs["Vector"])
    nt.links.new(mp.outputs["Vector"], n.inputs["Vector"])
    return n

def cover_material(book_id, color, cloth=True):
    """Book cloth: flat colour + woven normal/roughness (glTF-exportable node setup)."""
    name = f"Cover_{book_id}"
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True; nt = m.node_tree
    for n in list(nt.nodes):
        if n.type not in ("BSDF_PRINCIPLED", "OUTPUT_MATERIAL"):
            nt.nodes.remove(n)
    b = nt.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = T["hex_lin"](color)
    b.inputs["Metallic"].default_value = 0.0
    if cloth:
        # UVs are already in meters/LINEN_TILE, so mapping scale is 1 (glTF exports the texture directly)
        r = _tex_node(nt, _img("linen_rough.png", True), 1.0)
        sep = nt.nodes.new("ShaderNodeSeparateColor")  # glTF reads roughness from G
        nt.links.new(r.outputs["Color"], sep.inputs["Color"])
        nt.links.new(sep.outputs["Green"], b.inputs["Roughness"])
        nr = _tex_node(nt, _img("linen_nor.png", True), 1.0)
        nm = nt.nodes.new("ShaderNodeNormalMap"); nm.inputs["Strength"].default_value = 0.5
        nt.links.new(nr.outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs["Normal"], b.inputs["Normal"])
    else:  # paperback: smooth printed card stock
        b.inputs["Roughness"].default_value = 0.6
    return m

def pages_material():
    m = bpy.data.materials.get("Pages") or bpy.data.materials.new("Pages")
    m.use_nodes = True; nt = m.node_tree
    for n in list(nt.nodes):
        if n.type not in ("BSDF_PRINCIPLED", "OUTPUT_MATERIAL"):
            nt.nodes.remove(n)
    b = nt.nodes["Principled BSDF"]
    c = _tex_node(nt, _img("pages_col.png", False), 1.0)
    nt.links.new(c.outputs["Color"], b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = 0.85
    return m

def flat_material(name, color, rough, metal):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = T["hex_lin"](color)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    return m


# ------------------------------------------------------------------ geometry
def _uv(obj, tile, v_axis=2):
    """Box-project UVs in meters / tile. Side faces: V runs along Z (so page lines are horizontal)."""
    bm = bmesh.new(); bm.from_mesh(obj.data)
    uvl = bm.loops.layers.uv.verify()
    s = 1.0 / tile
    for f in bm.faces:
        n = f.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        others = [i for i in range(3) if i != ax]
        v_ax = v_axis if v_axis in others else others[1]
        u_ax = [i for i in others if i != v_ax][0]
        for l in f.loops:
            l[uvl].uv = (l.vert.co[u_ax] * s, l.vert.co[v_ax] * s)
    bm.to_mesh(obj.data); bm.free()

def _box(name, size, center, mat, bevel, segs=2, tile=LINEN_TILE):
    bpy.ops.mesh.primitive_cube_add(size=1, location=center)
    o = bpy.context.object; o.name = name; o.scale = size
    bpy.ops.object.transform_apply(location=True, scale=True)
    if bevel > 0:
        md = o.modifiers.new("Bevel", "BEVEL"); md.width = bevel; md.segments = segs
        md.limit_method = "ANGLE"
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.modifier_apply(modifier="Bevel")
    o.data.materials.append(mat)
    bpy.ops.object.select_all(action="DESELECT"); o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(35))
    _uv(o, tile)
    return o

def _spine(name, h, t, depth, x0, mat):
    """Rounded spine: half-elliptic tube along Y, bulging toward -X from x0."""
    bm = bmesh.new()
    segs = 12
    prof = []
    for i in range(segs + 1):
        a = -math.pi / 2 + math.pi * i / segs
        prof.append((x0 - depth * math.cos(a), t / 2 + (t / 2) * math.sin(a)))
    # inner flat side at x0 closes the shape
    ring_pts = prof + [(x0 + 0.0005, t), (x0 + 0.0005, 0.0)]
    rings = []
    for y in (-h / 2, h / 2):
        rings.append([bm.verts.new((x, y, z)) for x, z in ring_pts])
    n = len(ring_pts)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((rings[0][i], rings[0][j], rings[1][j], rings[1][i]))
    bm.faces.new(list(reversed(rings[0]))); bm.faces.new(rings[1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me); bpy.context.collection.objects.link(o)
    o.data.materials.append(mat)
    bpy.ops.object.select_all(action="DESELECT"); o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(50))
    _uv(o, LINEN_TILE)
    return o

def build_book(book_id):
    d = BOOKS[book_id]
    W, H, Tk = d["w"], d["h"], d["t"]
    hard = d["kind"] == "hard"
    board = 0.0026 if hard else 0.0007       # cover thickness
    over = 0.003 if hard else 0.0             # board overhang beyond the pages (head, tail, fore-edge)
    spine_d = 0.004 if hard else 0.0008       # spine bulge
    cov = cover_material(book_id, d["color"], cloth=hard)
    pages = pages_material()
    parts = []
    xl = -W / 2 + spine_d                     # inner face of the spine
    # boards (bottom / top) – from spine to fore-edge
    bw = W / 2 - xl
    for z in (board / 2, Tk - board / 2):
        parts.append(_box("board", (bw, H, board), (xl + bw / 2, 0, z), cov, 0.0009 if hard else 0.0003))
    # spine
    parts.append(_spine("spine", H, Tk, spine_d, xl, cov))
    # page block: inset from boards by the overhang, slightly concave look via inset only
    pw = W / 2 - over - xl - 0.0005
    ph = H - 2 * over
    pz = Tk - 2 * board - 0.0004
    parts.append(_box("pages", (pw, ph, pz), (xl + 0.0005 + pw / 2, 0, Tk / 2), pages, 0.0008, tile=PAGES_TILE))
    # gold foil bands on the spine (head & tail)
    if d.get("bands"):
        gold = flat_material("Foil_gold", "#c9a35f", 0.32, 1.0)
        # pairs of thin foil lines across the spine, near head and tail; each line is a thin
        # slice of the spine shape pushed out 0.25 mm, so it follows the curve with no gaps
        for y in (H / 2 - 0.02, -H / 2 + 0.02):
            for dy in (-0.0022, 0.0022):
                band = _spine("band", 0.0011, Tk, spine_d + 0.00025, xl, gold)
                band.location.y = y + dy
                bpy.ops.object.transform_apply(location=True)
                parts.append(band)
    # title label / debossed panel on the front cover
    if d.get("label"):
        lab = flat_material("Label_paper", "#efe9dc", 0.7, 0.0)
        parts.append(_box("label", (bw * 0.46, H * 0.16, 0.0006), (xl + bw * 0.55, H * 0.22, Tk + 0.0003), lab, 0.0002))
    if not hard:  # paperback: printed colour block on the cover
        ink = flat_material("Print_ink", "#3f5a4b", 0.55, 0.0)
        parts.append(_box("print", (bw * 0.999, H * 0.42, 0.0003), (xl + bw / 2, -H * 0.12, Tk + 0.00015), ink, 0.0))
    o = T["join"](book_id, parts)
    return o


# ------------------------------------------------------------------ export & staging
def export_books(path=None):
    path = path or os.path.join(T["EXPORT_DIR"], "books.glb")
    T["clear_scene"]()
    objs = [build_book(b) for b in BOOKS]
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True,
                              export_yup=True, export_apply=True, export_image_format="WEBP")
    return {o.name: {"tris": sum(len(p.vertices) - 2 for p in o.data.polygons),
                     "size_mm": [round(v * 1000, 1) for v in o.dimensions]} for o in objs}

def place_books(table_id, items):
    """Preview a user arrangement in Blender. items: [(book_id, x, z, rot_deg)] in three.js
    coordinates as stored by the website (Y up). Books are laid flat on the surface (no stacking)."""
    import math as _m
    surf = next(t for t in CATALOG["tables"] if t["id"] == table_id)["surface"]
    placed = []
    for bid, x, z, rot in items:
        o = build_book(bid)
        # three (x, y, z) -> Blender (x, -z, y); rotation about three's Y == about Blender's Z
        o.location = (x, -z, surf["y"])
        o.rotation_euler = (0, 0, _m.radians(rot))
        placed.append(o)
    return placed

def stage_table(table_id, colorway=0):
    obj = T["build_one"](table_id)
    if colorway:
        T["apply_colorway"](table_id, colorway)
    return obj


# ------------------------------------------------------------------ baked shadows
def _bake(path, center_z, size, res, casters_cam_hidden, hide_shadow_of=()):
    """Top-down orthographic shadow-catcher render. Output alpha = shadow strength."""
    sc = bpy.context.scene
    for o in casters_cam_hidden:
        o.visible_camera = False
    for o in hide_shadow_of:
        o.visible_shadow = False
    bpy.ops.mesh.primitive_plane_add(size=size, location=(0, 0, center_z + 0.0002))
    catcher = bpy.context.object; catcher.is_shadow_catcher = True
    # soft, mostly-overhead light + bright world => contact shadow + soft ambient occlusion
    bpy.ops.object.light_add(type="AREA", location=(0.25, -0.2, center_z + 1.6))
    key = bpy.context.object; key.data.size = 1.6; key.data.energy = 220
    bpy.ops.object.camera_add(location=(0, 0, center_z + 3.0), rotation=(0, 0, 0))
    cam = bpy.context.object; cam.data.type = "ORTHO"; cam.data.ortho_scale = size
    cam.data.clip_start = 0.01; cam.data.clip_end = 10
    sc.camera = cam
    w = sc.world or bpy.data.worlds.new("World"); sc.world = w; w.use_nodes = True
    bg = w.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (1, 1, 1, 1); bg.inputs["Strength"].default_value = 0.9
    sc.render.engine = "CYCLES"; sc.cycles.samples = 128; sc.cycles.use_denoising = True
    sc.render.film_transparent = True
    sc.render.image_settings.file_format = "PNG"; sc.render.image_settings.color_mode = "RGBA"
    sc.render.resolution_x = sc.render.resolution_y = res
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    for o in (catcher, key, cam):
        bpy.data.objects.remove(o, do_unlink=True)
    for o in casters_cam_hidden:
        o.visible_camera = True
    for o in hide_shadow_of:
        o.visible_shadow = True

def bake_shadows(table_id, out_dir):
    """floor_<id>.png: the table's soft shadow on the floor (top-down shadow catcher).
    Book shadows are not baked: books are placed live on the website, which draws a
    soft shadow decal under each book (src/BookEditor.tsx)."""
    os.makedirs(out_dir, exist_ok=True)
    table = stage_table(table_id)
    dims = table.dimensions
    floor_size = round(max(dims.x, dims.y) + 1.0, 2)
    out = {"floor": {"file": f"floor_{table_id}.png", "size": floor_size}}
    _bake(os.path.join(out_dir, out["floor"]["file"]), 0.0, floor_size, 512, [table])
    return out
