"""Parametric IKEA-style (LISABO-like) dining table.

Run inside Blender (via MCP or `blender --background --python build_table.py`).
Units: meters. Origin at floor centre. Exports GLB next to this script's project.
"""
import bpy, bmesh, math, os
from mathutils import Vector

PROJECT = os.path.expanduser("~/Projects/interior-3d")
TEX = os.path.join(PROJECT, "blender/textures")

# ---- parameters -----------------------------------------------------------
P = dict(
    length=1.40, width=0.78, height=0.74,   # overall size
    top_thick=0.028, top_bevel=0.004,
    leg_inset=0.07,                          # leg centre distance from top edge
    leg_r_top=0.024, leg_r_foot=0.016,       # tapered round legs
    leg_splay_deg=4.0,                       # slight outward angle
    tex_tile_m=1.0,                          # world meters per texture tile
)

def clear_scene():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.images):
        for d in list(coll):
            if d.users == 0:
                coll.remove(d)

def wood_material(name, tint=(1, 1, 1, 1)):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    def img(fname, non_color):
        n = nt.nodes.new("ShaderNodeTexImage")
        n.image = bpy.data.images.load(os.path.join(TEX, fname), check_existing=True)
        if non_color:
            n.image.colorspace_settings.name = "Non-Color"
        return n
    diff = img("ash_veneer_diff_2k.jpg", False)
    rough = img("ash_veneer_rough_2k.jpg", True)
    nor = img("ash_veneer_nor_gl_2k.jpg", True)
    nmap = nt.nodes.new("ShaderNodeNormalMap"); nmap.inputs["Strength"].default_value = 0.6
    nt.links.new(diff.outputs["Color"], bsdf.inputs["Base Color"])
    nt.links.new(rough.outputs["Color"], bsdf.inputs["Roughness"])
    nt.links.new(nor.outputs["Color"], nmap.inputs["Color"])
    nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
    return m

def world_uv(obj, grain_axis):
    """Box-project UVs in world meters; U follows the wood grain axis."""
    me = obj.data
    bm = bmesh.new(); bm.from_mesh(me)
    uv = bm.loops.layers.uv.verify()
    mw = obj.matrix_world
    s = 1.0 / P["tex_tile_m"]
    for f in bm.faces:
        n = (mw.to_3x3() @ f.normal).normalized()
        ax = max(range(3), key=lambda i: abs(n[i]))  # dominant normal axis
        others = [i for i in range(3) if i != ax]
        u_ax = grain_axis if grain_axis != ax else others[0]
        v_ax = [i for i in others if i != u_ax][0] if u_ax in others else others[1]
        for l in f.loops:
            co = mw @ l.vert.co
            l[uv].uv = (co[u_ax] * s, co[v_ax] * s)
    bm.to_mesh(me); bm.free()

def build():
    clear_scene()
    L, W, H, T = P["length"], P["width"], P["height"], P["top_thick"]
    mat = wood_material("Ash")

    # tabletop
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, H - T / 2))
    top = bpy.context.object; top.name = "TableTop"
    top.scale = (L, W, T)
    bpy.ops.object.transform_apply(scale=True)
    bev = top.modifiers.new("Bevel", "BEVEL")
    bev.width = P["top_bevel"]; bev.segments = 3; bev.limit_method = "ANGLE"
    bpy.ops.object.modifier_apply(modifier="Bevel")
    top.data.materials.append(mat)
    world_uv(top, grain_axis=0)

    # legs (tapered, slightly splayed)
    leg_h = H - T
    splay = math.radians(P["leg_splay_deg"])
    xi, yi = L / 2 - P["leg_inset"], W / 2 - P["leg_inset"]
    legs = []
    for sx in (-1, 1):
        for sy in (-1, 1):
            bpy.ops.mesh.primitive_cone_add(
                vertices=32, radius1=P["leg_r_foot"], radius2=P["leg_r_top"],
                depth=leg_h, location=(0, 0, 0))
            leg = bpy.context.object
            leg.name = f"Leg_{'L' if sx < 0 else 'R'}{'F' if sy < 0 else 'B'}"
            # pivot at top of leg, then rotate outward
            for v in leg.data.vertices:
                v.co.z -= leg_h / 2
            leg.location = (sx * xi, sy * yi, leg_h)
            leg.rotation_euler = (sy * splay * 0.7, -sx * splay, 0)  # feet outward
            bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
            leg.data.materials.append(mat)
            bpy.ops.object.shade_smooth()
            legs.append(leg)
    # snap feet to the floor (z=0) after splay
    for leg in legs:
        minz = min((leg.matrix_world @ v.co).z for v in leg.data.vertices)
        leg.location.z -= minz
        bpy.context.view_layer.update()
        world_uv(leg, grain_axis=2)

    # join into one object
    bpy.ops.object.select_all(action="DESELECT")
    for o in [top] + legs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = top
    bpy.ops.object.join()
    table = bpy.context.object; table.name = "Table"
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return table

def export(table, path):
    bpy.ops.object.select_all(action="DESELECT"); table.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB",
                              use_selection=True, export_yup=True,
                              export_apply=True, export_image_format="JPEG")

def render_check(path, cam_loc=(2.1, -2.0, 1.45), samples=64):
    """Cycles still for visual QA: floor, soft light, camera aimed at table."""
    sc = bpy.context.scene
    bpy.ops.mesh.primitive_plane_add(size=12); floor = bpy.context.object; floor.name = "QA_Floor"
    fm = bpy.data.materials.new("QA_FloorMat"); fm.use_nodes = True
    fm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.8, 0.79, 0.77, 1)
    floor.data.materials.append(fm)
    bpy.ops.object.light_add(type="AREA", location=(1.5, -1.0, 2.6)); key = bpy.context.object
    key.data.energy = 450; key.data.size = 2.0
    key.rotation_euler = (Vector((0, 0, 0.5)) - key.location).to_track_quat("-Z", "Y").to_euler()
    bpy.ops.object.camera_add(location=cam_loc); cam = bpy.context.object
    cam.rotation_euler = (Vector((0, 0, 0.45)) - cam.location).to_track_quat("-Z", "Y").to_euler()
    cam.data.lens = 40
    sc.camera = cam
    w = sc.world or bpy.data.worlds.new("World"); sc.world = w; w.use_nodes = True
    w.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.6
    w.node_tree.nodes["Background"].inputs["Color"].default_value = (0.9, 0.9, 0.92, 1)
    sc.render.engine = "CYCLES"; sc.cycles.samples = samples; sc.cycles.device = "CPU"
    sc.cycles.use_denoising = True
    sc.render.resolution_x, sc.render.resolution_y = 1280, 800
    sc.view_settings.view_transform = "AgX"
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    for o in (floor, key, cam):
        bpy.data.objects.remove(o, do_unlink=True)
