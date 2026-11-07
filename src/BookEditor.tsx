import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { Billboard, Line, useGLTF } from '@react-three/drei'
import { Color, Group, Mesh, Plane, Raycaster, ShaderMaterial, Spherical, Vector2, Vector3, type Object3D } from 'three'
import { books as bookDefs, type TableSurface } from './catalog'
import { clampToSurface, restingHeights, type Placed } from './layout'

const URL_BOOKS = '/models/books.glb'
useGLTF.preload(URL_BOOKS)
const QA = new URLSearchParams(location.search).has('qa')
const LIFT = 0.035 // how far a book floats while being dragged (m)

type Controls = { enabled: boolean; target: Vector3; update: () => void } | null
type Drag = { uid: string; mode: 'move' | 'rotate'; off: [number, number]; lastAngle: number; rot: number; planeY: number }

// ---------------------------------------------------------------- soft contact shadow (SDF decal)
const shadowVert = /* glsl */ `
  varying vec2 vPos;
  void main() { vPos = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`
const shadowFrag = /* glsl */ `
  uniform vec2 uHalf; uniform float uFall; uniform float uOpacity; uniform vec3 uColor;
  varying vec2 vPos;
  void main() {
    float r = 0.004;
    vec2 q = abs(vPos) - uHalf + r;
    float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;   // signed distance to the footprint
    float a = 1.0 - smoothstep(-uFall * 0.2, uFall, d);
    gl_FragColor = vec4(uColor, a * a * uOpacity);
  }`

function makeShadowMaterial(hx: number, hz: number) {
  return new ShaderMaterial({
    vertexShader: shadowVert,
    fragmentShader: shadowFrag,
    uniforms: {
      uHalf: { value: new Vector2(hx, hz) },
      uFall: { value: 0.02 },
      uOpacity: { value: 0 },
      uColor: { value: new Color('#2a2420') },
    },
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  })
}

// ---------------------------------------------------------------- one book
function Book({
  p, baseY, object, selected, dragging, onGrab,
}: {
  p: Placed; baseY: number; object: Object3D; selected: boolean; dragging: boolean
  onGrab: (e: ThreeEvent<PointerEvent>, mode: Drag['mode']) => void
}) {
  const def = bookDefs[p.id]
  const hx = def.w / 2, hz = def.h / 2
  const book = useRef<Group>(null)
  const shadow = useRef<Mesh>(null)
  const mat = useMemo(() => makeShadowMaterial(hx, hz), [hx, hz])
  const born = useRef(true)

  useFrame((_, dt) => {
    const g = book.current
    if (!g) return
    const k = (rate: number) => 1 - Math.exp(-dt * rate)
    const ty = baseY + (dragging ? LIFT : 0)
    if (born.current) { // new book: drop in from above
      g.position.set(p.x, QA ? ty : ty + 0.18, p.z)
      g.rotation.y = p.rot
      born.current = false
    }
    g.position.x += (p.x - g.position.x) * k(dragging ? 40 : 18)
    g.position.z += (p.z - g.position.z) * k(dragging ? 40 : 18)
    g.position.y += (ty - g.position.y) * (QA ? 1 : k(12))
    g.rotation.y += (p.rot - g.rotation.y) * (QA ? 1 : k(20))
    const s = shadow.current
    if (s) {
      s.position.set(g.position.x, baseY + 0.0006, g.position.z)
      s.rotation.set(-Math.PI / 2, g.rotation.y, 0, 'YXZ') // tilt flat, then turn with the book
      const lifted = g.position.y - baseY // softer, lighter shadow while in the air
      mat.uniforms.uFall.value = 0.022 + lifted * 0.6
      mat.uniforms.uOpacity.value = 0.72 * Math.max(0, 1 - lifted * 6)
    }
  })
  useEffect(() => () => mat.dispose(), [mat])

  const fall = 0.06 // decal margin: room for the softest (lifted) shadow
  return (
    <>
      <mesh ref={shadow} material={mat} renderOrder={1}>
        <planeGeometry args={[def.w + fall * 2, def.h + fall * 2]} />
      </mesh>
      <group ref={book}>
        <group
          onPointerDown={(e) => {
            // the rotate handle is drawn on top of everything, so it must also win the click
            // even when a book is nearer to the camera along the same ray
            if (e.intersections.some((i) => i.object.name === 'rotate-handle')) return
            onGrab(e, 'move')
          }}
          onPointerOver={() => (document.body.style.cursor = 'grab')}
          onPointerOut={() => (document.body.style.cursor = '')}
        >
          <primitive object={object} />
        </group>
        {selected && <Gizmo hx={hx} hz={hz} t={def.t} onRotate={(e) => onGrab(e, 'rotate')} />}
      </group>
    </>
  )
}

