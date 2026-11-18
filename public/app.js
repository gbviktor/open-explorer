'use strict';
/* Open Explorer — client. Vanilla JS, no build step. */

// ============================================================ utilities
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const enc = encodeURIComponent;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(route, body) {
  const opts = body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-OE': '1' }, body: JSON.stringify(body),
  };
  let r;
  try { r = await fetch('/api/' + route, opts); } catch { throw new Error('Cannot reach the Open Explorer server. Is it running?'); }
  const j = await r.json().catch(() => ({ error: r.statusText }));
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}
const fileUrl = (p) => '/api/file?path=' + enc(p);

function load(k, d) { try { const v = localStorage.getItem('oe.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } }
function save(k, v) { try { localStorage.setItem('oe.' + k, JSON.stringify(v)); } catch { /* ignore */ } }

function fmtSize(n) {
  if (n == null || isNaN(n)) return '';
  if (n < 1024) return `${n} B`;
  const u = ['KB', 'MB', 'GB', 'TB', 'PB']; let i = -1;
  do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
  return `${n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2)} ${u[i]}`;
}
const dtf = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
const fmtDate = (ms) => (ms ? dtf.format(new Date(ms)) : '');
const fmtNum = (n) => Number(n || 0).toLocaleString();
const extOf = (name) => { const i = name.lastIndexOf('.'); return i > 0 ? name.slice(i + 1).toLowerCase() : ''; };
const fmtDuration = (ms) => { const s = Math.round(ms / 1000); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`; };

const CAT = {
  image: 'jpg jpeg jfif png gif bmp webp svg ico tif tiff heic heif raw cr2 cr3 nef arw dng orf rw2 psd avif',
  video: 'mp4 mkv avi mov wmv flv webm m4v mpg mpeg 3gp ts mts m2ts ogv vob',
  audio: 'mp3 wav flac aac ogg oga m4a wma opus aiff aif mid midi',
  doc: 'doc docx odt rtf txt md pdf xls xlsx xlsm csv ods ppt pptx odp epub pages key numbers',
  archive: 'zip rar 7z tar gz tgz bz2 xz zst iso cab img dmg',
  code: 'js mjs cjs ts jsx tsx json html htm css scss less py java c cpp cc h hpp cs go rs php rb sh ps1 psm1 bat cmd xml yml yaml ini toml sql lua kt swift vue log cfg conf env gitignore',
  exe: 'exe msi dll sys apk appx msix com scr jar',
};
const EXT_CAT = {};
for (const [c, s] of Object.entries(CAT)) for (const e of s.split(' ')) EXT_CAT[e] = c;
const catOf = (name) => EXT_CAT[extOf(name)] || 'other';
const TEXTISH = new Set(['txt', 'md', 'log', 'csv', 'ini', 'cfg', 'conf', 'env', 'nfo', 'srt', 'vtt', ...CAT.code.split(' ')]);
const IMG_PREVIEW = new Set(['jpg', 'jpeg', 'jfif', 'png', 'gif', 'bmp', 'webp', 'svg', 'ico', 'avif']);
const VID_PREVIEW = new Set(['mp4', 'm4v', 'webm', 'mov', 'ogv']);
const AUD_PREVIEW = new Set(['mp3', 'wav', 'ogg', 'oga', 'flac', 'm4a', 'aac', 'opus']);
const TYPE_NAMES = {
  txt: 'Text Document', pdf: 'PDF Document', doc: 'Word Document', docx: 'Word Document', xls: 'Excel Worksheet', xlsx: 'Excel Worksheet',
  ppt: 'PowerPoint Presentation', pptx: 'PowerPoint Presentation', jpg: 'JPEG Image', jpeg: 'JPEG Image', png: 'PNG Image', gif: 'GIF Image',
  webp: 'WebP Image', mp4: 'MP4 Video', mkv: 'MKV Video', mp3: 'MP3 Audio', wav: 'WAV Audio', zip: 'Compressed (zipped) Folder',
  exe: 'Application', msi: 'Windows Installer Package', dll: 'Application extension', lnk: 'Shortcut', url: 'Internet Shortcut',
  html: 'HTML Document', htm: 'HTML Document', js: 'JavaScript File', json: 'JSON File', md: 'Markdown File', csv: 'CSV File',
};
const typeName = (it) => (it.dir ? 'File folder' : TYPE_NAMES[extOf(it.name)] || (extOf(it.name) ? `${extOf(it.name).toUpperCase()} File` : 'File'));

// ============================================================ icons
function colorFor(ext) {
  if (ext === 'pdf') return '#d93025';
  if (['doc', 'docx', 'odt', 'rtf'].includes(ext)) return '#2b579a';
  if (['xls', 'xlsx', 'xlsm', 'csv', 'ods'].includes(ext)) return '#217346';
  if (['ppt', 'pptx', 'odp'].includes(ext)) return '#c43e1c';
  return { image: '#8e44ad', video: '#e8710a', audio: '#0f9d58', archive: '#9c6b30', code: '#3367d6', exe: '#546e7a', doc: '#5f6368' }[EXT_CAT[ext]] || '#80868b';
}
function fileSvg(name) {
  const ext = extOf(name); const label = ext.slice(0, 4).toUpperCase();
  const w = Math.max(10, label.length * 3.7 + 3);
  const tag = label
    ? `<rect x="2.5" y="12.2" width="${w}" height="7" rx="1.2" fill="${colorFor(ext)}"/><text x="${2.5 + w / 2}" y="17.4" font-size="5.2" font-family="Segoe UI,Arial,sans-serif" font-weight="700" fill="#fff" text-anchor="middle">${esc(label)}</text>`
    : '<rect x="8" y="10" width="8" height="1.2" fill="#bdc1c6"/><rect x="8" y="13" width="8" height="1.2" fill="#bdc1c6"/><rect x="8" y="16" width="5" height="1.2" fill="#bdc1c6"/>';
  return `<svg viewBox="0 0 24 24"><path d="M5.5 1.5h9l4.5 4.5v16.5h-13.5z" fill="#fdfdfd" stroke="#9aa0a6" stroke-width=".9"/><path d="M14.5 1.5v4.5h4.5" fill="#e8eaed" stroke="#9aa0a6" stroke-width=".9" stroke-linejoin="round"/>${tag}</svg>`;
}
const FOLDER_SVG = '<svg viewBox="0 0 24 24"><path d="M1.5 5.5A1.5 1.5 0 0 1 3 4h6l2 2h10a1.5 1.5 0 0 1 1.5 1.5v11A1.5 1.5 0 0 1 21 20H3a1.5 1.5 0 0 1-1.5-1.5z" fill="#e3a21a"/><path d="M1.5 8.5h21v10A1.5 1.5 0 0 1 21 20H3a1.5 1.5 0 0 1-1.5-1.5z" fill="#ffc83d"/></svg>';
const DRIVE_SVG = '<svg viewBox="0 0 24 24"><rect x="2" y="7" width="20" height="10" rx="2" fill="#9aa0a6"/><rect x="2" y="7" width="20" height="5" rx="2" fill="#c4c7c5"/><circle cx="18" cy="14.5" r="1.1" fill="#34a853"/><rect x="4.5" y="14" width="8" height="1" fill="#e8eaed"/></svg>';
const iconFor = (it) => (it.dir ? FOLDER_SVG : fileSvg(it.name));

const s = (d, c = 'currentColor') => `<svg viewBox="0 0 24 24" style="stroke:${c}">${d}</svg>`;
const ICON = {
  home: s('<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>', '#e8710a'),
  desktop: s('<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>', '#1a73e8'),
  downloads: s('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>', '#0f9d58'),
  documents: s('<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>', '#5f6368'),
  pictures: s('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>', '#1a73e8'),
  music: s('<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>', '#e8453c'),
  videos: s('<rect x="3" y="5" width="13" height="14" rx="2"/><path d="M16 10l5-3v10l-5-3"/>', '#8e44ad'),
  pc: s('<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>', '#3367d6'),
  dupes: s('<rect x="3" y="3" width="12" height="14" rx="2"/><rect x="9" y="7" width="12" height="14" rx="2"/>', 'var(--accent)'),
  drive: DRIVE_SVG,
  open: s('<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>'),
  reveal: s('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 11v4M10 13l2 2 2-2"/>'),
  goto: s('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  eye: s('<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  keep: s('<path d="M5 12l5 5L20 7"/>'),
  x: s('<path d="M6 6l12 12M18 6L6 18"/>'),
  chev: s('<path d="M9 6l6 6-6 6"/>'),
  up: s('<path d="M6 15l6-6 6 6"/>'),
  down: s('<path d="M6 9l6 6 6-6"/>'),
  search: s('<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>'),
  folderOpen: s('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  copy: s('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>'),
  trash: s('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
  link: s('<path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"/>'),
  move: s('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M10 13h6M13 10l3 3-3 3"/>'),
  wand: s('<path d="M15 4V2M15 10V8M11 6h2M17 6h2M4 20L14 10"/>'),
  csv: s('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>'),
};

// ============================================================ state
const S = {
  loc: null, back: [], fwd: [], parent: null, loadToken: 0,
  items: [], shown: [], sel: new Set(), focus: null, anchor: -1, pending: -1,
  sort: load('sort', { key: 'name', dir: 1 }), layout: load('layout', 'details'),
  showHidden: load('hidden', false), preview: load('preview', true),
  clipboard: null, roots: null, filter: '', truncated: false, lastDir: null,
  typeahead: '', typeaheadT: 0,
};
const SEP = () => (S.roots && S.roots.sep) || '\\';
const IS_WIN = () => !S.roots || S.roots.platform === 'win32';
const normP = (p) => { let x = String(p || ''); if (x.length > 3 && /[\\/]$/.test(x)) x = x.slice(0, -1); return IS_WIN() ? x.toLowerCase() : x; };
const samePath = (a, b) => normP(a) === normP(b);
const isUnder = (p, dir) => { const a = normP(p), d = normP(dir); const sep = SEP() === '\\' ? '\\' : '/'; return a === d || a.startsWith(d.endsWith(sep) ? d : d + sep); };
const baseName = (p) => { const parts = String(p).split(/[\\/]/).filter(Boolean); return parts[parts.length - 1] || p; };
const isDirView = () => S.loc && (S.loc.type === 'dir' || S.loc.type === 'search');

// ============================================================ toasts / modals / busy
function toast(msg, kind = '', ms = 3800) {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.innerHTML = `<div class="tmsg">${esc(msg)}</div>`;
  $('#toasts').appendChild(el);
  setTimeout(() => { el.style.transition = 'opacity .3s'; el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, ms);
}

function modal({ title, html = '', buttons = [{ text: 'OK', value: true, primary: true }], wide = false, onOpen, closeValue = null }) {
  return new Promise((resolve) => {
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">
      <div class="modal-h">${esc(title)}</div><div class="modal-b">${html}</div>
      <div class="modal-f">${buttons.map((b, i) => `<button class="btn ${b.primary ? 'primary' : ''} ${b.danger ? 'danger' : ''}" data-i="${i}">${esc(b.text)}</button>`).join('')}</div></div>`;
    const done = (v) => { back.remove(); document.removeEventListener('keydown', onKey, true); resolve(v); };
    const ctx = { el: back, close: done, getValue: null };
    const valueOf = (b) => (typeof b.value === 'function' ? b.value(ctx) : b.value);
    back.addEventListener('click', (e) => {
      const btn = e.target.closest('.modal-f button');
      if (btn) { const b = buttons[+btn.dataset.i]; const v = valueOf(b); if (v !== undefined) done(v); }
      else if (e.target === back) done(closeValue);
    });
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(closeValue); }
      else if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && !e.target.closest('.modal-f')) {
        const b = buttons.find((x) => x.primary); if (b) { e.preventDefault(); e.stopPropagation(); const v = valueOf(b); if (v !== undefined) done(v); }
      }
      e.stopPropagation();
    };
    document.addEventListener('keydown', onKey, true);
    $('#modalRoot').appendChild(back);
    if (onOpen) onOpen(ctx);
    const focusEl = $('input', back) || $('.modal-f .btn.primary', back);
    if (focusEl) setTimeout(() => focusEl.focus(), 0);
  });
}

