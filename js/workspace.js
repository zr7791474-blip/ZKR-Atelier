// Workspace layer bootstrap. app.js hands over one context object (scene
// handles + the existing actions to reuse); this wires the new modules
// together and returns the per-frame callback for the render loop.
import { ws } from './ws.js';
import { bus } from './bus.js';
import { createMeasureTool } from './measure.js';
import { initSpatialOverlay } from './spatial-overlay.js';
import { initModes } from './modes.js';
import { initInspector } from './inspector.js';
import { initCostDelta } from './cost-delta.js';
import { initCommandPalette } from './command-palette.js';
import { buildReport, reportHtml, reportPdf, downloadText } from './report.js';
import { clearIssue } from './ws.js';

export function initWorkspace(ctx) {
  ws.ctx = ctx;
  document.querySelector('.app')?.classList.add('mode-design');
  ctx.getMode = () => ws.mode;
  ctx.measure = createMeasureTool(ctx);
  const overlay = initSpatialOverlay(ctx);
  const modes = initModes(ctx);
  ctx.setMode = modes.setMode;
  initInspector();
  initCostDelta(ctx);
  ctx.container.dataset.scale = ctx.state.cityScale;
  bus.on('scale', ({ scale }) => {
    ctx.container.dataset.scale = scale;
    ctx.measure.setVisible(scale === 'interior' && ws.mode !== 'present');
  });

  // ---- report actions (buttons in the export dialog + command palette) ----
  const slug = () => ctx.state.template;
  const actions = {
    ...modes,
    downloadReportHtml() {
      downloadText(`zkr-${slug()}-compliance-report.html`, reportHtml(buildReport(ctx)), 'text/html');
      ctx.showToast('Compliance report (HTML) downloaded', 'fa-circle-check');
    },
    downloadReportPdf() {
      const lib = window.jspdf?.jsPDF;
      if (!lib) { ctx.showToast('PDF library unavailable — try the HTML report', 'fa-triangle-exclamation'); return; }
      reportPdf(buildReport(ctx), lib).save(`zkr-${slug()}-compliance-report.pdf`);
      ctx.showToast('Compliance report (PDF) downloaded', 'fa-circle-check');
    },
  };
  document.getElementById('downloadReportPdf')?.addEventListener('click', actions.downloadReportPdf);
  document.getElementById('downloadReportHtml')?.addEventListener('click', actions.downloadReportHtml);
  const palette = initCommandPalette(ctx, actions);
  if (new URLSearchParams(location.search).has('debug')) { ctx.__actions = actions; ctx.__palette = palette; }
  document.getElementById('paletteBtn')?.addEventListener('click', () => palette.open());

  // ---- shortcuts for the new tools (I / P / O / M) and Escape priorities ----
  const typing = (e) => /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
  const modalOpen = () => document.querySelector('.export-modal.open') || palette.isOpen();
  window.addEventListener('keydown', (e) => {
    if (typing(e) || modalOpen() || e.ctrlKey || e.metaKey || e.altKey) {
      return;
    }
    const k = e.key.toLowerCase();
    if (k === 'i') { modes.toggleMode('inspect'); e.preventDefault(); }
    else if (k === 'p') { modes.toggleMode('present'); e.preventDefault(); }
    else if (k === 'o') { modes.toggleOverlay(); e.preventDefault(); }
    else if (k === 'm' && ws.mode !== 'present') { ctx.measure.toggle(); e.preventDefault(); }
  });
  // Escape (capture, so it wins before app.js's chain): presentation exit,
  // then clear a selected issue, then cancel a half-made measurement.
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || typing(e) || modalOpen()) return;
    if (ws.mode === 'present') { modes.setMode('design'); e.stopImmediatePropagation(); }
    else if (ws.issueKey) { clearIssue(); e.stopImmediatePropagation(); }
    else if (ctx.measure.cancelPending()) e.stopImmediatePropagation();
  }, true);

  return () => { ctx.measure.frame(); overlay.frame(); };
}
