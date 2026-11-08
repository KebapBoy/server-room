// Renders the screenshots and the GIF frames of the page with the sample installation, driving
// Chromium over the DevTools protocol. Run by capture.sh inside its container:
// /capture is this folder (read-only), /work a temp dir with the page in site/, out/ and frames/.
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const OUT = '/work/out';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- sample snapshot -------------------------------------------------------
// sample/stacks.json, made current so the page does not report stale data
function writeSnapshot() {
  const snap = JSON.parse(fs.readFileSync('/capture/sample/stacks.json', 'utf8'));
  snap.generated = Math.floor(Date.now() / 1000);
  fs.mkdirSync('/work/site/data', { recursive: true });
  fs.writeFileSync('/work/site/data/stacks.json', JSON.stringify(snap));
}

// ---- CDP ------------------------------------------------------------------
async function connect() {
  for (let i = 0; i < 50; i++) {
    try {
      const v = await (await fetch('http://127.0.0.1:9222/json/version')).json();
      return cdp(v.webSocketDebuggerUrl);
    } catch { await sleep(200); }
  }
  throw new Error('chrome not reachable');
}
function cdp(url) {
  const ws = new WebSocket(url);
  let id = 0;
  const pending = new Map();
  const handlers = new Set();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
    } else for (const h of handlers) h(m);
  };
  const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
    const i = ++id;
    pending.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method, params, sessionId }));
  });
  return new Promise((r) => { ws.onopen = () => r({ send, handlers, close: () => ws.close() }); });
}

async function openPage(b, { width, height, scale = 1, mobile = false, scheme = 'light', contrast = 'no-preference', js = true }) {
  const { targetId } = await b.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await b.send('Target.attachToTarget', { targetId, flatten: true });
  const s = (method, params) => b.send(method, params, sessionId);
  await s('Page.enable');
  await s('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile });
  await s('Emulation.setEmulatedMedia', { features: [
    { name: 'prefers-color-scheme', value: scheme },
    { name: 'prefers-contrast', value: contrast },
    { name: 'prefers-reduced-motion', value: 'no-preference' },
  ] });
  if (!js) await s('Emulation.setScriptExecutionDisabled', { value: true });
  return { s, sessionId, close: () => b.send('Target.closeTarget', { targetId }) };
}

async function screenshot(page, file, full) {
  const { cssContentSize, cssLayoutViewport } = await page.s('Page.getLayoutMetrics');
  const size = full ? cssContentSize : { width: cssLayoutViewport.clientWidth, height: cssLayoutViewport.clientHeight };
  const { data } = await page.s('Page.captureScreenshot', {
    format: 'png', captureBeyondViewport: full,
    clip: { x: 0, y: 0, width: size.width, height: size.height, scale: 1 },
  });
  fs.writeFileSync(`${OUT}/${file}`, Buffer.from(data, 'base64'));
  console.log('wrote', file);
}

// Records screencast frames into dir until stop() is called
function record(b, page, dir, maxWidth) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const frames = [];
  const handler = (m) => {
    if (m.method !== 'Page.screencastFrame' || m.sessionId !== page.sessionId) return;
    const n = String(frames.length).padStart(5, '0');
    fs.writeFileSync(`${dir}/${n}.png`, Buffer.from(m.params.data, 'base64'));
    frames.push({ file: `${n}.png`, t: m.params.metadata.timestamp });
    page.s('Page.screencastFrameAck', { sessionId: m.params.sessionId }).catch(() => {});
  };
  b.handlers.add(handler);
  page.s('Page.startScreencast', { format: 'png', maxWidth, maxHeight: 4000, everyNthFrame: 1 });
  return async () => {
    await page.s('Page.stopScreencast');
    b.handlers.delete(handler);
    // ffmpeg concat list with real frame durations
    let list = '';
    frames.forEach((f, i) => {
      const next = frames[i + 1]?.t ?? f.t + 0.1;
      list += `file '${f.file}'\nduration ${Math.max(0.01, next - f.t).toFixed(3)}\n`;
    });
    list += `file '${frames.at(-1).file}'\n`;
    fs.writeFileSync(`${dir}/list.txt`, list);
    console.log('recorded', frames.length, 'frames in', dir);
  };
}

async function click(page, selector) {
  const { result } = await page.s('Runtime.evaluate', {
    expression: `JSON.stringify(document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect())`,
  });
  const r = JSON.parse(result.value);
  const x = r.x + r.width / 2, y = r.y + r.height / 2;
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
    await page.s('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
  }
}

// ---- main -----------------------------------------------------------------
const ADMIN = 'http://example.com:8081/';
const USER = 'http://example.com:8082/';
const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844, scale: 2, mobile: true };

writeSnapshot();
const servers = [8081, 8082].map((port) =>
  spawn('php', ['-S', `0.0.0.0:${port}`, '/capture/sample/router.php'], { stdio: 'ignore' }));
const chrome = spawn('chromium-browser', ['--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
  '--remote-debugging-port=9222', '--host-resolver-rules=MAP example.com 127.0.0.1', '--font-render-hinting=none', 'about:blank'], { stdio: 'ignore' });
const b = await connect();
await sleep(500);

const only = process.argv[2];
const shots = [
  ['desktop-light.png', ADMIN, { ...DESKTOP, scheme: 'light' }],
  ['desktop-dark.png', ADMIN, { ...DESKTOP, scheme: 'dark' }],
  ['desktop-contrast.png', ADMIN, { ...DESKTOP, scheme: 'light', contrast: 'more' }],
  ['desktop-user.png', USER, { ...DESKTOP, scheme: 'dark' }],
  ['mobile-light.png', ADMIN, { ...MOBILE, scheme: 'light' }],
  ['mobile-dark.png', ADMIN, { ...MOBILE, scheme: 'dark' }],
  ['mobile-user.png', USER, { ...MOBILE, scheme: 'light' }],
  ['noscript.png', USER, { ...DESKTOP, height: 250, scheme: 'light', js: false }],
];
if (!only || only === 'shots') {
  for (const [file, url, opts] of shots) {
    const page = await openPage(b, opts);
    await page.s('Page.navigate', { url });
    await sleep(opts.js === false ? 1500 : 8000);
    await screenshot(page, file, !opts.mobile);
    await page.close();
  }
}

if (!only || only === 'gif') {
  // Greeting typed, traffic on the backplanes and patch cables
  let page = await openPage(b, { width: 1280, height: 800, scheme: 'dark' });
  let stop = record(b, page, '/work/frames/intro', 1280);
  await page.s('Page.navigate', { url: ADMIN });
  await sleep(10000);
  await stop();
  await page.close();

  // Sign-out: pull the plug, count down, power down; /?dry so nothing is logged out
  page = await openPage(b, { width: 1280, height: 800, scheme: 'light' });
  await page.s('Page.navigate', { url: ADMIN + '?dry' });
  await sleep(7500);
  stop = record(b, page, '/work/frames/signout', 1280);
  await sleep(800);
  await click(page, '.plug-link');
  // countdown (10 s) + power down (5 s) + dark (2 s) + part of the fade, before ?dry reloads
  await sleep(18000);
  await stop();
  await page.close();
}


b.close();
chrome.kill();
servers.forEach((p) => p.kill());
process.exit(0);
