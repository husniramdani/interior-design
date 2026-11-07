// Headless QA: load page, screenshot, simulate a drag on the 3D canvas, screenshot again.
// Usage: node qa/shot.mjs http://localhost:4173 out_dir
import { spawn } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'

const url = process.argv[2] ?? 'http://localhost:4173'
const out = process.argv[3] ?? 'qa/out'
mkdirSync(out, { recursive: true })
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const port = 9333
const proc = spawn(chrome, [
  '--headless=new', `--remote-debugging-port=${port}`, '--user-data-dir=' + out + '/profile',
  '--window-size=1440,900', '--use-angle=metal', '--enable-gpu', '--hide-scrollbars', 'about:blank',
], { stdio: 'ignore' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let wsUrl
for (let i = 0; i < 40 && !wsUrl; i++) {
  await sleep(250)
  try {
    const t = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
    wsUrl = t.find((x) => x.type === 'page')?.webSocketDebuggerUrl
  } catch {}
}
const ws = new WebSocket(wsUrl)
await new Promise((r) => (ws.onopen = r))
let id = 0; const pending = new Map(); const logs = []
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  if (m.method === 'Runtime.consoleAPICalled') logs.push(m.params.type + ': ' + m.params.args.map((a) => a.value ?? a.description).join(' '))
  if (m.method === 'Runtime.exceptionThrown') logs.push('EXCEPTION: ' + m.params.exceptionDetails.exception?.description)
}
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(`${out}/${name}.png`, Buffer.from(r.result.data, 'base64'))
}
await send('Runtime.enable'); await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url })
await sleep(5000)
const info = await send('Runtime.evaluate', { returnByValue: true, expression: `(() => {
  const c = document.querySelector('canvas'); const r = c?.getBoundingClientRect();
  const gl = c?.getContext('webgl2');
  return { canvas: !!c, rect: r && [r.x, r.y, r.width, r.height], renderer: gl?.getParameter(gl.RENDERER) }})()` })
const v = info.result.result.value
// stop autorotate influence: shoot immediately, then drag horizontally ~300px and vertically 80px
await shot('01_loaded')
const cx = v.rect[0] + v.rect[2] / 2, cy = v.rect[1] + v.rect[3] / 2
const mouse = (type, x, y) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, pointerType: 'mouse' })
await mouse('mousePressed', cx, cy)
for (let i = 1; i <= 20; i++) { await mouse('mouseMoved', cx - i * 18, cy - i * 5); await sleep(16) }
await mouse('mouseReleased', cx - 360, cy - 100)
await sleep(1200)
await shot('02_after_drag')
console.log(JSON.stringify({ ...v, logs }, null, 1))
ws.close(); proc.kill()
