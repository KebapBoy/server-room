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
  const CHASSIS_HEAD = 20;
  const COL_GAP = 8;
  const MIN_UNITS = 14;
  const POLL_MS = 15000;
  const FONT_W = 0.6;         // monospace glyph width relative to font size
  const MAX_PACKETS = 24;
  const FLOOR_H = 44;         // room below the racks for the power strip
  const SHUTDOWN_MS = 10000;  // unplug animation before the logout redirect; all phases scale with it
  // Shutdown phases as fractions of SHUTDOWN_MS
  const PHASES = {
    drain: 0.65,              // UPSs run on battery until it is empty
    ledsOff: 0.15,            // LEDs die one by one after that
    fans: 0.25,               // fans coast to a stop
    dimAt: 0.85,              // the rack starts to grey out
    dim: 0.12,                // duration of the grey-out
  };
  const phase = (name) => SHUTDOWN_MS * PHASES[name];

  const host = document.getElementById('rack');
  const statusEl = document.getElementById('status');
  const logoutLink = document.getElementById('logout');
  const motion = matchMedia('(prefers-reduced-motion: no-preference)');

  let model = JSON.parse(document.getElementById('model').textContent);
  let narrow = null;
  let traffic = null;
  let sessionLost = false;
  let poweredOff = false;

  const STATE_TEXT = {
    running: 'läuft', created: 'erstellt', paused: 'pausiert', restarting: 'startet neu',
    exited: 'gestoppt', dead: 'abgestürzt', removing: 'wird entfernt',
  };
  const HEALTH_TEXT = { healthy: 'gesund', unhealthy: 'gestört', starting: 'startet' };

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

  function ledClass(state, health) {
    if (state === 'running') return health === 'unhealthy' || health === 'starting' ? 'warn' : 'ok';
    if (['created', 'paused', 'restarting'].includes(state)) return 'warn';
    if (['exited', 'dead', 'removing'].includes(state)) return 'bad';
    return 'off';
  }

  function stackLed(modules) {
    const classes = modules.map((m) => ledClass(m.state, m.health));
    if (classes.every((c) => c === 'ok')) return 'ok';
    if (classes.every((c) => c === 'bad')) return 'bad';
    return 'warn';
  }

  function stateText(m) {
    const state = STATE_TEXT[m.state] || m.state;
    return m.health ? `${state}, ${HEALTH_TEXT[m.health] || m.health}` : state;
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
    return Math.ceil((CHASSIS_HEAD + rows * (MODULE_H + ROW_GAP) + 2) / U);
  }

  function planRack(rack, index, cols, devices) {
    const plan = [
      { type: 'head', u: 1 },
      { type: 'switch', u: 1 },
      index % 2 ? { type: 'blank', u: 1, variant: 'vent' } : { type: 'patch', u: 1 },
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
    const rows = h > U * 1.5 ? [y + U / 2, y + h - U / 2] : [y + h / 2];
    for (const sx of [x + EAR / 2 + 1, x + w - EAR / 2 - 1]) {
      for (const sy of rows) el(g, 'circle', { cx: sx, cy: sy, r: 2.2, class: 'screw' });
    }
  }

  function drawHead(g, box, rack, ctx) {
    const { x, y, w } = box;
    const all = rack.stacks.flatMap((s) => s.modules);
    const running = all.filter((m) => m.state === 'running').length;
    const name = rack.name.toUpperCase();
    el(g, 'text', { x, y: y + 15, class: 'title' }, name);
    const lx = x + name.length * 10 * FONT_W * 1.2 + 10;
    const state = !rack.online ? 'bad' : model.stale ? 'warn' : 'ok';
    const node = led(g, lx, y + 11, state, 3);
    if (state !== 'ok') blink(node, 0.8, 1.4);
    if (all.length) el(g, 'text', { x: lx + 9, y: y + 14, class: 'small' }, `${running}/${all.length} AKTIV`);

    let right = x + w;
    for (const link of [...rack.links].reverse()) {
      const label = link.label + ' ↗';
      const pw = label.length * 8 * FONT_W + 12;
      right -= pw;
      const a = el(g, 'a', { href: link.href, class: 'pill-link', 'aria-label': link.label + ' öffnen' });
      el(a, 'rect', { x: right, y: y + 4, width: pw, height: 14, rx: 7, class: 'pill' });
      el(a, 'text', { x: right + 6, y: y + 14, class: 'pill-text' }, label);
      right -= 6;
    }
    ctx.headLed = node;
  }

  function drawSwitch(g, box, ctx) {
    const { x, y, w } = box;
    el(g, 'text', { x, y: y + 14, class: 'small' }, 'SWITCH');
    const start = x + 44;
    const count = Math.min(24, Math.floor((w - 44) / 12));
    let last = null;
    for (let i = 0; i < count; i++) {
      const px = start + i * 12;
      el(g, 'rect', { x: px, y: y + 10, width: 9, height: 7, rx: 1, class: 'port' });
      const l = el(g, 'rect', { x: px + 3, y: y + 5, width: 3, height: 2, class: 'led ' + (Math.random() < 0.75 ? 'ok' : 'off') });
      if (l.classList.contains('ok')) blink(l, 0.4, 2.5);
      last = { x: px + 9, y: y + 13.5, led: l };
    }
    ctx.uplink = last;
  }

  function drawPatch(g, box) {
    const { x, y, w } = box;
    el(g, 'text', { x, y: y + 14, class: 'small' }, 'PATCH');
    for (let px = x + 44; px < x + w - 6; px += 12) {
      el(g, 'circle', { cx: px + 4, cy: y + 11, r: 3.2, class: 'port' });
      el(g, 'path', { d: `M${px + 2.5} ${y + 11}h3`, class: 'vent' });
    }
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
    el(g, 'rect', { x, y: y + 8, width: 74, height: h - 16, rx: 2, class: 'port' });
    el(g, 'text', { x: x + 6, y: y + 20, class: 'small' }, 'USV');
    el(g, 'text', { x: x + 6, y: y + 32, class: 'label ups-charge' }, '100 %');
    led(g, x + 88, y + 12, 'ok', 2.4).classList.add('ups-mains');
    el(g, 'text', { x: x + 94, y: y + 14.5, class: 'small' }, 'NETZ');
    led(g, x + 128, y + 12, 'off', 2.4).classList.add('ups-on-battery');
    el(g, 'text', { x: x + 134, y: y + 14.5, class: 'small' }, 'AKKU');
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
    const parent = m.href ? el(g, 'a', { href: m.href, class: 'module-link', 'aria-label': m.label + ' öffnen' }) : g;
    const box = el(parent, 'g', { class: 'module' });
    el(box, 'title', {}, `${m.title} · ${stateText(m)}`);
    el(box, 'rect', { x, y, width: w, height: h, rx: 2.5, class: 'module-body' });
    led(box, x + 8, y + 9, ledClass(m.state, m.health));
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
    el(g, 'text', { x, y: y + 14, class: 'stack-name' }, fit(stack.name, w - 60, 10));
    led(g, x + w - 28, y + 10, stackLed(stack.modules), 3);

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
      el(g, 'rect', { x: px, y: y + 6, width: 10, height: 8, rx: 1, class: 'port' });
      ctx.nics.push({ x: px + 10, y: y + 10, leds: uplinked });
    }
  }

  function drawShelf(g, box, devices, cols) {
    const { cells } = moduleGrid(box, devices.length, cols);
    el(g, 'text', { x: box.x, y: box.y + 14, class: 'stack-name' }, 'geräte');
    const rows = new Set(cells.map((c) => c.row));
    for (const r of rows) {
      const c = cells.find((cell) => cell.row === r);
      el(g, 'path', { d: `M${box.x} ${c.y + c.h + 1}H${box.x + box.w}v-3`, class: 'tray' });
    }
    devices.forEach((d, i) => {
      const c = cells[i];
      const a = el(g, 'a', { href: d.href, class: 'module-link', 'aria-label': d.label + ' öffnen' });
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
    const ctx = { routes: [], nics: [], uplink: null, headLed: null, ups: null };
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
      else if (unit.type === 'patch') drawPatch(ug, box);
      else if (unit.type === 'cable') drawCableManager(ug, box);
      else if (unit.type === 'chassis') drawChassis(ug, box, unit.stack, cols, ctx);
      else if (unit.type === 'shelf') drawShelf(ug, box, unit.devices, cols);
      else if (unit.type === 'ups') drawUps(ug, box, ctx);
      else drawBlank(ug, box, unit.variant);
      y += h;
    }
    ctx.channelX = x0 + w + CHANNEL / 2;
    ctx.top = y0;
    return ctx;
  }

  // Cables from each chassis NIC through the channel to the switch uplink
  function drawCables(layer, ctx) {
    if (!ctx.uplink || !ctx.nics.length) return;
    const cx = ctx.channelX;
    const bottom = Math.max(...ctx.nics.map((n) => n.y));
    el(layer, 'path', { d: `M${cx - 3} ${ctx.uplink.y - 6}V${bottom + 6}M${cx + 3} ${ctx.uplink.y - 6}V${bottom + 6}`, class: 'channel' });
    for (const nic of ctx.nics) {
      const d = `M${nic.x} ${nic.y}H${cx}V${ctx.uplink.y}H${ctx.uplink.x}`;
      const path = el(layer, 'path', { d, class: 'cable' });
      ctx.routes.push({ path, from: nic.leds, to: [ctx.uplink.led] });
    }
  }

  // One cable between neighbouring racks' switches (the Hawser link)
  function drawInterRack(layer, a, b, routes) {
    if (!a.uplink || !b.uplink) return;
    const sideBySide = b.top === a.top;
    const d = sideBySide
      ? `M${a.uplink.x} ${a.uplink.y}H${a.channelX}V${a.top - 12}H${b.channelX}V${b.uplink.y}H${b.uplink.x}`
      : `M${a.uplink.x} ${a.uplink.y}H${a.channelX}V${b.uplink.y}H${b.uplink.x}`;
    const path = el(layer, 'path', { d, class: 'cable uplink' });
    routes.push({ path, from: [a.uplink.led], to: [b.uplink.led] });
  }

  // Every UPS feeds one power strip whose plug sits in the wall socket;
  // the plug is the logout link. Returns the x of the wall.
  function drawPower(layer, contexts, sy) {
    const feeds = contexts.filter((ctx) => ctx.ups).map((ctx, i) => ({
      ups: ctx.ups,
      x: ctx.channelX + 7 + (narrow ? i * 4 : 0),
    }));
    for (const f of feeds) el(layer, 'path', { d: `M${f.ups.x} ${f.ups.y}H${f.x}V${sy - 5}`, class: 'cable' });

    const left = Math.min(...feeds.map((f) => f.x)) - 30;
    const right = Math.max(...feeds.map((f) => f.x)) + 14;
    el(layer, 'rect', { x: left, y: sy - 5, width: right - left, height: 10, rx: 2, class: 'face' });
    for (const f of feeds) el(layer, 'rect', { x: f.x - 3, y: sy - 2.5, width: 6, height: 5, rx: 1, class: 'port' });
    el(layer, 'rect', { x: left + 5, y: sy - 3, width: 9, height: 6, rx: 1, class: 'port' });
    led(layer, left + 19, sy, 'bad', 1.8).classList.add('strip-led');

    const wallX = right + 72;
    const bodyRight = wallX - 6;
    const bodyLeft = bodyRight - 24;
    el(layer, 'path', { d: `M${right} ${sy}H${bodyLeft}`, class: 'cable' });
    el(layer, 'path', { d: `M${wallX} ${sy - 30}V${sy + FLOOR_H / 2 - 1}`, class: 'rail' });
    for (let hy = sy - 28; hy < sy + FLOOR_H / 2 - 6; hy += 6) el(layer, 'path', { d: `M${wallX} ${hy}l5 5`, class: 'vent' });

    const a = el(layer, 'a', { href: logoutLink.href, class: 'plug-link', 'aria-label': 'Stecker ziehen und abmelden' });
    el(a, 'title', {}, 'Stecker ziehen · abmelden');
    el(a, 'rect', { x: bodyLeft - 20, y: sy - 24, width: wallX - bodyLeft + 20, height: 36, class: 'hit' });
    el(a, 'text', { x: wallX - 8, y: sy - 13, 'text-anchor': 'end', class: 'small' }, 'ABMELDEN');
    const plug = el(a, 'g', { class: 'plug' });
    el(plug, 'path', { d: `M${bodyLeft - 24} ${sy}H${bodyLeft}`, class: 'cable' });
    el(plug, 'path', { d: `M${bodyRight} ${sy - 3.5}h5M${bodyRight} ${sy + 3.5}h5`, class: 'pin' });
    el(plug, 'rect', { x: bodyLeft, y: sy - 7, width: 24, height: 14, rx: 3, class: 'plug-body' });
    for (let i = 0; i < 3; i++) el(plug, 'path', { d: `M${bodyLeft + 5 + i * 3} ${sy - 4}v8`, class: 'vent' });
    // The socket plate is drawn last so it hides the pins while plugged in
    el(a, 'rect', { x: wallX - 6, y: sy - 11, width: 6, height: 22, rx: 1, class: 'face' });
    return wallX;
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

  function render() {
    if (poweredOff) return;
    stopTraffic();
    narrow = host.clientWidth < 720;
    const cols = narrow ? 2 : 3;
    const w = narrow ? 340 : 460;
    const gap = narrow ? 36 : 48;
    const top = 26;
    const racks = model.racks.length ? model.racks : [{ name: 'example.com', online: true, links: [], stacks: [] }];
    const plans = racks.map((rack, i) => planRack(rack, i, cols, model.devices));
    const units = padPlans(plans, racks);
    const rackH = CAP * 2 + units * U + 4;
    const slotW = w + CHANNEL;
    const floor = narrow ? top + racks.length * rackH + (racks.length - 1) * gap : top + rackH;
    const height = floor + FLOOR_H;

    const svg = el(null, 'svg', { class: 'rack-svg', role: 'group', 'aria-label': 'Serverrack' });
    const contexts = racks.map((rack, i) => {
      const x0 = 1 + (narrow ? 0 : i * (slotW + gap));
      const y0 = top + (narrow ? i * (rackH + gap) : 0);
      return drawRack(svg, rack, plans[i], x0, y0, w, cols, model.devices);
    });
    const cables = el(svg, 'g', { class: 'cables' });
    const routes = [];
    for (const ctx of contexts) {
      drawCables(cables, ctx);
      routes.push(...ctx.routes);
    }
    for (let i = 1; i < contexts.length; i++) drawInterRack(cables, contexts[i - 1], contexts[i], routes);
    const wallX = drawPower(el(svg, 'g', { class: 'power' }), contexts, floor + FLOOR_H / 2);

    const width = wallX + 7;
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.style.maxWidth = Math.round(width * 1.15) + 'px';
    host.replaceChildren(svg);
    startTraffic(svg, routes);
  }

  function updateStatus() {
    statusEl.classList.toggle('warn', model.stale || sessionLost);
    if (sessionLost) {
      statusEl.textContent = 'Sitzung abgelaufen · ';
      const a = document.createElement('a');
      a.href = '/';
      a.textContent = 'neu anmelden';
      statusEl.appendChild(a);
      return;
    }
    if (!model.generated) {
      statusEl.textContent = 'Keine Rack-Daten verfügbar';
      return;
    }
    const age = Math.max(0, Math.round(Date.now() / 1000 - model.generated));
    const ago = age < 90 ? `${age} s` : age < 5400 ? `${Math.round(age / 60)} min` : `${Math.round(age / 3600)} h`;
    statusEl.textContent = (model.stale ? 'Daten veraltet · ' : '') + `Stand vor ${ago}`;
  }

  // ---- logout: pull the plug ----------------------------------------------

  function ledOff(node) {
    node.setAttribute('class', 'led');
    node.style.animation = 'none';
  }

  // Lets each fan coast from its current angle to a stop
  function spinDown(fan) {
    const m = new DOMMatrixReadOnly(getComputedStyle(fan).transform);
    const angle = (Math.atan2(m.b, m.a) * 180) / Math.PI;
    fan.style.animation = 'none';
    fan.style.transform = `rotate(${angle}deg)`;
    fan.getBoundingClientRect();
    // The curve starts at twice the average speed: about the running speed of 360° per 1.4 s
    const duration = phase('fans');
    fan.style.transition = `transform ${duration}ms cubic-bezier(.3, .6, .6, 1)`;
    fan.style.transform = `rotate(${angle + (360 / 1.4 / 2) * (duration / 1000)}deg)`;
  }

  // Counts every UPS down from 100 % to 0 within the drain phase, then calls done
  function drainBatteries(svg, done) {
    const batteries = [...svg.querySelectorAll('.battery')].map((node) => ({
      node,
      cells: [...node.querySelectorAll('.cell')],
      text: node.parentNode.querySelector('.ups-charge'),
    }));
    let start = null;
    const tick = (now) => {
      start ??= now;
      const charge = Math.max(0, 100 * (1 - (now - start) / phase('drain')));
      for (const b of batteries) {
        b.text.textContent = `${Math.ceil(charge)} %`;
        const lit = Math.ceil((charge / 100) * b.cells.length);
        b.cells.forEach((cell, i) => cell.classList.toggle('on', i < lit));
        b.node.classList.toggle('low', charge <= 30);
        b.node.classList.toggle('crit', charge <= 10);
      }
      if (charge > 0) requestAnimationFrame(tick);
      else done();
    };
    requestAnimationFrame(tick);
  }

  // Plug out: the UPSs keep everything running on battery until it is empty,
  // then traffic stops, LEDs die one by one, fans coast down, and we log out
  function unplug() {
    if (poweredOff) return;
    const svg = host.querySelector('svg');
    poweredOff = true;
    statusEl.classList.remove('warn');
    if (!motion.matches || !svg) {
      statusEl.textContent = 'Stecker gezogen · Abmeldung …';
      location.assign(logoutLink.href);
      return;
    }
    statusEl.textContent = 'Stecker gezogen · USV läuft auf Akku …';
    svg.querySelector('.plug-link').classList.add('pulled');
    svg.querySelectorAll('.strip-led, .ups-mains').forEach(ledOff);
    svg.querySelectorAll('.ups-on-battery').forEach((node) => {
      node.setAttribute('class', 'led warn');
      blink(node, 0.4, 0.7);
    });

    drainBatteries(svg, () => {
      statusEl.textContent = 'Akku leer · Abmeldung …';
      stopTraffic();
      const leds = [...svg.querySelectorAll('.led')].sort(() => Math.random() - 0.5);
      leds.forEach((node) => setTimeout(() => ledOff(node), rand(0, phase('ledsOff'))));
      svg.querySelectorAll('.fan').forEach(spinDown);
    });
    setTimeout(() => {
      svg.style.transition = `opacity ${phase('dim')}ms, filter ${phase('dim')}ms`;
      svg.classList.add('powered-off');
    }, phase('dimAt'));
    setTimeout(() => location.assign(logoutLink.href), SHUTDOWN_MS);
  }

  function onLogoutClick(event) {
    if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    unplug();
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

  new ResizeObserver(() => {
    if ((host.clientWidth < 720) !== narrow) render();
  }).observe(host);
  motion.addEventListener('change', render);
  logoutLink.addEventListener('click', onLogoutClick);
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
