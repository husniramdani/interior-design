import { useState } from 'react'
import Viewer from './Viewer'
import { finishes, swatchBackground, tables, thumbUrl } from './catalog'

export default function App() {
  const [tableId, setTableId] = useState(tables[0].id)
  // remember the chosen colour per table when switching back and forth
  const [colorBy, setColorBy] = useState<Record<string, number>>({})
  const table = tables.find((t) => t.id === tableId)!
  const colorIdx = colorBy[tableId] ?? 0
  const colorway = table.colorways[colorIdx]
  const materialText = [...new Set(Object.values(colorway.slots).map((f) => finishes[f!].label))].join(' · ')

  return (
    <div className="page">
      <header className="nav">
        <span className="brand">HUSNI&nbsp;INTERIOR</span>
        <nav>
          <a href="#collection">Collection</a>
          <a href="#details">Details</a>
        </nav>
      </header>

      {/* One grid; CSS areas reorder it: desktop = text left / 3D right, mobile = title → 3D → colours → tables → details */}
      <main className="hero">
        <div className="title">
          <p className="eyebrow">{table.type}</p>
          <h1>{table.name}</h1>
        </div>

        <section className="viewer" aria-label="Interactive 3D table">
          <Viewer tableId={tableId} colorway={colorway} />
          <p className="hint">
            <span className="hint-mouse">Drag to rotate · Scroll to zoom</span>
            <span className="hint-touch">Drag to rotate · Pinch to zoom</span>
          </p>
        </section>

        <div className="colors" role="radiogroup" aria-label="Colour">
          <p className="label">
            Colour <span>{colorway.name}</span>
          </p>
          <div className="swatches">
            {table.colorways.map((cw, i) => (
              <button
                key={cw.name}
                role="radio"
                aria-checked={i === colorIdx}
                aria-label={cw.name}
                title={cw.name}
                data-color={i}
                className={`swatch ${i === colorIdx ? 'active' : ''}`}
                style={{ background: swatchBackground(cw) }}
                onClick={() => setColorBy((c) => ({ ...c, [tableId]: i }))}
              />
            ))}
          </div>
        </div>

        <section id="details" className="info">
          <p className="lede">{table.desc}</p>
          <dl className="specs">
            <div>
              <dt>Dimensions</dt>
              <dd>{table.dims}</dd>
            </div>
            <div>
              <dt>Material</dt>
              <dd>{materialText}</dd>
            </div>
            <div>
              <dt>Seats</dt>
              <dd>{table.seats}</dd>
            </div>
          </dl>
        </section>

        <section id="collection" className="collection" aria-label="Choose a table">
          {tables.map((t) => (
            <button
              key={t.id}
              data-table={t.id}
              className={`card ${t.id === tableId ? 'active' : ''}`}
              aria-pressed={t.id === tableId}
              onClick={() => setTableId(t.id)}
            >
              <img src={thumbUrl(t.id)} alt="" width={400} height={300} />
              <span className="card-name">{t.name}</span>
              <span className="card-type">{t.type}</span>
            </button>
          ))}
        </section>
      </main>
    </div>
  )
}
