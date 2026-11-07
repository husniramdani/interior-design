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

### Book styling (user-placed)

Seven book assets (art books, novels, a paperback) are built in Blender by `blender/books.py` and exported together as `public/models/books.glb` (≈116 KB, cloth-texture covers, page-edge texture, gold spine foil). Visitors place them on the table themselves:

- **Add:** pick a book from "Style it with books". It drops into a free spot, and the camera glides to a higher placing view.
- **Move:** drag a book. It stays inside the table outline (rectangle or circle, from `surface` in the catalog) and the camera stays still while dragging.
- **Stack:** drop a book onto another one. Pull the bottom one away and the top one settles back down (`src/layout.ts`).
- **Rotate:** drag the round pin handle (it snaps gently to 15° steps), or use the toolbar buttons or the `R` / `Shift+R` keys.
- **Remove:** the bin in the toolbar or `Delete`. "Clear all" empties the table. Each table remembers its own books.

### Shadows

- **Floor:** baked in Blender per table (`bake_shadows` in `blender/books.py`, top-down shadow catcher), post-processed to fade to zero at the edges, and shown as `public/shadows/floor_<id>.png`.
- **Books:** a soft-edged shadow drawn in a shader under every book, which follows it live and softens while the book is lifted.
- drei `<ContactShadows>` is not used. With three r187 its shadow render target stayed empty (checked by reading its pixels).

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
- `CLOSE="studio:2,orbit:2" node qa/colorways.mjs …` zooms in on specific combinations to check surface detail. Add `MOBILE=1` to use an iPhone-size viewport.
- `node qa/layout.mjs http://localhost:4173 qa/out` takes full-page screenshots at iPhone, Android, tablet and desktop sizes, and checks section order, horizontal overflow and console errors.
- `node qa/books.mjs http://localhost:4173 qa/out` drives the book editor with real mouse events on LISA, TULIP and a phone-size STUDIO. It covers add, stack, gravity, dragging past the edge, rotating with the buttons and the handle, remove, the camera staying still during drags, and orbiting afterwards. It reads the results back from the three.js scene.
