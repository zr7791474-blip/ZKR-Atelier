// Contextual inspector — Select → understand → edit.
//
// One panel, four contexts, always driven by what the user is doing:
//   item    an object is selected      → real properties + edits + its clearance
//   issue   a collision/clearance marker (or list row) is selected
//   measure the measure tool is active → the measurements list
//   empty   nothing selected           → a short hint + a spatial-issue summary
//
// Everything shown is read from state the app already keeps (placed item,
// catalog entry, shared spatial analysis). Edits go through the app's own
// history-aware helpers (setItemPositionChecked / setItemRotationRad).
import { bus } from './bus.js';
import { ws, esc, fmtM, money, selectIssue, clearIssue, findIssue, issueKey } from './ws.js';
import { SEVERITY_LABEL, NON_FLOOR_TYPES, MIN_ACCESSIBLE_CLEARANCE } from './spatial-analysis.js';

const NON_FLOOR_NOTE = { pendant: 'Hangs from the ceiling — not a floor obstacle.', rug: 'Floor covering — not a floor obstacle.', painting: 'Wall-mounted — not a floor obstacle.' };
const WALL_NAME = { west: 'west', east: 'east', north: 'north', south: 'south' };
const $ = (id) => document.getElementById(id);

let rootEl, bodyEl, tagEl, sectionEl, sheetEl;
let lastKey = '';      // structural signature: rebuild the DOM only when this changes
let editable = true;

export function initInspector() {
  sectionEl = $('inspectorSection'); bodyEl = $('inspectorBody'); tagEl = $('inspectorContext');
  rootEl = sectionEl; sheetEl = $('inspectorSheet');
  if (!sectionEl) return;

  bodyEl.addEventListener('click', onClick);
  bodyEl.addEventListener('change', onChange);
  bodyEl.addEventListener('keydown', onKey);
  bodyEl.addEventListener('focusout', (e) => { if (e.target.matches?.('input[data-f]')) refreshFields(); });

  bus.on('selection', render);
  bus.on('itemchange', () => refreshFields());
  bus.on('layout', () => { render(); });
  bus.on('issue', render);
  bus.on('mode', render);
  bus.on('measure', render);
  bus.on('scale', render);

  // Tablet / phone: the inspector becomes a bottom sheet over the canvas
  // instead of living in a side drawer nobody has open while editing.
  const mq = window.matchMedia('(max-width: 900px)');
  const place = () => {
    if (mq.matches && sheetEl) sheetEl.querySelector('.inspector-sheet-body').appendChild(sectionEl);
    else { const panel = $('rightPanel'); panel.insertBefore(sectionEl, panel.querySelector('.rail-resizer')?.nextSibling || panel.firstChild); }
    render();
  };
  (mq.addEventListener ? mq.addEventListener('change', place) : mq.addListener(place));
  sheetEl?.querySelector('[data-sheet="toggle"]')?.addEventListener('click', () => sheetEl.classList.toggle('collapsed'));
  sheetEl?.querySelector('[data-sheet="close"]')?.addEventListener('click', () => { clearIssue(); ws.ctx.deselectActiveItem(); if (ws.ctx.measure?.active) ws.ctx.measure.toggle(false); });
  place();
}

function context() {
  const { state } = ws.ctx;
  if (state.cityScale !== 'interior') return 'hidden';
  if (ws.issueKey && findIssue(ws.issueKey)) return 'issue';
  if (state.activeItem) return 'item';
  if (ws.ctx.measure?.active) return 'measure';
  return 'empty';
}

