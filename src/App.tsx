import { Suspense } from 'react'
import { Canvas } from '@react-three/fiber'
import {
  OrbitControls,
  ContactShadows,
  Environment,
  Lightformer,
  useGLTF,
  Html,
  useProgress,
} from '@react-three/drei'

const MODEL = '/models/table.glb'

function Table() {
  const { scene } = useGLTF(MODEL)
  return <primitive object={scene} />
}
useGLTF.preload(MODEL)

function Loader() {
  const { progress } = useProgress()
  return (
    <Html center>
      <div className="loader">{progress.toFixed(0)}%</div>
    </Html>
  )
}

function TableViewer() {
  return (
    <Canvas
      dpr={[1, 2]}
      camera={{ position: [2.0, 1.35, 2.2], fov: 35 }}
      gl={{ antialias: true, preserveDrawingBuffer: true }}
    >
      <Suspense fallback={<Loader />}>
        <group position={[0, -0.37, 0]}>
          <Table />
          <ContactShadows
            position={[0, 0.001, 0]}
            opacity={0.55}
            scale={4}
            blur={2.4}
            far={1}
            resolution={1024}
          />
        </group>
        {/* local studio lighting: no external HDRI download */}
        <Environment resolution={256}>
          {/* warm room-bounce base so undersides/legs never go black */}
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
        target={[0, 0, 0]}
        enablePan={false}
        enableDamping
        minDistance={1.8}
        maxDistance={5}
        minPolarAngle={0.2}
        maxPolarAngle={Math.PI / 2 - 0.05}
        autoRotate
        autoRotateSpeed={0.6}
      />
    </Canvas>
  )
}

export default function App() {
  return (
    <div className="page">
      <header className="nav">
        <span className="brand">HUSNI&nbsp;INTERIOR</span>
        <nav>
          <a href="#details">Details</a>
          <a href="#details">Dimensions</a>
          <a className="cta-small" href="#details">Shop</a>
        </nav>
      </header>

      <main className="hero">
        <section className="copy">
          <p className="eyebrow">Dining table · Ash veneer</p>
          <h1>
            Simple lines.
            <br />
            Made for everyday.
          </h1>
          <p className="lede">
            A light ash dining table for four, with slim tapered legs and a soft
            bevelled top. Drag the model to look at it from any angle.
          </p>
          <div className="actions">
            <a className="cta" href="#details">See details</a>
            <span className="price">¥24,990</span>
          </div>
        </section>

        <section className="viewer" aria-label="Interactive 3D table">
          <TableViewer />
          <p className="hint">Drag to rotate · Scroll to zoom</p>
        </section>
      </main>

      <section id="details" className="details">
        <div>
          <h3>Dimensions</h3>
          <p>140 × 78 cm, height 74 cm</p>
        </div>
        <div>
          <h3>Material</h3>
          <p>Ash veneer top, solid tapered legs</p>
        </div>
        <div>
          <h3>Seats</h3>
          <p>4 people</p>
        </div>
      </section>
    </div>
  )
}
