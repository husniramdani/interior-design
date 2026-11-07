import data from './catalog.json'

export type Slot = 'Top' | 'Frame' | 'Accent'

export type WoodFinish = {
  label: string; type: 'wood'; tex: string; rotate: boolean; tint: string; swatch: string
}
export type Surface = 'satin' | 'powder' | 'brushed'
export type PaintFinish = {
  label: string; type: 'paint'; color: string; roughness: number; metalness: number; swatch: string
  surface: Surface // generated normal + roughness maps (blender/gen_surface_textures.py)
  scale: number // world meters per texture tile
}
export type Finish = WoodFinish | PaintFinish

export type Colorway = { name: string; slots: Partial<Record<Slot, string>> }

export type BookDef = { kind: 'hard' | 'paper'; w: number; h: number; t: number; color: string; bands: boolean; label: boolean }

/** Where books can be placed: top height (m) and outline, a rectangle [length, width] or a circle radius. */
export type TableSurface = { y: number; rect?: [number, number]; circle?: number }

export type TableDef = {
  id: string; name: string; type: string; desc: string
  dims: string; seats: string; colorways: Colorway[]
  surface: TableSurface
  floorShadow: number // size (m) of the baked floor-shadow image
}

export const finishes = data.finishes as Record<string, Finish>
export const tables = data.tables as unknown as TableDef[]
export const books = data.books as Record<string, BookDef>
export const woodTextures = [
  ...new Set(Object.values(finishes).filter((f): f is WoodFinish => f.type === 'wood').map((f) => f.tex)),
]
export const surfaceTextures = [
  ...new Set(Object.values(finishes).filter((f): f is PaintFinish => f.type === 'paint').map((f) => f.surface)),
]

export const modelUrl = (id: string) => `/models/${id}.glb`
export const thumbUrl = (id: string) => `/thumbs/${id}.webp`

/** "art_sage" -> { kind: "Art book", color: "Sage" } */
export function bookLabel(id: string) {
  const [k, ...c] = id.split('_')
  const kind = { art: 'Art book', novel: 'Novel', paperback: 'Paperback' }[k] ?? k
  const color = c.join(' ')
  return { kind, color: color.charAt(0).toUpperCase() + color.slice(1) }
}

/** Two-tone swatch: top finish / frame finish. */
export function swatchBackground(cw: Colorway) {
  const a = finishes[cw.slots.Top ?? 'white'].swatch
  const b = finishes[cw.slots.Frame ?? cw.slots.Top ?? 'white'].swatch
  return a === b ? a : `linear-gradient(135deg, ${a} 0 50%, ${b} 50% 100%)`
}