// ---------- helpers ----------
const nameOf = (item) => item.name;
function ordinal(item) {
  const same = ws.ctx.state.placedItems.filter(i => i.type === item.type);
  return same.length > 1 ? `${same.indexOf(item) + 1} of ${same.length}` : null;
}
function itemById(id) { return ws.ctx.state.placedItems.find(i => i.id === id); }
function labelOf(item) { const o = ordinal(item); return o ? `${item.name} ${o.split(' ')[0]}` : item.name; }
function sevBadge(sev) { return `<span class="sev-badge sev-${sev}"><i></i>${SEVERITY_LABEL[sev]}</span>`; }
function degOf(item) { const d = (item.rotation * 180 / Math.PI) % 360; return ((d % 360) + 360) % 360; }
function categoryLabel(item) {
  const cat = ws.ctx.ITEM_CATALOG[item.type]?.cat;
  return ws.ctx.FURNITURE_CATEGORIES.find(c => c.key === cat)?.label || cat || '—';
}
function hasBrandFinish(item) { let f = false; item.mesh.traverse(c => { if (c.isMesh && c.userData.brand) f = true; }); return f; }
const distText = (c) => (c < 0 ? `overlap ${fmtM(-c)} m` : `${fmtM(c)} m`);

// ---------- render ----------
function render() {
  if (!bodyEl) return;
  const ctxName = context();
  sectionEl.hidden = ctxName === 'hidden';
  editable = ws.mode === 'design';
  const { state } = ws.ctx;
  let key = ctxName;
  if (ctxName === 'item') key += ':' + state.activeItem.id + ':' + editable;
  if (ctxName === 'issue') key += ':' + ws.issueKey;
  if (ctxName === 'empty') key += ':' + ws.mode;
  // Structure that depends on live analysis (issue lists) is re-rendered by the
  // builders below on every layout change, but field-only changes go through
  // refreshFields() so a focused input is never destroyed while typing.
  const sig = key + '|' + signature(ctxName);
  const tagText = { item: 'Object', issue: 'Issue', measure: 'Measure', empty: ws.mode === 'inspect' ? 'Inspection' : 'No selection' }[ctxName] || '';
  tagEl.textContent = tagText;
  sectionEl.dataset.context = ctxName;
  ws.ctx.rightPanel?.classList.toggle('has-context', ctxName === 'item' || ctxName === 'issue' || ctxName === 'measure');
  updateSheet(ctxName);
  if (sig === lastKey) { refreshFields(); return; }
  lastKey = sig;
  if (ctxName === 'item') bodyEl.innerHTML = buildItem(state.activeItem);
  else if (ctxName === 'issue') bodyEl.innerHTML = buildIssue(findIssue(ws.issueKey));
  else if (ctxName === 'measure') bodyEl.innerHTML = buildMeasure();
  else if (ctxName === 'empty') bodyEl.innerHTML = buildEmpty();
  else bodyEl.innerHTML = '';
  refreshFields();
  if (ctxName !== 'empty' && ws.ctx.rightPanel && !window.matchMedia('(max-width: 900px)').matches) ws.ctx.rightPanel.scrollTo?.({ top: 0, behavior: 'smooth' });
}
// What must trigger a DOM rebuild beyond the context key.
function signature(ctxName) {
  const a = ws.ctx.state.analysis;
  if (ctxName === 'empty') return a ? `${a.counts.collision}/${a.counts.critical}/${a.counts.warning}/${ws.ctx.state.placedItems.length}` : '';
  if (ctxName === 'item') {
    const rec = a?.perItem.get(ws.ctx.state.activeItem.id);
    return rec ? `${rec.worst}:${rec.pairs.map(p => issueKey(p) + Math.round(p.clearance * 100)).join(',')}:${rec.wallIssue ? Math.round(rec.wallIssue.clearance * 100) : ''}` : 'x';
  }
  if (ctxName === 'issue') { const r = findIssue(ws.issueKey); return r ? Math.round(r.clearance * 1000) : ''; }
  if (ctxName === 'measure') return ws.ctx.measure.list().map(m => m.id + ':' + m.dist.toFixed(3)).join(',') + ':' + ws.ctx.measure.pending();
  return '';
}
function updateSheet(ctxName) {
  if (!sheetEl) return;
  const show = ctxName === 'item' || ctxName === 'issue' || ctxName === 'measure';
  sheetEl.classList.toggle('show', show);
  if (show) {
    const title = ctxName === 'item' ? ws.ctx.state.activeItem.name : ctxName === 'issue' ? 'Spatial issue' : 'Measurements';
    sheetEl.querySelector('.inspector-sheet-title').textContent = title;
  }
}

