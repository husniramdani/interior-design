// QA for the book editor: drives the UI with real mouse events in headless Chrome and
// reads book positions back from the three.js scene (window.__r3f, exposed in ?qa mode).
// Usage: node qa/books.mjs http://localhost:4173 out_dir
import { spawn } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'

const base = process.argv[2] ?? 'http://localhost:4173'
const out = process.argv[3] ?? 'qa/out'
mkdirSync(out, { recursive: true })
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const port = 9336
const proc = spawn(chrome, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${out}/profile`,
  '--use-angle=metal', '--enable-gpu', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let wsUrl
for (let i = 0; i < 40 && !wsUrl; i++) {
  await sleep(250)
  try { wsUrl = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((x) => x.type === 'page')?.webSocketDebuggerUrl } catch {}
}
const ws = new WebSocket(wsUrl); await new Promise((r) => (ws.onopen = r))
let id = 0; const pending = new Map(); const errors = []
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description?.slice(0, 300))
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 300))
}
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
const js = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true })
  if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description)
  return r.result.result.value
}
const click = (sel) => js(`document.querySelector('${sel}').click()`)
const mouse = (type, x, y) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 })
async function dragPath(from, to, steps = 16) {
  await mouse('mouseMoved', from[0], from[1])
  await mouse('mousePressed', from[0], from[1]); await sleep(60)
  for (let k = 1; k <= steps; k++) {
    await mouse('mouseMoved', from[0] + ((to[0] - from[0]) * k) / steps, from[1] + ((to[1] - from[1]) * k) / steps); await sleep(20)
  }
  await mouse('mouseReleased', to[0], to[1]); await sleep(700)
}
const shot = async (name) => {
  const rect = await js(`(() => { const r = document.querySelector('.viewer').getBoundingClientRect(); return {x:r.x,y:r.y+scrollY,width:r.width,height:r.height,scale:1} })()`)
  const r = await send('Page.captureScreenshot', { format: 'png', clip: rect })
  writeFileSync(`${out}/${name}.png`, Buffer.from(r.result.data, 'base64'))
}

// Scene helpers evaluated in the page
const STATE = `(() => {
  const s = window.__r3f, out = []
  const g = s.scene.getObjectByName('books'); if (!g) return { books: [] }
  for (const c of g.children) if (c.type === 'Group') out.push({ x: +c.position.x.toFixed(4), y: +c.position.y.toFixed(4), z: +c.position.z.toFixed(4), rot: +(c.rotation.y * 180 / Math.PI).toFixed(1) })
  const cam = s.camera.position
  return { books: out, cam: [cam.x, cam.y, cam.z].map(v => +v.toFixed(4)), sel: !!document.querySelector('.toolbar') }
})()`
// screen position of book i (its top centre) or of the rotate handle
const SCREEN = (expr) => `(() => {
  const s = window.__r3f, V = s.camera.position.constructor
  const r = s.gl.domElement.getBoundingClientRect()
  const p = ${expr}
  const v = p.clone().project(s.camera)
  return [r.left + (v.x + 1) / 2 * r.width, r.top + (1 - v.y) / 2 * r.height]
})()`
const bookTop = (i) => SCREEN(`(() => { const c = s.scene.getObjectByName('books').children.filter(o => o.type === 'Group')[${i}]; const w = new V(); c.getWorldPosition(w); w.y += 0.012; return w })()`)
const handle = SCREEN(`(() => { const h = s.scene.getObjectByName('rotate-handle'); const w = new V(); h.getWorldPosition(w); return w })()`)
const worldToScreen = (x, y, z) => SCREEN(`new V(${x}, ${y}, ${z})`)
// a point in book i's local frame (x along width, z along height), on its top-ish
const bookLocal = (i, lx, lz) => SCREEN(`(() => { const c = s.scene.getObjectByName('books').children.filter(o => o.type === 'Group')[${i}]; return c.localToWorld(new V(${lx}, 0.012, ${lz})) })()`)

const report = {}
async function run(tableId, w, h, tag) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 600 })
  await send('Page.navigate', { url: base + '/?qa' }); await sleep(3500)
  await click(`[data-table="${tableId}"]`); await sleep(1200)
  const r = { steps: [] }
  const camInitial = (await js(STATE)).cam

  // 1. add three books
  for (const b of ['art_sage', 'novel_navy', 'novel_terracotta']) { await click(`[data-book="${b}"]`); await sleep(500) }
  let st = await js(STATE)
  r.steps.push({ step: 'add 3', books: st.books, toolbar: st.sel })
  r.placingViewGlide = JSON.stringify(st.cam) !== JSON.stringify(camInitial) // camera moved to the placing view
  const camStart = st.cam // from here on, dragging books must NOT move the camera
  await shot(`${tag}_1_added`)

  // 2. drag book 2 (terracotta) onto book 0 (sage) -> must stack (y > surface)
  const from = await js(bookTop(2)), to = await js(bookTop(0))
  await dragPath(from, to)
  st = await js(STATE)
  r.steps.push({ step: 'stack 2 on 0', books: st.books, camMoved: JSON.stringify(st.cam) !== JSON.stringify(camStart) })
  await shot(`${tag}_2_stacked`)

  // 3. grab the bottom book (sage, index 0) by its uncovered corner and pull it away:
  //    the book stacked on it (terracotta) must fall back to the table surface
  const corner = await js(bookLocal(0, 0.1, 0.13))
  const sy = st.books[0].y
  const away = await js(worldToScreen(st.books[0].x + 0.32, sy, st.books[0].z - 0.05))
  await dragPath(corner, away)
  st = await js(STATE)
  r.steps.push({ step: 'pull bottom book away (top book must drop)', books: st.books })

  // 4. drag a book far past the table edge -> must stay on the table
  const navy = await js(bookTop(1))
  const off = await js(worldToScreen(3, 0.75, 0))
  await dragPath(navy, [Math.min(off[0], w - 5), navy[1]])
  st = await js(STATE)
  r.steps.push({ step: 'drag off edge', books: st.books })

  // 5. rotate with the toolbar button (selected = last dragged book)
  const before = (await js(STATE)).books
  await click('[data-act="rot-right"]'); await sleep(500)
  st = await js(STATE)
  r.steps.push({ step: 'rotate button', before, after: st.books })

  // 6. rotate with the handle: drag it around to a world point 90deg further on, along an arc
  const last = st.books[st.books.length - 1]
  const surfY = (await js(STATE)).books.reduce((m, b) => Math.min(m, b.y), 9)
  const r0 = last.rot * Math.PI / 180
  const hs = await js(handle)
  r.handleScreen = hs
  r.handleHitEl = await js(`(() => { const e = document.elementFromPoint(${hs[0]}, ${hs[1]}); return e ? e.tagName + '.' + e.className : null })()`)
  r.viewerRect = await js(`(() => { const r = document.querySelector('.viewer').getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom].map(Math.round) })()`)
  // the handle may sit at the head or the tail: start the arc at its actual angle
  const hw = await js(`(() => { const h = window.__r3f.scene.getObjectByName('rotate-handle'); const w = h.getWorldPosition(h.position.clone()); return [w.x, w.y, w.z] })()`)
  const a0 = Math.atan2(hw[0] - last.x, hw[2] - last.z)
  const arc = []
  for (let k = 1; k <= 12; k++) {
    const a = a0 + (Math.PI / 2) * k / 12
    arc.push(await js(worldToScreen(last.x + 0.22 * Math.sin(a), hw[1], last.z + 0.22 * Math.cos(a))))
  }
  await mouse('mouseMoved', hs[0], hs[1]); await mouse('mousePressed', hs[0], hs[1]); await sleep(60)
  for (const pt of arc) { await mouse('mouseMoved', pt[0], pt[1]); await sleep(25) }
  await mouse('mouseReleased', arc[11][0], arc[11][1]); await sleep(700)
  st = await js(STATE)
  r.steps.push({ step: 'rotate handle (+90 expected)', rotBefore: last.rot, after: st.books, delta: +(st.books[st.books.length - 1].rot - last.rot).toFixed(1) })
  await shot(`${tag}_3_rotated`)
  r.camMovedDuringEditing = JSON.stringify((await js(STATE)).cam) !== JSON.stringify(camStart)
  // close-up of the selection (zoom toward the selected book)
  const zc = await js(bookTop(st.books.length - 1))
  for (let k = 0; k < 7; k++) { await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: zc[0], y: zc[1], deltaX: 0, deltaY: -120 }); await sleep(40) }
  await sleep(900)
  await shot(`${tag}_5_zoom`)

  // 7. remove the selected book
  await click('[data-act="remove"]'); await sleep(400)
  st = await js(STATE)
  r.steps.push({ step: 'remove', count: st.books.length, toolbar: st.sel })
  await shot(`${tag}_4_final`)
  // 8. orbit must still work after the drags (controls re-enabled): drag on empty sky area
  const vr = await js(`(() => { const r = document.querySelector('.viewer').getBoundingClientRect(); return [r.left, r.top, r.width, r.height] })()`)
  await dragPath([vr[0] + vr[2] * 0.85, vr[1] + vr[3] * 0.12], [vr[0] + vr[2] * 0.55, vr[1] + vr[3] * 0.12])
  r.orbitWorksAfter = JSON.stringify((await js(STATE)).cam) !== JSON.stringify(st.cam)
  report[tag] = r
}

await run('lisa', 1440, 900, 'lisa')
await run('tulip', 1440, 900, 'tulip')
await run('studio', 390, 844, 'mobile')
console.log(JSON.stringify({ report, errors }, null, 1))
ws.close(); proc.kill()
