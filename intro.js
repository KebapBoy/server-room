// Types the greeting in #intro like a typewriter. The full text is already in the
// HTML (and in its aria-label), so without JS or with reduced motion it simply stands there.
// When rack.js reports the plug pulled ("shutdown" event), it counts down to the logout;
// plugged back in ("restore" event), it reports the reboot and then greets again.
(() => {
  'use strict';

  const root = document.getElementById('intro');
  if (!root) return;
  const animate = matchMedia('(prefers-reduced-motion: no-preference)').matches;
  const greeting = [...root.childNodes].map((node) => node.cloneNode(true));
  const greetingLabel = root.getAttribute('aria-label');

  const caret = document.createElement('span');
  caret.className = 'caret';
  caret.setAttribute('aria-hidden', 'true');
  let timer = null;
  let flush = null;           // writes out whatever the current type() has not typed yet
  let countdown = [];
  let countdownTarget = null;

  // Types the parts ({ node, text }) one after another, with the caret right behind the text
  function type(parts, pace) {
    let index = 0;
    let pos = 0;
    flush = () => {
      for (; index < parts.length; index++, pos = 0) parts[index].node.textContent += parts[index].text.slice(pos);
      parts.at(-1).node.after(caret);
      follow();
    };
    const step = () => {
      while (index < parts.length && pos >= parts[index].text.length) {
        index++;
        pos = 0;
      }
      if (index >= parts.length) return;
      const part = parts[index];
      const ch = part.text[pos++];
      part.node.textContent += ch;
      part.node.after(caret);
      follow();
      timer = setTimeout(step, pace(ch));
    };
    step();
  }

  // A single line that has grown too long scrolls left, so the end and the caret stay in view
  function follow() {
    if (root.scrollWidth > root.clientWidth) root.scrollLeft = root.scrollWidth;
  }

  function line(node) {
    const span = document.createElement('span');
    span.className = 'line';
    span.append(node);
    return span;
  }

  function typeGreeting(delay) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const parts = [];
    while (walker.nextNode()) parts.push({ node: walker.currentNode, text: walker.currentNode.textContent });
    if (!parts.length) return;
    for (const part of parts) part.node.textContent = '';
    parts[0].node.after(caret);
    // Short pause after punctuation, a little jitter otherwise
    timer = setTimeout(() => type(parts, (ch) => (/[!,]/.test(ch) ? 420 : 45 + Math.random() * 75)), delay);
  }

  // rack.js dispatches this with the shutdown duration when the plug is pulled, and
  // optionally another element to count down in
  document.addEventListener('shutdown', (event) => {
    clearTimeout(timer);
    countdown.forEach(clearTimeout);
    const seconds = Math.max(1, Math.round(event.detail.ms / 1000));
    const head = document.createTextNode('');
    const count = document.createTextNode('');
    countdownTarget = event.detail.target || root;
    countdownTarget.replaceChildren(line(head), line(count));
    if (countdownTarget === root) {
      root.setAttribute('aria-label', 'Shutting down');
      // Above the racks the countdown stays on one line, so nothing below moves
      root.classList.add('one-line');
    }
    const number = (n) => (n ? `${n}... ` : '0');
    if (!animate) {
      head.textContent = 'Shutting down ';
      count.textContent = number(seconds);
      return;
    }
    head.after(caret);
    // One number per second; 0 arrives when the UPS shuts the services down
    type([{ node: head, text: 'Shutting down ' }, { node: count, text: number(seconds) }], () => 25);
    countdown = [];
    for (let n = seconds - 1; n > 0; n--) {
      countdown.push(setTimeout(() => type([{ node: count, text: number(n) }], () => 40), (seconds - n) * 1000));
    }
    // At 0 the services go down and take the session with them, like ssh says goodbye
    const target = countdownTarget;
    countdown.push(setTimeout(() => {
      const bye = document.createTextNode('');
      target.append(line(bye));
      const host = location.hostname;
      type([{ node: count, text: number(0) }, { node: bye, text: host ? ` Connection to ${host} closed.` : ' Connection closed.' }], () => 30);
    }, seconds * 1000));
  });

  // Plugged back in before the logout: report the reboot right behind the countdown for as
  // long as rack.js needs to boot (detail.ms), then greet again
  document.addEventListener('restore', (event) => {
    clearTimeout(timer);
    // Finish a countdown number that was half typed
    flush?.();
    countdown.forEach(clearTimeout);
    const target = countdownTarget || root;
    countdownTarget = target;
    const tail = document.createTextNode('');
    target.append(line(tail));
    if (target === root) root.setAttribute('aria-label', 'Power restored, rebooting');
    const greet = () => {
      root.classList.remove('one-line');
      if (target !== root) target.remove();
      countdownTarget = null;
      root.replaceChildren(...greeting.map((node) => node.cloneNode(true)));
      root.setAttribute('aria-label', greetingLabel);
      if (animate) typeGreeting(300);
    };
    countdown = [setTimeout(greet, event.detail.ms + 500)];
    // The leading space keeps it apart from a countdown that ended at "0" on the same line
    const text = ' Power restored... rebooting...';
    if (!animate) {
      tail.textContent = text;
      return;
    }
    tail.after(caret);
    type([{ node: tail, text }], (ch) => (ch === '.' ? 140 : 35));
  });

  if (!animate) return;
  // Keep the full height, caret included, so nothing below jumps while the text grows
  root.append(caret);
  root.style.minHeight = root.offsetHeight + 'px';
  typeGreeting(500);
})();