// ---------- builders ----------
function buildItem(item) {
  const cat = ws.ctx.ITEM_CATALOG[item.type];
  const ord = ordinal(item);
  const dims = item.dims;
  const total = ws.ctx.state.placedItems.reduce((s, i) => s + i.price, 0);
  const share = total > 0 ? (item.price / total) * 100 : 0;
  const ro = editable ? '' : ' readonly tabindex="-1"';
  const brand = hasBrandFinish(item);
  return `
  <div class="insp-head">
    <div class="insp-icon"><i class="fa-solid ${cat.icon}" aria-hidden="true"></i></div>
    <div class="insp-head-text">
      <div class="insp-name">${esc(nameOf(item))}</div>
      <div class="insp-sub">${esc(categoryLabel(item))}${ord ? ' · ' + ord : ''}${item.seats ? ' · ' + item.seats + (item.seats > 1 ? ' seats' : ' seat') : ''}</div>
    </div>
    <button type="button" class="insp-icon-btn" data-act="focus" title="Focus camera on this object" aria-label="Focus camera on this object"><i class="fa-solid fa-crosshairs" aria-hidden="true"></i></button>
  </div>

  <div class="insp-group">
    <div class="insp-group-title">Position &amp; rotation ${editable ? '' : '<span class="insp-ro">read-only in Inspect</span>'}</div>
    <div class="insp-grid">
      <label class="insp-field"><span>X</span><input type="number" step="0.05" data-f="x" inputmode="decimal"${ro} aria-label="X position in metres"><em>m</em></label>
      <label class="insp-field"><span>Z</span><input type="number" step="0.05" data-f="z" inputmode="decimal"${ro} aria-label="Z position in metres"><em>m</em></label>
      <label class="insp-field insp-field--wide"><span>Rot</span><input type="number" step="5" data-f="rot" inputmode="decimal"${ro} aria-label="Rotation in degrees"><em>°</em>
        ${editable ? '<span class="insp-step"><button type="button" data-act="rot" data-d="-45" aria-label="Rotate 45 degrees left">−45</button><button type="button" data-act="rot" data-d="45" aria-label="Rotate 45 degrees right">+45</button></span>' : ''}
      </label>
    </div>
    <div class="insp-msg" data-f="msg" role="alert" hidden></div>
    <div class="insp-note">Origin is the room centre. Edits obey the same room and overlap rules as dragging, and can be undone.</div>
  </div>

  <div class="insp-group">
    <div class="insp-group-title">Dimensions</div>
    <div class="insp-rows">
      <div class="insp-row"><span>Footprint</span><b class="mono">${dims ? `${fmtM(dims.w)} × ${fmtM(dims.d)} m` : '—'}</b></div>
      <div class="insp-row"><span>Height</span><b class="mono">${dims ? fmtM(dims.h) + ' m' : '—'}</b></div>
    </div>
  </div>

  <div class="insp-group">
    <div class="insp-group-title">Cost &amp; finish</div>
    <div class="insp-rows">
      <div class="insp-row"><span>Price</span><b class="mono">${item.price ? money(item.price) : 'Included'}</b></div>
      ${item.price ? `<div class="insp-row"><span>Share of furniture subtotal</span><b class="mono">${share.toFixed(1)}%</b></div>` : ''}
      ${brand ? `<div class="insp-row"><span>Finish</span><b class="insp-finish"><i style="background:${esc(ws.ctx.state.brandColor)}"></i>Project brand colour</b></div>` : ''}
    </div>
  </div>

  <div class="insp-group" data-slot="compliance">${buildCompliance(item)}</div>`;
}

