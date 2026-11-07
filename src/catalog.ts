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

export type TableDef = {
  id: string; name: string; type: string; desc: string
  dims: string; seats: string; price: number; colorways: Colorway[]
}

export const finishes = data.finishes as Record<string, Finish>
export const tables = data.tables as TableDef[]
export const woodTextures = [
  ...new Set(Object.values(finishes).filter((f): f is WoodFinish => f.type === 'wood').map((f) => f.tex)),
]
export const surfaceTextures = [
  ...new Set(Object.values(finishes).filter((f): f is PaintFinish => f.type === 'paint').map((f) => f.surface)),
]

export const modelUrl = (id: string) => `/models/${id}.glb`
export const thumbUrl = (id: string) => `/thumbs/${id}.webp`

/** Two-tone swatch: top finish / frame finish. */
export function swatchBackground(cw: Colorway) {
  const a = finishes[cw.slots.Top ?? 'white'].swatch
  const b = finishes[cw.slots.Frame ?? cw.slots.Top ?? 'white'].swatch
  return a === b ? a : `linear-gradient(135deg, ${a} 0 50%, ${b} 50% 100%)`
}

export const formatPrice = (yen: number) => `¥${yen.toLocaleString('ja-JP')}`
