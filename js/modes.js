// Working modes — one interface that changes context, not three apps.
//
//   Design   place / move / edit (everything as before)
//   Inspect  read the layout: compliance overlay on, editing chrome hidden,
//            catalog panel out of the way, issues listed in the inspector
//   Present  the scene is the focus: panels, toolbars and HUDs hidden; a slim
//            bar keeps view switching, walkthrough and exit reachable
//
// Modes are a class on `.app` (mode-design | mode-inspect | mode-present).
// CSS in workspace.css does the reconfiguring; this module owns the state
// transitions and the few things CSS cannot do (cancel placement, close
// overlays, keep the canvas sized).
import { bus } from './bus.js';
import { ws, money, clearIssue } from './ws.js';

const $ = (id) => document.getElementById(id);
const MODE_LABEL = { design: 'Design', inspect: 'Inspection', present: 'Presentation' };

export function initModes(ctx) {
  const { state } = ctx;
  const app = document.querySelector('.app');
  let overlayAuto = false;        // overlay was switched on by entering Inspect (so leaving turns it off again)
  let summaryOn = true;

  function resizeSoon() {
    window.dispatchEvent(new Event('resize'));
    requestAnimationFrame(() => { window.dispatchEvent(new Event('resize')); setTimeout(() => window.dispatchEvent(new Event('resize')), 120); });
  }

  function setOverlay(on, { auto = false } = {}) {
    if (ws.overlay === on) return;
    ws.overlay = on; if (!auto) overlayAuto = false;
    $('overlayToggleBtn')?.classList.toggle('active', on);
    $('overlayToggleBtn')?.setAttribute('aria-pressed', String(on));
    document.querySelector('.canvas-container')?.classList.toggle('overlay-on', on);
    bus.emit('overlay', { on });
  }

  function setMode(mode) {
    if (!MODE_LABEL[mode] || mode === ws.mode) return;
    const previous = ws.mode;
    ws.mode = mode;
    app.classList.remove('mode-design', 'mode-inspect', 'mode-present');
    app.classList.add('mode-' + mode);
    document.querySelectorAll('.mode-switch [data-mode]').forEach(b => { const on = b.dataset.mode === mode; b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on)); });

    if (mode !== 'design') {
      // Leave every editing gesture cleanly: armed placement, armed move.
      if (state.selectedItem) ctx.selectItem(state.selectedItem);
      ctx.disarmMove();
    }
    if (mode === 'inspect') {
      if (state.cityScale !== 'interior') ctx.setCityScale('interior');
      if (!ws.overlay) { setOverlay(true, { auto: true }); overlayAuto = true; }
    } else if (previous === 'inspect' && overlayAuto) { setOverlay(false); }
    if (mode === 'present') {
      ctx.deselectActiveItem(); clearIssue();
      if (ctx.measure.active) ctx.measure.toggle(false);
      if (state.costPanelOpen) ctx.toggleCostPanel();
      ctx.closeDrawers?.();
      ctx.measure.setVisible(false);
      renderSummary();
    } else ctx.measure.setVisible(state.cityScale === 'interior');
    ctx.updateBreadcrumb();
    bus.emit('mode', { mode, previous });
    resizeSoon();
    if (mode === 'present') ctx.showToast('Presentation mode — Esc to exit', 'fa-display');
  }

  // ---- presentation bar + summary ----
  function renderSummary() {
    const el = $('presentSummary'); if (!el) return;
    const seats = state.placedItems.reduce((s, i) => s + i.seats, 0);
    const subtotal = state.placedItems.reduce((s, i) => s + i.price, 0);
    const total = ctx.computeCostBreakdown(subtotal).total;
    const a = state.analysis;
    const issues = a ? a.counts.collision + a.counts.critical + a.counts.warning : 0;
    el.innerHTML = `
      <div class="ps-eyebrow">${ctx.TEMPLATES[state.template]?.label || ''}</div>
      <div class="ps-name">${$('projectName').textContent.trim() || 'Untitled project'}</div>
      <div class="ps-grid">
        <span>Floor area<b>${state.roomArea} m²</b></span>
        <span>Objects<b>${state.placedItems.length}</b></span>
        <span>Seats<b>${seats} / ${state.maxCapacity}</b></span>
        <span>Est. cost<b>${money(total)}</b></span>
      </div>
      <div class="ps-foot">${issues ? `${issues} spatial note${issues > 1 ? 's' : ''} open` : 'No spatial issues detected'}</div>`;
    el.hidden = !summaryOn;
  }
  bus.on('layout', () => { if (ws.mode === 'present') renderSummary(); });

  document.querySelectorAll('.mode-switch [data-mode]').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
  $('presentExit')?.addEventListener('click', () => setMode('design'));
  $('presentSummaryToggle')?.addEventListener('click', () => { summaryOn = !summaryOn; $('presentSummaryToggle').classList.toggle('active', summaryOn); renderSummary(); });
  document.querySelectorAll('#presentBar [data-view]').forEach(b => b.addEventListener('click', () => {
    const v = b.dataset.view;
    if (v === 'perspective') ctx.setCityScale('interior'); else if (v === 'city') ctx.setCityScale('city'); else ctx.transitionToView('top');
    document.querySelectorAll('#presentBar [data-view]').forEach(x => x.classList.toggle('active', x === b));
  }));
  $('presentWalkBtn')?.addEventListener('click', () => { if (state.firstPerson) ctx.exitFirstPerson(); else ctx.enterFirstPerson(); });
  $('overlayToggleBtn')?.addEventListener('click', () => toggleOverlay());

  function toggleOverlay() {
    if (ws.mode === 'present') return;
    setOverlay(!ws.overlay);
    ctx.showToast(ws.overlay ? 'Compliance overlay on' : 'Compliance overlay off', 'fa-shield-halved');
  }
  const toggleMode = (m) => setMode(ws.mode === m ? 'design' : m);

  // Same inputs ⇒ same outputs as the palette: both call these.
  return { setMode, toggleMode, setOverlay, toggleOverlay, renderSummary };
}