function promptDlg(title, label, value = '', { selectBase = false } = {}) {
  return modal({
    title, html: `<div style="margin-bottom:6px">${esc(label)}</div><input class="input" id="dlgInput" spellcheck="false" value="${esc(value)}">`,
    buttons: [{ text: 'Cancel', value: null }, { text: 'OK', primary: true, value: (c) => $('#dlgInput', c.el).value }],
    onOpen: (c) => setTimeout(() => {
      const i = $('#dlgInput', c.el); i.focus();
      const dot = value.lastIndexOf('.');
      if (selectBase && dot > 0) i.setSelectionRange(0, dot); else i.select();
    }, 10),
  });
}

function confirmDlg({ title, message, list, okText = 'OK', danger = false }) {
  const shown = (list || []).slice(0, 300);
  const html = `<div>${message}</div>${shown.length ? `<ul class="plist">${shown.map((p) => `<li title="${esc(p)}">${esc(p)}</li>`).join('')}${list.length > shown.length ? `<li>… and ${fmtNum(list.length - shown.length)} more</li>` : ''}</ul>` : ''}`;
  return modal({ title, html, buttons: [{ text: 'Cancel', value: false }, { text: okText, value: true, primary: !danger, danger }], closeValue: false });
}

let busyEl = null;
function busy(text) {
  if (!text) { if (busyEl) busyEl.remove(); busyEl = null; return; }
  if (!busyEl) {
    busyEl = document.createElement('div');
    busyEl.className = 'modal-back';
    busyEl.innerHTML = '<div class="modal" style="width:auto;min-width:300px"><div class="modal-b" style="display:flex;gap:12px;align-items:center;padding:20px 24px;color:var(--text)"><span class="spinner"></span><span class="busytext"></span></div></div>';
    document.body.appendChild(busyEl);
  }
  $('.busytext', busyEl).textContent = text;
}
async function withBusy(text, fn) {
  const t = setTimeout(() => busy(text), 250);
  try { return await fn(); } finally { clearTimeout(t); busy(null); }
}

function report(results, verb) {
  const okN = results.filter((r) => r.ok && !r.skipped).length;
  const bad = results.filter((r) => !r.ok);
  if (okN) toast(`${fmtNum(okN)} item${okN === 1 ? '' : 's'} ${verb}`, 'ok');
  if (bad.length) toast(`${fmtNum(bad.length)} failed — ${baseName(bad[0].path)}: ${bad[0].error}`, 'err', 7000);
  return results.filter((r) => r.ok).map((r) => r.path);
}

// ---------- folder picker
async function pickFolder(title, start) {
  let cur = start || (S.loc && S.loc.type === 'dir' ? S.loc.path : null);
  let selected = null;
  return modal({
    title, wide: true,
    html: `<div class="picker-path"><button class="btn small" id="pkUp" title="Up">${ICON.up}</button><input class="input" id="pkPath" spellcheck="false" style="flex:1;height:26px"><button class="btn small" id="pkNew">New folder</button></div><div class="picker-list" id="pkList"></div><div class="hint" style="margin-top:6px">Double-click to open a folder. The selected (or current) folder will be used.</div>`,
    buttons: [{ text: 'Cancel', value: null }, { text: 'Select folder', primary: true, value: () => selected || cur || undefined }],
    onOpen: (ctx) => {
      const list = $('#pkList', ctx.el); const inp = $('#pkPath', ctx.el);
      const show = async (p) => {
        selected = null;
        if (!p) {
          cur = null; inp.value = 'This PC';
          const drives = (S.roots && S.roots.drives) || [];
          list.innerHTML = [...(S.roots ? S.roots.quick : []), ...drives].map((d) => `<div class="picker-item" data-p="${esc(d.path)}"><span class="ico">${d.label !== undefined ? DRIVE_SVG : FOLDER_SVG}</span>${esc(d.label !== undefined ? driveName(d) : d.name)}</div>`).join('');
          return;
        }
        try {
          const r = await api('list?path=' + enc(p));
          cur = r.path; inp.value = r.path; ctx.parent = r.parent;
          const dirs = r.items.filter((i) => i.dir && (S.showHidden || !i.hidden)).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
          list.innerHTML = dirs.length ? dirs.map((d) => `<div class="picker-item" data-p="${esc(d.path)}"><span class="ico">${FOLDER_SVG}</span>${esc(d.name)}</div>`).join('') : '<div class="empty" style="padding:30px">No subfolders</div>';
        } catch (e) { toast(e.message, 'err'); }
      };
      list.addEventListener('click', (e) => { const it = e.target.closest('.picker-item'); if (!it) return; $$('.picker-item', list).forEach((x) => x.classList.toggle('sel', x === it)); selected = it.dataset.p; });
      list.addEventListener('dblclick', (e) => { const it = e.target.closest('.picker-item'); if (it) show(it.dataset.p); });
      $('#pkUp', ctx.el).onclick = () => show(cur && ctx.parent ? ctx.parent : null);
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); show(inp.value.trim() || null); } });
      $('#pkNew', ctx.el).onclick = async () => {
        if (!cur) return toast('Open a folder first', 'err');
        try { const r = await api('mkdir', { path: cur, name: 'New folder' }); await show(cur); selected = r.path; const el = $$('.picker-item', list).find((x) => samePath(x.dataset.p, r.path)); if (el) { el.classList.add('sel'); el.scrollIntoView({ block: 'nearest' }); } } catch (e) { toast(e.message, 'err'); }
      };
      show(cur);
    },
  });
}

// ============================================================ context menu
function showMenu(x, y, items) {
  const m = $('#ctxmenu');
  m.innerHTML = items.filter(Boolean).map((it, i) => (it === '-' ? '<div class="ctx-sep"></div>'
    : `<div class="ctx-item ${it.disabled ? 'disabled' : ''} ${it.danger ? 'danger' : ''}" data-i="${i}">${it.icon || '<svg></svg>'}<span>${esc(it.label)}</span>${it.key ? `<span class="k">${esc(it.key)}</span>` : ''}</div>`)).join('');
  const list = items.filter(Boolean);
  m.onclick = (e) => { const el = e.target.closest('.ctx-item'); if (!el) return; hideMenu(); const it = list[+el.dataset.i]; it.action && it.action(); };
  m.hidden = false;
  const r = m.getBoundingClientRect();
  m.style.left = Math.min(x, innerWidth - r.width - 6) + 'px';
  m.style.top = Math.min(y, innerHeight - r.height - 6) + 'px';
}
function hideMenu() { $('#ctxmenu').hidden = true; $$('.dropdown').forEach((d) => d.remove()); }

// ============================================================ navigation
function saveLoc() { try { if (S.loc && S.loc.type !== 'search') sessionStorage.setItem('oe.loc', JSON.stringify({ type: S.loc.type, path: S.loc.path })); } catch { /* ignore */ } }

async function go(loc, push = true) {
  hideMenu();
  if (push && S.loc) { S.back.push(S.loc); if (S.back.length > 100) S.back.shift(); S.fwd = []; }
  S.loc = loc; S.sel.clear(); S.focus = null; S.anchor = -1; S.filter = '';
  $('#searchInput').value = loc.type === 'search' ? loc.q : '';
  $('#searchInput').placeholder = loc.type === 'dir' ? `Search ${baseName(loc.path)}` : 'Search';
  if (loc.type === 'dir') S.lastDir = loc.path;
  saveLoc(); updateNavButtons(); renderCrumbs(); renderNav(); updateCommands();
  if (loc.type === 'dupes') { S.items = []; S.shown = []; setStatus('Duplicate Finder'); Dupes.render(); renderPreview(null); return; }
  if (loc.type === 'pc') { renderPC(); return; }
  await loadDir();
}
function goBack() { if (!S.back.length) return; S.fwd.push(S.loc); go(S.back.pop(), false); }
function goFwd() { if (!S.fwd.length) return; S.back.push(S.loc); go(S.fwd.pop(), false); }
function goUp() {
  if (!S.loc) return;
  if (S.loc.type === 'search') return go({ type: 'dir', path: S.loc.path });
  if (S.loc.type === 'dir') return S.parent ? go({ type: 'dir', path: S.parent, select: S.loc.path }) : go({ type: 'pc' });
  if (S.loc.type === 'dupes') return go({ type: 'pc' });
}
function refresh() {
  if (!S.loc) return;
  if (S.loc.type === 'pc') return loadRoots().then(renderPC);
  if (S.loc.type === 'dupes') return Dupes.render();
  return loadDir(true);
}
function updateNavButtons() {
  $('#btnBack').disabled = !S.back.length;
  $('#btnFwd').disabled = !S.fwd.length;
  $('#btnUp').disabled = !S.loc || S.loc.type === 'pc';
}
async function loadRoots() { try { S.roots = await api('roots'); } catch (e) { toast(e.message, 'err'); } renderNav(); }

function driveName(d) {
  const kind = d.driveType === 2 ? 'Removable Disk' : d.driveType === 4 ? 'Network Drive' : d.driveType === 5 ? 'CD Drive' : 'Local Disk';
  return `${d.label || kind} (${d.name})`;
}

function segments(p) {
  if (SEP() === '\\') {
    const m = /^([A-Za-z]:\\)(.*)$/.exec(p);
    if (m) {
      const out = [{ name: m[1].slice(0, 2), path: m[1], drive: true }]; let acc = m[1];
      for (const x of m[2].split('\\').filter(Boolean)) { acc = acc.endsWith('\\') ? acc + x : `${acc}\\${x}`; out.push({ name: x, path: acc }); }
      return out;
    }
    return [{ name: p, path: p }];
  }
  const out = [{ name: '/', path: '/' }]; let acc = '';
  for (const x of p.split('/').filter(Boolean)) { acc += '/' + x; out.push({ name: x, path: acc }); }
  return out;
}

function renderCrumbs() {
  const c = $('#crumbs'); const loc = S.loc;
  const sepHtml = `<span class="crumb-sep">${ICON.chev}</span>`;
  let html = '';
  if (loc.type === 'pc') html = `<button class="crumb" data-pc="1"><span class="ico" style="width:16px;height:16px">${ICON.pc}</span>This PC</button>`;
  else if (loc.type === 'dupes') html = `<button class="crumb" data-pc="1"><span class="ico" style="width:16px;height:16px">${ICON.pc}</span>This PC</button>${sepHtml}<button class="crumb" data-dupes="1">Duplicate Finder</button>`;
  else {
    const segs = segments(loc.path);
    const driveLabel = (seg) => { const d = S.roots && S.roots.drives.find((x) => samePath(x.path, seg.path)); return d ? driveName(d) : seg.name; };
    html = `<button class="crumb" data-pc="1"><span class="ico" style="width:16px;height:16px">${ICON.pc}</span></button>${sepHtml}`
      + segs.map((sg) => `<button class="crumb" data-path="${esc(sg.path)}">${esc(sg.drive ? driveLabel(sg) : sg.name)}</button>`).join(sepHtml);
    if (loc.type === 'search') html += `${sepHtml}<span class="crumb" style="cursor:default">Search results for “${esc(loc.q)}”</span>`;
  }
  c.innerHTML = html;
  c.scrollLeft = c.scrollWidth;
}

function editAddress() {
  const inp = $('#addrInput');
  $('#crumbs').hidden = true; inp.hidden = false;
  inp.value = S.loc.type === 'dir' || S.loc.type === 'search' ? S.loc.path : S.loc.type === 'dupes' ? 'Duplicate Finder' : 'This PC';
  inp.focus(); inp.select();
}
function endEditAddress() { $('#crumbs').hidden = false; $('#addrInput').hidden = true; }

