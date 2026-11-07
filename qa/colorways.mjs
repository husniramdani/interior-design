// QA every table × colourway: click the UI like a user, screenshot the 3D viewer.
// Usage: node qa/colorways.mjs http://localhost:4173 out_dir
import { spawn } from 'node:child_process'
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs'

const url = (process.argv[2] ?? 'http://localhost:4173') + '/?qa'
const out = process.argv[3] ?? 'qa/out'
mkdirSync(out, { recursive: true })
const catalog = JSON.parse(readFileSync(new URL('../src/catalog.json', import.meta.url)))
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const port = 9334
const proc = spawn(chrome, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${out}/profile`,
  '--window-size=1440,900', '--use-angle=metal', '--enable-gpu', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let wsUrl
for (let i = 0; i < 40 && !wsUrl; i++) {
  await sleep(250)
  try { wsUrl = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((x) => x.type === 'page')?.webSocketDebuggerUrl } catch {}
}
const ws = new WebSocket(wsUrl); await new Promise((r) => (ws.onopen = r))
let id = 0; const pending = new Map(); const logs = []
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type !== 'log') logs.push(m.params.type + ': ' + m.params.args.map((a) => a.value ?? a.description).join(' '))
  if (m.method === 'Runtime.exceptionThrown') logs.push('EXCEPTION: ' + m.params.exceptionDetails.exception?.description)
}
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
const evalJs = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true })).result.result.value
await send('Runtime.enable'); await send('Page.enable')
const MOBILE = !!process.env.MOBILE // MOBILE=1 => iPhone-size viewport
await send('Emulation.setDeviceMetricsOverride', MOBILE ? { width: 390, height: 844, deviceScaleFactor: 2, mobile: true } : { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url }); await sleep(4000)

const full = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
writeFileSync(`${out}/page_full.png`, Buffer.from(full.result.data, 'base64'))

const rect = await evalJs(`(() => { const r = document.querySelector('.viewer').getBoundingClientRect(); return {x:r.x,y:r.y+scrollY,width:r.width,height:r.height,scale:1} })()`)
const shots = []
// CLOSE="studio:2,tulip:2" => zoom in with the mouse wheel and shoot only those combos
const close = process.env.CLOSE ? Object.fromEntries(process.env.CLOSE.split(',').map((s) => s.split(':'))) : null
for (const t of catalog.tables) {
  if (close && !(t.id in close)) continue
  await evalJs(`document.querySelector('[data-table="${t.id}"]').click()`); await sleep(1300)
  for (let i = 0; i < t.colorways.length; i++) {
    if (close && String(i) !== close[t.id]) continue
    await evalJs(`document.querySelector('[data-color="${i}"]').click()`); await sleep(500)
    if (close) {
      const cx = rect.x + rect.width / 2, cy = rect.y + rect.height / 2
      // TILT=px drags the camera up (look down at the tabletop); ZOOM=n wheel ticks (default 12)
      const tilt = Number(process.env.TILT ?? 0)
      if (tilt) {
        const md = (type, x, y) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 })
        await md('mousePressed', cx, cy)
        for (let k = 1; k <= 10; k++) { await md('mouseMoved', cx, cy + (tilt * k) / 10); await sleep(16) }
        await md('mouseReleased', cx, cy + tilt); await sleep(300)
      }
      for (let k = 0; k < Number(process.env.ZOOM ?? 12); k++) { await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: cx, y: cy, deltaX: 0, deltaY: -120 }); await sleep(40) }
      await sleep(1200)
    }
    const label = await evalJs(`document.querySelector('.label span').textContent + ' | ' + document.querySelector('h1').textContent`)
    const r = await send('Page.captureScreenshot', { format: 'png', clip: rect })
    const f = `${out}/${t.id}_${i}.png`; writeFileSync(f, Buffer.from(r.result.data, 'base64'))
    shots.push({ f, label })
  }
}
console.log(JSON.stringify({ shots, logs }, null, 1))
ws.close(); proc.kill()
