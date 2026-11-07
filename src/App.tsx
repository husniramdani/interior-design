import { useCallback, useEffect, useRef, useState } from 'react'
import Viewer from './Viewer'
import { bookLabel, books, finishes, swatchBackground, tables, thumbUrl } from './catalog'
import { clampToSurface, freeSpot, type Placed } from './layout'

const STEP = Math.PI / 12 // 15deg rotate step

export default function App() {
  const [tableId, setTableId] = useState(tables[0].id)
  // remember the chosen colour and the placed books per table when switching back and forth
  const [colorBy, setColorBy] = useState<Record<string, number>>({})
  const [booksBy, setBooksBy] = useState<Record<string, Placed[]>>({})
  const [selected, setSelected] = useState<string | null>(null)
  const uidSeq = useRef(0)
  const [focus, setFocus] = useState(0)

  const table = tables.find((t) => t.id === tableId)!
  const colorIdx = colorBy[tableId] ?? 0
  const colorway = table.colorways[colorIdx]
  const materialText = [...new Set(Object.values(colorway.slots).map((f) => finishes[f!].label))].join(' · ')
  const placed = booksBy[tableId] ?? []
  const current = placed.find((p) => p.uid === selected) ?? null

  const setPlaced = useCallback(
    (next: Placed[] | ((prev: Placed[]) => Placed[])) =>
      setBooksBy((all) => ({ ...all, [tableId]: typeof next === 'function' ? next(all[tableId] ?? []) : next })),
    [tableId],
  )

  const addBook = (id: string) => {
    const uid = `b${++uidSeq.current}`
    setPlaced((list) => [...list, freeSpot(list, id, table.surface, uid)])
    setSelected(uid)
    setFocus((f) => f + 1)
  }
  const rotateSel = useCallback(
    (dir: number) =>
      setPlaced((list) =>
        list.map((p) => {
          if (p.uid !== selected) return p
          // go to the next 15deg step in that direction (12deg -> 15deg, not 30deg)
          const k = dir > 0 ? Math.floor(p.rot / STEP + 1e-6) + 1 : Math.ceil(p.rot / STEP - 1e-6) - 1
          return clampToSurface({ ...p, rot: k * STEP }, table.surface)
        }),
      ),
    [selected, setPlaced, table.surface],
  )
  const removeSel = useCallback(() => {
    setPlaced((list) => list.filter((p) => p.uid !== selected))
    setSelected(null)
  }, [selected, setPlaced])

  // keyboard: R / Shift+R rotate, Delete / Backspace remove, Esc deselect
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!selected || (e.target as HTMLElement).closest('input, textarea')) return
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeSel() }
      else if (e.key === 'r' || e.key === 'R') rotateSel(e.shiftKey ? -1 : 1)
      else if (e.key === 'Escape') setSelected(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected, removeSel, rotateSel])

  const switchTable = (id: string) => {
    setSelected(null)
    setTableId(id)
  }

  return (
    <div className="page">
      <header className="nav">
        <span className="brand">HUSNI&nbsp;INTERIOR</span>
        <nav>
          <a href="#collection">Collection</a>
          <a href="#details">Details</a>
        </nav>
      </header>

      {/* One grid; CSS areas reorder it: desktop = text left / 3D right, mobile = title → 3D → options → tables → details */}
      <main className="hero">
        <div className="title">
          <p className="eyebrow">{table.type}</p>
          <h1>{table.name}</h1>
        </div>

        <section className="viewer" aria-label="Interactive 3D table">
          <Viewer
            tableId={tableId}
            colorway={colorway}
            placed={placed}
            selected={selected}
            onSelect={setSelected}
            onChange={setPlaced}
            focus={focus}
          />
          {current ? (
            <div className="toolbar" role="toolbar" aria-label="Selected book">
              <span className="toolbar-name">
                <i style={{ background: books[current.id].color }} />
                {bookLabel(current.id).kind}
              </span>
              <button data-act="rot-left" onClick={() => rotateSel(-1)} aria-label="Rotate left" title="Rotate left (Shift+R)">
                <svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4.5h4.5" /></svg>
              </button>
              <button data-act="rot-right" onClick={() => rotateSel(1)} aria-label="Rotate right" title="Rotate right (R)">
                <svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.4-5.7M20 4v4.5h-4.5" /></svg>
              </button>
              <button data-act="remove" className="danger" onClick={removeSel} aria-label="Remove book" title="Remove (Delete)">
                <svg viewBox="0 0 24 24"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" /></svg>
              </button>
              <button data-act="done" className="done" onClick={() => setSelected(null)}>Done</button>
            </div>
          ) : (
            <p className="hint">
              <span className="hint-mouse">{placed.length ? 'Drag a book to move it · Drag the table to rotate' : 'Drag to rotate · Scroll to zoom'}</span>
              <span className="hint-touch">{placed.length ? 'Drag a book to move it · Drag the table to rotate' : 'Drag to rotate · Pinch to zoom'}</span>
            </p>
          )}
        </section>

        <div className="colors">
          <div role="radiogroup" aria-label="Colour" className="opt">
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

          <div className="opt books-opt">
            <p className="label">
              Style it with books <span>{placed.length ? `${placed.length} on the table` : ''}</span>
              {placed.length > 0 && (
                <button className="text-btn" data-act="clear" onClick={() => { setPlaced([]); setSelected(null) }}>
                  Clear all
                </button>
              )}
            </p>
            <div className="book-picker">
              {Object.entries(books).map(([id, b]) => {
                const l = bookLabel(id)
                return (
                  <button key={id} data-book={id} className="book-chip" onClick={() => addBook(id)} title={`Add ${l.kind.toLowerCase()} (${l.color})`}>
                    <span
                      className={`book-icon ${b.kind}`}
                      style={{ background: b.color, width: 14 + b.w * 60, height: 18 + b.h * 60 }}
                    />
                    <span className="book-text">
                      <b>{l.color}</b>
                      <small>{l.kind}</small>
                    </span>
                    <span className="plus" aria-hidden>+</span>
                  </button>
                )
              })}
            </div>
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
              onClick={() => switchTable(t.id)}
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