function buildCompliance(item) {
  if (NON_FLOOR_TYPES.has(item.type)) {
    return `<div class="insp-group-title">Clearance</div><div class="insp-quiet">${esc(NON_FLOOR_NOTE[item.type] || 'Not checked.')}</div>`;
  }
  const rec = ws.ctx.state.analysis?.perItem.get(item.id);
  if (!rec) return '';
  const rows = [];
  rec.pairs.forEach(p => {
    const other = itemById(p.aId === item.id ? p.bId : p.aId);
    if (!other) return;
    rows.push(`<button type="button" class="insp-issue sev-${p.severity}" data-act="issue" data-key="${esc(issueKey(p))}">
      <i class="insp-dot"></i><span class="insp-issue-main">${p.severity === 'collision' ? 'Collides with' : 'Close to'} ${esc(labelOf(other))}</span>
      <b class="mono">${distText(p.clearance)}</b></button>`);
  });
  if (rec.wallIssue) {
    const w = rec.wallIssue;
    rows.push(`<button type="button" class="insp-issue sev-${w.severity}" data-act="issue" data-key="${esc(issueKey(w))}">
      <i class="insp-dot"></i><span class="insp-issue-main">${WALL_NAME[w.wall]} wall</span><b class="mono">${fmtM(w.clearance)} m</b></button>`);
  }
  const nearest = rec.nearest;
  const nearestLine = nearest && !rows.length
    ? `<div class="insp-row"><span>Nearest</span><b class="mono">${fmtM(nearest.clearance)} m ${nearest.other.startsWith?.('wall:') ? 'to ' + nearest.other.slice(5) + ' wall' : 'to ' + esc(labelOf(itemById(nearest.other) || { name: 'object' }))}</b></div>` : '';
  const wallLine = rec.wall?.againstWall ? `<div class="insp-row"><span>Boundary</span><b>Against wall</b></div>` : '';
  return `<div class="insp-group-title">Clearance ${sevBadge(rec.worst)}</div>
    ${rows.length ? `<div class="insp-issues">${rows.join('')}</div>` : `<div class="insp-quiet">${nearest ? `All clearances ≥ ${MIN_ACCESSIBLE_CLEARANCE.toFixed(2)} m.` : 'No neighbouring objects within range.'}</div>`}
    <div class="insp-rows">${nearestLine}${wallLine}</div>`;
}

function buildIssue(rec) {
  if (!rec) return '';
  const a = itemById(rec.aId != null ? rec.aId : rec.id);
  const b = rec.bId != null ? itemById(rec.bId) : null;
  const title = rec.severity === 'collision' ? 'Collision' : rec.severity === 'critical' ? 'Insufficient clearance' : 'Tight clearance';
  const pt = rec.point;
  const partner = b ? `<button type="button" class="insp-issue-obj" data-act="select" data-id="${b.id}"><i class="fa-solid ${ws.ctx.ITEM_CATALOG[b.type].icon}" aria-hidden="true"></i><span>${esc(labelOf(b))}</span><em>select</em></button>`
    : `<div class="insp-issue-obj insp-issue-obj--static"><i class="fa-solid fa-border-none" aria-hidden="true"></i><span>${esc(WALL_NAME[rec.wall])} room boundary</span></div>`;
  const guidance = rec.severity === 'collision'
    ? 'These footprints overlap or are closer than the 0.08 m placement buffer.'
    : `The gap is ${fmtM(rec.clearance)} m; the accessible minimum is ${MIN_ACCESSIBLE_CLEARANCE.toFixed(2)} m${rec.severity === 'critical' ? ' and this is below the pass/fail line of 0.50 m' : ''}.`;
  return `
  <div class="insp-issue-head sev-${rec.severity}">
    <i class="insp-dot"></i>
    <div><div class="insp-name">${title}</div><div class="insp-sub">${b ? 'Between two objects' : 'Object to room boundary'}</div></div>
  </div>
  <div class="insp-rows">
    <div class="insp-row"><span>${rec.clearance < 0 ? 'Overlap' : 'Gap'}</span><b class="mono">${fmtM(Math.abs(rec.clearance))} m</b></div>
    <div class="insp-row"><span>Location</span><b class="mono">x ${fmtM(pt.x)} · z ${fmtM(pt.z)}</b></div>
  </div>
  <div class="insp-group"><div class="insp-group-title">Involved</div>
    <button type="button" class="insp-issue-obj" data-act="select" data-id="${a?.id}"><i class="fa-solid ${a ? ws.ctx.ITEM_CATALOG[a.type].icon : 'fa-cube'}" aria-hidden="true"></i><span>${esc(a ? labelOf(a) : 'Object')}</span><em>select</em></button>
    ${partner}
  </div>
  <div class="insp-quiet">${guidance}</div>
  <div class="insp-actions">
    <button type="button" class="btn" data-act="issue-focus"><i class="fa-solid fa-crosshairs" aria-hidden="true"></i>Focus in scene</button>
    <button type="button" class="btn" data-act="issue-close">Dismiss</button>
  </div>`;
}

