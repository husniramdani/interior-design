/**
 * Book placement maths (pure functions, three.js coordinates: Y up, books lie flat).
 *
 * A placed book is a rotated rectangle on the table: centre (x, z), rotation `rot`
 * about Y. Its local X is the width (spine to fore-edge), local Z the height (head to tail).
 * The array order is the stacking order: later books land on top of earlier ones.
 */
import { books as bookDefs, type TableSurface } from './catalog'

export type Placed = { uid: string; id: string; x: number; z: number; rot: number }

const half = (id: string) => [bookDefs[id].w / 2, bookDefs[id].h / 2] as const

/** Unit axes of the book's footprint in world XZ (rotation about Y). */
function axes(rot: number) {
  const c = Math.cos(rot), s = Math.sin(rot)
  return [
    [c, -s], // local X
    [s, c], // local Z
  ] as const
}

/** Half-extent of a footprint projected on a world axis. */
function radiusOn(p: Placed, ax: readonly [number, number]) {
  const [hx, hz] = half(p.id)
  const [u, v] = axes(p.rot)
  return hx * Math.abs(u[0] * ax[0] + u[1] * ax[1]) + hz * Math.abs(v[0] * ax[0] + v[1] * ax[1])
}

/** Do two footprints overlap? Separating-axis test; `shrink` ignores edge-touching. */
export function overlaps(a: Placed, b: Placed, shrink = 0.006) {
  const d = [b.x - a.x, b.z - a.z]
  for (const ax of [...axes(a.rot), ...axes(b.rot)]) {
    const dist = Math.abs(d[0] * ax[0] + d[1] * ax[1])
    if (dist >= radiusOn(a, ax) + radiusOn(b, ax) - shrink) return false
  }
  return true
}

/** Resting height of every book's bottom: gravity in stacking order. */
export function restingHeights(list: Placed[], surfaceY: number) {
  const y: Record<string, number> = {}
  list.forEach((p, i) => {
    let base = surfaceY
    for (let j = 0; j < i; j++) {
      const q = list[j]
      if (overlaps(p, q)) base = Math.max(base, y[q.uid] + bookDefs[q.id].t)
    }
    y[p.uid] = base
  })
  return y
}

/** Keep the whole footprint on the table top (with a small margin from the edge). */
export function clampToSurface(p: Placed, s: TableSurface, margin = 0.015): Placed {
  if (s.rect) {
    const ex = radiusOn(p, [1, 0]), ez = radiusOn(p, [0, 1])
    const mx = Math.max(0, s.rect[0] / 2 - ex - margin)
    const mz = Math.max(0, s.rect[1] / 2 - ez - margin)
    return { ...p, x: Math.min(mx, Math.max(-mx, p.x)), z: Math.min(mz, Math.max(-mz, p.z)) }
  }
  const [hx, hz] = half(p.id)
  const maxR = Math.max(0, (s.circle ?? 0) - Math.hypot(hx, hz) - margin)
  const r = Math.hypot(p.x, p.z)
  return r <= maxR ? p : { ...p, x: (p.x / r) * maxR, z: (p.z / r) * maxR }
}

/** A free spot for a new book: nearest to the front-centre that touches no other book. */
export function freeSpot(list: Placed[], id: string, s: TableSurface, uid: string): Placed {
  const rot = ((list.length * 37) % 25 - 12) * (Math.PI / 180) // gentle, varied angle
  const extX = s.rect ? s.rect[0] / 2 : (s.circle ?? 0)
  const extZ = s.rect ? s.rect[1] / 2 : (s.circle ?? 0)
  const prefer = [0, extZ * 0.25] // a little toward the viewer
  const cands: [number, number][] = []
  for (let x = -extX; x <= extX; x += 0.04) for (let z = -extZ; z <= extZ; z += 0.04) cands.push([x, z])
  cands.sort((a, b) => Math.hypot(a[0] - prefer[0], a[1] - prefer[1]) - Math.hypot(b[0] - prefer[0], b[1] - prefer[1]))
  for (const [x, z] of cands) {
    const p = clampToSurface({ uid, id, x, z, rot }, s)
    if (Math.abs(p.x - x) > 1e-6 || Math.abs(p.z - z) > 1e-6) continue // would hang off the edge
    if (!list.some((q) => overlaps(p, q, -0.02))) return p // keep 2 cm air to neighbours
  }
  return clampToSurface({ uid, id, x: 0, z: 0, rot }, s) // table is full: stack in the middle
}
