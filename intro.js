// Types the greeting in #intro like a typewriter. The full text is already in the
// HTML (and in its aria-label), so without JS or with reduced motion it simply stands there.
(() => {
  'use strict';

  const root = document.getElementById('intro');
  if (!root || !matchMedia('(prefers-reduced-motion: no-preference)').matches) return;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const parts = [];
  while (walker.nextNode()) parts.push({ node: walker.currentNode, text: walker.currentNode.textContent });
  if (!parts.length) return;
  // Keep the full height so nothing below jumps while the text grows
  root.style.minHeight = root.offsetHeight + 'px';
  for (const part of parts) part.node.textContent = '';

  const caret = document.createElement('span');
  caret.className = 'caret';
  caret.setAttribute('aria-hidden', 'true');
  parts[0].node.after(caret);

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
    // Short pause after punctuation, a little jitter otherwise
    setTimeout(step, /[!,]/.test(ch) ? 420 : 45 + Math.random() * 75);
  };
  setTimeout(step, 500);
})();
