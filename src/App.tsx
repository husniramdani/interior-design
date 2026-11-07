import { useState } from 'react'
import Viewer from './Viewer'
import { finishes, formatPrice, swatchBackground, tables, thumbUrl } from './catalog'

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
          <a className="cta-small" href="#details">Shop</a>
        </nav>
      </header>

      <main className="hero">
        <section className="copy">
          <p className="eyebrow">{table.type}</p>
          <h1>{table.name}</h1>
          <p className="lede">{table.desc} Drag the model to look at it from any angle.</p>

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

          <div className="actions">
            <a className="cta" href="#details">Add to cart</a>
            <span className="price">{formatPrice(table.price)}</span>
          </div>
        </section>

        <section className="viewer" aria-label="Interactive 3D table">
          <Viewer tableId={tableId} colorway={colorway} />
          <p className="hint">Drag to rotate · Scroll to zoom</p>
        </section>
      </main>

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

      <section id="details" className="details">
        <div>
          <h3>Dimensions</h3>
          <p>{table.dims}</p>
        </div>
        <div>
          <h3>Material</h3>
          <p>{materialText}</p>
        </div>
        <div>
          <h3>Seats</h3>
          <p>{table.seats}</p>
        </div>
      </section>
    </div>
  )
}