/**
 * Selection: a two-tone outline around the footprint (dark + white, readable on any tabletop)
 * and a round rotate handle beyond the head of the book. The handle keeps a constant size on
 * screen (so it is always easy to grab, also with a finger) and is drawn on top of everything.
 */
function Gizmo({ hx, hz, t, onRotate }: { hx: number; hz: number; t: number; onRotate: (e: ThreeEvent<PointerEvent>) => void }) {
  const m = 0.012
  const y = 0.0012 // just above the surface the book rests on
  const rect: [number, number, number][] = [
    [-hx - m, y, -hz - m], [hx + m, y, -hz - m], [hx + m, y, hz + m], [-hx - m, y, hz + m], [-hx - m, y, -hz - m],
  ]
  const handle = useRef<Group>(null)
  const stem = useRef<Group>(null)
  const tmp = useMemo(() => new Vector3(), [])
  const side = useRef(-1) // -1 = head end (-Z), +1 = tail end (+Z)
  useFrame(({ camera }) => {
    const h = handle.current
    const parent = h?.parent
    if (!h || !parent) return
    h.getWorldPosition(tmp)
    const s = Math.min(3, Math.max(0.8, camera.position.distanceTo(tmp) / 1.1))
    const off = hz + 0.02 + 0.022 * s // keep a gap between book and handle at any zoom
    // put the handle on whichever end of the book is nearer the middle of the screen,
    // so it never ends up outside the view when a book sits near the edge of the frame
    const ndc = (sd: number) => {
      const v = parent.localToWorld(new Vector3(0, t, sd * off)).project(camera)
      return Math.max(Math.abs(v.x), Math.abs(v.y))
    }
    const head = ndc(-1), tail = ndc(1)
    if (side.current === -1 ? tail < head - 0.05 : head < tail - 0.05) side.current *= -1 // with hysteresis
    h.scale.setScalar(s)
    h.position.z = side.current * off
    if (stem.current) {
      stem.current.position.z = side.current * hz
      stem.current.rotation.y = side.current > 0 ? Math.PI : 0
      stem.current.scale.z = Math.max(0.0001, off - hz - 0.016 * s)
    }
  })
  return (
    <group>
      <Line points={rect} color="#1c1b19" lineWidth={4} renderOrder={5} />
      <Line points={rect} color="#ffffff" lineWidth={1.6} renderOrder={6} />
      {/* thin stem from the head edge to the handle */}
      <group ref={stem} position={[0, t + 0.002, -hz]}>
        <mesh renderOrder={7} position={[0, 0, -0.5]} rotation-x={-Math.PI / 2}>
          <planeGeometry args={[0.0025, 1]} />
          <meshBasicMaterial color="#ffffff" depthTest={false} transparent opacity={0.9} />
        </mesh>
      </group>
      <group ref={handle} position={[0, t + 0.003, -hz - 0.05]}>
        {/* faces the camera like a pin, so it never flattens into a sliver at low angles */}
        <Billboard position={[0, 0.018, 0]}>
          <mesh
            name="rotate-handle"
            renderOrder={8}
            onPointerDown={onRotate}
            onPointerOver={() => (document.body.style.cursor = 'alias')}
            onPointerOut={() => (document.body.style.cursor = '')}
          >
            <circleGeometry args={[0.016, 40]} />
            <meshBasicMaterial color="#1c1b19" depthTest={false} transparent />
          </mesh>
          <mesh renderOrder={9} position={[0, 0, 0.0003]}>
            <circleGeometry args={[0.0135, 40]} />
            <meshBasicMaterial color="#ffffff" depthTest={false} transparent />
          </mesh>
          {/* rotate arrow icon */}
          <mesh renderOrder={10} position={[0, 0, 0.0006]}>
            <ringGeometry args={[0.0055, 0.0078, 32, 1, 0.5, Math.PI * 1.45]} />
            <meshBasicMaterial color="#1c1b19" depthTest={false} transparent />
          </mesh>
          <mesh renderOrder={10} position={[0.0066 * Math.cos(0.5), 0.0066 * Math.sin(0.5), 0.0006]} rotation-z={0.5 - Math.PI / 2}>
            <circleGeometry args={[0.0034, 3]} />
            <meshBasicMaterial color="#1c1b19" depthTest={false} transparent />
          </mesh>
        </Billboard>
        {/* pin stalk from the book top up to the handle */}
        <mesh renderOrder={7} position={[0, 0.009, 0]}>
          <cylinderGeometry args={[0.0011, 0.0011, 0.018, 8]} />
          <meshBasicMaterial color="#1c1b19" depthTest={false} transparent opacity={0.8} />
        </mesh>
      </group>
    </group>
  )
}

