# Interior 3D — AI-built table landing page

Pipeline: Hermes (AI) → Blender 5.2 via Blender Lab MCP (headless) → GLB → gltf-transform → React Three Fiber.

1. Model: `blender/build_table.py` (parametric; edit `P` dict) — run `build()` then `export()` in Blender.
2. Optimize: `npx gltf-transform optimize blender/export/table.glb public/models/table.glb --compress meshopt --texture-compress webp --texture-size 1024`
3. Web: `pnpm dev` (local) / `pnpm build` (dist/).
4. QA: `node qa/shot.mjs http://localhost:4173 qa/out` — headless Chrome screenshot + simulated drag.

Textures: Poly Haven "Ash Veneer" (CC0).
