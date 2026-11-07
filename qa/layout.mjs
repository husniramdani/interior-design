// Layout QA: full-page screenshots at phone / tablet / desktop sizes, plus overflow checks.
// Usage: node qa/layout.mjs http://localhost:4173 out_dir
import { spawn } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'

const url = (process.argv[2] ?? 'http://localhost:4173') + '/?qa'
const out = process.argv[3] ?? 'qa/out'
mkdirSync(out, { recursive: true })
const VIEWPORTS = [
  { name: 'iphone', width: 390, height: 844, dpr: 2, mobile: true },
  { name: 'small-android', width: 360, height: 740, dpr: 2, mobile: true },
  { name: 'tablet', width: 820, height: 1180, dpr: 1, mobile: true },
  { name: 'desktop', width: 1440, height: 900, dpr: 1, mobile: false },
]
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const port = 9335
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
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description)
}
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
const evalJs = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true })).result.result.value
await send('Runtime.enable'); await send('Page.enable')

const report = {}
for (const v of VIEWPORTS) {
  await send('Emulation.setDeviceMetricsOverride', { width: v.width, height: v.height, deviceScaleFactor: v.dpr, mobile: v.mobile })
  await send('Emulation.setTouchEmulationEnabled', { enabled: v.mobile, maxTouchPoints: v.mobile ? 5 : 0 })
  await send('Emulation.setEmitTouchEventsForMouse', { enabled: v.mobile, configuration: v.mobile ? 'mobile' : 'desktop' })
  await send('Page.navigate', { url }); await sleep(3500)
  report[v.name] = await evalJs(`(() => {
    const vw = document.documentElement.clientWidth
    const box = (s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y + scrollY), Math.round(r.width), Math.round(r.height)] }
    const overflow = [...document.querySelectorAll('body *')].filter(e => { const r = e.getBoundingClientRect(); return (r.right > vw + 1 || r.left < -1) && !e.closest('.collection') }).map(e => e.className || e.tagName).slice(0, 8)
    const order = ['.title', '.viewer', '.colors', '.collection', '.info'].map(s => [s, box(s)?.[1]]).sort((a, b) => a[1] - b[1]).map(a => a[0])
    return { grid: getComputedStyle(document.querySelector('.hero')).gridTemplateColumns, hero: box('.hero'), colBox: box('.collection'), pageScrollWidth: document.documentElement.scrollWidth, vw, overflow, order, viewer: box('.viewer'), swatch: box('.swatch'), card: box('.card'),
      hasShop: /shop|cart|¥/i.test(document.body.innerText), hint: [...document.querySelectorAll('.hint span')].filter(s => getComputedStyle(s).display !== 'none').map(s => s.textContent) }
  })()`)
  const full = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
  writeFileSync(`${out}/${v.name}_full.png`, Buffer.from(full.result.data, 'base64'))
}
console.log(JSON.stringify({ report, errors }, null, 1))
ws.close(); proc.kill()
