// Mini-helpers de DOM

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function html(strings, ...vals) {
  return strings.reduce((out, s, i) => out + s + (i < vals.length ? vals[i] : ''), '');
}

export function render(root, htmlStr) {
  root.innerHTML = htmlStr;
}

export function $(sel, root = document) { return root.querySelector(sel); }
export function $$(sel, root = document) { return [...root.querySelectorAll(sel)]; }

export function on(root, evento, selector, handler) {
  root.addEventListener(evento, e => {
    const t = e.target.closest(selector);
    if (t && root.contains(t)) handler(e, t);
  });
}

let toastTimer = null;
export function toast(msg, esError = false) {
  let t = $('#toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.className = 'visible' + (esError ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = ''; }, 3500);
}