function buildMeasure() {
  const m = ws.ctx.measure;
  const list = m.list();
  const rows = list.map((x, i) => `<div class="insp-mrow sev-${x.status}">
      <i class="insp-dot"></i><span class="insp-issue-main">M${i + 1}</span><b class="mono">${fmtM(x.dist)} m</b>
      <button type="button" class="insp-icon-btn" data-act="m-del" data-id="${x.id}" aria-label="Delete measurement M${i + 1}"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button></div>`).join('');
  const pending = m.pending();
  return `
  <div class="insp-quiet">${pending ? 'Click the end point. <b>Esc</b> cancels this measurement.' : 'Click a start point on the floor. Points snap to object corners, edges and walls.'}</div>
  ${rows ? `<div class="insp-issues">${rows}</div>` : '<div class="insp-quiet insp-quiet--faint">No measurements yet.</div>'}
  <div class="insp-actions">
    ${list.length ? '<button type="button" class="btn" data-act="m-clear"><i class="fa-solid fa-eraser" aria-hidden="true"></i>Clear all</button>' : ''}
    <button type="button" class="btn btn-primary" data-act="m-done">Done</button>
  </div>`;
}

function buildEmpty() {
  const { state } = ws.ctx;
  const a = state.analysis;
  const n = state.placedItems.length;
  const c = a?.counts || { collision: 0, critical: 0, warning: 0 };
  const total = c.collision + c.critical + c.warning;
  const inspect = ws.mode === 'inspect';
  let html = '';
  if (!inspect) {
    html += `<div class="insp-empty">
      <i class="fa-solid fa-arrow-pointer" aria-hidden="true"></i>
      <div><b>Nothing selected</b><span>${n ? 'Click an object in the scene to inspect and edit it. Double-click to focus the camera.' : 'Pick a piece from the catalog and click the floor to place it.'}</span></div>
    </div>
    <div class="insp-hints"><span><kbd>Ctrl/⌘</kbd><kbd>K</kbd> commands</span><span><kbd>I</kbd> inspect</span><span><kbd>M</kbd> measure</span></div>`;
  }
  if (!n) return html;
  html += `<div class="insp-group"><div class="insp-group-title">Spatial issues <span class="insp-count">${total}</span></div>`;
  if (!total) {
    html += `<div class="insp-quiet">No collisions or tight clearances detected across ${a.evaluated} floor object${a.evaluated === 1 ? '' : 's'}.</div>`;
  } else {
    html += `<div class="insp-tally">
      ${c.collision ? `<span class="sev-collision"><i class="insp-dot"></i>${c.collision} collision${c.collision > 1 ? 's' : ''}</span>` : ''}
      ${c.critical ? `<span class="sev-critical"><i class="insp-dot"></i>${c.critical} insufficient</span>` : ''}
      ${c.warning ? `<span class="sev-warning"><i class="insp-dot"></i>${c.warning} tight</span>` : ''}</div>`;
    if (inspect) {
      const all = [...a.pairs.map(p => ({ p, kind: 'pair' })), ...a.walls.map(p => ({ p, kind: 'wall' }))].sort((x, y) => x.p.clearance - y.p.clearance);
      html += `<div class="insp-issues insp-issues--list">${all.slice(0, 60).map(({ p }) => {
        const A = itemById(p.aId ?? p.id), B = p.bId != null ? itemById(p.bId) : null;
        return `<button type="button" class="insp-issue sev-${p.severity}" data-act="issue" data-key="${esc(issueKey(p))}">
          <i class="insp-dot"></i><span class="insp-issue-main">${esc(A ? labelOf(A) : '?')} ↔ ${B ? esc(labelOf(B)) : esc(WALL_NAME[p.wall]) + ' wall'}</span><b class="mono">${distText(p.clearance)}</b></button>`;
      }).join('')}</div>${all.length > 60 ? `<div class="insp-quiet insp-quiet--faint">Showing the 60 tightest of ${all.length}.</div>` : ''}`;
    } else {
      html += `<button type="button" class="btn insp-review" data-act="review"><i class="fa-solid fa-magnifying-glass-location" aria-hidden="true"></i>Review in Inspect mode</button>`;
    }
  }
  return html + '</div>';
}