// ============================================================ nav pane
function navItem(path, label, icon, active) {
  return `<div class="nav-item ${active ? 'active' : ''}" data-path="${esc(path)}" title="${esc(path)}"><span class="ni-ico">${icon}</span><span class="ni-label">${esc(label)}</span></div>`;
}
function renderNav() {
  const r = S.roots || { drives: [], quick: [] };
  const cur = S.loc || {};
  const act = (p) => cur.type === 'dir' && samePath(cur.path, p);
  const running = Dupes.state.info && Dupes.state.info.status === 'running';
  const badge = running ? '<span class="spinner"></span>' : Dupes.state.groups.length ? `<span class="count">${fmtNum(Dupes.state.groups.length)}</span>` : '';
  $('#navpane').innerHTML = `
    <div class="nav-section"><div class="nav-item featured ${cur.type === 'dupes' ? 'active' : ''}" data-nav="dupes"><span class="ni-ico">${ICON.dupes}</span><span class="ni-label">Duplicate Finder</span>${badge}</div></div>
    <div class="nav-section"><div class="nav-title">Quick access</div>${r.quick.map((q) => navItem(q.path, q.name, ICON[q.icon] || FOLDER_SVG, act(q.path))).join('')}</div>
    <div class="nav-section"><div class="nav-item ${cur.type === 'pc' ? 'active' : ''}" data-nav="pc"><span class="ni-ico">${ICON.pc}</span><span class="ni-label">This PC</span></div>
    ${r.drives.map((d) => navItem(d.path, driveName(d), DRIVE_SVG, act(d.path))).join('')}</div>`;
}

// ============================================================ This PC
function renderPC() {
  const r = S.roots || { drives: [], quick: [] };
  S.items = []; S.shown = [];
  $('#main').innerHTML = `<div class="pc">
    <div class="hero"><div class="hero-ico">${ICON.dupes}</div><div style="flex:1"><h2>Find and clean up duplicate files</h2><p>Scan any folders or drives, compare files by content, and safely send extra copies to the Recycle Bin.</p></div><button class="btn primary" data-nav="dupes">Open Duplicate Finder</button></div>
    <h3>Quick access</h3>
    <div class="pc-grid">${r.quick.map((q) => `<div class="pc-card" data-path="${esc(q.path)}"><div class="big">${FOLDER_SVG}</div><div class="info"><div class="name">${esc(q.name)}</div><div class="sub">${esc(q.path)}</div></div></div>`).join('')}</div>
    <h3>Devices and drives</h3>
    <div class="pc-grid">${r.drives.map((d) => {
      const used = d.total ? (d.total - d.free) / d.total : 0;
      return `<div class="pc-card" data-path="${esc(d.path)}"><div class="big">${DRIVE_SVG}</div><div class="info"><div class="name">${esc(driveName(d))}</div>
        ${d.total ? `<div class="bar ${used > 0.9 ? 'full' : ''}"><i style="width:${(used * 100).toFixed(1)}%"></i></div><div class="sub">${fmtSize(d.free)} free of ${fmtSize(d.total)}</div>` : '<div class="sub">&nbsp;</div>'}</div></div>`;
    }).join('')}</div></div>`;
  setStatus(`${r.drives.length} drives`);
  renderPreview(null);
}

// ============================================================ folder view
function setStatus(left, right = '') { $('#status').textContent = left; $('#statusRight').textContent = right; }

async function loadDir(keepSel) {
  const loc = S.loc; const token = ++S.loadToken;
  const prevSel = keepSel ? new Set(S.sel) : null;
  const spinner = setTimeout(() => { if (token === S.loadToken) $('#main').innerHTML = `<div class="empty"><span class="spinner" style="display:inline-block;width:24px;height:24px"></span><div style="margin-top:10px">${loc.type === 'search' ? 'Searching…' : 'Loading…'}</div></div>`; }, 150);
  try {
    let data;
    if (loc.type === 'search') {
      setStatus('Searching…');
      data = await api(`search?path=${enc(loc.path)}&q=${enc(loc.q)}&hidden=${S.showHidden ? 1 : 0}`);
      S.truncated = data.truncated; S.parent = loc.path;
    } else {
      data = await api('list?path=' + enc(loc.path));
      if (token !== S.loadToken) return;
      loc.path = data.path; S.parent = data.parent; S.lastDir = data.path; S.truncated = false;
      renderCrumbs(); saveLoc();
    }
    if (token !== S.loadToken) return;
    S.items = data.items;
    if (prevSel) { const have = new Set(S.items.map((i) => i.path)); S.sel = new Set([...prevSel].filter((p) => have.has(p))); }
    if (loc.select) { S.sel = new Set([loc.select]); S.focus = loc.select; delete loc.select; }
    renderList();
    renderNav();
  } catch (e) {
    if (token !== S.loadToken) return;
    S.items = []; S.shown = [];
    $('#main').innerHTML = `<div class="empty">${ICON.folderOpen}<div>${esc(e.message)}</div><div style="margin-top:12px"><button class="btn" id="errUp">Go up</button></div></div>`;
    $('#errUp').onclick = goUp;
    setStatus('');
  } finally { clearTimeout(spinner); }
}

function computeShown() {
  const f = S.filter.trim().toLowerCase();
  let list = S.items.filter((i) => (S.showHidden || !i.hidden) && (!f || i.name.toLowerCase().includes(f)));
  const { key, dir } = S.sort;
  const coll = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  const val = {
    name: (a, b) => coll.compare(a.name, b.name),
    mtime: (a, b) => (a.mtime || 0) - (b.mtime || 0),
    size: (a, b) => (a.size || 0) - (b.size || 0),
    type: (a, b) => coll.compare(typeName(a), typeName(b)) || coll.compare(a.name, b.name),
    folder: (a, b) => coll.compare(a.path, b.path),
  }[key] || ((a, b) => coll.compare(a.name, b.name));
  list.sort((a, b) => (b.dir - a.dir) || val(a, b) * dir || coll.compare(a.name, b.name));
  S.shown = list;
}

function renderList() {
  computeShown();
  const main = $('#main');
  const isSearch = S.loc.type === 'search';
  if (!S.shown.length) {
    main.innerHTML = `<div class="empty">${isSearch ? ICON.search : ICON.folderOpen}<div>${isSearch ? 'No items match your search.' : S.filter ? 'No items match the filter.' : 'This folder is empty.'}</div></div>`;
    updateSelectionUI();
    return;
  }
  const cut = S.clipboard && S.clipboard.mode === 'cut' ? new Set(S.clipboard.paths) : null;
  if (S.layout === 'tiles') {
    main.innerHTML = `<div class="tiles" id="listBody" tabindex="0">${S.shown.map((it, i) => {
      const ext = extOf(it.name);
      const thumb = !it.dir && IMG_PREVIEW.has(ext) && it.size < 40e6 ? `<img loading="lazy" decoding="async" src="${fileUrl(it.path)}" alt="" draggable="false">` : (it.dir ? FOLDER_SVG : fileSvg(it.name));
      return `<div class="tile ${cls(it, cut)}" data-i="${i}" draggable="true" title="${esc(it.name)}"><div class="thumb">${thumb}</div><div class="tl">${esc(it.name)}</div></div>`;
    }).join('')}</div>`;
  } else {
    const cols = isSearch ? 'minmax(200px,2fr) minmax(160px,2fr) 150px 130px 90px' : 'minmax(240px,1fr) 150px 160px 100px';
    const head = [['name', 'Name'], ...(isSearch ? [['folder', 'Folder']] : []), ['mtime', 'Date modified'], ['type', 'Type'], ['size', 'Size', 'num']];
    const arrow = (k) => (S.sort.key === k ? `<span class="arrow">${S.sort.dir > 0 ? ICON.up : ICON.down}</span>` : '');
    main.innerHTML = `<div class="list" style="--cols:${cols}"><div class="list-head">${head.map(([k, l, c]) => `<div data-sort="${k}" class="${c || ''}">${l}${arrow(k)}</div>`).join('')}</div>
      <div class="list-body" id="listBody" tabindex="0">${S.shown.map((it, i) => `<div class="row ${cls(it, cut)}" data-i="${i}" draggable="true">
        <span class="nm"><span class="ico">${iconFor(it)}</span><span class="t">${esc(it.name)}</span></span>
        ${isSearch ? `<span title="${esc(it.path)}">${esc(it.path.slice(0, it.path.length - it.name.length - 1))}</span>` : ''}
        <span>${fmtDate(it.mtime)}</span><span>${esc(typeName(it))}</span><span class="num">${it.dir ? '' : fmtSize(it.size)}</span></div>`).join('')}</div></div>`;
  }
  updateSelectionUI();
  const f = focusIndex();
  if (f >= 0) { const el = $(`[data-i="${f}"]`, main); if (el) el.scrollIntoView({ block: 'nearest' }); }
}
const cls = (it, cut) => `${S.sel.has(it.path) ? 'sel' : ''} ${S.focus === it.path ? 'focus' : ''} ${cut && cut.has(it.path) ? 'cut' : ''} ${it.hidden ? 'hidden-item' : ''}`;
const focusIndex = () => (S.focus ? S.shown.findIndex((i) => i.path === S.focus) : -1);
const selectedItems = () => S.shown.filter((i) => S.sel.has(i.path));

function updateSelectionUI() {
  $$('#main [data-i]').forEach((el) => {
    const it = S.shown[+el.dataset.i]; if (!it) return;
    el.classList.toggle('sel', S.sel.has(it.path));
    el.classList.toggle('focus', S.focus === it.path);
  });
  const sel = selectedItems();
  const size = sel.reduce((a, i) => a + (i.size || 0), 0);
  const total = `${fmtNum(S.shown.length)} item${S.shown.length === 1 ? '' : 's'}${S.truncated ? ' (search limit reached)' : ''}`;
  setStatus(sel.length ? `${total}   |   ${fmtNum(sel.length)} selected${size ? ` ${fmtSize(size)}` : ''}` : total, S.clipboard ? `${S.clipboard.paths.length} item(s) on clipboard (${S.clipboard.mode})` : '');
  updateCommands();
  renderPreview(sel.length === 1 ? sel[0] : null, sel);
}

function selectIndex(i, e = {}) {
  if (i < 0 || i >= S.shown.length) return;
  const p = S.shown[i].path;
  if (e.shiftKey && S.anchor >= 0) {
    if (!(e.ctrlKey || e.metaKey)) S.sel.clear();
    const [a, b] = [Math.min(S.anchor, i), Math.max(S.anchor, i)];
    for (let k = a; k <= b; k++) S.sel.add(S.shown[k].path);
  } else if (e.ctrlKey || e.metaKey) {
    if (S.sel.has(p)) S.sel.delete(p); else S.sel.add(p);
    S.anchor = i;
  } else { S.sel.clear(); S.sel.add(p); S.anchor = i; }
  S.focus = p;
  updateSelectionUI();
  const el = $(`#main [data-i="${i}"]`); if (el) el.scrollIntoView({ block: 'nearest' });
}

async function openItem(it) {
  if (!it) return;
  if (it.dir) return go({ type: 'dir', path: it.path });
  try { await api('open', { path: it.path }); toast(`Opening “${it.name}”…`); } catch (e) { toast(e.message, 'err'); }
}
async function revealItem(p) { try { await api('reveal', { path: p }); } catch (e) { toast(e.message, 'err'); } }
function copyText(t) { navigator.clipboard.writeText(t).then(() => toast('Copied to clipboard', 'ok'), () => toast('Clipboard not available', 'err')); }

// ---------- commands
const currentDir = () => (S.loc && S.loc.type === 'dir' ? S.loc.path : null);

function updateCommands() {
  const dirView = isDirView(); const n = dirView ? S.sel.size : 0;
  const set = (c, en) => { const b = $(`.cmd[data-cmd="${c}"]`); if (b) b.disabled = !en; };
  set('newfolder', !!currentDir()); set('newfile', !!currentDir());
  set('cut', n > 0); set('copy', n > 0); set('rename', n === 1); set('delete', n > 0);
  set('paste', !!(S.clipboard && currentDir()));
  set('dupes-here', !!currentDir());
  set('layout', dirView);
  $('.cmd[data-cmd="preview"]').classList.toggle('on', S.preview);
  $('.cmd[data-cmd="hidden"]').classList.toggle('on', S.showHidden);
  $('#layoutLabel').textContent = S.layout === 'tiles' ? 'Tiles' : 'Details';
}

