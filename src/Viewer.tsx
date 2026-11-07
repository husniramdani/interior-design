import { Suspense, useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import {
  Bounds,
  ContactShadows,
  Environment,
  Lightformer,
  OrbitControls,
  useBounds,
  useGLTF,
  useProgress,
  useTexture,
} from '@react-three/drei'
import {
  Material,
  Mesh,
  MeshStandardMaterial,
  NoColorSpace,
  RepeatWrapping,
  SRGBColorSpace,
  Texture,
  Vector2,
} from 'three'
import { finishes, modelUrl, surfaceTextures, tables, woodTextures, type Colorway } from './catalog'

const QA = new URLSearchParams(location.search).has('qa')

tables.forEach((t) => useGLTF.preload(modelUrl(t.id)))

const texUrls = Object.fromEntries([
  ...woodTextures.flatMap((w) => ['diff', 'nor', 'rough'].map((k) => [`${w}_${k}`, `/textures/${w}_${k}.webp`])),
  ...surfaceTextures.flatMap((s) => ['nor', 'rough'].map((k) => [`surf_${s}_${k}`, `/textures/surf_${s}_${k}.webp`])),
])

/** Per-finish copy of a texture (shares the image, own repeat/rotation). */
function prep(src: Texture, srgb: boolean, repeat: number, rotate: boolean) {
  const t = src.clone()
  t.flipY = false // glTF UV convention (matches Blender export)
  t.wrapS = t.wrapT = RepeatWrapping // UVs are in world meters
  t.repeat.set(repeat, repeat)
  t.rotation = rotate ? Math.PI / 2 : 0 // keep wood grain / brush direction along U
  t.colorSpace = srgb ? SRGBColorSpace : NoColorSpace
  t.anisotropy = 8
  t.needsUpdate = true
  return t
}

/** One shared material per finish (wood = textured, paint/metal = flat PBR). */
function useFinishMaterials() {
  const tex = useTexture(texUrls) as Record<string, Texture>
  return useMemo(() => {
    const mats: Record<string, MeshStandardMaterial> = {}
    for (const [id, f] of Object.entries(finishes)) {
      let m: MeshStandardMaterial
      if (f.type === 'wood') {
        // scanned Poly Haven veneer: colour + normal + roughness, 1 tile = 1 m
        m = new MeshStandardMaterial({
          map: prep(tex[`${f.tex}_diff`], true, 1, f.rotate),
          normalMap: prep(tex[`${f.tex}_nor`], false, 1, f.rotate),
          roughnessMap: prep(tex[`${f.tex}_rough`], false, 1, f.rotate),
          // flipY=false + derivative tangents => invert Y (same as three's GLTFLoader)
          normalScale: new Vector2(0.6, -0.6),
          color: f.tint,
          roughness: 0.95, // multiplier on the scanned roughness map
          metalness: 0,
        })
      } else {
        // paint / powder coat / brushed metal: flat colour + generated micro-surface
        const rep = 1 / f.scale
        const strength = f.surface === 'brushed' ? 0.35 : f.surface === 'powder' ? 0.22 : 0.07
        m = new MeshStandardMaterial({
          color: f.color,
          normalMap: prep(tex[`surf_${f.surface}_nor`], false, rep, false),
          roughnessMap: prep(tex[`surf_${f.surface}_rough`], false, rep, false),
          normalScale: new Vector2(strength, -strength),
          roughness: f.roughness,
          metalness: f.metalness,
        })
      }
      m.name = id
      mats[id] = m
    }
    return mats
  }, [tex])
}

function TableModel({ id, colorway }: { id: string; colorway: Colorway }) {
  const { scene } = useGLTF(modelUrl(id))
  const mats = useFinishMaterials()
  const model = useMemo(() => {
    const s = scene.clone(true)
    s.traverse((o) => {
      const m = o as Mesh
      if (m.isMesh) m.userData.slot = (m.material as Material).name // "Top" | "Frame" | "Accent"
    })
    return s
  }, [scene])
  // auto-apply the selected colourway to every slot
  useLayoutEffect(() => {
    model.traverse((o) => {
      const m = o as Mesh
      if (!m.isMesh) return
      const finishId = colorway.slots[m.userData.slot as keyof Colorway['slots']]
      if (finishId && mats[finishId]) m.material = mats[finishId]
    })
  }, [model, colorway, mats])
  return <primitive object={model} />
}

/** Re-frame the camera whenever the table changes (coffee table vs. big work table). */

/** Plain DOM overlay (outside the Canvas) – avoids React/portal unmount errors. */
function Loader() {
  const { active, progress } = useProgress()
  return active ? <div className="loader">{progress.toFixed(0)}%</div> : null
}

/** Narrow (portrait-ish) viewers need more margin: Bounds fits the box's axis size,
 *  but from a 3/4 angle the table's diagonal is wider than its length. */
function useFitMargin() {
  const query = '(max-width: 860px)'
  const [narrow, setNarrow] = useState(() => matchMedia(query).matches)
  useEffect(() => {
    const mq = matchMedia(query)
    const on = () => setNarrow(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return narrow ? 1.45 : 1.15
}

function Refit({ dep }: { dep: string }) {
  const api = useBounds()
  useEffect(() => {
    api.refresh().clip().fit()
  }, [dep, api])
  return null
}

export default function Viewer({ tableId, colorway }: { tableId: string; colorway: Colorway }) {
  const margin = useFitMargin()
  return (
    <>
    <Loader />
    <Canvas
      dpr={[1, 2]}
      camera={{ position: [2.1, 1.35, 2.3], fov: 35 }}
      gl={{ antialias: true, preserveDrawingBuffer: true }}
    >
      <Suspense fallback={null}>
        <Bounds fit clip observe margin={margin} maxDuration={0.7}>
          <Refit dep={tableId + margin} />
          <TableModel id={tableId} colorway={colorway} />
        </Bounds>
        <ContactShadows position={[0, 0.001, 0]} opacity={0.55} scale={4} blur={2.4} far={1} resolution={1024} />
        <Environment resolution={256}>
          <color attach="background" args={['#bdb6ac']} />
          <Lightformer intensity={0.7} position={[0, -3, 0]} rotation-x={-Math.PI / 2} scale={[8, 8, 1]} color="#efe7dc" />
          <Lightformer intensity={2.2} position={[0, 4, 0]} rotation-x={Math.PI / 2} scale={[6, 6, 1]} />
          <Lightformer intensity={1.2} position={[-4, 1.5, 2]} rotation-y={Math.PI / 2} scale={[4, 2, 1]} />
          <Lightformer intensity={0.8} position={[4, 1.5, -2]} rotation-y={-Math.PI / 2} scale={[4, 2, 1]} />
          <Lightformer intensity={0.6} position={[0, 1, 5]} scale={[6, 2, 1]} />
        </Environment>
      </Suspense>
      <OrbitControls
        makeDefault
        enablePan={false}
        enableDamping
        minDistance={0.9}
        maxDistance={6}
        minPolarAngle={0.2}
        maxPolarAngle={Math.PI / 2 - 0.05}
        autoRotate={!QA}
        autoRotateSpeed={0.6}
      />
    </Canvas>
    </>
  )
}