// ---------------------------------------------------------------- editor
export default function BookEditor({
  surface, placed, selected, onSelect, onChange, focus,
}: {
  surface: TableSurface
  placed: Placed[]
  selected: string | null
  onSelect: (uid: string | null) => void
  onChange: (next: Placed[]) => void
  focus: number // bumps when a book is added -> glide the camera to a placing view
}) {
  const { nodes } = useGLTF(URL_BOOKS)
  const { camera, gl } = useThree()
  const controls = useThree((s) => s.controls) as unknown as Controls
  const [drag, setDrag] = useState<Drag | null>(null)
  const latest = useRef(placed)
  latest.current = placed

  // one clone per placed book (shares geometry + materials)
  const clones = useRef(new Map<string, Object3D>())
  const objectFor = (p: Placed) => {
    let o = clones.current.get(p.uid)
    if (!o) {
      o = nodes[p.id].clone(true)
      o.position.set(0, 0, 0)
      o.rotation.set(0, 0, 0)
      clones.current.set(p.uid, o)
    }
    return o
  }

  const heights = useMemo(() => restingHeights(placed, surface.y), [placed, surface.y])

  // ---- "placing view": a higher three-quarter view centred on the tabletop
  type Glide = { from: Spherical; to: Spherical; t0: Vector3; t1: Vector3; k: number }
  const glide = useRef<Glide | null>(null)
  useEffect(() => {
    if (!focus || !controls) return
    const from = new Spherical().setFromVector3(camera.position.clone().sub(controls.target))
    const ext = surface.rect ? Math.max(...surface.rect) : (surface.circle ?? 0.5) * 2
    const aspect = gl.domElement.clientWidth / Math.max(1, gl.domElement.clientHeight)
    const to = new Spherical(
      // close enough to work, far enough to keep the whole top in frame (portrait phones need more room)
      Math.min(from.radius, Math.max(1.3, (ext * 1.6) / Math.min(1, aspect / 1.25))),
      Math.min(from.phi, 0.92), // ~53deg down from vertical: you can see the whole top
      from.theta, // keep the side the user is looking from
    )
    const t1 = new Vector3(0, surface.y, 0)
    if (from.phi - to.phi < 0.03 && from.radius - to.radius < 0.03 && controls.target.distanceTo(t1) < 0.01) return
    glide.current = { from, to, t0: controls.target.clone(), t1, k: QA ? 1 : 0 }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus])
  useFrame((_, dt) => {
    const g = glide.current
    if (!g || !controls) return
    g.k = Math.min(1, g.k + dt / 0.75)
    const e = g.k < 0.5 ? 4 * g.k ** 3 : 1 - (-2 * g.k + 2) ** 3 / 2 // ease in-out
    const s = new Spherical(
      g.from.radius + (g.to.radius - g.from.radius) * e,
      g.from.phi + (g.to.phi - g.from.phi) * e,
      g.from.theta + (g.to.theta - g.from.theta) * e,
    )
    controls.target.lerpVectors(g.t0, g.t1, e)
    camera.position.setFromSpherical(s).add(controls.target)
    controls.update()
    if (g.k >= 1) glide.current = null
  })

  // pointer -> point on the tabletop plane
  const ray = useMemo(() => new Raycaster(), [])
  const plane = useMemo(() => new Plane(new Vector3(0, 1, 0), -surface.y), [surface.y])
  const hit = useMemo(() => new Vector3(), [])
  /** Pointer -> point on a horizontal plane (default: the tabletop; rotating uses the handle's height). */
  const toSurface = (clientX: number, clientY: number, planeY = surface.y) => {
    const r = gl.domElement.getBoundingClientRect()
    const ndc = new Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1)
    ray.setFromCamera(ndc, camera)
    plane.constant = -planeY
    return ray.ray.intersectPlane(plane, hit) ? ([hit.x, hit.z] as [number, number]) : null
  }

  const grab = (uid: string) => (e: ThreeEvent<PointerEvent>, mode: Drag['mode']) => {
    e.stopPropagation()
    if (controls) controls.enabled = false // stop the camera orbiting while we place
    const list = latest.current
    const p = list.find((q) => q.uid === uid)!
    const planeY = mode === 'rotate' ? heights[uid] + bookDefs[p.id].t : surface.y
    const at = toSurface(e.clientX, e.clientY, planeY) ?? [p.x, p.z]
    onSelect(uid)
    // the grabbed book goes to the top of the stacking order
    if (mode === 'move') onChange([...list.filter((q) => q.uid !== uid), p])
    setDrag({
      uid, mode,
      off: [at[0] - p.x, at[1] - p.z],
      lastAngle: Math.atan2(at[0] - p.x, at[1] - p.z),
      rot: p.rot,
      planeY,
    })
  }

  useEffect(() => {
    if (!drag) return
    const move = (ev: PointerEvent) => {
      const at = toSurface(ev.clientX, ev.clientY, drag.planeY)
      if (!at) return
      const list = latest.current
      const next = list.map((q) => {
        if (q.uid !== drag.uid) return q
        if (drag.mode === 'move') return clampToSurface({ ...q, x: at[0] - drag.off[0], z: at[1] - drag.off[1] }, surface)
        // accumulate small angle steps (wrapped to +-180deg) so crossing atan2's seam never jumps a full turn
        const a = Math.atan2(at[0] - q.x, at[1] - q.z)
        let da = a - drag.lastAngle
        da -= Math.round(da / (2 * Math.PI)) * 2 * Math.PI
        drag.lastAngle = a
        drag.rot += da
        let rot = drag.rot
        const snap = Math.round(rot / (Math.PI / 12)) * (Math.PI / 12) // magnetic 15deg steps
        if (Math.abs(rot - snap) < 0.05) rot = snap
        return clampToSurface({ ...q, rot }, surface)
      })
      onChange(next)
    }
    const up = () => {
      setDrag(null)
      if (controls) controls.enabled = true
      document.body.style.cursor = ''
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    document.body.style.cursor = drag.mode === 'move' ? 'grabbing' : 'alias'
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag, surface])

  // forget clones of removed books
  useEffect(() => {
    const live = new Set(placed.map((p) => p.uid))
    for (const k of clones.current.keys()) if (!live.has(k)) clones.current.delete(k)
  }, [placed])

  return (
    <group name="books">
      {placed.map((p) => (
        <Book
          key={p.uid}
          p={p}
          baseY={heights[p.uid]}
          object={objectFor(p)}
          selected={selected === p.uid}
          dragging={drag?.uid === p.uid && drag.mode === 'move'}
          onGrab={grab(p.uid)}
        />
      ))}
    </group>
  )
}
