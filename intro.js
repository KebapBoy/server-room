// Types the greeting in #intro like a typewriter. The full text is already in the
// HTML (and in its aria-label), so without JS or with reduced motion it simply stands there.
// When rack.js reports the plug pulled ("shutdown" event), it counts down to the logout.
(() => {
  'use strict';

  const root = document.getElementById('intro');
  if (!root) return;
  const animate = matchMedia('(prefers-reduced-motion: no-preference)').matches;

  const caret = document.createElement('span');
  caret.className = 'caret';
  caret.setAttribute('aria-hidden', 'true');
  let timer = null;

  // Types the parts ({ node, text }) one after another, with the caret right behind the text
  function type(parts, pace) {
    let index = 0;
    let pos = 0;
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
      timer = setTimeout(step, pace(ch));
    };
    step();
  }

  function line(node) {
    const span = document.createElement('span');
    span.className = 'line';
    span.append(node);
    return span;
  }

  // rack.js dispatches this with the shutdown duration when the plug is pulled, and
  // optionally another element to count down in
  document.addEventListener('shutdown', (event) => {
    clearTimeout(timer);
    const seconds = Math.max(1, Math.round(event.detail.ms / 1000));
    const head = document.createTextNode('');
    const count = document.createTextNode('');
    const target = event.detail.target || root;
    target.replaceChildren(line(head), line(count));
    if (target === root) root.setAttribute('aria-label', 'Shutting down');
    const number = (n) => (n ? `${n}... ` : '0');
    if (!animate) {
      head.textContent = 'Shutting down ';
      count.textContent = number(seconds);
      return;
    }
    head.after(caret);
    // One number per second; 0 arrives together with the moment everything is off
    type([{ node: head, text: 'Shutting down ' }, { node: count, text: number(seconds) }], () => 25);
    for (let n = seconds - 1; n >= 0; n--) {
      setTimeout(() => type([{ node: count, text: number(n) }], () => 40), (seconds - n) * 1000);
    }
  });

  if (!animate) return;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const parts = [];
  while (walker.nextNode()) parts.push({ node: walker.currentNode, text: walker.currentNode.textContent });
  if (!parts.length) return;
  // Keep the full height so nothing below jumps while the text grows
  root.style.minHeight = root.offsetHeight + 'px';
  for (const part of parts) part.node.textContent = '';
  parts[0].node.after(caret);
  // Short pause after punctuation, a little jitter otherwise
  timer = setTimeout(() => type(parts, (ch) => (/[!,]/.test(ch) ? 420 : 45 + Math.random() * 75)), 500);
})();
