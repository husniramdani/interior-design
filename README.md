# Interior 3D: AI-built table collection

Five parametric tables, each with three colourways, modelled by AI (Hermes) in Blender through the Blender Lab MCP server and shown on an interactive React Three Fiber landing page. Visitors can drag to rotate, scroll to zoom, and pick a table and colour, which applies instantly.

| Table | Type | Colourways |
|---|---|---|
| LISA | Dining table 140×78 | Natural ash · Walnut · Black-stained oak |
| STUDIO | Work desk 120×60 with 3-drawer unit | Oak & white · All white · Walnut & black (brass handles) |
| TULIP | Round pedestal table Ø100 | White · Oak & white · Black |
| LOFT | Work table 160×80, steel sled frame | Oak & black steel · Walnut & black steel · Ash & white steel |
| ORBIT | Coffee table Ø80 with shelf | Natural ash · Walnut · Sage green |

## Pipeline

```
src/catalog.json  ← single source of truth: finishes, tables, colourways (read by Blender AND the website)
blender/tables.py ← parametric geometry; every part gets a material slot: Top / Frame / Accent
   └─ Blender (headless, via MCP) → blender/export/<id>.glb   (geometry + UVs, no textures)
gltf-transform meshopt → public/models/<id>.glb                (≈175 KB for all five)
website applies finishes per slot at runtime                  (colour switch = no reload)
```

### Materials

- **Wood** (ash, oak, walnut, black-stained oak): scanned Poly Haven veneers (CC0) with colour, normal and roughness maps, 1 tile = 1 m. UVs are box-projected in world metres with the grain along each part's long axis.
- **Satin paint** (white, black, sage), **powder-coated steel** and **brushed metal** (steel, brass): flat colour plus generated, seamless normal and roughness maps (`blender/gen_surface_textures.py`).

### Rebuild

1. Edit the dimensions in `blender/tables.py` or the finishes and colourways in `src/catalog.json`.
2. In Blender (MCP): `ns = runpy.run_path("blender/tables.py")`, then for each id: `o = ns["build_one"](id); ns["export_glb"](o, ...); ns["render"](o, ...)`.
3. Compress: `npx gltf-transform meshopt blender/export/<id>.glb public/models/<id>.glb`.
   Do **not** use `optimize`. It merges identical materials (which breaks the per-slot colours) and strips UVs from untextured meshes.
4. Generate the surface textures: `python blender/gen_surface_textures.py` (NumPy, Pillow).
5. Web: `pnpm dev`, or `pnpm build` for production.

### QA

- `node qa/colorways.mjs http://localhost:4173 qa/out` clicks through all 15 table × colour combinations in headless Chrome and screenshots each one.
- `CLOSE="studio:2,orbit:2" node qa/colorways.mjs …` zooms in on specific combinations to check surface detail.
