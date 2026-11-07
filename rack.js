// Draws the start page as a schematic server rack (SVG) from the model in #model,
// polls /?data=1 for changes and animates pseudo traffic between containers.
(() => {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  const U = 22;               // height of one rack unit
  const RAIL = 22;            // width of a mounting rail
  const EAR = 8;              // how far faceplates reach over the rails
  const CAP = 14;             // frame above and below the rails
  const CHANNEL = 22;         // cable channel right of each rack
  const MODULE_H = 40;
  const ROW_GAP = 12;         // room below a module row for the backplane bus
  const CHASSIS_HEAD = 16;
  const COL_GAP = 8;
  const MIN_UNITS = 14;
  const POLL_MS = 15000;
  const FONT_W = 0.6;         // monospace glyph width relative to font size
  const MAX_PACKETS = 24;
  const NEW_TAB = { target: '_blank', rel: 'noopener' };  // service links always open a new tab
  const TOP = 26;             // room above the racks for the inter-rack cable
  const FLOOR_H = 84;         // room below the racks for the power strip and the plug
  const STRIP_SCALE = 1.6;    // power strip relative to the rest
  const PLUG_SCALE = 2;       // plug, socket and marker tag relative to the rest
  const PLUG_ROOM = 180;      // from the end of the power strip to the wall, room to pull the plug
  const PLUG_DROP = 170;      // stacked racks: floor socket this far below the strip, room to pull the plug
  // From pulling the plug until the UPS is down to LOW_BATTERY and shuts the services
  // down; the countdown hits 0 right then. Everything runs on battery until that point.
  const SHUTDOWN_MS = 10000;
  const LOW_BATTERY = 20;     // % at which the UPS shuts everything down
  const RECHARGE_MS = 3000;   // after replugging: battery back to 100 %
  const BOOT_MS = 2500;       // after replugging: LEDs back on one by one, fans up to speed
  const RESTORE_FADE_MS = 600; // after replugging: rack and page regain their colour
  const FAN_TURN_S = 1.4;     // one fan turn, as the spin animation in style.css
  // What follows, as fractions of SHUTDOWN_MS so it all scales with it
  const PHASES = {
    powerDown: 0.5,           // 20 → 0 %: LEDs die one by one, fans coast to a stop
    dark: 0.2,                // at 0 % the rack greys out and stays dark this long ...
    fadeOut: 0.15,            // ... then the page fades out and we log out
  };
  const phase = (name) => SHUTDOWN_MS * PHASES[name];

  const host = document.getElementById('rack');
  const statusEl = document.getElementById('status');
  const logoutUrl = host.dataset.logout;
  // /?dry plays the unplug animation without logging out
  const dryRun = new URLSearchParams(location.search).has('dry');
  const motion = matchMedia('(prefers-reduced-motion: no-preference)');

  let model = JSON.parse(document.getElementById('model').textContent);
  let narrow = null;
  let layout = null;
  // Must match the media query in style.css that moves the greeting beside the racks
  const sideLayout = matchMedia('(min-width: 1400px)');
  let traffic = null;
  let sessionLost = false;
  let poweredOff = false;
  // Running shutdown: its timers, the battery animation frame and the charge shown last
  let shutdown = null;
  let lastRoutes = [];
  let spinGeneration = 0;     // bumped on every unplug/replug so running fan loops stop
  let booting = [];           // pending LED restores after a replug: { timer, fn }

  const STATE_TEXT = {
    exited: 'stopped', dead: 'crashed',
  };

  // ---- helpers ----------------------------------------------------------

  function el(parent, name, attrs = {}, text) {
    const node = document.createElementNS(NS, name);
    for (const [key, value] of Object.entries(attrs)) {
      if (value !== null && value !== undefined) node.setAttribute(key, value);
    }
    if (text !== undefined) node.textContent = text;
    if (parent) parent.appendChild(node);
    return node;
  }

  const rand = (min, max) => min + Math.random() * (max - min);

  // Deterministic random numbers, so fillers keep their look across re-renders
  function seeded(text) {
    let a = 0;
    for (const ch of text) a = (Math.imul(a, 31) + ch.charCodeAt(0)) | 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  const sum = (plan) => plan.reduce((total, unit) => total + unit.u, 0);

  function fit(str, width, size) {
    const max = Math.max(1, Math.floor(width / (size * FONT_W)));
    return str.length > max ? str.slice(0, Math.max(1, max - 1)) + '…' : str;
  }

  function stackLed(modules) {
    const classes = modules.map((m) => m.led);
    if (classes.every((c) => c === 'ok')) return 'ok';
    if (classes.every((c) => c === 'bad')) return 'bad';
    return 'warn';
  }

  function stateText(m) {
    const state = STATE_TEXT[m.state] || m.state;
    return m.health ? `${state}, ${m.health}` : state;
  }

  function blink(node, min, max) {
    node.classList.add('blink');
    node.style.animationDuration = rand(min, max).toFixed(2) + 's';
    node.style.animationDelay = (-rand(0, max)).toFixed(2) + 's';
  }

  function led(parent, cx, cy, cls, r = 2.6) {
    return el(parent, 'circle', { cx, cy, r, class: 'led ' + cls });
  }

  // ---- rack planning ------------------------------------------------------

  function gridUnits(count, cols) {
    const rows = Math.max(1, Math.ceil(count / cols));
    // The last row only needs half a gap below it for its backplane bus
    return Math.ceil((CHASSIS_HEAD + rows * (MODULE_H + ROW_GAP) - ROW_GAP / 2 + 2) / U);
  }

  function planRack(rack, index, cols, devices) {
    const plan = [
      { type: 'head', u: 2 },
      { type: 'switch', u: 2 },
      { type: 'cable', u: 1 },
    ];
    for (const stack of rack.stacks) plan.push({ type: 'chassis', u: gridUnits(stack.modules.length, cols), stack });
    if (index === 0 && devices.length) plan.push({ type: 'shelf', u: gridUnits(devices.length, cols), devices });
    plan.push({ type: 'ups', u: 2 });
    return plan;
  }

  // Fill shorter racks with blank panels so all racks end at the same height
  function padPlans(plans, racks) {
    const total = Math.max(MIN_UNITS, ...plans.map(sum));
    plans.forEach((plan, i) => {
      const random = seeded(racks[i].name);
      let missing = total - sum(plan);
      while (missing > 0) {
        const u = missing >= 2 && random() < 0.5 ? 2 : 1;
        const variant = u === 2 ? ['drives', 'drawer', 'drives', 'vent'][Math.floor(random() * 4)] : 'vent';
        plan.splice(plan.length - 1, 0, { type: 'blank', u, variant });
        missing -= u;
      }
    });
    return total;
  }

  // ---- drawing ------------------------------------------------------------

  // Gradients and the brushed texture used by the "Material" rules in style.css
  function addDefs(svg) {
    const defs = el(svg, 'defs');
    const stops = (parent, list) => list.forEach(([offset, colour]) => el(parent, 'stop', { offset, style: `stop-color: var(${colour})` }));
    stops(el(defs, 'linearGradient', { id: 'g-face', x1: 0, y1: 0, x2: 0, y2: 1 }), [[0, '--metal-hi'], [0.55, '--metal'], [1, '--metal-lo']]);
    stops(el(defs, 'linearGradient', { id: 'g-sled', x1: 0, y1: 0, x2: 0, y2: 1 }), [[0, '--sled-hi'], [1, '--sled-lo']]);
    stops(el(defs, 'linearGradient', { id: 'g-frame', x1: 0, y1: 0, x2: 1, y2: 0 }), [[0, '--steel-lo'], [0.5, '--steel-hi'], [1, '--steel-lo']]);
    stops(el(defs, 'radialGradient', { id: 'g-screw', cx: 0.35, cy: 0.35, r: 0.75 }), [[0, '--metal-hi'], [1, '--metal-lo']]);
    const brush = el(defs, 'pattern', { id: 'p-brush', width: 7, height: 2, patternUnits: 'userSpaceOnUse' });
    el(brush, 'path', { d: 'M0 0.5H4.5M5.5 1.5H7', class: 'brush-line' });
  }

  function drawFrame(g, x, y, w, units) {
    const h = CAP * 2 + units * U;
    el(g, 'rect', { x, y, width: w, height: h, rx: 4, class: 'frame' });
    el(g, 'rect', { x: x + 3, y: y + CAP, width: RAIL - 3, height: units * U, class: 'rail' });
    el(g, 'rect', { x: x + w - RAIL, y: y + CAP, width: RAIL - 3, height: units * U, class: 'rail' });
    for (let u = 0; u < units; u++) {
      const top = y + CAP + u * U;
      el(g, 'text', { x: x + 6, y: top + U / 2 + 2, class: 'unum' }, String(units - u).padStart(2, '0'));
      for (const hx of [x + RAIL - 7, x + w - RAIL + 4]) {
        for (const k of [4, 9.5, 15]) el(g, 'rect', { x: hx, y: top + k, width: 3, height: 3, class: 'hole' });
      }
    }
    for (const fx of [x + 10, x + w - 30]) el(g, 'rect', { x: fx, y: y + h, width: 20, height: 4, rx: 1, class: 'rail' });
  }

  function face(g, x, y, w, h) {
    el(g, 'rect', { x, y: y + 1, width: w, height: h - 2, rx: 2, class: 'face' });
    el(g, 'rect', { x, y: y + 1, width: w, height: h - 2, rx: 2, class: 'brush' });
    const rows = h > U * 1.5 ? [y + U / 2, y + h - U / 2] : [y + h / 2];
    for (const sx of [x + EAR / 2 + 1, x + w - EAR / 2 - 1]) {
      for (const sy of rows) el(g, 'circle', { cx: sx, cy: sy, r: 2.2, class: 'screw' });
    }
  }

  function drawHead(g, box, rack, ctx) {
    const { x, y, w, h } = box;
    const all = rack.stacks.flatMap((s) => s.modules);
    const running = all.filter((m) => m.state === 'running').length;
    const name = rack.name.toUpperCase();
    // Name plate: recessed field with the environment name and its status LED
    const nameW = name.length * 17 * (FONT_W + 0.14);
    const plateW = nameW + 34;
    el(g, 'rect', { x, y: y + 7, width: plateW, height: h - 14, rx: 2, class: 'port plate' });
    el(g, 'text', { x: x + 9, y: y + h / 2 + 6, class: 'title' }, name);
    const lx = x + 9 + nameW + 10;
    const state = !rack.online ? 'bad' : model.stale ? 'warn' : 'ok';
    const node = led(g, lx, y + h / 2, state, 3.5);
    if (state !== 'ok') blink(node, 0.8, 1.4);

    let right = x + w;
    for (const link of [...rack.links].reverse()) {
      const label = link.label + ' ↗';
      const pw = label.length * 8 * FONT_W + 12;
      right -= pw;
      const a = el(g, 'a', { href: link.href, ...NEW_TAB, class: 'pill-link', 'aria-label': `Open ${link.label} in a new tab` });
      el(a, 'rect', { x: right, y: y + h / 2 - 7, width: pw, height: 14, rx: 7, class: 'pill' });
      el(a, 'text', { x: right + 6, y: y + h / 2 + 3, class: 'pill-text' }, label);
      right -= 6;
    }

    // Two-line display: active containers, below it the status that updateStatus() writes
    const lcdX = x + plateW + 8;
    const lcdW = Math.min(180, right - 2 - lcdX);
    const counts = !rack.online ? 'OFFLINE' : all.length ? `${running}/${all.length} ACTIVE` : 'ONLINE';
    const lcd = el(g, 'a', { class: 'lcd-link' });
    el(lcd, 'rect', { x: lcdX, y: y + 7, width: lcdW, height: h - 14, rx: 2, class: 'lcd' });
    el(lcd, 'text', { x: lcdX + 6, y: y + 19, class: 'lcd-text' }, fit(counts, lcdW - 12, 8));
    el(lcd, 'text', { x: lcdX + 6, y: y + 31, class: 'lcd-text lcd-status', 'data-width': lcdW - 12 });
    ctx.headLed = node;
  }

  // 2U switch with numbered ports like the real ones: odd numbers in the upper row, even
  // ones in the lower row. Numbers sit in the strip between the rows and each port's two
  // LEDs (link green left, activity amber right) at its outer corners, so the cables
  // hanging down from the lower row hide neither.
  // Two SFP cages flush right.
  function drawSwitch(g, box, ctx) {
    const { x, y, w, h } = box;
    el(g, 'text', { x, y: y + 14, class: 'small' }, 'SWITCH');
    el(g, 'text', { x, y: y + 23, class: 'small port-num' }, '1G · 2× SFP');
    const rows = [
      { py: y + 7, ledY: y + 4, labelY: y + 21.5 },
      { py: y + 28, ledY: y + 39.5, labelY: y + 26.5 },
    ];
    const port = (px, row, number) => {
      const { py, ledY, labelY } = rows[row];
      el(g, 'rect', { x: px, y: py, width: 12, height: 10, rx: 1.2, class: 'port' });
      const link = el(g, 'rect', { x: px + 0.5, y: ledY, width: 3, height: 1.5, class: 'led off' });
      const act = el(g, 'rect', { x: px + 8.5, y: ledY, width: 3, height: 1.5, class: 'led off' });
      el(g, 'text', { x: px + 6, y: labelY, 'text-anchor': 'middle', class: 'small port-num' }, String(number));
      return { x: px + 6, y: py + 5, link, act };
    };
    // Set apart from the copper ports: the outer SFP takes the fibre to the neighbouring
    // rack, the inner one stays free
    const sfpX = x + w - 27;
    const start = x + 44;
    const cols = Math.min(12, Math.floor((sfpX - 6 - start + 4) / 16));
    ctx.ports = [];
    for (let i = 0; i < cols; i++) {
      port(start + i * 16, 0, 2 * i + 1);
      ctx.ports.push(port(start + i * 16, 1, 2 * i + 2));
    }
    el(g, 'text', { x: sfpX + 13.5, y: y + 14, 'text-anchor': 'middle', class: 'small port-num' }, 'SFP');
    port(sfpX, 1, 2 * cols + 1);
    el(g, 'path', { d: `M${sfpX + 3} ${rows[1].py + 2}h6`, class: 'vent' });
    ctx.uplink = port(sfpX + 15, 1, 2 * cols + 2);
    // Cables leave the switch downwards and run to the channel just below it
    ctx.laneY = y + h + 3;
  }

  // A cable plugged in: the link LED lights steadily, the activity LED flickers (and
  // flashes when a packet arrives)
  function linkUp(port) {
    port.link.setAttribute('class', 'led ok');
    port.act.setAttribute('class', 'led amber');
    blink(port.act, 0.4, 2.5);
  }

  function drawCableManager(g, box) {
    const { x, y, w } = box;
    for (const dy of [8, 11, 14]) el(g, 'path', { d: `M${x} ${y + dy}H${x + w}`, class: 'cable' });
    const rings = 5;
    for (let i = 0; i < rings; i++) {
      const rx = x + 10 + i * ((w - 30) / (rings - 1));
      el(g, 'path', { d: `M${rx} ${y + 18}V${y + 6}a4 4 0 0 1 4 -4h2a4 4 0 0 1 4 4V${y + 18}`, class: 'ring' });
    }
  }

  function drawBlank(g, box, variant) {
    const { x, y, w, h } = box;
    if (variant === 'drawer') {
      el(g, 'path', { d: `M${x + w / 2 - 30} ${y + h / 2 + 4}v-6h60v6`, class: 'ring' });
      el(g, 'path', { d: `M${x} ${y + h - 6}H${x + w}`, class: 'vent' });
      return;
    }
    if (variant === 'drives') {
      el(g, 'text', { x, y: y + 12, class: 'small' }, 'DISK');
      for (let bx = x + 36; bx + 30 <= x + w; bx += 34) {
        el(g, 'rect', { x: bx, y: y + 5, width: 30, height: h - 10, rx: 1.5, class: 'port' });
        el(g, 'path', { d: `M${bx + 6} ${y + h - 11}h18`, class: 'vent' });
        blink(led(g, bx + 6, y + 10, 'act', 1.8), 0.5, 3);
        led(g, bx + 12, y + 10, 'ok', 1.8);
      }
      return;
    }
    // vent: staggered horizontal slots
    const rows = Math.max(2, Math.floor((h - 8) / 5));
    for (let r = 0; r < rows; r++) {
      const sy = y + 5 + r * 5 + (h - 8 - rows * 5) / 2 + 1;
      for (let sx = x + 14 + (r % 2) * 8; sx + 12 <= x + w - 10; sx += 16) {
        el(g, 'path', { d: `M${sx} ${sy}h12`, class: 'slot' });
      }
    }
  }

  function drawUps(g, box, ctx) {
    const { x, y, w, h } = box;
    el(g, 'rect', { x, y: y + 8, width: 74, height: h - 16, rx: 2, class: 'port display' });
    el(g, 'text', { x: x + 6, y: y + 20, class: 'small on-display' }, 'UPS');
    el(g, 'text', { x: x + 6, y: y + 32, class: 'label ups-charge on-display' }, '100 %');
    led(g, x + 88, y + 12, 'ok', 2.4).classList.add('ups-mains');
    el(g, 'text', { x: x + 94, y: y + 14.5, class: 'small' }, 'MAINS');
    led(g, x + 128, y + 12, 'off', 2.4).classList.add('ups-on-battery');
    el(g, 'text', { x: x + 134, y: y + 14.5, class: 'small' }, 'BATT');
    ctx.ups = { x: x + w, y: y + h - 5 };
    // Battery gauge, drains when the plug is pulled
    const bx = x + 84;
    const bw = w - 140;
    const battery = el(g, 'g', { class: 'battery' });
    el(battery, 'rect', { x: bx, y: y + 20, width: bw, height: 16, rx: 2, class: 'port' });
    el(battery, 'rect', { x: bx + bw, y: y + 25, width: 3, height: 6, rx: 1, class: 'port' });
    for (let cx = bx + 3; cx + 4 <= bx + bw - 3; cx += 6) {
      el(battery, 'rect', { x: cx, y: y + 23, width: 4, height: 10, rx: 0.5, class: 'cell on' });
    }
    const cx = x + w - 22;
    const cy = y + h / 2;
    el(g, 'circle', { cx, cy, r: 15, class: 'port' });
    const fan = el(g, 'g', { class: 'fan' });
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      const ex = cx + Math.cos(a) * 12;
      const ey = cy + Math.sin(a) * 12;
      const qx = cx + Math.cos(a + 0.7) * 10;
      const qy = cy + Math.sin(a + 0.7) * 10;
      el(fan, 'path', { d: `M${cx} ${cy}Q${qx} ${qy} ${ex} ${ey}`, class: 'blade' });
    }
    el(fan, 'circle', { cx, cy, r: 3, class: 'port' });
  }

  function drawModule(g, m, x, y, w, h) {
    const parent = m.href ? el(g, 'a', { href: m.href, ...NEW_TAB, class: 'module-link', 'aria-label': `Open ${m.label} in a new tab` }) : g;
    const box = el(parent, 'g', { class: 'module' });
    el(box, 'title', {}, `${m.title} · ${stateText(m)}`);
    el(box, 'rect', { x, y, width: w, height: h, rx: 2.5, class: 'module-body' });
    led(box, x + 8, y + 9, m.led);
    const act = led(box, x + 16, y + 9, m.state === 'running' ? 'act' : 'off');
    if (m.state === 'running') blink(act, 0.7, 3.2);
    for (let i = 0; i < 4; i++) el(box, 'path', { d: `M${x + w - 8 - i * 4} ${y + 5}v8`, class: 'vent' });
    const room = w - 16 - (m.href ? 12 : 0);
    el(box, 'text', { x: x + 8, y: y + h - 9, class: 'label' }, fit(m.label, room, 9.5));
    if (m.href) {
      const ax = x + w - 14;
      const ay = y + h - 8;
      el(box, 'path', { d: `M${ax} ${ay}l6 -6m-4 0h4v4`, class: 'arrow' });
    }
    return act;
  }

  function moduleGrid(box, count, cols) {
    const gx = box.x + 8;
    const gw = box.w - 8;
    const cw = (gw - (cols - 1) * COL_GAP) / cols;
    const rows = Math.max(1, Math.ceil(count / cols));
    const cells = [];
    for (let i = 0; i < rows * cols; i++) {
      const r = Math.floor(i / cols);
      const c = i % cols;
      const x = gx + c * (cw + COL_GAP);
      const y = box.y + CHASSIS_HEAD + r * (MODULE_H + ROW_GAP);
      cells.push({ x, y, w: cw, h: MODULE_H, row: r, bus: y + MODULE_H + ROW_GAP / 2 });
    }
    return { cells, laneX: box.x + 3 };
  }

  function drawChassis(g, box, stack, cols, ctx) {
    const { x, y, w } = box;
    el(g, 'text', { x, y: y + 12, class: 'stack-name' }, fit(stack.name, w - 60, 10));
    led(g, x + w - 28, y + 8, stackLed(stack.modules), 3);

    const { cells, laneX } = moduleGrid(box, stack.modules.length, cols);
    const traces = el(g, 'g', { class: 'traces' });
    const acts = stack.modules.map((m, i) => drawModule(g, m, cells[i].x, cells[i].y, cells[i].w, cells[i].h));
    for (let i = stack.modules.length; i < cells.length; i++) {
      const c = cells[i];
      el(g, 'rect', { x: c.x, y: c.y, width: c.w, height: c.h, rx: 2.5, class: 'blank-body' });
    }

    for (const [a, b] of stack.links) {
      const p = cells[a];
      const q = cells[b];
      const ax = p.x + p.w / 2;
      const bx = q.x + q.w / 2;
      const d = p.row === q.row
        ? `M${ax} ${p.y + p.h}V${p.bus}H${bx}V${q.y + q.h}`
        : `M${ax} ${p.y + p.h}V${p.bus}H${laneX}V${q.bus}H${bx}V${q.y + q.h}`;
      const path = el(traces, 'path', { d, class: 'trace' });
      ctx.routes.push({ path, from: [acts[a]], to: [acts[b]] });
    }

    const uplinked = stack.modules.map((m, i) => (m.proxy || m.href ? acts[i] : null)).filter(Boolean);
    if (uplinked.length) {
      const px = x + w - 14;
      el(g, 'rect', { x: px, y: y + 4, width: 10, height: 8, rx: 1, class: 'port' });
      ctx.nics.push({ x: px + 5, y: y + 8, leds: uplinked });
    }
  }

  function drawShelf(g, box, devices, cols) {
    const { cells } = moduleGrid(box, devices.length, cols);
    el(g, 'text', { x: box.x, y: box.y + 14, class: 'stack-name' }, 'devices');
    const rows = new Set(cells.map((c) => c.row));
    for (const r of rows) {
      const c = cells.find((cell) => cell.row === r);
      el(g, 'path', { d: `M${box.x} ${c.y + c.h + 1}H${box.x + box.w}v-3`, class: 'tray' });
    }
    devices.forEach((d, i) => {
      const c = cells[i];
      const a = el(g, 'a', { href: d.href, ...NEW_TAB, class: 'module-link', 'aria-label': `Open ${d.label} in a new tab` });
      const bx = c.x + c.w / 2 - 34;
      el(a, 'title', {}, d.label);
      el(a, 'rect', { x: bx, y: c.y + 4, width: 68, height: c.h - 12, rx: 2, class: 'module-body' });
      el(a, 'rect', { x: bx + 4, y: c.y + 8, width: 60, height: c.h - 20, rx: 1, class: 'port' });
      el(a, 'path', { d: `M${bx + 26} ${c.y + c.h - 8}l-4 6m24 -6l4 6`, class: 'vent' });
      el(a, 'text', { x: bx + 74, y: c.y + c.h / 2 + 3, class: 'label' }, fit(d.label + ' ↗', c.w - 76, 9.5));
    });
  }

  function drawRack(svg, rack, plan, x0, y0, w, cols, devices) {
    const g = el(svg, 'g', { class: 'rack-unit' });
    const units = sum(plan);
    drawFrame(g, x0, y0, w, units);
    const ctx = { routes: [], nics: [], ports: [], uplink: null, headLed: null, ups: null };
    let y = y0 + CAP;
    for (const unit of plan) {
      const h = unit.u * U;
      const fx = x0 + RAIL - EAR;
      const fw = w - 2 * (RAIL - EAR);
      const ug = el(g, 'g', { class: 'u-' + unit.type });
      face(ug, fx, y, fw, h);
      const box = { x: x0 + RAIL + 8, y, w: w - 2 * RAIL - 16, h };
      if (unit.type === 'head') drawHead(ug, box, rack, ctx);
      else if (unit.type === 'switch') drawSwitch(ug, box, ctx);
      else if (unit.type === 'cable') drawCableManager(ug, box);
      else if (unit.type === 'chassis') drawChassis(ug, box, unit.stack, cols, ctx);
      else if (unit.type === 'shelf') drawShelf(ug, box, unit.devices, cols);
      else if (unit.type === 'ups') drawUps(ug, box, ctx);
      else drawBlank(ug, box, unit.variant);
      y += h;
    }
    // Stacked racks: no channel beside the rack, the cables run down the right rail
    ctx.channelX = narrow ? x0 + w - 8 : x0 + w + CHANNEL / 2;
    ctx.top = y0;
    return ctx;
  }

  // ---- patch cables -----------------------------------------------------

  const PATCH_COLORS = ['yellow', 'red', 'green', 'blue'];

  // Orthogonal route through the points with rounded bends, as cables cannot kink
  function cablePath(points, r = 3) {
    let d = `M${points[0][0]} ${points[0][1]}`;
    for (let i = 1; i < points.length - 1; i++) {
      const [x, y] = points[i];
      const [px, py] = points[i - 1];
      const [nx, ny] = points[i + 1];
      const lin = Math.hypot(x - px, y - py);
      const lout = Math.hypot(nx - x, ny - y);
      const k = Math.min(r, lin / 2, lout / 2);
      if (!k) continue;
      d += `L${x + ((px - x) * k) / lin} ${y + ((py - y) * k) / lin}`;
      d += `Q${x} ${y} ${x + ((nx - x) * k) / lout} ${y + ((ny - y) * k) / lout}`;
    }
    const [lx, ly] = points.at(-1);
    return d + `L${lx} ${ly}`;
  }

  const FIBER_TAIL = 9;        // fibre: the duplex cord splits into its two strands this far from the plug

  // Jacket with a darker edge and a highlight, a plug in each port at the ends: RJ45 for
  // copper, an SFP module with a duplex LC plug for fibre ('fiber'). Returns the core path
  // for the traffic.
  function drawPatchCable(layer, points, color) {
    const g = el(layer, 'g', { class: 'patch patch-' + color });
    const fiber = color === 'fiber';
    const ends = [[points[0], points[1]], [points.at(-1), points.at(-2)]];
    let route = points;
    if (fiber) {
      // The cord itself ends where the strands split off
      const [[a, a1], [b, b1]] = ends;
      route = [toward(a, a1, FIBER_TAIL), ...points.slice(1, -1), toward(b, b1, FIBER_TAIL)];
    }
    const d = cablePath(route);
    el(g, 'path', { d, class: 'patch-edge' });
    const core = el(g, 'path', { d, class: 'patch-core' });
    el(g, 'path', { d, class: 'patch-shine' });
    for (const [end, next] of ends) {
      // Drawn as if the cable left the port downwards, then turned its actual way
      const [x, y] = end;
      const angle = (Math.atan2(next[1] - y, next[0] - x) * 180) / Math.PI - 90;
      const p = el(g, 'g', { transform: `rotate(${angle.toFixed(1)} ${x} ${y})` });
      if (fiber) drawLcPlug(p, x, y);
      else el(p, 'rect', { x: x - 4.5, y: y - 3.5, width: 9, height: 7.5, rx: 1.4, class: 'patch-boot' });
    }
    return core;
  }

  // The point dist along the straight line from a towards b
  function toward([ax, ay], [bx, by], dist) {
    const len = Math.hypot(bx - ax, by - ay) || 1;
    return [ax + ((bx - ax) * dist) / len, ay + ((by - ay) * dist) / len];
  }

  // SFP transceiver sticking out of the port with its bail, two strands running into a
  // pair of LC plugs held by a duplex clip; the cord leaves towards +y
  function drawLcPlug(g, x, y) {
    el(g, 'rect', { x: x - 5.2, y: y - 4.2, width: 10.4, height: 8.4, rx: .8, class: 'sfp-module' });
    el(g, 'path', { d: `M${x - 4.4} ${y + 4.2}v2.4h8.8v-2.4`, class: 'sfp-bail' });
    for (const side of [-1, 1]) {
      const sx = x + side * 1.6;
      el(g, 'path', { d: `M${sx} ${y + 2}V${y + 4.5}Q${sx} ${y + FIBER_TAIL - 2} ${x} ${y + FIBER_TAIL}`, class: 'fiber-strand' });
      el(g, 'rect', { x: sx - 1.35, y: y - 2.6, width: 2.7, height: 4.6, rx: .5, class: 'lc-plug' });
    }
    el(g, 'rect', { x: x - 3.6, y: y - .4, width: 7.2, height: 1.3, rx: .4, class: 'lc-clip' });
  }

  // One cable from each chassis NIC through the channel to its own switch port. Lower NICs
  // run further out in the channel and higher in the lane below the switch, so no cable crosses another.
  // The colours take turns within a rack, starting one further on in each rack.
  function drawCables(layer, ctx, index) {
    if (!ctx.uplink || !ctx.nics.length) return;
    const cx = ctx.channelX;
    const n = ctx.nics.length;
    const bottom = Math.max(...ctx.nics.map((nic) => nic.y));
    el(layer, 'path', { d: `M${cx - 5} ${ctx.uplink.y - 6}V${bottom + 6}M${cx + 5} ${ctx.uplink.y - 6}V${bottom + 6}`, class: 'channel' });
    const step = n > 1 ? Math.min(1.6, 5 / (n - 1)) : 0;
    const lane = Math.min(2.4, 13 / n);
    // The lower row from port 2 on, as far as there are ports
    ctx.nics.forEach((nic, i) => {
      const port = ctx.ports[Math.min(i, ctx.ports.length - 1)];
      const x = cx - ((n - 1) * step) / 2 + i * step;
      const y = ctx.laneY + 4 + (n - 1 - i) * lane;
      const path = drawPatchCable(layer, [[nic.x, nic.y], [x, nic.y], [x, y], [port.x, y], [port.x, port.y]], PATCH_COLORS[(index + i) % PATCH_COLORS.length]);
      linkUp(port);
      ctx.routes.push({ path, from: nic.leds, to: [port.act] });
    });
  }

  // One fibre between neighbouring racks' SFP uplinks (the Hawser link), outside the
  // other cables in the channel and in the lane right below the switch
  function drawInterRack(layer, a, b, routes) {
    if (!a.uplink || !b.uplink) return;
    const ax = a.channelX + 4.5;
    const bx = b.channelX + 4.5;
    const ay = a.laneY;
    const by = b.laneY;
    const via = b.top === a.top ? [[ax, a.top - 12], [bx, a.top - 12]] : [];
    const points = [[a.uplink.x, a.uplink.y], [a.uplink.x, ay], [ax, ay], ...via, [bx, by], [b.uplink.x, by], [b.uplink.x, b.uplink.y]];
    const path = drawPatchCable(layer, points, 'fiber');
    linkUp(a.uplink);
    linkUp(b.uplink);
    routes.push({ path, from: [a.uplink.act], to: [b.uplink.act] });
  }

  // Wall socket with the plug in it, drawn sideways and PLUG_SCALE times larger around
  // (wallX, sy): the wall at wallX, the cord coming from the left at height sy. A marker
  // tag on the cord carries the label; `upright` keeps its text level when the whole
  // assembly is turned by 90°. The plug is the logout link, which is returned.
  function drawPlug(parent, wallX, sy, upright = false) {
    const g = el(parent, 'g', { transform: `translate(${wallX} ${sy}) scale(${PLUG_SCALE}) translate(${-wallX} ${-sy})` });
    const bodyRight = wallX - 6;
    const bodyLeft = bodyRight - 24;
    el(g, 'path', { d: `M${wallX} ${sy - 30}V${sy + 20}`, class: 'rail' });
    for (let hy = sy - 28; hy < sy + 16; hy += 6) el(g, 'path', { d: `M${wallX} ${hy}l5 5`, class: 'vent' });

    const a = el(g, 'a', { href: logoutUrl, class: 'plug-link', 'aria-label': 'Pull the plug to sign out' });
    el(a, 'title', {}, 'Pull the plug · sign out');
    el(a, 'rect', { x: bodyLeft - 44, y: sy - 24, width: wallX - bodyLeft + 44, height: 46, class: 'hit' });
    const plug = el(a, 'g', { class: 'plug' });
    el(plug, 'path', { d: `M${bodyLeft - 24} ${sy}H${bodyLeft}`, class: 'cable' });
    el(plug, 'path', { d: `M${bodyRight} ${sy - 3.5}h5M${bodyRight} ${sy + 3.5}h5`, class: 'pin' });
    el(plug, 'rect', { x: bodyLeft, y: sy - 7, width: 24, height: 14, rx: 3, class: 'plug-body' });
    for (let i = 0; i < 3; i++) el(plug, 'path', { d: `M${bodyLeft + 5 + i * 3} ${sy - 4}v8`, class: 'vent' });

    // Marker tag: a band around the cord and a flag with the label hanging from it
    const bandX = bodyLeft - 14;
    const tag = el(plug, 'g', upright ? { transform: `rotate(-90 ${bandX} ${sy})` } : {});
    const tagW = 36;
    const tagH = 11;
    // Below the cord, or (turned assembly) sticking out to the left of the upright cord
    const fx = upright ? bandX - 3 - tagW : bandX - tagW / 2;
    const fy = upright ? sy - tagH / 2 : sy + 4;
    el(tag, 'path', { d: upright ? `M${bandX - 3} ${sy}H${fx + tagW}` : `M${bandX} ${sy + 3}V${fy}`, class: 'tag-strap' });
    el(tag, 'rect', { x: fx, y: fy, width: tagW, height: tagH, rx: 1.5, class: 'tag' });
    el(tag, 'text', { x: fx + tagW / 2, y: fy + tagH / 2 + 2.1, 'text-anchor': 'middle', class: 'tag-text' }, 'SIGN OUT');
    el(plug, 'rect', { x: bandX - 2, y: sy - 3, width: 4, height: 6, rx: 1, class: 'tag' });

    // The socket plate is drawn last so it hides the pins while plugged in
    el(a, 'rect', { x: wallX - 6, y: sy - 11, width: 6, height: 22, rx: 1, class: 'face' });
    return a;
  }

  // Every UPS feeds one power strip whose plug sits in a wall socket: to the right of
  // the strip, or (stacked racks) turned by 90° into a floor socket below it, so nothing
  // sticks out to the right of the racks. Returns the right edge of the drawing.
  function drawPower(layer, contexts, sy) {
    const feeds = contexts.filter((ctx) => ctx.ups).map((ctx, i) => ({
      ups: ctx.ups,
      x: narrow ? ctx.channelX - 2 + i * 3 : ctx.channelX + 7,
    }));
    const k = STRIP_SCALE;
    for (const f of feeds) el(layer, 'path', { d: `M${f.ups.x} ${f.ups.y}H${f.x}V${sy - 5 * k}`, class: 'cable' });

    // Stacked racks: the strip ends flush with the rack frame
    const right = narrow ? contexts[0].channelX + 8 : Math.max(...feeds.map((f) => f.x)) + 14;
    const left = narrow ? right - 160 : Math.min(...feeds.map((f) => f.x)) - 40;
    el(layer, 'rect', { x: left, y: sy - 5 * k, width: right - left, height: 10 * k, rx: 2 * k, class: 'face' });
    for (const f of feeds) el(layer, 'rect', { x: f.x - 3 * k, y: sy - 2.5 * k, width: 6 * k, height: 5 * k, rx: k, class: 'port' });
    el(layer, 'rect', { x: left + 5 * k, y: sy - 3 * k, width: 9 * k, height: 6 * k, rx: k, class: 'port' });
    led(layer, left + 19 * k, sy, 'bad', 1.8 * k).classList.add('strip-led');

    // Where the cord meets the plug, measured from the wall
    const cordEnd = 30 * PLUG_SCALE;
    if (narrow) {
      // Rotating by 90° turns the cord side (left) into up and the wall into the floor at
      // py; the wall then reaches 30 units (scaled) to the right of px
      const px = right - 1 - 30 * PLUG_SCALE;
      const py = sy + PLUG_DROP;
      el(layer, 'path', { d: `M${px} ${sy + 5 * k}V${py - cordEnd}`, class: 'cable' });
      drawPlug(el(layer, 'g', { transform: `rotate(90 ${px} ${py})` }), px, py, true);
      return right + 1;
    }
    const wallX = right + PLUG_ROOM;
    el(layer, 'path', { d: `M${right} ${sy}H${wallX - cordEnd}`, class: 'cable' });
    drawPlug(layer, wallX, sy);
    return wallX + 6 * PLUG_SCALE;
  }

  // ---- pseudo traffic -----------------------------------------------------

  function flash(leds) {
    const node = pick(leds);
    if (!node) return;
    node.classList.add('flash');
    setTimeout(() => node.classList.remove('flash'), 160);
  }

  function stopTraffic() {
    if (traffic) traffic();
    traffic = null;
  }

  function startTraffic(svg, routes) {
    stopTraffic();
    if (!motion.matches || !routes.length) return;
    for (const r of routes) r.length = r.path.getTotalLength();
    const layer = el(svg, 'g', { class: 'packets' });
    const active = [];
    let next = 0;
    let frame;
    const tick = (now) => {
      if (now >= next && active.length < MAX_PACKETS) {
        const route = pick(routes);
        const dot = el(layer, 'circle', { r: 1.9, class: 'packet' });
        active.push({ route, dot, forward: Math.random() < 0.5, start: now, duration: (route.length / rand(70, 150)) * 1000 });
        next = now + rand(120, 480);
      }
      for (let i = active.length - 1; i >= 0; i--) {
        const p = active[i];
        const t = (now - p.start) / p.duration;
        if (t >= 1) {
          p.dot.remove();
          flash(p.forward ? p.route.to : p.route.from);
          active.splice(i, 1);
          continue;
        }
        const point = p.route.path.getPointAtLength((p.forward ? t : 1 - t) * p.route.length);
        p.dot.setAttribute('cx', point.x.toFixed(1));
        p.dot.setAttribute('cy', point.y.toFixed(1));
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    traffic = () => {
      cancelAnimationFrame(frame);
      layer.remove();
    };
  }

  // ---- render, status, polling ------------------------------------------

  function currentRacks() {
    return model.racks.length ? model.racks : [{ name: 'example.com', online: true, links: [], stacks: [] }];
  }

  // Size of the drawing for a column count, without drawing anything; viewW must match
  // what drawPower() needs to the right of the last rack
  function geometry(racks, cols, isNarrow) {
    const w = isNarrow ? 340 : 40 + 140 * cols;
    const gap = isNarrow ? 36 : 48;
    const plans = racks.map((rack, i) => planRack(rack, i, cols, model.devices));
    const units = padPlans(plans, racks);
    const rackH = CAP * 2 + units * U + 4;
    const n = racks.length;
    const floor = TOP + (isNarrow ? n * rackH + (n - 1) * gap : rackH);
    // Must match the right edge drawPower() returns
    const viewW = isNarrow ? w + 2 : (n - 1) * (w + CHANNEL + gap) + w + 33 + PLUG_ROOM + 6 * PLUG_SCALE;
    const height = floor + (isNarrow ? FLOOR_H / 2 + PLUG_DROP + 7 * PLUG_SCALE : FLOOR_H);
    return { cols, w, gap, plans, rackH, floor, height, viewW };
  }

  // Stacked racks on small screens. Otherwise the racks get at least 75 % of the page width
  // (exactly that when the greeting sits beside them) and at most 1500 px, and as many
  // modules per row as it takes to fit the window height.
  function chooseLayout(racks) {
    const pageW = document.documentElement.clientWidth;
    if (pageW < 752) return { narrow: true, geo: geometry(racks, 2, true), width: null };
    const minW = Math.min(pageW * 0.75, 1500);
    const maxW = sideLayout.matches ? minW : Math.min(1500, pageW - 32);
    const availH = innerHeight - (host.getBoundingClientRect().top + scrollY) - 16;
    let best = null;
    for (const cols of [3, 4, 5]) {
      const geo = geometry(racks, cols, false);
      const width = Math.max(minW, Math.min(maxW, (availH * geo.viewW) / geo.height));
      const option = { narrow: false, geo, width, height: (width * geo.height) / geo.viewW };
      if (option.height <= availH) return option;
      if (!best || option.height < best.height) best = option;
    }
    return best;
  }

  const layoutKey = (choice) => `${choice.narrow}/${choice.geo.cols}`;

  function render() {
    if (poweredOff) return;
    stopTraffic();
    const racks = currentRacks();
    const choice = chooseLayout(racks);
    layout = layoutKey(choice);
    narrow = choice.narrow;
    const { cols, w, gap, plans, rackH, floor, height } = choice.geo;
    const top = TOP;
    const slotW = w + CHANNEL;

    const svg = el(null, 'svg', { class: 'rack-svg', role: 'group', 'aria-label': 'Server rack' });
    addDefs(svg);
    const contexts = racks.map((rack, i) => {
      const x0 = 1 + (narrow ? 0 : i * (slotW + gap));
      const y0 = top + (narrow ? i * (rackH + gap) : 0);
      return drawRack(svg, rack, plans[i], x0, y0, w, cols, model.devices);
    });
    const cables = el(svg, 'g', { class: 'cables' });
    const routes = [];
    for (const [i, ctx] of contexts.entries()) {
      drawCables(cables, ctx, i);
      routes.push(...ctx.routes);
    }
    for (let i = 1; i < contexts.length; i++) drawInterRack(cables, contexts[i - 1], contexts[i], routes);
    const width = drawPower(el(svg, 'g', { class: 'power' }), contexts, floor + FLOOR_H / 2);

    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    if (narrow) svg.style.maxWidth = Math.round(width * 1.15) + 'px';
    else svg.style.width = Math.round(choice.width) + 'px';
    host.replaceChildren(svg);
    lastRoutes = routes;
    startTraffic(svg, routes);
    updateStatus();
  }

  // Shows a status on every rack display and, for screen readers, in #status
  function setStatus(text, { warn = false, href = null } = {}) {
    statusEl.textContent = text;
    for (const node of host.querySelectorAll('.lcd-status')) {
      node.textContent = fit(text.toUpperCase(), Number(node.dataset.width), 8);
    }
    for (const link of host.querySelectorAll('.lcd-link')) {
      link.classList.toggle('warn', warn);
      if (href) link.setAttribute('href', href);
      else link.removeAttribute('href');
    }
  }

  function updateStatus() {
    if (poweredOff) return;
    if (sessionLost) {
      setStatus('Session expired · sign in again', { warn: true, href: '/' });
      return;
    }
    if (!model.generated) {
      setStatus('No data', { warn: true });
      return;
    }
    const age = Math.max(0, Math.round(Date.now() / 1000 - model.generated));
    const ago = age < 90 ? `${age} s` : age < 5400 ? `${Math.round(age / 60)} min` : `${Math.round(age / 3600)} h`;
    setStatus((model.stale ? 'Stale · ' : 'Updated ') + ago + ' ago', { warn: model.stale });
  }

  // ---- logout: pull the plug ----------------------------------------------

  // Dropping the classes also stops blinking; the inline blink timing stays for a restore
  function ledOff(node) {
    node.setAttribute('class', 'led');
  }

  // Lets each fan coast from its current angle to a stop
  function spinDown(fan) {
    const m = new DOMMatrixReadOnly(getComputedStyle(fan).transform);
    const angle = (Math.atan2(m.b, m.a) * 180) / Math.PI;
    fan.style.animation = 'none';
    fan.style.transform = `rotate(${angle}deg)`;
    fan.getBoundingClientRect();
    // The curve starts at twice the average speed: about the running speed of 360° per 1.4 s
    const duration = phase('powerDown');
    fan.style.transition = `transform ${duration}ms cubic-bezier(.3, .6, .6, 1)`;
    fan.style.transform = `rotate(${angle + (360 / FAN_TURN_S / 2) * (duration / 1000)}deg)`;
  }

  function batteriesIn(svg) {
    return [...svg.querySelectorAll('.battery')].map((node) => ({
      node,
      cells: [...node.querySelectorAll('.cell')],
      text: node.parentNode.querySelector('.ups-charge'),
    }));
  }

  function showCharge(batteries, charge) {
    for (const b of batteries) {
      b.text.textContent = `${Math.ceil(charge)} %`;
      const lit = Math.ceil((charge / 100) * b.cells.length);
      b.cells.forEach((cell, i) => cell.classList.toggle('on', i < lit));
      b.node.classList.toggle('low', charge <= 30);
      b.node.classList.toggle('crit', charge <= 10);
    }
  }

  // Shows every UPS draining to LOW_BATTERY within SHUTDOWN_MS and on to 0 % within the
  // powerDown phase (the shutdown itself runs on timers in unplug())
  function drainBatteries(svg) {
    const batteries = batteriesIn(svg);
    let start = null;
    const tick = (now) => {
      start ??= now;
      const t = now - start;
      const charge = t < SHUTDOWN_MS
        ? 100 - ((100 - LOW_BATTERY) * t) / SHUTDOWN_MS
        : Math.max(0, LOW_BATTERY * (1 - (t - SHUTDOWN_MS) / phase('powerDown')));
      showCharge(batteries, charge);
      shutdown.charge = charge;
      if (charge > 0) shutdown.frame = requestAnimationFrame(tick);
    };
    shutdown.frame = requestAnimationFrame(tick);
  }

  // Back on mains: recharge from where the battery was to 100 %
  function chargeBatteries(svg, from) {
    const batteries = batteriesIn(svg);
    let start = null;
    const tick = (now) => {
      start ??= now;
      const charge = Math.min(100, from + ((100 - from) * (now - start)) / RECHARGE_MS);
      showCharge(batteries, charge);
      if (charge < 100) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  // Spins a stopped fan back up to the speed of the CSS animation, then hands over to it
  // at the same angle so there is no jump
  function spinUp(fan) {
    const generation = spinGeneration;
    const m = new DOMMatrixReadOnly(getComputedStyle(fan).transform);
    let angle = (Math.atan2(m.b, m.a) * 180) / Math.PI;
    const fullSpeed = 360 / FAN_TURN_S;
    fan.style.transition = 'none';
    let start = null;
    let last = null;
    const tick = (now) => {
      if (generation !== spinGeneration) return;
      start ??= now;
      angle += fullSpeed * Math.min(1, (now - start) / BOOT_MS) * ((now - (last ?? now)) / 1000);
      last = now;
      if (now - start < BOOT_MS) {
        fan.style.transform = `rotate(${angle}deg)`;
        requestAnimationFrame(tick);
        return;
      }
      const turn = (((angle % 360) + 360) % 360) / 360;
      fan.style.transform = '';
      fan.style.animation = '';
      fan.style.animationDelay = `${-turn * FAN_TURN_S}s`;
    };
    requestAnimationFrame(tick);
  }

  // Runs any LED restores still pending from a replug right away
  function finishBooting() {
    for (const { timer, fn } of booting) {
      clearTimeout(timer);
      fn();
    }
    booting = [];
  }

  function logout() {
    if (dryRun) location.reload();
    else location.assign(logoutUrl);
  }

  // Plug out: the UPSs keep everything running on battery until it is empty,
  // then traffic stops, LEDs die one by one, fans coast down, and we log out
  function unplug() {
    if (poweredOff) return;
    const svg = host.querySelector('svg');
    poweredOff = true;
    finishBooting();
    spinGeneration++;
    // Every LED's classes as they are now, so a replug can bring them back exactly
    const leds = new Map([...svg.querySelectorAll('.led')].map((node) => [node, node.getAttribute('class')]));
    shutdown = { timers: [], frame: null, charge: 100, svg, leds };
    const later = (fn, ms) => shutdown.timers.push(setTimeout(fn, ms));
    if (!motion.matches || !svg) {
      setStatus('Plug pulled · signing out …');
      logout();
      return;
    }
    setStatus('Plug pulled · on battery', { warn: true });
    // Stacked racks: the greeting is scrolled away, so count down next to the plug instead
    let target = null;
    if (narrow) {
      target = document.createElement('p');
      target.className = 'shutdown-text terminal';
      target.dataset.title = document.querySelector('.intro')?.dataset.title ?? '';
      // Pin the window to the top of the power strip, so new lines grow downwards, and end
      // it a little left of the strip
      const strip = svg.querySelector('.power .face').getBoundingClientRect();
      const box = host.getBoundingClientRect();
      target.style.top = Math.round(strip.top - box.top) + 'px';
      target.style.width = Math.round(strip.left - box.left - 12) + 'px';
      host.append(target);
    }
    document.dispatchEvent(new CustomEvent('shutdown', { detail: { ms: SHUTDOWN_MS, target } }));
    const plugLink = svg.querySelector('.plug-link');
    plugLink.classList.add('pulled');
    plugLink.setAttribute('aria-label', 'Plug back in to stay signed in');
    plugLink.querySelector('title').textContent = 'Plug back in · stay signed in';
    svg.querySelectorAll('.strip-led, .ups-mains').forEach(ledOff);
    svg.querySelectorAll('.ups-on-battery').forEach((node) => {
      node.setAttribute('class', 'led warn ups-on-battery');
      blink(node, 0.4, 0.7);
    });

    // At LOW_BATTERY the UPS shuts everything down; its own BATT LED stays on until 0 %
    drainBatteries(svg);
    later(() => {
      setStatus('Battery low · powering down …', { warn: true });
      stopTraffic();
      const leds = [...svg.querySelectorAll('.led:not(.ups-on-battery)')].sort(() => Math.random() - 0.5);
      leds.forEach((node) => later(() => ledOff(node), rand(0, phase('powerDown') * 0.9)));
      svg.querySelectorAll('.fan').forEach(spinDown);
    }, SHUTDOWN_MS);
    later(() => {
      setStatus('Battery empty · signing out …', { warn: true });
      // Too late to plug back in now
      shutdown.final = true;
      svg.querySelectorAll('.plug-link').forEach((link) => {
        link.classList.add('locked');
        link.setAttribute('aria-disabled', 'true');
      });
      svg.querySelectorAll('.led').forEach(ledOff);
      svg.style.transition = `opacity ${phase('fadeOut') / 2}ms, filter ${phase('fadeOut') / 2}ms`;
      svg.classList.add('powered-off');
    }, SHUTDOWN_MS + phase('powerDown'));
    later(() => {
      document.body.style.transition = `opacity ${phase('fadeOut')}ms ease-in`;
      document.body.style.opacity = '0';
    }, SHUTDOWN_MS + phase('powerDown') + phase('dark'));
    later(logout, SHUTDOWN_MS + phase('powerDown') + phase('dark') + phase('fadeOut') + 100);
  }

  // Plugging back in before the logout cancels the shutdown and gently reverses it: the
  // plug slides back, the rack regains its colour, the LEDs come back one by one as the
  // machines boot, fans spin up, the batteries recharge and traffic resumes
  function replug() {
    const { timers, frame, charge, svg, leds } = shutdown;
    timers.forEach(clearTimeout);
    cancelAnimationFrame(frame);
    shutdown = null;
    poweredOff = false;
    spinGeneration++;
    document.dispatchEvent(new CustomEvent('restore', { detail: { ms: BOOT_MS } }));

    document.body.style.transition = `opacity ${RESTORE_FADE_MS}ms`;
    document.body.style.opacity = '';
    svg.style.transition = `opacity ${RESTORE_FADE_MS}ms, filter ${RESTORE_FADE_MS}ms`;
    svg.classList.remove('powered-off');
    const plugLink = svg.querySelector('.plug-link');
    plugLink.classList.remove('pulled');
    plugLink.setAttribute('aria-label', 'Pull the plug to sign out');
    plugLink.querySelector('title').textContent = 'Pull the plug · sign out';

    // Mains is back at once; the machines take a moment to boot
    for (const [node, classes] of leds) {
      if (/\b(strip-led|ups-mains|ups-on-battery)\b/.test(classes)) {
        node.setAttribute('class', classes);
        continue;
      }
      if (node.getAttribute('class') === classes) continue;
      const fn = () => node.setAttribute('class', classes);
      booting.push({ timer: setTimeout(fn, rand(BOOT_MS * 0.15, BOOT_MS)), fn });
    }
    // Only fans that had already stopped spin up; the others never lost power
    svg.querySelectorAll('.fan').forEach((fan) => {
      if (fan.style.animationName === 'none') spinUp(fan);
    });
    chargeBatteries(svg, charge);
    setStatus('Power restored · booting …');
    setTimeout(() => {
      if (poweredOff) return;
      if (!traffic) startTraffic(svg, lastRoutes);
      updateStatus();
    }, BOOT_MS);
  }

  function onLogoutClick(event) {
    if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (!shutdown) unplug();
    else if (!shutdown.final) replug();
  }

  async function poll() {
    if (document.hidden || poweredOff) return;
    try {
      const response = await fetch('/?data=1', { cache: 'no-store', credentials: 'same-origin', redirect: 'manual' });
      if (response.type === 'opaqueredirect' || response.status === 401 || response.status === 403) {
        sessionLost = true;
        updateStatus();
        return;
      }
      if (!response.ok) return;
      const next = await response.json();
      // A new snapshot alone (only "generated" differs) must not restart the drawing
      const changed = JSON.stringify({ ...next, generated: 0 }) !== JSON.stringify({ ...model, generated: 0 });
      model = next;
      sessionLost = false;
      if (changed) render();
      updateStatus();
    } catch {
      // network hiccup: keep the current view and try again next round
    }
  }

  // Redraw only when the column count changes, otherwise just rescale
  function resize() {
    if (poweredOff) return;
    const choice = chooseLayout(currentRacks());
    if (layoutKey(choice) !== layout) render();
    else if (!choice.narrow) host.firstChild.style.width = Math.round(choice.width) + 'px';
  }
  addEventListener('resize', resize);
  sideLayout.addEventListener('change', resize);
  motion.addEventListener('change', render);
  host.addEventListener('click', (event) => {
    if (event.target.closest('.plug-link')) onLogoutClick(event);
  });
  // Coming back via the back/forward cache must not show a dead rack
  addEventListener('pageshow', (event) => {
    if (event.persisted && poweredOff) location.reload();
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) poll();
  });

  render();
  updateStatus();
  setInterval(poll, POLL_MS);
  setInterval(updateStatus, 5000);
})();