async function cmdNew(kind) {
  const dir = currentDir(); if (!dir) return;
  try {
    const r = await api(kind === 'file' ? 'newfile' : 'mkdir', { path: dir, name: kind === 'file' ? 'New Text Document.txt' : 'New folder' });
    await loadDir();
    S.sel = new Set([r.path]); S.focus = r.path; updateSelectionUI();
    startRename(r.path);
  } catch (e) { toast(e.message, 'err'); }
}

function startRename(p) {
  const i = S.shown.findIndex((x) => x.path === p); if (i < 0) return;
  const it = S.shown[i];
  const el = $(`#main [data-i="${i}"]`); if (!el) return;
  const target = $('.t', el) || $('.tl', el);
  el.scrollIntoView({ block: 'nearest' });
  el.draggable = false;
  const old = target.innerHTML;
  target.innerHTML = `<input class="rename-input" spellcheck="false" value="${esc(it.name)}">`;
  const inp = $('input', target);
  inp.focus();
  const dot = it.name.lastIndexOf('.');
  if (!it.dir && dot > 0) inp.setSelectionRange(0, dot); else inp.select();
  let done = false;
  const finish = async (commit) => {
    if (done) return; done = true;
    const name = inp.value.trim();
    if (!commit || !name || name === it.name) { target.innerHTML = old; el.draggable = true; return; }
    try { const r = await api('rename', { path: it.path, name }); await loadDir(); S.sel = new Set([r.path]); S.focus = r.path; updateSelectionUI(); }
    catch (e) { toast(e.message, 'err'); target.innerHTML = old; el.draggable = true; }
  };
  inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') finish(true); else if (e.key === 'Escape') finish(false); });
  inp.addEventListener('blur', () => finish(true));
  inp.addEventListener('mousedown', (e) => e.stopPropagation());
  inp.addEventListener('dblclick', (e) => e.stopPropagation());
}

async function deletePaths(paths, permanent) {
  if (!paths.length) return [];
  const ok = await confirmDlg({
    title: permanent ? 'Delete permanently?' : 'Move to Recycle Bin?',
    message: permanent ? `<b>${fmtNum(paths.length)}</b> item(s) will be permanently deleted. This cannot be undone.` : `<b>${fmtNum(paths.length)}</b> item(s) will be moved to the Recycle Bin. You can restore them from there.`,
    list: paths, okText: permanent ? 'Delete permanently' : 'Move to Recycle Bin', danger: true,
  });
  if (!ok) return [];
  try {
    const r = await withBusy(`${permanent ? 'Deleting' : 'Moving to Recycle Bin'} ${fmtNum(paths.length)} item(s)…`, () => api('delete', { paths, permanent: !!permanent }));
    return report(r.results, permanent ? 'deleted' : 'moved to the Recycle Bin');
  } catch (e) { toast(e.message, 'err'); return []; }
}
async function cmdDelete(permanent) {
  const paths = selectedItems().map((i) => i.path);
  const done = await deletePaths(paths, permanent);
  if (done.length) { Dupes.forget(done); loadDir(true); }
}
function cmdClip(mode) {
  const paths = selectedItems().map((i) => i.path); if (!paths.length) return;
  S.clipboard = { mode, paths };
  toast(`${paths.length} item(s) ${mode === 'cut' ? 'cut' : 'copied'} — paste with Ctrl+V`);
  renderList();
}
async function transfer(paths, dest, copy) {
  try {
    const r = await withBusy(`${copy ? 'Copying' : 'Moving'} ${fmtNum(paths.length)} item(s)…`, () => api(copy ? 'copy' : 'move', { paths, dest }));
    const done = report(r.results, copy ? 'copied' : 'moved');
    if (!copy) Dupes.forget(done);
    return r.results;
  } catch (e) { toast(e.message, 'err'); return []; }
}
async function cmdPaste(destOverride) {
  const dest = destOverride || currentDir(); if (!S.clipboard || !dest) return;
  const { mode, paths } = S.clipboard;
  const results = await transfer(paths, dest, mode === 'copy');
  if (mode === 'cut') S.clipboard = null;
  await loadDir();
  const added = results.filter((r) => r.ok && r.to).map((r) => r.to);
  if (added.length) { S.sel = new Set(added); S.focus = added[0]; updateSelectionUI(); }
}
function setPref(key, val) {
  S[key] = val; save(key === 'showHidden' ? 'hidden' : key, val);
  if (key === 'preview') { document.body.classList.toggle('no-preview', !val); updateSelectionUI(); }
  if (isDirView()) renderList(); else updateCommands();
}
function findDupesIn(paths, autostart = true) {
  Dupes.state.cfg.roots = [...paths]; Dupes.saveCfg();
  go({ type: 'dupes' }).then(() => { if (autostart) Dupes.start(); });
}

function runCmd(c) {
  switch (c) {
    case 'newfolder': return cmdNew('folder');
    case 'newfile': return cmdNew('file');
    case 'cut': return cmdClip('cut');
    case 'copy': return cmdClip('copy');
    case 'paste': return cmdPaste();
    case 'rename': { const s1 = selectedItems(); if (s1.length === 1) startRename(s1[0].path); return; }
    case 'delete': return cmdDelete(false);
    case 'layout': return setPref('layout', S.layout === 'tiles' ? 'details' : 'tiles');
    case 'preview': return setPref('preview', !S.preview);
    case 'hidden': return setPref('showHidden', !S.showHidden);
    case 'dupes-here': if (currentDir()) findDupesIn([currentDir()]); return;
  }
}

function itemMenu(x, y) {
  const sel = selectedItems(); const one = sel.length === 1 ? sel[0] : null;
  const dirs = sel.filter((i) => i.dir);
  showMenu(x, y, [
    { label: one && one.dir ? 'Open' : 'Open', icon: ICON.open, key: 'Enter', action: () => (one ? openItem(one) : sel.filter((i) => !i.dir).forEach(openItem)), disabled: !one && !sel.some((i) => !i.dir) },
    { label: 'Show in Windows Explorer', icon: ICON.reveal, action: () => revealItem(sel[0].path) },
    S.loc.type === 'search' && one ? { label: 'Open file location', icon: ICON.goto, action: () => go({ type: 'dir', path: one.path.slice(0, one.path.length - one.name.length - 1) || one.path, select: one.path }) } : null,
    { label: 'Copy as path', icon: ICON.copy, action: () => copyText(sel.map((i) => (sel.length > 1 ? `"${i.path}"` : i.path)).join('\n')) },
    '-',
    dirs.length ? { label: `Find duplicates in ${dirs.length > 1 ? `${dirs.length} folders` : 'this folder'}`, icon: ICON.dupes, action: () => findDupesIn(dirs.map((d) => d.path)) } : null,
    dirs.length ? { label: 'Add to duplicate scan folders', icon: ICON.dupes, action: () => { const c = Dupes.state.cfg; for (const d of dirs) if (!c.roots.some((r) => samePath(r, d.path))) c.roots.push(d.path); Dupes.saveCfg(); toast(`Added ${dirs.length} folder(s) to the duplicate scan`, 'ok'); } } : null,
    dirs.length ? '-' : null,
    { label: 'Cut', icon: s('<circle cx="6" cy="18" r="3"/><circle cx="18" cy="18" r="3"/><path d="M8 16L18 4M16 16L6 4"/>'), key: 'Ctrl+X', action: () => cmdClip('cut') },
    { label: 'Copy', icon: ICON.copy, key: 'Ctrl+C', action: () => cmdClip('copy') },
    one && one.dir && S.clipboard ? { label: 'Paste into folder', icon: ICON.move, action: () => cmdPaste(one.path) } : null,
    { label: 'Move to…', icon: ICON.move, action: async () => { const d = await pickFolder('Move to folder'); if (d) { await transfer(sel.map((i) => i.path), d, false); loadDir(); } } },
    { label: 'Copy to…', icon: ICON.copy, action: async () => { const d = await pickFolder('Copy to folder'); if (d) { await transfer(sel.map((i) => i.path), d, true); loadDir(); } } },
    '-',
    { label: 'Rename', icon: s('<path d="M4 20h4l10-10-4-4L4 16z"/>'), key: 'F2', action: () => startRename(one.path), disabled: !one },
    { label: 'Delete', icon: ICON.trash, key: 'Del', action: () => cmdDelete(false) },
    { label: 'Delete permanently', icon: ICON.trash, key: 'Shift+Del', danger: true, action: () => cmdDelete(true) },
  ]);
}
function backgroundMenu(x, y) {
  const dir = currentDir();
  showMenu(x, y, [
    { label: S.layout === 'tiles' ? 'View: Details' : 'View: Tiles', icon: s('<path d="M4 6h16M4 12h16M4 18h16"/>'), action: () => runCmd('layout') },
    { label: 'Refresh', icon: s('<path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5"/>'), key: 'F5', action: refresh },
    '-',
    { label: 'Paste', icon: s('<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4h6v3H9z"/>'), key: 'Ctrl+V', action: () => cmdPaste(), disabled: !S.clipboard || !dir },
    { label: 'New folder', icon: ICON.folderOpen, key: 'Ctrl+Shift+N', action: () => cmdNew('folder'), disabled: !dir },
    { label: 'New text document', icon: s('<path d="M6 3h8l5 5v13H6z"/><path d="M14 3v5h5"/>'), action: () => cmdNew('file'), disabled: !dir },
    '-',
    { label: 'Find duplicates in this folder', icon: ICON.dupes, action: () => findDupesIn([dir]), disabled: !dir },
    { label: 'Open in Windows Explorer', icon: ICON.reveal, action: () => api('open', { path: dir }).catch((e) => toast(e.message, 'err')), disabled: !dir },
    { label: 'Copy folder path', icon: ICON.copy, action: () => copyText(dir), disabled: !dir },
  ]);
}

// ============================================================ preview pane
let previewToken = 0;
function renderPreview(it, sel) {
  const pane = $('#previewpane');
  if (!S.preview) return;
  const token = ++previewToken;
  if (!it) {
    if (sel && sel.length > 1) {
      const size = sel.reduce((a, i) => a + (i.size || 0), 0);
      pane.innerHTML = `<div class="pv-empty"><div class="pv-title" style="color:var(--text)">${fmtNum(sel.length)} items selected</div>${size ? `<div>${fmtSize(size)}</div>` : ''}</div>`;
    } else pane.innerHTML = '<div class="pv-empty">Select a file to preview its contents.</div>';
    return;
  }
  const ext = extOf(it.name); const url = fileUrl(it.path);
  let media;
  if (it.dir) media = `<div class="bigico">${FOLDER_SVG}</div>`;
  else if (IMG_PREVIEW.has(ext)) media = `<img src="${url}" alt="">`;
  else if (VID_PREVIEW.has(ext)) media = `<video src="${url}" controls preload="metadata"></video>`;
  else if (AUD_PREVIEW.has(ext)) media = `<audio src="${url}" controls preload="metadata"></audio>`;
  else if (ext === 'pdf') media = `<iframe src="${url}" title="PDF preview"></iframe>`;
  else if (TEXTISH.has(ext) || (!ext && it.size < 1e6)) media = '<pre class="pv-text">Loading…</pre>';
  else media = `<div class="bigico">${fileSvg(it.name)}</div>`;
  pane.innerHTML = `<div class="pv">
    <div class="pv-media">${media}</div>
    <div class="pv-title">${esc(it.name)}</div>
    <dl class="pv-props">
      <dt>Type</dt><dd>${esc(typeName(it))}</dd>
      ${it.dir ? '' : `<dt>Size</dt><dd>${fmtSize(it.size)} (${fmtNum(it.size)} bytes)</dd>`}
      <dt>Modified</dt><dd>${fmtDate(it.mtime)}</dd>
      ${it.ctime ? `<dt>Created</dt><dd>${fmtDate(it.ctime)}</dd>` : ''}
      <dt>Location</dt><dd>${esc(it.path)}</dd>
    </dl>
    <div class="pv-actions">
      <button class="btn small" data-pv="open">${ICON.open} Open</button>
      <button class="btn small" data-pv="reveal">${ICON.reveal} Show in Explorer</button>
      <button class="btn small" data-pv="copy">${ICON.copy} Copy path</button>
    </div></div>`;
  pane.querySelector('.pv-actions').onclick = (e) => {
    const b = e.target.closest('[data-pv]'); if (!b) return;
    if (b.dataset.pv === 'open') openItem(it); else if (b.dataset.pv === 'reveal') revealItem(it.path); else copyText(it.path);
  };
  const pre = $('.pv-text', pane);
  if (pre) {
    api('text?path=' + enc(it.path)).then((r) => {
      if (token !== previewToken) return;
      pre.textContent = r.binary ? '(Binary file — no text preview)' : (r.text || '(empty file)') + (r.truncated ? '\n\n… (preview truncated)' : '');
    }).catch((e) => { if (token === previewToken) pre.textContent = e.message; });
  }
}

