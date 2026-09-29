// Interface: header (plate, title, download menu), footer (views, generate,
// print modes). Black ruled boxes on white.
import { STR as T } from './i18n.js';

const $ = (sel) => document.querySelector(sel);
const h = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null) e.append(c);
  return e;
};

export function initUI(api) {
  const { state } = api;
  $('#scene').setAttribute('aria-label', T.canvas);

  const toast = (msg) => {
    const t = $('#toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(t._h); t._h = setTimeout(() => { t.hidden = true; }, 2200);
  };

  // ---------- footer: views · generate · print ----------
  const views = ['frontale', 'scorcio', 'basso', 'aereo'].map((v) =>
    h('button', { type: 'button', 'data-view': v, onclick: () => api.setPhoto('view', v) }, T.view[v]));
  const modes = ['archivio', 'cartolina', 'colore', 'disegno'].map((m) =>
    h('button', { type: 'button', 'data-mode': m, onclick: () => api.setPhoto('mode', m) }, T.mode[m]));
  const gen = h('button', { type: 'button', id: 'generate', class: 'btn generate', title: T.generateHint, onclick: () => generate() }, T.generate);
  $('#dock').append(
    h('div', { class: 'seg', role: 'group', 'aria-label': T.views }, views),
    gen,
    h('div', { class: 'seg', role: 'group', 'aria-label': T.modes }, modes),
  );

  let busy = false;
  function generate() {
    if (busy) return;
    busy = true;
    gen.classList.add('pressed');
    requestAnimationFrame(() => setTimeout(() => {
      try { api.newBuilding('random'); } finally { busy = false; gen.classList.remove('pressed'); }
    }, 0));
  }
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'g' && e.key !== 'G') return;
    if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
    generate();
  });

  // ---------- header: download menu ----------
  const exp = $('#export');
  const run = async (btn, fn) => {
    const label = btn.textContent;
    btn.disabled = true; btn.textContent = T.developing;
    try {
      const res = await fn();
      toast(res === 'saved' ? T.saved : res === 'declined' ? T.declined : T.failed);
    } catch { toast(T.failed); }
    finally { btn.disabled = false; btn.textContent = label; exp.open = false; }
  };
  const shots = ['1:1', '4:5', '3:2'].map((r) => {
    const b = h('button', { type: 'button' }, r);
    b.addEventListener('click', () => run(b, () => api.takePhoto(r)));
    return b;
  });
  const glb = h('button', { type: 'button', class: 'btn' }, api.inClaude() ? T.modelZip : T.model);
  glb.addEventListener('click', () => run(glb, () => api.exportGLB()));
  exp.append(
    h('summary', {}, T.download),
    h('div', { class: 'menu' },
      h('p', { class: 'menu-label' }, T.photo),
      h('div', { class: 'seg' }, shots),
      glb));
  document.addEventListener('pointerdown', (e) => { if (exp.open && !exp.contains(e.target)) exp.open = false; });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') exp.open = false; });

  // ---------- plate ----------
  const syncPlate = () => { const c = api.caption(); $('#plate').textContent = `${c.index} - ${c.name}`; };
  function sync() {
    views.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === state.S.view)));
    modes.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === state.S.mode)));
    syncPlate();
  }
  sync();

  let codeTimer = 0;
  return {
    sync,
    onRebuilt() {
      syncPlate();
      if (api.inClaude()) return;
      clearTimeout(codeTimer);
      codeTimer = setTimeout(async () => {
        try { history.replaceState(null, '', '#' + await api.code()); } catch { /* ignore */ }
      }, 400);
    },
  };
}
