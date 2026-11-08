// Measures frame intervals and main-thread time of the page in headless Chromium over the
// DevTools protocol. Run by perf.sh inside its container: /capture is the screenshot folder
// (sample installation), /work a temp dir with the page in site/ and out/ for the results.
// Headless Chromium renders in software, so absolute numbers are pessimistic; compare runs
// with each other, not with a real device.
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const OUT = '/work/out';
const WARMUP_MS = 4000;
const MEASURE_MS = 8000;
const FRAME_MS = 1000 / 60;
const LATE_MS = 17.5; // a frame counts as late above this (16.7 ms plus timer jitter)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- sample snapshot -------------------------------------------------------
function writeSnapshot() {
  const snap = JSON.parse(fs.readFileSync('/capture/sample/stacks.json', 'utf8'));
  snap.generated = Math.floor(Date.now() / 1000);
  fs.mkdirSync('/work/site/data', { recursive: true });
  fs.writeFileSync('/work/site/data/stacks.json', JSON.stringify(snap));
}

// ---- CDP (same minimal client as capture.mjs) ------------------------------
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
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
    }
  };
  const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
    const i = ++id;
    pending.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method, params, sessionId }));
  });
  return new Promise((r) => { ws.onopen = () => r({ send, close: () => ws.close() }); });
}

async function openPage(b, { width, height, scale = 1, mobile = false, scheme = 'light', cpu = 1 }) {
  const { targetId } = await b.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await b.send('Target.attachToTarget', { targetId, flatten: true });
  const s = (method, params) => b.send(method, params, sessionId);
  await s('Page.enable');
  await s('Performance.enable');
  await s('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile });
  await s('Emulation.setEmulatedMedia', { features: [
    { name: 'prefers-color-scheme', value: scheme },
    { name: 'prefers-contrast', value: 'no-preference' },
    { name: 'prefers-reduced-motion', value: 'no-preference' },
  ] });
  if (cpu > 1) await s('Emulation.setCPUThrottlingRate', { rate: cpu });
  return { s, close: () => b.send('Target.closeTarget', { targetId }) };
}

async function metrics(page) {
  const { metrics } = await page.s('Performance.getMetrics');
  return Object.fromEntries(metrics.map((m) => [m.name, m.value]));
}

const median = (a) => a[Math.floor(a.length / 2)];
const pct = (a, p) => a[Math.min(a.length - 1, Math.floor(a.length * p))];
const round = (n, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

async function measure(b, sc) {
  const page = await openPage(b, sc);
  await page.s('Page.navigate', { url: sc.url });
  await sleep(WARMUP_MS);

  await page.s('Runtime.evaluate', { expression: `
    window.__t = []; window.__run = true;
    (function tick(t) { window.__t.push(t); if (window.__run) requestAnimationFrame(tick); })(performance.now());
    0` });
  const before = await metrics(page);
  const t0 = Date.now();
  await sleep(MEASURE_MS);
  const after = await metrics(page);
  const wall = (Date.now() - t0) / 1000;
  const { result } = await page.s('Runtime.evaluate', {
    expression: 'window.__run = false; JSON.stringify(window.__t)', returnByValue: true });
  await page.close();

  const ts = JSON.parse(result.value);
  const iv = ts.slice(1).map((t, i) => t - ts[i]);
  const sorted = [...iv].sort((x, y) => x - y);
  const dropped = iv.reduce((n, d) => n + Math.max(0, Math.round(d / FRAME_MS - 1)), 0);
  const cpuMs = (k) => round(((after[k] ?? 0) - (before[k] ?? 0)) * 1000, 0);
  return {
    name: sc.name, frames: iv.length,
    medianMs: round(median(sorted)), p95Ms: round(pct(sorted, 0.95)), maxMs: round(sorted.at(-1)),
    latePct: round(100 * iv.filter((d) => d > LATE_MS).length / iv.length),
    droppedPct: round(100 * dropped / (iv.length + dropped)),
    fps: round(iv.length / wall),
    scriptMs: cpuMs('ScriptDuration'), styleMs: cpuMs('RecalcStyleDuration'),
    layoutMs: cpuMs('LayoutDuration'), taskMs: cpuMs('TaskDuration'),
  };
}

// ---- main -----------------------------------------------------------------
const ADMIN = 'http://example.com:8081/';
const DESKTOP = { width: 1440, height: 900 };
const TABLET = { width: 820, height: 1180, scale: 2, mobile: true };
const PHONE = { width: 390, height: 844, scale: 3, mobile: true };
const scenarios = [
  { name: 'desktop light', url: ADMIN, ...DESKTOP },
  { name: 'desktop dark', url: ADMIN, ...DESKTOP, scheme: 'dark' },
  { name: 'tablet 2x', url: ADMIN, ...TABLET },
  { name: 'phone 3x, cpu 4x', url: ADMIN, ...PHONE, cpu: 4 },
  { name: 'phone 3x, cpu 6x', url: ADMIN, ...PHONE, cpu: 6 },
  { name: 'phone 3x, cpu 4x, /?dry', url: ADMIN + '?dry', ...PHONE, cpu: 4 },
];

fs.mkdirSync(OUT, { recursive: true });
writeSnapshot();
const server = spawn('php', ['-S', '0.0.0.0:8081', '/capture/sample/router.php'], { stdio: 'ignore' });
// Default: capped at 60 fps like a real display. PERF_UNCAPPED=1 lifts the cap to show headroom
// (the main thread then renders flat out, so the task time is no longer comparable).
const chrome = spawn('chromium-browser', ['--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
  ...(process.env.PERF_UNCAPPED ? ['--disable-frame-rate-limit', '--disable-gpu-vsync'] : []),
  '--remote-debugging-port=9222', '--host-resolver-rules=MAP example.com 127.0.0.1', '--font-render-hinting=none', 'about:blank'], { stdio: 'ignore' });
const b = await connect();
await sleep(500);

const results = [];
for (const sc of scenarios) {
  console.error('measuring', sc.name);
  results.push(await measure(b, sc));
}
fs.writeFileSync(`${OUT}/perf.json`, JSON.stringify(results, null, 2));

const cols = [['scenario', 'name'], ['frames', 'frames'], ['fps', 'fps'], ['median ms', 'medianMs'], ['P95 ms', 'p95Ms'],
  ['max ms', 'maxMs'], ['>16.7 ms %', 'latePct'], ['dropped %', 'droppedPct'],
  ['script ms', 'scriptMs'], ['style ms', 'styleMs'], ['layout ms', 'layoutMs'], ['task ms', 'taskMs']];
console.log(`| ${cols.map((c) => c[0]).join(' | ')} |`);
console.log(`|${cols.map((c, i) => (i ? '---:' : '---')).join('|')}|`);
for (const r of results) console.log(`| ${cols.map((c) => r[c[1]]).join(' | ')} |`);
console.log(`\nWarm-up ${WARMUP_MS / 1000} s, then ${MEASURE_MS / 1000} s. Script/style/layout/task are main-thread ms summed over the window.`);

b.close();
chrome.kill();
server.kill();
process.exit(0);