// ============================================================ duplicate finder
const UNITS = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 };
const TYPE_PRESETS = { all: 'All files', image: 'Images', video: 'Videos', audio: 'Music & audio', doc: 'Documents', archive: 'Archives', custom: 'Custom extensions…' };
const Dupes = {
  state: {
    cfg: Object.assign({ roots: [], mode: 'content', minSize: 1, minUnit: 'KB', maxSize: '', maxUnit: 'MB', types: 'all', customExt: '', exclude: 'node_modules, .git', includeHidden: false }, load('dupcfg', {})),
    scanId: load('dupScan', null), info: null, groups: [], marked: new Set(), timer: null, freed: 0, removed: 0, mode: 'content',
    view: { q: '', sort: 'wasted', type: 'all', limit: 40 }, restored: false,
  },
  saveCfg() { save('dupcfg', this.state.cfg); },

  // remove paths that were deleted/moved elsewhere in the app from the results
  forget(paths) {
    const st = this.state; if (!st.groups.length || !paths.length) return;
    const set = new Set(paths.map(normP));
    let changed = false;
    for (const g of st.groups) {
      const before = g.files.length;
      g.files = g.files.filter((f) => !set.has(normP(f.path)) && ![...set].some((p) => isUnder(f.path, p)));
      if (g.files.length !== before) { changed = true; recalc(g); }
    }
    if (!changed) return;
    for (const p of [...st.marked]) if (set.has(normP(p))) st.marked.delete(p);
    st.groups = st.groups.filter((g) => g.files.length > 1);
    const live = new Set(st.groups.flatMap((g) => g.files.map((f) => f.path)));
    for (const p of [...st.marked]) if (!live.has(p)) st.marked.delete(p);
  },

  async render() {
    const st = this.state; const c = st.cfg;
    $('#main').innerHTML = `<div class="dupes" id="dupesRoot">
      <h1>${ICON.dupes} Duplicate Finder</h1>
      <p class="lead">Finds identical files by comparing size, then sampled content, then a full SHA-1 hash. Removed files go to the Recycle Bin by default.</p>
      <div class="card" id="dSetup">
        <div class="setup-grid">
          <label>Folders to scan</label>
          <div><div class="chips" id="dRoots"></div>
            <div class="rowc" style="margin-top:8px">
              <button class="btn small" id="dAddFolder">${ICON.folderOpen} Browse…</button>
              ${S.lastDir ? `<button class="btn small" id="dAddLast" title="${esc(S.lastDir)}">+ ${esc(baseName(S.lastDir))}</button>` : ''}
              ${(S.roots ? S.roots.drives : []).map((d) => `<button class="btn small ghost" data-adddrive="${esc(d.path)}">+ ${esc(d.name)}</button>`).join('')}
              <input class="input" id="dPathInput" placeholder="…or paste a folder path and press Enter" style="flex:1;min-width:220px;height:26px" spellcheck="false">
            </div></div>
          <label>Match files by</label>
          <div class="rowc"><div class="seg" id="dMode">
            <button data-mode="content" class="${c.mode === 'content' ? 'on' : ''}">Content (exact)</button>
            <button data-mode="namesize" class="${c.mode === 'namesize' ? 'on' : ''}">Name + size</button>
            <button data-mode="name" class="${c.mode === 'name' ? 'on' : ''}">Name only</button></div>
            <span class="hint" id="dModeHint"></span></div>
          <label>File size</label>
          <div class="rowc">at least <input class="input" type="number" min="0" id="dMin" value="${esc(c.minSize)}" style="width:90px">
            <select class="input" id="dMinU">${Object.keys(UNITS).map((u) => `<option ${u === c.minUnit ? 'selected' : ''}>${u}</option>`).join('')}</select>
            &nbsp; at most <input class="input" type="number" min="0" id="dMax" value="${esc(c.maxSize)}" placeholder="no limit" style="width:100px">
            <select class="input" id="dMaxU">${Object.keys(UNITS).map((u) => `<option ${u === c.maxUnit ? 'selected' : ''}>${u}</option>`).join('')}</select></div>
          <label>File types</label>
          <div class="rowc"><select class="input" id="dTypes">${Object.entries(TYPE_PRESETS).map(([k, v]) => `<option value="${k}" ${k === c.types ? 'selected' : ''}>${v}</option>`).join('')}</select>
            <input class="input" id="dExt" placeholder="e.g. jpg, png, mp4" value="${esc(c.customExt)}" style="flex:1;min-width:180px" ${c.types === 'custom' ? '' : 'hidden'}></div>
          <label>Skip folders named</label>
          <div class="rowc"><input class="input" id="dExclude" value="${esc(c.exclude)}" style="flex:1" spellcheck="false" placeholder="comma separated, e.g. node_modules, .git">
            <label class="check"><input type="checkbox" id="dHidden" ${c.includeHidden ? 'checked' : ''}> Include hidden &amp; system folders</label></div>
        </div>
        <div class="setup-actions"><span class="hint" id="dSetupHint"></span><button class="btn primary" id="dStart">${ICON.search} Start scan</button></div>
      </div>
      <div id="dProgress"></div>
      <div id="dResults"></div></div>`;
    this.bindSetup();
    this.renderRoots(); this.modeHint();
    if (!st.restored && st.scanId && !st.info) {
      st.restored = true;
      try { st.info = await api('scan/' + st.scanId); if (st.info.status === 'running') this.poll(); else if (st.info.status === 'done') await this.fetchResult(); }
      catch { st.scanId = null; save('dupScan', null); }
    }
    this.renderProgress(); this.renderResults();
  },

  bindSetup() {
    const st = this.state; const c = st.cfg; const root = $('#dSetup');
    const addRoot = (p) => {
      if (!p) return;
      if (c.roots.some((r) => isUnder(p, r))) return toast('That folder is already covered by the scan list');
      c.roots = c.roots.filter((r) => !isUnder(r, p)); c.roots.push(p);
      this.saveCfg(); this.renderRoots();
    };
    $('#dAddFolder').onclick = async () => addRoot(await pickFolder('Add a folder to scan'));
    if ($('#dAddLast')) $('#dAddLast').onclick = () => addRoot(S.lastDir);
    $$('[data-adddrive]', root).forEach((b) => { b.onclick = () => addRoot(b.dataset.adddrive); });
    $('#dPathInput').addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter') return;
      const v = e.target.value.trim().replace(/^"|"$/g, ''); if (!v) return;
      try { const r = await api('list?path=' + enc(v)); addRoot(r.path); e.target.value = ''; } catch (err) { toast(err.message, 'err'); }
    });
    $('#dRoots').onclick = (e) => { const b = e.target.closest('[data-rm]'); if (!b) return; c.roots.splice(+b.dataset.rm, 1); this.saveCfg(); this.renderRoots(); };
    $('#dMode').onclick = (e) => { const b = e.target.closest('[data-mode]'); if (!b) return; c.mode = b.dataset.mode; $$('#dMode button').forEach((x) => x.classList.toggle('on', x === b)); this.saveCfg(); this.modeHint(); };
    const bindVal = (id, key, ev = 'change') => { $(id).addEventListener(ev, (e) => { c[key] = e.target.type === 'checkbox' ? e.target.checked : e.target.value; this.saveCfg(); }); };
    bindVal('#dMin', 'minSize', 'input'); bindVal('#dMinU', 'minUnit'); bindVal('#dMax', 'maxSize', 'input'); bindVal('#dMaxU', 'maxUnit');
    bindVal('#dExt', 'customExt', 'input'); bindVal('#dExclude', 'exclude', 'input'); bindVal('#dHidden', 'includeHidden');
    $('#dTypes').onchange = (e) => { c.types = e.target.value; $('#dExt').hidden = c.types !== 'custom'; this.saveCfg(); };
    $('#dStart').onclick = () => this.start();
  },
  modeHint() {
    const m = this.state.cfg.mode;
    $('#dModeHint').textContent = m === 'content' ? 'Safest — byte-for-byte identical files only.' : m === 'namesize' ? 'Fast — same name and size, content not verified.' : 'Same file name, any size — review carefully.';
  },
  renderRoots() {
    const c = this.state.cfg; const el = $('#dRoots'); if (!el) return;
    el.innerHTML = c.roots.length ? c.roots.map((r, i) => `<span class="chip" title="${esc(r)}">${FOLDER_SVG.replace('<svg', '<svg style="stroke:none"')}<span>${esc(r)}</span><button data-rm="${i}" title="Remove">${ICON.x}</button></span>`).join('') : '<span class="muted">No folders yet — add one or more folders or drives below.</span>';
    const running = this.state.info && this.state.info.status === 'running';
    $('#dStart').disabled = !c.roots.length || running;
  },

  async start() {
    const st = this.state; const c = st.cfg;
    if (!c.roots.length) return toast('Add at least one folder to scan', 'err');
    let exts = [];
    if (c.types === 'custom') exts = c.customExt.split(/[\s,;]+/).filter(Boolean);
    else if (c.types !== 'all') exts = CAT[c.types].split(' ');
    if (c.types === 'custom' && !exts.length) return toast('Enter at least one file extension', 'err');
    const body = {
      roots: c.roots, mode: c.mode, exts, includeHidden: c.includeHidden,
      minSize: Math.round((Number(c.minSize) || 0) * UNITS[c.minUnit]),
      maxSize: c.maxSize === '' || c.maxSize == null ? 0 : Math.round(Number(c.maxSize) * UNITS[c.maxUnit]),
      exclude: c.exclude.split(',').map((x) => x.trim()).filter(Boolean),
    };
    try {
      st.info = await api('scan', body);
      st.scanId = st.info.id; save('dupScan', st.scanId);
      st.groups = []; st.marked.clear(); st.freed = 0; st.removed = 0; st.view.limit = 40; st.mode = c.mode;
      this.renderRoots(); this.renderProgress(); this.renderResults(); renderNav();
      this.poll();
    } catch (e) { toast(e.message, 'err'); }
  },
  async cancel() { const st = this.state; if (st.scanId) await api(`scan/${st.scanId}/cancel`, {}).catch(() => {}); },
  poll() {
    const st = this.state; clearTimeout(st.timer);
    const tick = async () => {
      try { st.info = await api('scan/' + st.scanId); } catch (e) { st.info = { status: 'error', error: e.message, phase: 'Failed' }; }
      this.renderProgress();
      if (st.info.status === 'running') { st.timer = setTimeout(tick, 400); return; }
      if (st.info.status === 'done') { await this.fetchResult(); toast(`Scan complete — ${fmtNum(st.groups.length)} duplicate group(s) found`, 'ok'); }
      else if (st.info.status === 'cancelled') toast('Scan cancelled');
      else toast(st.info.error || 'Scan failed', 'err');
      this.renderRoots(); this.renderProgress(); this.renderResults(); renderNav();
    };
    st.timer = setTimeout(tick, 300);
  },
  async fetchResult() {
    const st = this.state;
    const r = await api(`scan/${st.scanId}/result`);
    st.info = r; st.groups = r.groups; st.mode = r.opts.mode; st.marked.clear();
    // the scan may be old: drop anything deleted since
    renderNav();
  },

  renderProgress() {
    const el = $('#dProgress'); if (!el) return;
    const i = this.state.info;
    if (!i || i.status !== 'running') { el.innerHTML = ''; return; }
    let pct = null; let detail = '';
    if (i.phase === 'Comparing file samples' && i.candidates) { pct = (i.checked / i.candidates) * 100; detail = `${fmtNum(i.checked)} / ${fmtNum(i.candidates)} candidate files`; }
    else if (i.phase === 'Hashing full content' && i.hashBytesTotal) { pct = (i.hashBytesDone / i.hashBytesTotal) * 100; detail = `${fmtSize(i.hashBytesDone)} / ${fmtSize(i.hashBytesTotal)} hashed`; }
    el.innerHTML = `<div class="card progress">
      <div style="display:flex;align-items:center;gap:10px"><div class="phase"><span class="spinner"></span>${esc(i.phase)}…</div><span class="hint">${detail}</span><span class="spacer"></span>
        <span class="hint">${fmtDuration(Date.now() - i.startedAt)}</span><button class="btn small" id="dCancel">Cancel</button></div>
      <div class="pbar ${pct == null ? 'indet' : ''}"><i style="width:${pct == null ? 30 : pct.toFixed(1)}%"></i></div>
      <div class="pstats"><span><b>${fmtNum(i.dirs)}</b> folders</span><span><b>${fmtNum(i.files)}</b> files matched filters</span><span><b>${fmtSize(i.bytes)}</b> total</span>${i.candidates ? `<span><b>${fmtNum(i.candidates)}</b> same-size candidates</span>` : ''}${i.errors ? `<span>${fmtNum(i.errors)} unreadable</span>` : ''}</div>
      <div class="pcur">${esc(i.current || '')}</div></div>`;
    $('#dCancel').onclick = () => this.cancel();
  },

  filtered() {
    const v = this.state.view; const q = v.q.trim().toLowerCase();
    const gs = this.state.groups.filter((g) => (v.type === 'all' || catOf(g.files[0].name) === v.type) && (!q || g.files.some((f) => f.path.toLowerCase().includes(q))));
    const coll = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
    const cmp = {
      wasted: (a, b) => b.wasted - a.wasted, size: (a, b) => b.size - a.size, count: (a, b) => b.files.length - a.files.length,
      name: (a, b) => coll.compare(a.files[0].name, b.files[0].name), path: (a, b) => coll.compare(a.files[0].path, b.files[0].path),
    }[v.sort];
    return gs.sort(cmp);
  },

  renderResults() {
    const el = $('#dResults'); if (!el) return;
    const st = this.state; const i = st.info;
    if (!i || i.status !== 'done') {
      el.innerHTML = i && i.status === 'error' ? `<div class="card" style="color:var(--danger)">Scan failed: ${esc(i.error)}</div>` : i && i.status === 'cancelled' ? '<div class="card hint">The last scan was cancelled.</div>' : '';
      return;
    }
    const wasted = st.groups.reduce((a, g) => a + g.wasted, 0);
    const dupFiles = st.groups.reduce((a, g) => a + g.files.length - 1, 0);
    const exact = st.mode === 'content';
    const scannedRoots = (i.opts && i.opts.roots) || [];
    if (!st.groups.length) {
      el.innerHTML = `<div class="summary">${this.statsHtml(0, 0, 0, i)}</div><div class="card empty" style="padding:40px">${ICON.keep}<div style="font-size:15px;color:var(--text)">${st.removed ? 'All duplicates handled!' : 'No duplicates found.'}</div><div>${st.removed ? `You removed ${fmtNum(st.removed)} file(s) and freed ${fmtSize(st.freed)}.` : `Scanned ${fmtNum(i.files)} files in ${esc(scannedRoots.join(', '))}.`}</div></div>`;
      return;
    }
    const list = this.filtered();
    const v = st.view;
    el.innerHTML = `
      <div class="summary">${this.statsHtml(st.groups.length, dupFiles, wasted, i)}</div>
      ${exact ? '' : '<div class="card" style="border-color:var(--warn);color:var(--text)"><b>Heads up:</b> these groups were matched by name' + (st.mode === 'namesize' ? ' and size' : '') + ', not by content. Files may differ — preview before removing.</div>'}
      <div class="dtoolbar">
        <div class="menu-btn"><button class="btn primary small" id="dAuto">${ICON.wand} Auto-select ▾</button></div>
        <button class="btn small" id="dClear">Clear selection</button>
        <span class="sep"></span>
        <input class="input" id="dFilter" placeholder="Filter by path or name…" value="${esc(v.q)}" style="width:220px" spellcheck="false">
        <select class="input" id="dType">${[['all', 'All types'], ['image', 'Images'], ['video', 'Videos'], ['audio', 'Audio'], ['doc', 'Documents'], ['archive', 'Archives'], ['code', 'Code & text'], ['exe', 'Programs'], ['other', 'Other']].map(([k, l]) => `<option value="${k}" ${k === v.type ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <select class="input" id="dSort">${[['wasted', 'Sort: wasted space'], ['size', 'Sort: file size'], ['count', 'Sort: number of copies'], ['name', 'Sort: name'], ['path', 'Sort: path']].map(([k, l]) => `<option value="${k}" ${k === v.sort ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <span class="spacer"></span>
        <span class="hint">${fmtNum(list.length)} of ${fmtNum(st.groups.length)} groups</span>
        <button class="btn small" id="dCsv" title="Export results as CSV">${ICON.csv} CSV</button>
        <button class="btn small" id="dRescan" title="Run the same scan again">Rescan</button>
      </div>
      <div class="selbar" id="dSelbar"></div>
      <div id="dGroups">${list.slice(0, v.limit).map((g) => this.groupHtml(g)).join('')}</div>
      ${list.length > v.limit ? `<div class="more"><button class="btn" id="dMore">Show ${fmtNum(Math.min(100, list.length - v.limit))} more groups (${fmtNum(list.length - v.limit)} hidden)</button></div>` : ''}`;
    this.updateSelbar();
    this.bindResults(list);
  },
  statsHtml(groups, dupFiles, wasted, i) {
    const took = i.finishedAt && i.startedAt ? fmtDuration(i.finishedAt - i.startedAt) : '';
    return `<div class="stat hl"><div class="v">${fmtSize(wasted)}</div><div class="l">reclaimable space</div></div>
      <div class="stat"><div class="v">${fmtNum(groups)}</div><div class="l">duplicate groups</div></div>
      <div class="stat"><div class="v">${fmtNum(dupFiles)}</div><div class="l">extra copies</div></div>
      <div class="stat"><div class="v">${fmtNum(i.files)}</div><div class="l">files scanned${took ? ` in ${took}` : ''}</div></div>
      ${this.state.freed ? `<div class="stat"><div class="v" style="color:var(--ok)">${fmtSize(this.state.freed)}</div><div class="l">freed this session</div></div>` : ''}`;
  },
  groupHtml(g) {
    const st = this.state; const f0 = g.files[0]; const ext = extOf(f0.name);
    const thumb = IMG_PREVIEW.has(ext) && g.size < 40e6 ? `<img loading="lazy" decoding="async" src="${fileUrl(f0.path)}" alt="">` : fileSvg(f0.name);
    const names = new Set(g.files.map((f) => f.name.toLowerCase()));
    const markedN = g.files.filter((f) => st.marked.has(f.path)).length;
    return `<div class="dgroup" data-g="${g.id}">
      <div class="dg-head"><div class="dg-thumb" data-pv="${esc(f0.path)}" title="Preview">${thumb}</div>
        <div class="dg-title"><div class="n">${esc(f0.name)}${names.size > 1 ? ` <span class="hint">+${names.size - 1} other name${names.size > 2 ? 's' : ''}</span>` : ''}</div>
          <div class="m">${g.files.length} copies · ${fmtSize(g.size)} each · <span class="w">${fmtSize(g.wasted)} wasted</span>${markedN ? ` · ${markedN} selected` : ''}</div></div>
        <button class="btn small ghost" data-gact="keepfirst" title="Keep the first file, select the rest">Select all but first</button>
        <button class="btn small ghost" data-gact="none">Unselect</button></div>
      <div class="dg-files">${g.files.map((f) => this.fileHtml(f)).join('')}</div></div>`;
  },
  fileHtml(f) {
    const m = this.state.marked.has(f.path);
    const sep = SEP();
    return `<label class="dfile ${m ? 'marked' : ''}" data-path="${esc(f.path)}">
      <input type="checkbox" ${m ? 'checked' : ''} title="Select for removal">
      <span class="dpath" title="${esc(f.path)}"><span class="dd">&lrm;${esc(f.dir.endsWith(sep) ? f.dir.slice(0, -1) : f.dir)}&lrm;</span><span class="dn">${esc(sep + f.name)}</span></span>
      <span class="dt" title="Modified">${fmtDate(f.mtime)}</span>
      <span class="ds">${fmtSize(f.size)}</span>
      <span class="badge ${m ? 'del' : 'keep'}">${m ? 'Remove' : 'Keep'}</span>
      <span class="acts">
        <button type="button" data-fact="preview" title="Preview">${ICON.eye}</button>
        <button type="button" data-fact="open" title="Open file">${ICON.open}</button>
        <button type="button" data-fact="goto" title="Show in Open Explorer">${ICON.goto}</button>
        <button type="button" data-fact="reveal" title="Show in Windows Explorer">${ICON.reveal}</button>
        <button type="button" data-fact="only" title="Keep only this copy (select all others in group)">${ICON.keep}</button>
      </span></label>`;
  },
  groupOf(path) { return this.state.groups.find((g) => g.files.some((f) => f.path === path)); },
  refreshGroup(g) {
    const el = $(`.dgroup[data-g="${g.id}"]`);
    if (el) el.outerHTML = this.groupHtml(g);
    this.updateSelbar();
  },
  updateSelbar() {
    const el = $('#dSelbar'); if (!el) return;
    const st = this.state;
    const paths = [...st.marked];
    const size = paths.reduce((a, p) => { const g = this.groupOf(p); const f = g && g.files.find((x) => x.path === p); return a + (f ? f.size : 0); }, 0);
    el.classList.toggle('empty-sel', !paths.length);
    el.innerHTML = paths.length
      ? `<span><b>${fmtNum(paths.length)}</b> file(s) selected · <b>${fmtSize(size)}</b></span><span class="spacer"></span>
         <button class="btn small primary" data-sact="recycle">${ICON.trash} Move to Recycle Bin</button>
         <button class="btn small" data-sact="move">${ICON.move} Move to folder…</button>
         ${st.mode === 'content' ? `<button class="btn small" data-sact="link" title="Replace each selected copy with a hard link to the kept file. Frees the space while keeping every path working (same drive only).">${ICON.link} Replace with hard links</button>` : ''}
         <button class="btn small danger" data-sact="delete">Delete permanently</button>`
      : '<span>Tick the copies you want to remove, or use <b>Auto-select</b> to pick them for you. At least one file in every group is always kept.</span>';
  },

  bindResults(list) {
    const st = this.state;
    const rerender = () => { this.renderResults(); };
    $('#dFilter').addEventListener('input', debounce((e) => { st.view.q = e.target.value; st.view.limit = 40; rerender(); setTimeout(() => { const f = $('#dFilter'); if (f) { f.focus(); f.setSelectionRange(f.value.length, f.value.length); } }, 0); }, 250));
    $('#dType').onchange = (e) => { st.view.type = e.target.value; st.view.limit = 40; rerender(); };
    $('#dSort').onchange = (e) => { st.view.sort = e.target.value; rerender(); };
    $('#dClear').onclick = () => { st.marked.clear(); rerender(); };
    $('#dCsv').onclick = () => this.exportCsv();
    $('#dRescan').onclick = () => { if (st.info && st.info.opts) { st.cfg.roots = st.info.opts.roots; this.saveCfg(); this.render().then(() => this.start()); } else this.start(); };
    if ($('#dMore')) $('#dMore').onclick = () => { st.view.limit += 100; rerender(); };
    $('#dAuto').onclick = (e) => { e.stopPropagation(); this.autoMenu(e.currentTarget, list); };
    $('#dSelbar').onclick = (e) => { const b = e.target.closest('[data-sact]'); if (b) this.action(b.dataset.sact); };

    const groupsEl = $('#dGroups');
    groupsEl.addEventListener('click', (e) => {
      const gact = e.target.closest('[data-gact]');
      if (gact) {
        const g = st.groups.find((x) => x.id === +gact.closest('.dgroup').dataset.g);
        g.files.forEach((f, idx) => { if (gact.dataset.gact === 'keepfirst' && idx > 0) st.marked.add(f.path); else st.marked.delete(f.path); });
        this.refreshGroup(g); return;
      }
      const pv = e.target.closest('[data-pv]');
      if (pv) { const g = this.groupOf(pv.dataset.pv); const f = g.files[0]; this.preview(f); return; }
      const fact = e.target.closest('[data-fact]');
      const row = e.target.closest('.dfile');
      if (!row) return;
      const p = row.dataset.path; const g = this.groupOf(p); if (!g) return;
      const f = g.files.find((x) => x.path === p);
      if (fact) {
        e.preventDefault();
        const a = fact.dataset.fact;
        if (a === 'open') openItem({ ...f, dir: false });
        else if (a === 'reveal') revealItem(p);
        else if (a === 'goto') go({ type: 'dir', path: f.dir, select: p });
        else if (a === 'preview') this.preview(f);
        else if (a === 'only') { g.files.forEach((x) => (x.path === p ? st.marked.delete(x.path) : st.marked.add(x.path))); this.refreshGroup(g); this.preview(f); }
        return;
      }
      if (e.target.tagName !== 'INPUT') return; // label click forwards to the checkbox; handle once
      const cb = e.target;
      if (cb.checked) {
        const others = g.files.filter((x) => x.path !== p && !st.marked.has(x.path));
        if (!others.length) { cb.checked = false; toast('At least one copy in each group must be kept', 'err'); return; }
        st.marked.add(p);
      } else st.marked.delete(p);
      this.refreshGroup(g);
      this.preview(f);
    });
  },
  preview(f) { if (S.preview) renderPreview({ ...f, dir: false }); },

  autoMenu(anchor, list) {
    hideMenu();
    const st = this.state;
    const strategies = [
      ['newest', 'Keep the newest copy', 'Select everything except the most recently modified file'],
      ['oldest', 'Keep the oldest copy', 'Select everything except the earliest modified file (usually the original)'],
      ['shortest', 'Keep the shortest path', 'Keep the copy closest to the drive root'],
      ['longest', 'Keep the longest path', 'Keep the most deeply nested copy'],
      ['first', 'Keep the first copy (A→Z by path)', 'Simple, predictable choice'],
      ['infolder', 'Keep copies inside a folder…', 'Prefer copies in a folder you choose; groups without one are left unchanged'],
      ['fromfolder', 'Remove copies inside a folder…', 'Select copies in a folder you choose (always keeps one per group)'],
      ['copyname', 'Remove copies named like “(1)”, “- Copy”', 'Select files whose names look like copies, keeping an original'],
    ];
    const dd = document.createElement('div');
    dd.className = 'dropdown';
    dd.innerHTML = `<div class="hint" style="padding:6px 10px">Applies to the ${fmtNum(list.length)} group(s) currently shown</div>` + strategies.map(([k, l, sm]) => `<div class="ctx-item" data-k="${k}"><span>${esc(l)}</span><small>${esc(sm)}</small></div>`).join('');
    anchor.parentElement.appendChild(dd);
    dd.onclick = async (e) => {
      const it = e.target.closest('[data-k]'); if (!it) return;
      e.stopPropagation(); dd.remove();
      const k = it.dataset.k;
      let folder = null;
      if (k === 'infolder' || k === 'fromfolder') { folder = await pickFolder(k === 'infolder' ? 'Keep copies inside this folder' : 'Remove copies inside this folder', st.info.opts.roots[0]); if (!folder) return; }
      let touched = 0;
      for (const g of list) {
        let keep = null; const fs = g.files;
        const pickBy = (fn) => fs.reduce((a, b) => (fn(b, a) ? b : a));
        if (k === 'newest') keep = [pickBy((b, a) => b.mtime > a.mtime)];
        else if (k === 'oldest') keep = [pickBy((b, a) => b.mtime < a.mtime)];
        else if (k === 'shortest') keep = [pickBy((b, a) => b.path.length < a.path.length)];
        else if (k === 'longest') keep = [pickBy((b, a) => b.path.length > a.path.length)];
        else if (k === 'first') keep = [[...fs].sort((a, b) => a.path.localeCompare(b.path))[0]];
        else if (k === 'infolder') { const inside = fs.filter((f) => isUnder(f.path, folder)); if (!inside.length) continue; keep = [inside[0]]; }
        else if (k === 'fromfolder') {
          const inside = fs.filter((f) => isUnder(f.path, folder)); if (!inside.length) continue;
          const outside = fs.filter((f) => !isUnder(f.path, folder));
          keep = outside.length ? outside : [inside[0]];
          // keep files outside unless already marked — only add marks inside the folder
          inside.forEach((f) => { if (!keep.includes(f)) st.marked.add(f.path); });
          if (!outside.length) st.marked.delete(inside[0].path);
          touched++; continue;
        } else if (k === 'copyname') {
          const re = /(\s*\(\d+\)|\s*-\s*copy(\s*\(\d+\))?|\s+copy(\s+\d+)?|_copy\d*|\s*-\s*kopie|\s*\[\d+\])(\.[^.]+)?$/i;
          const looksCopy = (f) => re.test(f.name);
          const originals = fs.filter((f) => !looksCopy(f));
          const copies = fs.filter(looksCopy);
          if (!copies.length) continue;
          keep = originals.length ? originals : [copies[0]];
          fs.forEach((f) => { if (keep.includes(f)) st.marked.delete(f.path); else st.marked.add(f.path); });
          touched++; continue;
        }
        fs.forEach((f) => { if (keep.includes(f)) st.marked.delete(f.path); else st.marked.add(f.path); });
        touched++;
      }
      toast(`Auto-selected in ${fmtNum(touched)} group(s)`, 'ok');
      this.renderResults();
    };
  },

  checkSafe(paths) {
    const set = new Set(paths);
    const bad = this.state.groups.filter((g) => g.files.length && g.files.every((f) => set.has(f.path)));
    if (bad.length) { toast(`${bad.length} group(s) have every copy selected — keep at least one per group`, 'err', 6000); return false; }
    return true;
  },
  sizeOf(paths) { return paths.reduce((a, p) => { const g = this.groupOf(p); const f = g && g.files.find((x) => x.path === p); return a + (f ? f.size : 0); }, 0); },

  async action(kind) {
    const st = this.state;
    const paths = [...st.marked];
    if (!paths.length || !this.checkSafe(paths)) return;
    const size = this.sizeOf(paths);
    let done = [];
    if (kind === 'recycle' || kind === 'delete') {
      const permanent = kind === 'delete';
      const ok = await confirmDlg({
        title: permanent ? 'Delete permanently?' : 'Move duplicates to Recycle Bin?',
        message: `${permanent ? 'Permanently delete' : 'Move'} <b>${fmtNum(paths.length)}</b> file(s), <b>${fmtSize(size)}</b>${permanent ? '. <b>This cannot be undone.</b>' : ' to the Recycle Bin. You can restore them from there.'} One copy in every group is kept.`,
        list: paths, okText: permanent ? 'Delete permanently' : 'Move to Recycle Bin', danger: permanent,
      });
      if (!ok) return;
      try {
        const r = await withBusy(`${permanent ? 'Deleting' : 'Recycling'} ${fmtNum(paths.length)} file(s)…`, () => api('delete', { paths, permanent }));
        done = report(r.results, permanent ? 'deleted' : 'moved to the Recycle Bin');
      } catch (e) { return toast(e.message, 'err'); }
    } else if (kind === 'move') {
      const dest = await pickFolder(`Move ${fmtNum(paths.length)} selected file(s) to…`);
      if (!dest) return;
      try {
        const r = await withBusy(`Moving ${fmtNum(paths.length)} file(s)…`, () => api('move', { paths, dest }));
        done = report(r.results, 'moved');
      } catch (e) { return toast(e.message, 'err'); }
    } else if (kind === 'link') {
      const ok = await confirmDlg({
        title: 'Replace copies with hard links?',
        message: `Each of the <b>${fmtNum(paths.length)}</b> selected copies will be re-verified and replaced by a hard link to the kept file in its group. Every path keeps working, but all of them then share one copy on disk (<b>${fmtSize(size)}</b> freed). Editing one edits all. Only works for files on the same NTFS drive.`,
        okText: 'Replace with hard links',
      });
      if (!ok) return;
      const groups = st.groups.filter((g) => g.files.some((f) => st.marked.has(f.path)));
      const results = [];
      try {
        let n = 0;
        busy('Creating hard links…');
        for (const g of groups) {
          busy(`Creating hard links… group ${++n} of ${groups.length}`);
          const keep = g.files.find((f) => !st.marked.has(f.path));
          const targets = g.files.filter((f) => st.marked.has(f.path)).map((f) => f.path);
          const r = await api('hardlink', { keep: keep.path, paths: targets });
          results.push(...r.results);
        }
      } catch (e) { toast(e.message, 'err'); } finally { busy(null); }
      done = report(results, 'replaced with hard links');
    }
    if (!done.length) return;
    const freed = this.sizeOf(done);
    st.freed += freed; st.removed += done.length;
    this.forget(done);
    this.renderResults(); renderNav();
    if (S.preview) renderPreview(null);
  },

  exportCsv() {
    const rows = [['group', 'hash', 'size_bytes', 'path', 'modified', 'selected_for_removal']];
    for (const g of this.state.groups) for (const f of g.files) rows.push([g.id, g.key, f.size, f.path, new Date(f.mtime).toISOString(), this.state.marked.has(f.path) ? 'yes' : 'no']);
    const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }));
    a.download = `duplicates-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  },
};
function recalc(g) {
  g.total = g.files.reduce((a, f) => a + f.size, 0);
  g.wasted = g.files.length > 1 ? g.total - Math.max(...g.files.map((f) => f.size)) : 0;
}
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

// ============================================================ global events
function bindGlobal() {
  $('#btnBack').onclick = goBack; $('#btnFwd').onclick = goFwd; $('#btnUp').onclick = goUp; $('#btnRefresh').onclick = refresh;
  $('#commandbar').addEventListener('click', (e) => { const b = e.target.closest('.cmd'); if (b && !b.disabled) runCmd(b.dataset.cmd); });

  // address bar
  $('#address').addEventListener('click', (e) => {
    const cr = e.target.closest('.crumb');
    if (cr) {
      if (cr.dataset.pc) go({ type: 'pc' });
      else if (cr.dataset.dupes) go({ type: 'dupes' });
      else if (cr.dataset.path) go({ type: 'dir', path: cr.dataset.path });
      return;
    }
    if (e.target.closest('#addrInput')) return;
    editAddress();
  });
  const addr = $('#addrInput');
  addr.addEventListener('keydown', async (e) => {
    if (e.key === 'Escape') { endEditAddress(); return; }
    if (e.key !== 'Enter') return;
    const v = addr.value.trim().replace(/^"|"$/g, '');
    endEditAddress();
    if (!v || /^this pc$/i.test(v)) return go({ type: 'pc' });
    if (/^duplicate/i.test(v)) return go({ type: 'dupes' });
    try {
      const r = await api('stat?path=' + enc(v));
      if (r.error) throw new Error(`Cannot find “${v}”`);
      if (r.dir) go({ type: 'dir', path: r.path });
      else { const parent = r.path.slice(0, r.path.length - r.name.length - 1); go({ type: 'dir', path: parent.length < 3 ? parent + SEP() : parent, select: r.path }); }
    } catch (err) { toast(err.message.startsWith('Not found') ? `Windows can't find “${v}”` : err.message, 'err'); }
  });
  addr.addEventListener('blur', () => setTimeout(endEditAddress, 100));

  // search: type to filter, Enter to search subfolders
  const sInp = $('#searchInput');
  sInp.addEventListener('input', () => {
    if (S.loc.type === 'dir') { S.filter = sInp.value; renderList(); }
  });
  sInp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && sInp.value.trim()) {
      const base = S.loc.type === 'search' ? S.loc.path : currentDir();
      if (!base) return toast('Open a folder to search in', 'err');
      go({ type: 'search', path: base, q: sInp.value.trim() });
    } else if (e.key === 'Escape') { sInp.value = ''; if (S.loc.type === 'search') go({ type: 'dir', path: S.loc.path }); else if (S.loc.type === 'dir') { S.filter = ''; renderList(); } sInp.blur(); }
  });

  // nav pane
  const nav = $('#navpane');
  nav.addEventListener('click', (e) => {
    const it = e.target.closest('.nav-item'); if (!it) return;
    if (it.dataset.nav === 'dupes') go({ type: 'dupes' }); else if (it.dataset.nav === 'pc') go({ type: 'pc' }); else go({ type: 'dir', path: it.dataset.path });
  });
  nav.addEventListener('contextmenu', (e) => {
    const it = e.target.closest('.nav-item[data-path]'); if (!it) return;
    e.preventDefault();
    const p = it.dataset.path;
    showMenu(e.clientX, e.clientY, [
      { label: 'Open', icon: ICON.open, action: () => go({ type: 'dir', path: p }) },
      { label: 'Find duplicates here', icon: ICON.dupes, action: () => findDupesIn([p]) },
      { label: 'Open in Windows Explorer', icon: ICON.reveal, action: () => api('open', { path: p }) },
      { label: 'Copy path', icon: ICON.copy, action: () => copyText(p) },
    ]);
  });

  // main area (lists, PC cards)
  const main = $('#main');
  main.addEventListener('mousedown', (e) => {
    if (e.button === 3 || e.button === 4) return;
    const el = e.target.closest('[data-i]');
    if (!isDirView()) return;
    if (!el) {
      if (e.target.closest('.list-head')) return;
      if (e.target.closest('#listBody') || e.target === main) { if (!(e.ctrlKey || e.shiftKey)) { S.sel.clear(); S.focus = null; updateSelectionUI(); } }
      return;
    }
    if (e.target.closest('.rename-input')) return;
    const i = +el.dataset.i; const it = S.shown[i];
    if (e.button === 2) { if (!S.sel.has(it.path)) selectIndex(i); return; }
    if (S.sel.has(it.path) && !e.ctrlKey && !e.shiftKey && !e.metaKey) { S.pending = i; S.focus = it.path; return; }
    S.pending = -1; selectIndex(i, e);
  });
  main.addEventListener('click', (e) => {
    const el = e.target.closest('[data-i]');
    if (el && S.pending === +el.dataset.i) { selectIndex(S.pending); }
    S.pending = -1;
    const hd = e.target.closest('.list-head [data-sort]');
    if (hd) { const k = hd.dataset.sort; S.sort = { key: k, dir: S.sort.key === k ? -S.sort.dir : 1 }; save('sort', S.sort); renderList(); }
    const card = e.target.closest('.pc-card'); if (card) { $$('.pc-card').forEach((c) => c.style.background = ''); card.style.background = 'var(--sel)'; }
    const nv = e.target.closest('[data-nav]'); if (nv && nv.dataset.nav === 'dupes') go({ type: 'dupes' });
  });
  main.addEventListener('dblclick', (e) => {
    const card = e.target.closest('.pc-card'); if (card) return go({ type: 'dir', path: card.dataset.path });
    const el = e.target.closest('[data-i]'); if (!el || !isDirView()) return;
    openItem(S.shown[+el.dataset.i]);
  });
  main.addEventListener('contextmenu', (e) => {
    const card = e.target.closest('.pc-card');
    if (card) {
      e.preventDefault(); const p = card.dataset.path;
      return showMenu(e.clientX, e.clientY, [
        { label: 'Open', icon: ICON.open, action: () => go({ type: 'dir', path: p }) },
        { label: 'Find duplicates here', icon: ICON.dupes, action: () => findDupesIn([p]) },
        { label: 'Open in Windows Explorer', icon: ICON.reveal, action: () => api('open', { path: p }) },
      ]);
    }
    if (!isDirView()) return;
    e.preventDefault();
    const el = e.target.closest('[data-i]');
    if (el) itemMenu(e.clientX, e.clientY); else { S.sel.clear(); updateSelectionUI(); backgroundMenu(e.clientX, e.clientY); }
  });

  // drag & drop moves (Ctrl = copy)
  let dragPaths = null;
  main.addEventListener('dragstart', (e) => {
    const el = e.target.closest('[data-i]'); if (!el) return;
    const it = S.shown[+el.dataset.i];
    if (!S.sel.has(it.path)) { S.sel = new Set([it.path]); S.focus = it.path; updateSelectionUI(); }
    dragPaths = selectedItems().map((i) => i.path);
    e.dataTransfer.effectAllowed = 'copyMove';
    e.dataTransfer.setData('text/plain', dragPaths.join('\n'));
  });
  main.addEventListener('dragend', () => { dragPaths = null; $$('.drop').forEach((x) => x.classList.remove('drop')); });
  const dropTarget = (e) => {
    const row = e.target.closest('#main [data-i]');
    if (row) { const it = S.shown[+row.dataset.i]; return it && it.dir ? { el: row, path: it.path } : null; }
    const ni = e.target.closest('.nav-item[data-path], .crumb[data-path]');
    return ni ? { el: ni, path: ni.dataset.path } : null;
  };
  document.addEventListener('dragover', (e) => {
    if (!dragPaths) return;
    const t = dropTarget(e);
    $$('.drop').forEach((x) => { if (!t || x !== t.el) x.classList.remove('drop'); });
    if (!t || dragPaths.some((p) => samePath(p, t.path))) return;
    e.preventDefault(); e.dataTransfer.dropEffect = e.ctrlKey ? 'copy' : 'move'; t.el.classList.add('drop');
  });
  document.addEventListener('drop', async (e) => {
    if (!dragPaths) return;
    const t = dropTarget(e); const paths = dragPaths; dragPaths = null;
    $$('.drop').forEach((x) => x.classList.remove('drop'));
    if (!t) return;
    e.preventDefault();
    await transfer(paths, t.path, e.ctrlKey);
    loadDir();
  });

  // menus close
  document.addEventListener('mousedown', (e) => { if (!e.target.closest('#ctxmenu') && !e.target.closest('.dropdown')) hideMenu(); });
  window.addEventListener('blur', hideMenu);
  window.addEventListener('resize', hideMenu);
  document.addEventListener('mouseup', (e) => { if (e.button === 3) { e.preventDefault(); goBack(); } else if (e.button === 4) { e.preventDefault(); goFwd(); } });

  // keyboard
  document.addEventListener('keydown', (e) => {
    const tag = e.target.tagName;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    if (e.key === 'Escape') hideMenu();
    if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); return goBack(); }
    if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); return goFwd(); }
    if (e.altKey && e.key === 'ArrowUp') { e.preventDefault(); return goUp(); }
    if (e.key === 'F5' || (e.ctrlKey && e.key.toLowerCase() === 'r')) { e.preventDefault(); return refresh(); }
    if ((e.ctrlKey && e.key.toLowerCase() === 'l') || (e.altKey && e.key.toLowerCase() === 'd')) { e.preventDefault(); return editAddress(); }
    if ((e.ctrlKey && (e.key.toLowerCase() === 'f' || e.key.toLowerCase() === 'e')) || e.key === 'F3') { e.preventDefault(); $('#searchInput').focus(); $('#searchInput').select(); return; }
    if (e.altKey && e.key.toLowerCase() === 'p') { e.preventDefault(); return runCmd('preview'); }
    if (typing || !isDirView()) return;
    const n = S.shown.length; let f = focusIndex();
    const k = e.key;
    const cols = () => { const g = $('.tiles'); return g ? getComputedStyle(g).gridTemplateColumns.split(' ').length : 1; };
    const step = { ArrowDown: S.layout === 'tiles' ? cols() : 1, ArrowUp: S.layout === 'tiles' ? -cols() : -1, ArrowRight: S.layout === 'tiles' ? 1 : 0, ArrowLeft: S.layout === 'tiles' ? -1 : 0, PageDown: 15, PageUp: -15 }[k];
    if (step !== undefined && n) {
      e.preventDefault(); if (!step) return;
      const next = f < 0 ? 0 : Math.max(0, Math.min(n - 1, f + step));
      if (e.shiftKey) { if (S.anchor < 0) S.anchor = Math.max(0, f); selectIndex(next, { shiftKey: true }); }
      else if (e.ctrlKey) { S.focus = S.shown[next].path; updateSelectionUI(); $(`#main [data-i="${next}"]`)?.scrollIntoView({ block: 'nearest' }); }
      else selectIndex(next);
      return;
    }
    if (k === 'Home' && n) { e.preventDefault(); return selectIndex(0, e); }
    if (k === 'End' && n) { e.preventDefault(); return selectIndex(n - 1, e); }
    if (k === ' ' && e.ctrlKey && f >= 0) { e.preventDefault(); return selectIndex(f, { ctrlKey: true }); }
    if (k === 'Enter') { e.preventDefault(); const sel = selectedItems(); if (sel.length === 1) openItem(sel[0]); else sel.filter((i) => !i.dir).forEach(openItem); return; }
    if (k === 'Backspace') { e.preventDefault(); return goUp(); }
    if (k === 'Delete') { e.preventDefault(); return cmdDelete(e.shiftKey); }
    if (k === 'F2') { e.preventDefault(); return runCmd('rename'); }
    if (e.ctrlKey && e.shiftKey && k.toLowerCase() === 'n') { e.preventDefault(); return cmdNew('folder'); }
    if (e.ctrlKey && !e.shiftKey) {
      const kk = k.toLowerCase();
      if (kk === 'a') { e.preventDefault(); S.sel = new Set(S.shown.map((i) => i.path)); return updateSelectionUI(); }
      if (kk === 'c') { e.preventDefault(); return cmdClip('copy'); }
      if (kk === 'x') { e.preventDefault(); return cmdClip('cut'); }
      if (kk === 'v') { e.preventDefault(); return cmdPaste(); }
    }
    if (k === 'Escape') { S.sel.clear(); updateSelectionUI(); return; }
    // type-ahead to jump
    if (k.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey && n) {
      const now = Date.now();
      S.typeahead = now - S.typeaheadT > 900 ? k.toLowerCase() : S.typeahead + k.toLowerCase();
      S.typeaheadT = now;
      const start = S.typeahead.length === 1 ? f + 1 : Math.max(0, f);
      for (let j = 0; j < n; j++) { const idx = (start + j) % n; if (S.shown[idx].name.toLowerCase().startsWith(S.typeahead)) { selectIndex(idx); break; } }
    }
  });

  // splitters
  $$('.splitter').forEach((sp) => {
    sp.addEventListener('mousedown', (e) => {
      e.preventDefault(); sp.classList.add('drag');
      const which = sp.dataset.split; const pane = which === 'nav' ? $('#navpane') : $('#previewpane');
      const startX = e.clientX; const startW = pane.getBoundingClientRect().width;
      const move = (ev) => { const d = ev.clientX - startX; const w = Math.max(150, Math.min(700, which === 'nav' ? startW + d : startW - d)); pane.style.width = w + 'px'; };
      const up = () => { sp.classList.remove('drag'); document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); save(which + 'W', pane.getBoundingClientRect().width); };
      document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
    });
  });
}

// ============================================================ boot
(async function boot() {
  document.body.classList.toggle('no-preview', !S.preview);
  const nw = load('navW', null); if (nw) $('#navpane').style.width = nw + 'px';
  const pw = load('previewW', null); if (pw) $('#previewpane').style.width = pw + 'px';
  bindGlobal();
  await loadRoots();
  let start = null;
  try { start = JSON.parse(sessionStorage.getItem('oe.loc') || 'null'); } catch { /* ignore */ }
  go(start && start.type ? start : { type: 'pc' }, false);
  // drive labels load asynchronously on the server; refresh them once
  setTimeout(() => { loadRoots().then(() => { if (S.loc && S.loc.type === 'pc') renderPC(); renderCrumbs(); }); }, 2500);
})();