// ---------- live field updates (never rebuild a DOM the user is typing in) ----------
function refreshFields() {
  if (!bodyEl || sectionEl.dataset.context !== 'item') return;
  const item = ws.ctx.state.activeItem; if (!item) return;
  const set = (f, v) => { const el = bodyEl.querySelector(`input[data-f="${f}"]`); if (el && document.activeElement !== el) el.value = v; };
  set('x', fmtM(item.position.x)); set('z', fmtM(item.position.z)); set('rot', Math.round(degOf(item) * 10) / 10);
}
function showMsg(text) {
  const el = bodyEl.querySelector('[data-f="msg"]'); if (!el) return;
  el.textContent = text || ''; el.hidden = !text;
}

// ---------- events ----------
function onChange(e) {
  const f = e.target.dataset?.f; if (!f || !editable) return;
  const item = ws.ctx.state.activeItem; if (!item) return;
  const v = parseFloat(e.target.value);
  if (!Number.isFinite(v)) { refreshFields(); return; }
  if (f === 'rot') { ws.ctx.setItemRotationRad(item, (v * Math.PI) / 180); showMsg(''); return; }
  const x = f === 'x' ? v : item.position.x, z = f === 'z' ? v : item.position.z;
  const res = ws.ctx.setItemPositionChecked(item, x, z);
  if (!res.ok) { showMsg(`${res.reason} — position not changed.`); e.target.value = fmtM(item.position[f]); e.target.classList.add('invalid'); setTimeout(() => e.target.classList.remove('invalid'), 900); return; }
  showMsg(res.adjusted ? 'Adjusted to keep the object inside the room.' : '');
  refreshFields();
}
function onKey(e) {
  if (e.key === 'Enter' && e.target.matches?.('input[data-f]')) { e.target.blur(); }
  if (e.key === 'Escape' && e.target.matches?.('input[data-f]')) { e.stopPropagation(); refreshFields(); e.target.blur(); }
}
function onClick(e) {
  const btn = e.target.closest('[data-act]'); if (!btn) return;
  const act = btn.dataset.act; const item = ws.ctx.state.activeItem;
  if (act === 'focus') ws.ctx.focusSelected();
  else if (act === 'rot' && item && editable) ws.ctx.setItemRotationRad(item, item.rotation + (parseFloat(btn.dataset.d) * Math.PI) / 180);
  else if (act === 'issue') { const r = findIssue(btn.dataset.key); if (r) { selectIssue(r); bus.emit('issue-focus', { rec: r }); } }
  else if (act === 'select') { const it = itemById(Number(btn.dataset.id)) || ws.ctx.state.placedItems.find(i => String(i.id) === btn.dataset.id); if (it) ws.ctx.setActiveItem(it); }
  else if (act === 'issue-focus') { const r = findIssue(ws.issueKey); if (r) bus.emit('issue-focus', { rec: r }); }
  else if (act === 'issue-close') clearIssue();
  else if (act === 'review') ws.ctx.setMode('inspect');
  else if (act === 'm-del') ws.ctx.measure.remove(btn.dataset.id);
  else if (act === 'm-clear') ws.ctx.measure.clear();
  else if (act === 'm-done') ws.ctx.measure.toggle(false);
}
