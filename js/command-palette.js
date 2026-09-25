// Command palette — Ctrl/⌘+K.
//
// Every entry calls an action that already exists in the app (or one of the new
// workspace actions). Entries that cannot run right now (e.g. "Delete selected"
// with nothing selected, or any edit outside Design mode) are not listed —
// nothing here is a dead button.
import { ws } from './ws.js';

const MAC = /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);
const MOD = MAC ? '⌘' : 'Ctrl';

export function initCommandPalette(ctx, actions) {
  const { state } = ctx;
  let root, input, list, empty, open = false, results = [], active = 0, lastFocus = null;

  // ---------- command registry (rebuilt on every open so `enabled` is current) ----------
  function commands() {
    const design = ws.mode === 'design';
    const sel = state.activeItem;
    const hist = ctx.historyState();
    const C = [];
    const add = (c) => C.push({ enabled: true, ...c });

    // Selection
    add({ group: 'Selection', title: 'Focus selected object', icon: 'fa-crosshairs', kw: 'camera zoom center', enabled: !!sel, run: () => ctx.focusSelected() });
    add({ group: 'Selection', title: 'Duplicate selected object', icon: 'fa-clone', kbd: [MOD, 'D'], kw: 'copy clone', enabled: design && !!sel, run: () => ctx.duplicateActiveItem() });
    add({ group: 'Selection', title: 'Delete selected object', icon: 'fa-trash', kbd: ['Del'], kw: 'remove', enabled: design && !!sel, run: () => ctx.removePlacedItem(sel) });
    add({ group: 'Selection', title: 'Rotate selected object 45° clockwise', icon: 'fa-arrow-rotate-right', kbd: ['R'], enabled: design && !!sel, run: () => ctx.rotateSelected(Math.PI / 4) });
    add({ group: 'Selection', title: 'Rotate selected object 45° counter-clockwise', icon: 'fa-arrow-rotate-left', kbd: ['['], enabled: design && !!sel, run: () => ctx.rotateSelected(-Math.PI / 4) });
    add({ group: 'Selection', title: 'Move selected object (drag)', icon: 'fa-arrows-up-down-left-right', enabled: design && !!sel, run: () => ctx.armMoveSelected() });
    add({ group: 'Selection', title: 'Deselect', icon: 'fa-xmark', kbd: ['Esc'], enabled: !!sel || !!ws.issueKey, run: () => { ctx.deselectActiveItem(); ctx.clearIssue(); } });

    // Modes & inspection
    add({ group: 'Mode', title: 'Design mode', icon: 'fa-pen-ruler', kw: 'edit place layout', enabled: ws.mode !== 'design', run: () => actions.setMode('design') });
    add({ group: 'Mode', title: ws.mode === 'inspect' ? 'Leave Inspection mode' : 'Inspection mode', icon: 'fa-magnifying-glass-location', kbd: ['I'], kw: 'inspect compliance collisions clearance issues', run: () => actions.toggleMode('inspect') });
    add({ group: 'Mode', title: ws.mode === 'present' ? 'Exit Presentation mode' : 'Presentation mode', icon: 'fa-display', kbd: ['P'], kw: 'present clean walkthrough show', run: () => actions.toggleMode('present') });
    add({ group: 'Mode', title: ws.overlay ? 'Hide compliance overlay' : 'Show compliance overlay', icon: 'fa-shield-halved', kbd: ['O'], kw: 'clearance heatmap footprint', enabled: ws.mode !== 'present', run: () => actions.toggleOverlay() });

    // Tools
    add({ group: 'Tools', title: ctx.measure.active ? 'Stop measuring' : 'Measure distance', icon: 'fa-ruler', kbd: ['M'], kw: 'dimension tape', enabled: ws.mode !== 'present', run: () => ctx.measure.toggle() });
    add({ group: 'Tools', title: 'Clear measurements', icon: 'fa-eraser', enabled: ctx.measure.list().length > 0, run: () => ctx.measure.clear() });
    add({ group: 'Tools', title: 'Undo', icon: 'fa-rotate-left', kbd: [MOD, 'Z'], enabled: design && hist.undo > 0, run: () => ctx.undo() });
    add({ group: 'Tools', title: 'Redo', icon: 'fa-rotate-right', kbd: [MOD, 'Shift', 'Z'], enabled: design && hist.redo > 0, run: () => ctx.redo() });
    add({ group: 'Tools', title: 'Toggle planning grid', icon: 'fa-border-all', kbd: ['G'], run: () => ctx.toggleGrid() });
    add({ group: 'Tools', title: 'Toggle fire egress paths', icon: 'fa-route', kbd: ['F'], kw: 'exit evacuation', run: () => ctx.toggleFireSafety() });
    add({ group: 'Tools', title: 'Search furniture…', icon: 'fa-magnifying-glass', kw: 'find catalog add', enabled: design, keepOpen: true, run: () => { input.value = 'Add '; refresh(); } });

    // View
    add({ group: 'View', title: 'Cycle view (3D → City → Floor plan)', icon: 'fa-cube', kbd: ['V'], run: () => { const o = ['perspective', 'city', 'top']; ctx.transitionToView(o[(o.indexOf(state.view) + 1) % o.length]); } });
    add({ group: 'View', title: 'Interior 3D view', icon: 'fa-cube', kw: 'perspective reset home', run: () => ctx.setCityScale('interior') });
    add({ group: 'View', title: 'Floor plan view', icon: 'fa-vector-square', kw: 'top plan', run: () => { if (state.cityScale !== 'interior') ctx.setCityScale('interior'); setTimeout(() => ctx.transitionToView('top'), state.cityScale === 'interior' ? 0 : 60); } });
    add({ group: 'View', title: 'City overview', icon: 'fa-city', run: () => ctx.setCityScale('city') });
    add({ group: 'View', title: state.firstPerson ? 'Exit walkthrough' : 'First-person walkthrough', icon: 'fa-person-walking', kw: 'wasd', run: () => (state.firstPerson ? ctx.exitFirstPerson() : ctx.enterFirstPerson()) });

    // Project
    add({ group: 'Project', title: 'Open cost estimate', icon: 'fa-calculator', kbd: ['C'], kw: 'price quote budget total', run: () => ctx.toggleCostPanel() });
    add({ group: 'Project', title: 'Export PDF…', icon: 'fa-file-arrow-down', kw: 'report layout sheet download', run: () => ctx.openExportModal() });
    add({ group: 'Project', title: 'Download compliance report (PDF)', icon: 'fa-file-pdf', kw: 'export', run: () => actions.downloadReportPdf() });
    add({ group: 'Project', title: 'Download compliance report (HTML)', icon: 'fa-file-code', kw: 'export standalone', run: () => actions.downloadReportHtml() });
    add({ group: 'Project', title: 'Keyboard shortcuts', icon: 'fa-keyboard', kbd: ['?'], kw: 'help', run: () => ctx.openHelpModal() });

    // Furniture: "Add …" (only when the user types — 24 rows would bury everything else)
    Object.entries(ctx.ITEM_CATALOG).forEach(([key, it]) => {
      const cat = ctx.FURNITURE_CATEGORIES.find(c => c.key === it.cat)?.label || '';
      add({ group: 'Add furniture', title: `Add ${it.name}`, icon: it.icon, meta: it.price ? '$' + it.price : 'included', kw: `${cat} place furniture ${it.seats ? 'seat' : ''}`, onlyWhenSearching: true,
        run: () => { if (ws.mode !== 'design') actions.setMode('design'); if (state.selectedItem !== key) ctx.selectItem(key); } });
    });
    // Placed objects: jump to any object in the scene
    if (state.cityScale === 'interior') {
      const counts = {};
      state.placedItems.forEach(it => {
        counts[it.type] = (counts[it.type] || 0) + 1;
        const total = state.placedItems.filter(i => i.type === it.type).length;
        add({ group: 'Objects in scene', title: `Select ${it.name}${total > 1 ? ' ' + counts[it.type] : ''}`, icon: ctx.ITEM_CATALOG[it.type].icon, meta: `x ${it.position.x.toFixed(1)} · z ${it.position.z.toFixed(1)}`,
          kw: 'go to find object', onlyWhenSearching: true, run: () => { ctx.setActiveItem(it); ctx.focusSelected(); } });
      });
    }
    return C.filter(c => c.enabled);
  }

  // ---------- matching ----------
  function score(cmd, q) {
    if (!q) return 1;
    const hay = (cmd.title + ' ' + (cmd.kw || '') + ' ' + cmd.group).toLowerCase();
    const title = cmd.title.toLowerCase();
    let total = 0;
    for (const tok of q.toLowerCase().split(/\s+/).filter(Boolean)) {
      let s = 0;
      if (title.startsWith(tok)) s = 100;
      else if (title.split(/[\s—-]+/).some(w => w.startsWith(tok))) s = 80;
      else if (title.includes(tok)) s = 60;
      else if (hay.includes(tok)) s = 40;
      else { // ordered subsequence ("dlt" → "Delete")
        let i = 0; for (const ch of title) if (ch === tok[i]) i++;
        s = i === tok.length && tok.length >= 3 ? 15 : 0;
      }
      if (!s) return 0;
      total += s;
    }
    return total;
  }

  // ---------- UI ----------
  function build() {
    root = document.createElement('div');
    root.className = 'cmdk'; root.id = 'commandPalette'; root.hidden = true;
    root.innerHTML = `
      <div class="cmdk-backdrop" data-close></div>
      <div class="cmdk-panel" role="dialog" aria-modal="true" aria-label="Command palette">
        <div class="cmdk-search">
          <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
          <input type="text" id="cmdkInput" role="combobox" aria-expanded="true" aria-controls="cmdkList" aria-autocomplete="list" autocomplete="off" spellcheck="false" placeholder="Type a command or search furniture…">
          <kbd>Esc</kbd>
        </div>
        <ul class="cmdk-list" id="cmdkList" role="listbox" aria-label="Commands"></ul>
        <div class="cmdk-empty" hidden>No matching command.</div>
        <div class="cmdk-foot"><span><kbd>↑</kbd><kbd>↓</kbd> navigate</span><span><kbd>↵</kbd> run</span><span><kbd>Esc</kbd> close</span></div>
      </div>`;
    document.body.appendChild(root);
    input = root.querySelector('input'); list = root.querySelector('ul'); empty = root.querySelector('.cmdk-empty');
    root.addEventListener('click', (e) => { if (e.target.hasAttribute('data-close')) close(); });
    input.addEventListener('input', () => { active = 0; refresh(); });
    input.addEventListener('keydown', onKey);
    list.addEventListener('mousemove', (e) => { const li = e.target.closest('li[data-i]'); if (li && +li.dataset.i !== active) setActive(+li.dataset.i, false); });
    list.addEventListener('click', (e) => { const li = e.target.closest('li[data-i]'); if (li) run(+li.dataset.i); });
  }

  function refresh() {
    const q = input.value.trim();
    const all = commands();
    let scored = all
      .filter(c => q || !c.onlyWhenSearching)
      .map((c, idx) => ({ c, s: score(c, q), idx })).filter(x => x.s > 0);
    if (q) scored.sort((a, b) => b.s - a.s || a.idx - b.idx);
    results = scored.slice(0, 60).map(x => x.c);
    let html = '', lastGroup = null;
    results.forEach((c, i) => {
      if (!q && c.group !== lastGroup) { html += `<li class="cmdk-group" role="presentation">${c.group}</li>`; lastGroup = c.group; }
      html += `<li role="option" id="cmdk-opt-${i}" data-i="${i}" aria-selected="${i === active}" class="${i === active ? 'active' : ''}">
        <i class="fa-solid ${c.icon}" aria-hidden="true"></i><span class="cmdk-title">${c.title}</span>
        ${q && c.group ? `<em class="cmdk-grp">${c.group}</em>` : ''}
        ${c.meta ? `<em class="cmdk-meta">${c.meta}</em>` : ''}
        ${c.kbd ? `<span class="cmdk-kbd">${c.kbd.map(k => `<kbd>${k}</kbd>`).join('')}</span>` : ''}</li>`;
    });
    list.innerHTML = html; empty.hidden = results.length > 0;
    if (active >= results.length) active = Math.max(0, results.length - 1);
    setActive(active, true);
  }
  function setActive(i, scroll) {
    active = i;
    list.querySelectorAll('li[data-i]').forEach(li => { const on = +li.dataset.i === i; li.classList.toggle('active', on); li.setAttribute('aria-selected', String(on)); });
    input.setAttribute('aria-activedescendant', results.length ? 'cmdk-opt-' + i : '');
    if (scroll) list.querySelector(`li[data-i="${i}"]`)?.scrollIntoView({ block: 'nearest' });
  }
  function onKey(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (results.length) setActive((active + 1) % results.length, true); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (results.length) setActive((active - 1 + results.length) % results.length, true); }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0, true); }
    else if (e.key === 'End') { e.preventDefault(); setActive(Math.max(0, results.length - 1), true); }
    else if (e.key === 'Enter') { e.preventDefault(); run(active); }
    else if (e.key === 'Tab') { e.preventDefault(); }   // focus stays in the palette
  }
  function run(i) {
    const c = results[i]; if (!c) return;
    if (c.keepOpen) { c.run(); return; }
    close(false);
    requestAnimationFrame(() => { try { c.run(); } catch (err) { console.error('Command failed:', c.title, err); ctx.showToast('That command could not run', 'fa-triangle-exclamation'); } });
  }
  function show() {
    if (open) return;
    if (state.firstPerson) ctx.exitFirstPerson();
    if (!root) build();
    lastFocus = document.activeElement; open = true; active = 0;
    root.hidden = false; input.value = ''; refresh(); input.focus();
  }
  function close(restore = true) {
    if (!open) return;
    open = false;
    // Blur first: hiding (root.hidden = true) an element that still holds
    // focus forces a synchronous, reentrant blur while the input's own
    // keydown handler is still on the call stack (Enter-to-run). That
    // reentrant focus change destabilises this build's renderer, so the
    // input is blurred one tick ahead of the hide instead.
    if (document.activeElement && root.contains(document.activeElement)) document.activeElement.blur();
    root.hidden = true;
    if (restore && lastFocus && document.body.contains(lastFocus)) lastFocus.focus();
  }

  // Ctrl/⌘+K works everywhere (even from inside an input); Esc closes first.
  window.addEventListener('keydown', (e) => {
    if ((e.key === 'k' || e.key === 'K') && (e.ctrlKey || e.metaKey) && !e.altKey) { e.preventDefault(); e.stopPropagation(); open ? close() : show(); }
    else if (e.key === 'Escape' && open) { e.preventDefault(); e.stopImmediatePropagation(); close(); }
  }, true);

  return { open: show, close, isOpen: () => open, commands };
}
