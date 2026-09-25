// Project / compliance report — a deliverable a designer can hand to someone.
//
// One data builder (buildReport) feeds two renderers (HTML, PDF). Every figure
// comes from state the app already holds: placed items, the shared spatial
// analysis, the measure tool, computeCostBreakdown(), the template record.
// Nothing is estimated here and nothing is invented; sections with no data say
// so plainly instead of being filled.
import { footprintOf, footprintPolygon, NON_FLOOR_TYPES, ANALYSIS_BASIS, SEVERITY_LABEL, MIN_ACCESSIBLE_CLEARANCE } from './spatial-analysis.js';
import { esc } from './ws.js';

const SEV_RGB = { ok: [76, 139, 90], warning: [214, 169, 74], critical: [196, 58, 58], collision: [196, 58, 58] };
const SEV_HEX = { ok: '#4C8B5A', warning: '#D6A94A', critical: '#C43A3A', collision: '#C43A3A' };
const MEAS_LABEL = { compliant: 'Accessible clearance', tight: 'Tight — below recommended', violation: 'Too narrow' };

export function buildReport(ctx) {
  const { state, ITEM_CATALOG, TEMPLATES } = ctx;
  const tpl = TEMPLATES[state.template];
  const room = { width: ctx.ROOM_W, depth: ctx.ROOM_D, ceiling: ctx.ROOM_H };
  const items = state.placedItems;
  const a = state.analysis;

  // unique, stable labels ("Dining Chair 3")
  const seen = {}, totals = {};
  items.forEach(i => { totals[i.type] = (totals[i.type] || 0) + 1; });
  const label = new Map(items.map(i => { seen[i.type] = (seen[i.type] || 0) + 1; return [i.id, totals[i.type] > 1 ? `${i.name} ${seen[i.type]}` : i.name]; }));

  const seats = items.reduce((s, i) => s + i.seats, 0);
  const subtotal = items.reduce((s, i) => s + i.price, 0);
  const cost = ctx.computeCostBreakdown(subtotal);
  const byType = Object.values(items.reduce((g, i) => { (g[i.type] ||= { name: i.name, count: 0, price: i.price }).count++; return g; }, {}))
    .map(g => ({ ...g, total: g.count * g.price }));

  // issues, numbered so the plan markers and the table agree
  const raw = [...a.pairs, ...a.walls].sort((p, q) => (p.severity === 'collision') !== (q.severity === 'collision') ? (p.severity === 'collision' ? -1 : 1) : p.clearance - q.clearance);
  const issues = raw.map((r, k) => ({
    n: k + 1, severity: r.severity, clearance: r.clearance, point: r.point,
    a: label.get(r.aId ?? r.id), b: r.bId != null ? label.get(r.bId) : `${r.wall} room boundary`,
  }));

  const measurements = ctx.measure.list().map((m, k) => ({ n: 'M' + (k + 1), dist: m.dist, status: m.status, a: m.a, b: m.b }));

  // plan geometry (metres, room-centred, +z = down the page)
  const shapes = items.map(i => {
    const fp = footprintOf(i);
    const floor = !NON_FLOOR_TYPES.has(i.type);
    return { id: i.id, floor, sev: floor ? (a.perItem.get(i.id)?.worst || 'ok') : 'ok', poly: footprintPolygon(fp, 20), circle: fp.kind === 'circle' ? { cx: fp.cx, cz: fp.cz, r: fp.r } : null };
  });

  const overCap = seats > state.maxCapacity;
  return {
    project: ctx.getProjectName(), template: tpl.label, category: tpl.category,
    date: new Date(), ref: ctx.getExportRef(), brand: state.brandColor,
    room: { ...room, area: state.roomArea, areaFt2: tpl.area },
    counts: { objects: items.length, seats, maxCapacity: state.maxCapacity, byType },
    status: { overCap, accessible: a.accessible, score: state.projectScore, efficiency: state.spaceEfficiencyPct, tightest: a.tightest, evaluated: a.evaluated },
    tally: a.counts, issues, measurements, shapes,
    cost: { subtotal, delivery: cost.delivery, contingency: cost.contingency, total: cost.total, deliveryRate: 0.12, contingencyRate: 0.08 },
    schedule: items.map(i => ({ name: label.get(i.id), category: ctx.FURNITURE_CATEGORIES.find(c => c.key === ITEM_CATALOG[i.type].cat)?.label || '', x: i.position.x, z: i.position.z, rot: ((i.rotation * 180 / Math.PI) % 360 + 360) % 360, w: i.dims?.w, d: i.dims?.d, price: i.price })),
    basis: ANALYSIS_BASIS,
  };
}

const fm = (n, d = 2) => (Math.abs(n) < 0.005 ? 0 : n).toFixed(d);
const usd = (n) => '$' + Math.round(n).toLocaleString('en-US');
const dateLong = (d) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
const gapText = (c) => (c < 0 ? `overlap ${fm(-c)} m` : `${fm(c)} m`);
const verdict = (r) => r.tally.collision ? 'Collisions detected' : !r.status.accessible ? 'Clearance issues — review required' : r.tally.warning ? 'Passes, with tight areas' : 'No spatial issues detected';

// ======================= HTML =======================
function planSvg(r) {
  const S = 60, W = r.room.width * S, H = r.room.depth * S, m = 34;
  const X = (x) => m + (x + r.room.width / 2) * S, Z = (z) => m + (z + r.room.depth / 2) * S;
  let g = '';
  for (let i = 0; i <= r.room.width; i++) g += `<line x1="${X(i - r.room.width / 2)}" y1="${m}" x2="${X(i - r.room.width / 2)}" y2="${m + H}" class="gr"/>`;
  for (let i = 0; i <= r.room.depth; i++) g += `<line x1="${m}" y1="${Z(i - r.room.depth / 2)}" x2="${m + W}" y2="${Z(i - r.room.depth / 2)}" class="gr"/>`;
  g += `<rect x="${m}" y="${m}" width="${W}" height="${H}" class="rm"/>`;
  r.shapes.forEach(s => {
    const col = s.floor ? SEV_HEX[s.sev] : '#8A96A6';
    const fill = s.floor ? (s.sev === 'ok' ? '#E9E5DA' : col) : 'none';
    const op = s.floor ? (s.sev === 'ok' ? 1 : 0.35) : 1;
    const dash = s.floor ? '' : ' stroke-dasharray="4 3"';
    g += s.circle
      ? `<circle cx="${X(s.circle.cx)}" cy="${Z(s.circle.cz)}" r="${s.circle.r * S}" fill="${fill}" fill-opacity="${op}" stroke="${s.floor && s.sev !== 'ok' ? col : '#12243A'}" stroke-width="1"${dash}/>`
      : `<polygon points="${s.poly.map(p => X(p.x).toFixed(1) + ',' + Z(p.z).toFixed(1)).join(' ')}" fill="${fill}" fill-opacity="${op}" stroke="${s.floor && s.sev !== 'ok' ? col : '#12243A'}" stroke-width="1"${dash}/>`;
  });
  r.measurements.forEach(k => {
    g += `<line x1="${X(k.a.x)}" y1="${Z(k.a.z)}" x2="${X(k.b.x)}" y2="${Z(k.b.z)}" stroke="#0B7A86" stroke-width="1.5" stroke-dasharray="5 3"/>`
      + `<text x="${(X(k.a.x) + X(k.b.x)) / 2}" y="${(Z(k.a.z) + Z(k.b.z)) / 2 - 4}" class="ml">${k.n} · ${fm(k.dist)} m</text>`;
  });
  r.issues.forEach(k => {
    g += `<g><circle cx="${X(k.point.x)}" cy="${Z(k.point.z)}" r="9" fill="${SEV_HEX[k.severity]}" stroke="#fff" stroke-width="1.5"/><text x="${X(k.point.x)}" y="${Z(k.point.z) + 3.5}" class="pn">${k.n}</text></g>`;
  });
  g += `<text x="${m + W / 2}" y="${m - 14}" class="dm">${fm(r.room.width, 1)} m</text><text x="${m - 14}" y="${m + H / 2}" class="dm" transform="rotate(-90 ${m - 14} ${m + H / 2})">${fm(r.room.depth, 1)} m</text>`;
  return `<svg viewBox="0 0 ${W + m * 2} ${H + m * 2}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Annotated floor plan">
  <style>.gr{stroke:#12243A;stroke-opacity:.07}.rm{fill:#FBF9F4;stroke:#12243A;stroke-width:2.5}.pn{font:700 10px sans-serif;fill:#fff;text-anchor:middle}.dm{font:600 11px monospace;fill:#41536B;text-anchor:middle}.ml{font:700 10px monospace;fill:#0B7A86;text-anchor:middle}</style>
  <rect width="100%" height="100%" fill="#fff"/>${g}</svg>`;
}

export function reportHtml(r) {
  const row = (cells) => `<tr>${cells.map(c => `<td${c.cls ? ` class="${c.cls}"` : ''}>${c.v}</td>`).join('')}</tr>`;
  const sevPill = (s) => `<span class="pill s-${s}">${SEVERITY_LABEL[s]}</span>`;
  const issuesRows = r.issues.map(k => row([{ v: k.n, cls: 'n' }, { v: sevPill(k.severity) }, { v: `${esc(k.a)} ↔ ${esc(k.b)}` }, { v: gapText(k.clearance), cls: 'r' }, { v: `x ${fm(k.point.x)}, z ${fm(k.point.z)}`, cls: 'r mono' }])).join('');
  const brand = /^#[0-9a-f]{6}$/i.test(r.brand) ? r.brand : '#17B6C4';
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(r.project)} — Compliance report</title>
<style>
:root{--ink:#12243A;--mute:#546077;--line:#D5CEC1;--bg:#F4F0E7;--brand:${brand}}
*{box-sizing:border-box}body{margin:0;background:#E9E3D8;color:var(--ink);font:13px/1.5 'Manrope',-apple-system,'Segoe UI',sans-serif}
.sheet{max-width:900px;margin:24px auto;background:#fff;padding:44px 52px;box-shadow:0 2px 14px rgba(18,36,58,.12)}
header{border-top:5px solid var(--ink);padding-top:16px;display:flex;justify-content:space-between;gap:20px;align-items:flex-end;border-bottom:1px solid var(--line);padding-bottom:16px}
.eyebrow{font:600 10px monospace;letter-spacing:.14em;text-transform:uppercase;color:var(--mute)}h1{font-size:26px;margin:4px 0 2px;letter-spacing:-.02em}
.meta{text-align:right;font:11px/1.6 monospace;color:var(--mute)}
h2{font:700 11px monospace;letter-spacing:.14em;text-transform:uppercase;color:var(--mute);margin:30px 0 10px;padding-bottom:6px;border-bottom:1px solid var(--line)}
.verdict{margin:18px 0 0;padding:12px 14px;border-left:4px solid ${r.tally.collision || !r.status.accessible ? '#C43A3A' : r.tally.warning ? '#D6A94A' : '#4C8B5A'};background:var(--bg);font-weight:700}
.tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--line);border:1px solid var(--line);margin-top:16px}
.tile{background:#fff;padding:12px}.tile span{display:block;font:600 9px monospace;letter-spacing:.1em;text-transform:uppercase;color:var(--mute)}.tile b{display:block;font-size:20px;margin-top:4px;letter-spacing:-.03em}
table{width:100%;border-collapse:collapse;font-size:12px}th{font:600 9.5px monospace;letter-spacing:.08em;text-transform:uppercase;color:var(--mute);text-align:left;padding:6px 8px;border-bottom:2px solid var(--ink)}
td{padding:6px 8px;border-bottom:1px solid #ECE7DC;vertical-align:top}td.r,th.r{text-align:right}td.n{font-weight:700;width:34px}.mono{font-family:monospace;font-size:11px}
tfoot td{font-weight:800;border-top:2px solid var(--ink);border-bottom:none}
.pill{display:inline-block;padding:1px 7px;border-radius:2px;font:700 9.5px monospace;text-transform:uppercase;letter-spacing:.05em;color:#fff}
.s-ok{background:#4C8B5A}.s-warning{background:#D6A94A;color:#12243A}.s-critical,.s-collision{background:#C43A3A}
.plan{border:1px solid var(--line);margin-top:8px}.plan svg{display:block;width:100%;height:auto}
.legend{display:flex;gap:16px;flex-wrap:wrap;font-size:11px;color:var(--mute);margin-top:8px}.legend i{display:inline-block;width:10px;height:10px;margin-right:5px;vertical-align:-1px}
ul.basis{margin:0;padding-left:18px;color:var(--mute);font-size:12px}ul.basis li{margin:3px 0}
.none{color:var(--mute);font-style:italic;padding:8px 0}.disc{margin-top:26px;font-size:11px;color:var(--mute);border-top:1px solid var(--line);padding-top:12px}
@media print{body{background:#fff}.sheet{margin:0;box-shadow:none;max-width:none;padding:0}h2{break-after:avoid}table,.plan{break-inside:avoid}}
@page{size:A4;margin:16mm}
</style></head><body><div class="sheet">
<header><div><div class="eyebrow">ZKR Atelier · Compliance report</div><h1>${esc(r.project)}</h1><div class="eyebrow">${esc(r.template)} · ${esc(r.category)}</div></div>
<div class="meta">${esc(dateLong(r.date))}<br>REF ${esc(r.ref)}<br>Generated ${esc(r.date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }))}</div></header>
<div class="verdict">${esc(verdict(r))}</div>
<div class="tiles">
<div class="tile"><span>Floor area</span><b>${r.room.area} m²</b></div>
<div class="tile"><span>Room</span><b>${fm(r.room.width, 1)} × ${fm(r.room.depth, 1)} m</b></div>
<div class="tile"><span>Objects</span><b>${r.counts.objects}</b></div>
<div class="tile"><span>Seats</span><b>${r.counts.seats} / ${r.counts.maxCapacity}</b></div>
</div>

<h2>1 · Layout &amp; findings</h2>
<div class="plan">${planSvg(r)}</div>
<div class="legend"><span><i style="background:#E9E5DA;border:1px solid #12243A"></i>Compliant</span><span><i style="background:#D6A94A"></i>Tight (&lt; ${MIN_ACCESSIBLE_CLEARANCE.toFixed(2)} m)</span><span><i style="background:#C43A3A"></i>Insufficient / collision</span><span><i style="border:1px dashed #8A96A6"></i>Not a floor obstacle</span><span>Numbered markers match the table below</span></div>

<h2>2 · Compliance summary</h2>
<table><tbody>
${row([{ v: 'Capacity' }, { v: `${r.counts.seats} of ${r.counts.maxCapacity} seats — ${r.status.overCap ? 'over the template limit' : 'within the template limit'}`, cls: 'r' }])}
${row([{ v: 'Fire egress (as evaluated by ZKR Atelier)' }, { v: r.status.overCap ? 'Over limit' : 'Compliant', cls: 'r' }])}
${row([{ v: 'Accessibility clearance' }, { v: r.status.accessible ? 'Pass' : 'Fail — clearances below 0.50 m', cls: 'r' }])}
${row([{ v: 'Collisions' }, { v: String(r.tally.collision), cls: 'r' }])}
${row([{ v: 'Insufficient clearances (&lt; 0.50 m)' }, { v: String(r.tally.critical), cls: 'r' }])}
${row([{ v: 'Tight clearances (0.50 – 0.90 m)' }, { v: String(r.tally.warning), cls: 'r' }])}
${row([{ v: 'Tightest gap found' }, { v: Number.isFinite(r.status.tightest) ? `${fm(r.status.tightest)} m` : '—', cls: 'r' }])}
${row([{ v: 'Project score / space efficiency' }, { v: `${r.status.score} / ${r.status.efficiency}%`, cls: 'r' }])}
</tbody></table>
<div class="none">Egress here means the seat count against the template's capacity limit; drawn egress paths are illustrative and are not measured.</div>

<h2>3 · Detected issues (${r.issues.length})</h2>
${r.issues.length ? `<table><thead><tr><th>#</th><th>State</th><th>Objects</th><th class="r">Gap</th><th class="r">Location</th></tr></thead><tbody>${issuesRows}</tbody></table>` : '<div class="none">No collisions or sub-threshold clearances were detected.</div>'}

<h2>4 · Measurements (${r.measurements.length})</h2>
${r.measurements.length ? `<table><thead><tr><th>#</th><th class="r">Distance</th><th>Read</th><th class="r">From</th><th class="r">To</th></tr></thead><tbody>${r.measurements.map(k => row([{ v: k.n, cls: 'n' }, { v: fm(k.dist) + ' m', cls: 'r' }, { v: MEAS_LABEL[k.status] }, { v: `${fm(k.a.x)}, ${fm(k.a.z)}`, cls: 'r mono' }, { v: `${fm(k.b.x)}, ${fm(k.b.z)}`, cls: 'r mono' }])).join('')}</tbody></table>` : '<div class="none">No measurements were taken.</div>'}

<h2>5 · Cost summary</h2>
${r.counts.objects ? `<table><thead><tr><th>Item</th><th class="r">Qty</th><th class="r">Unit</th><th class="r">Total</th></tr></thead><tbody>
${r.counts.byType.map(g => row([{ v: esc(g.name) }, { v: g.count, cls: 'r' }, { v: g.price ? usd(g.price) : 'included', cls: 'r' }, { v: usd(g.total), cls: 'r' }])).join('')}
${row([{ v: 'Furniture subtotal' }, { v: '' }, { v: '' }, { v: usd(r.cost.subtotal), cls: 'r' }])}
${row([{ v: `Delivery &amp; install (${r.cost.deliveryRate * 100}%)` }, { v: '' }, { v: '' }, { v: usd(r.cost.delivery), cls: 'r' }])}
${row([{ v: `Contingency (${r.cost.contingencyRate * 100}%)` }, { v: '' }, { v: '' }, { v: usd(r.cost.contingency), cls: 'r' }])}
</tbody><tfoot><tr><td colspan="3">Total estimate</td><td class="r">${usd(r.cost.total)}</td></tr></tfoot></table>` : '<div class="none">No objects placed — no cost to report.</div>'}

<h2>6 · Object schedule</h2>
${r.schedule.length ? `<table><thead><tr><th>Object</th><th>Category</th><th class="r">x, z (m)</th><th class="r">Rot.</th><th class="r">Footprint (m)</th></tr></thead><tbody>
${r.schedule.map(s => row([{ v: esc(s.name) }, { v: esc(s.category) }, { v: `${fm(s.x)}, ${fm(s.z)}`, cls: 'r mono' }, { v: Math.round(s.rot) + '°', cls: 'r mono' }, { v: s.w != null ? `${fm(s.w)} × ${fm(s.d)}` : '—', cls: 'r mono' }])).join('')}</tbody></table>` : '<div class="none">No objects placed.</div>'}

<h2>7 · Basis of checks</h2>
<ul class="basis">${r.basis.map(b => `<li>${esc(b)}</li>`).join('')}</ul>
<div class="disc">Generated by ZKR Atelier. This is a planning aid based on the rules listed above; it is not a certification of code compliance. Costs are estimates from the catalog prices in the application. Origin of coordinates is the room centre.</div>
</div></body></html>`;
}

// ======================= PDF =======================
const pdfSafe = (s) => String(s).replace(/[−–—]/g, '-').replace(/↔/g, '<->').replace(/≥/g, '>=').replace(/≤/g, '<=').replace(/[^\x20-\xFF]/g, '?');

export function reportPdf(r, jsPDF) {
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const PW = 210, M = 16, CW = PW - M * 2;
  let y = M, page = 1;
  const ink = [18, 36, 58], mute = [84, 96, 119];
  const T = (s, x, yy, o) => pdf.text(pdfSafe(s), x, yy, o);
  const footer = () => { pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7.5); pdf.setTextColor(...mute); T(`ZKR Atelier - ${r.project} - REF ${r.ref}`, M, 289); T(`Page ${page}`, PW - M, 289, { align: 'right' }); };
  const newPage = () => { footer(); pdf.addPage(); page++; y = M; };
  const need = (h) => { if (y + h > 282) newPage(); };
  const h2 = (s) => { need(14); y += 6; pdf.setFont('courier', 'bold'); pdf.setFontSize(8.5); pdf.setTextColor(...mute); T(s.toUpperCase(), M, y); pdf.setDrawColor(213, 206, 193); pdf.line(M, y + 1.8, PW - M, y + 1.8); y += 7; };
  const plain = (s, italic) => { pdf.setFont('helvetica', italic ? 'italic' : 'normal'); pdf.setFontSize(9); pdf.setTextColor(...(italic ? mute : ink)); const lines = pdf.splitTextToSize(pdfSafe(s), CW); need(lines.length * 4.4); pdf.text(lines, M, y); y += lines.length * 4.4 + 1; };
  const table = (cols, rows, opts = {}) => {
    // cols: [{h, w (mm), align}], rows: array of arrays of strings (+ optional colour via {t, rgb})
    need(10); pdf.setFont('courier', 'bold'); pdf.setFontSize(7.5); pdf.setTextColor(...mute);
    let x = M; cols.forEach(c => { T(c.h.toUpperCase(), c.align === 'r' ? x + c.w - 1 : x + 1, y, { align: c.align === 'r' ? 'right' : 'left' }); x += c.w; });
    pdf.setDrawColor(...ink); pdf.setLineWidth(0.4); pdf.line(M, y + 1.8, PW - M, y + 1.8); pdf.setLineWidth(0.2); y += 6;
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8.5);
    rows.forEach(row => {
      need(6.5); x = M;
      row.forEach((cell, i) => {
        const c = cols[i], txt = typeof cell === 'object' ? cell.t : cell;
        pdf.setTextColor(...(typeof cell === 'object' && cell.rgb ? cell.rgb : ink));
        const clipped = pdf.splitTextToSize(pdfSafe(txt), c.w - 2)[0] || '';
        T(clipped, c.align === 'r' ? x + c.w - 1 : x + 1, y, { align: c.align === 'r' ? 'right' : 'left' }); x += c.w;
      });
      pdf.setDrawColor(236, 231, 220); pdf.line(M, y + 1.8, PW - M, y + 1.8); y += 5.6;
    });
    if (opts.total) { need(8); pdf.setFont('helvetica', 'bold'); pdf.setTextColor(...ink); pdf.setDrawColor(...ink); pdf.setLineWidth(0.4); pdf.line(M, y - 3, PW - M, y - 3); pdf.setLineWidth(0.2); T(opts.total[0], M + 1, y + 1); T(opts.total[1], PW - M - 1, y + 1, { align: 'right' }); y += 6; }
    y += 2;
  };

  // ---- title block ----
  pdf.setFillColor(...ink); pdf.rect(M, y - 4, CW, 1.6, 'F'); y += 4;
  pdf.setFont('courier', 'bold'); pdf.setFontSize(8); pdf.setTextColor(...mute); T('ZKR ATELIER · COMPLIANCE REPORT', M, y);
  pdf.setFont('courier', 'normal'); T(dateLong(r.date), PW - M, y, { align: 'right' }); y += 8;
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(21); pdf.setTextColor(...ink); T(r.project, M, y); y += 6;
  pdf.setFont('courier', 'normal'); pdf.setFontSize(8.5); pdf.setTextColor(...mute); T(`${r.template} · ${r.category}    REF ${r.ref}`, M, y); y += 7;
  const bad = r.tally.collision || !r.status.accessible;
  pdf.setFillColor(244, 240, 231); pdf.rect(M, y - 4.5, CW, 9, 'F'); pdf.setFillColor(...(bad ? SEV_RGB.critical : r.tally.warning ? SEV_RGB.warning : SEV_RGB.ok)); pdf.rect(M, y - 4.5, 1.4, 9, 'F');
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(10); pdf.setTextColor(...ink); T(verdict(r), M + 4, y + 1.2); y += 11;
  // key figures
  const kf = [['Floor area', `${r.room.area} m2`], ['Room', `${fm(r.room.width, 1)} x ${fm(r.room.depth, 1)} m`], ['Objects', String(r.counts.objects)], ['Seats', `${r.counts.seats} / ${r.counts.maxCapacity}`]];
  kf.forEach((k, i) => { const x = M + i * (CW / 4); pdf.setDrawColor(213, 206, 193); pdf.rect(x, y - 4, CW / 4, 13); pdf.setFont('courier', 'bold'); pdf.setFontSize(6.5); pdf.setTextColor(...mute); T(k[0].toUpperCase(), x + 2.5, y); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(12); pdf.setTextColor(...ink); T(k[1], x + 2.5, y + 6); });
  y += 16;

  // ---- annotated plan (vector) ----
  h2('1 · Layout & findings');
  const pw = CW - 8, S = pw / r.room.width, ph = S * r.room.depth;
  need(ph + 14);
  const ox = M + 4, oy = y + 2;
  const X = (x) => ox + (x + r.room.width / 2) * S, Z = (z) => oy + (z + r.room.depth / 2) * S;
  pdf.setDrawColor(226, 222, 212); pdf.setLineWidth(0.1);
  for (let i = 0; i <= r.room.width; i++) pdf.line(ox + i * S, oy, ox + i * S, oy + ph);
  for (let i = 0; i <= r.room.depth; i++) pdf.line(ox, oy + i * S, ox + pw, oy + i * S);
  pdf.setDrawColor(...ink); pdf.setLineWidth(0.7); pdf.rect(ox, oy, pw, ph); pdf.setLineWidth(0.2);
  r.shapes.forEach(s => {
    const rgb = s.floor ? SEV_RGB[s.sev] : [138, 150, 166];
    const flagged = s.floor && s.sev !== 'ok';
    pdf.setDrawColor(...(flagged ? rgb : ink)); pdf.setLineWidth(0.25);
    if (s.floor) pdf.setFillColor(...(flagged ? rgb.map(v => Math.round(v + (255 - v) * 0.62)) : [233, 229, 218])); 
    const style = s.floor ? 'FD' : 'S';
    if (!s.floor) pdf.setLineDashPattern([0.8, 0.6], 0); else pdf.setLineDashPattern([], 0);
    if (s.circle) pdf.circle(X(s.circle.cx), Z(s.circle.cz), s.circle.r * S, style);
    else { const p = s.poly; pdf.lines(p.slice(1).map((q, i) => [(q.x - p[i].x) * S, (q.z - p[i].z) * S]), X(p[0].x), Z(p[0].z), [1, 1], style, true); }
  });
  pdf.setLineDashPattern([], 0);
  r.measurements.forEach(k => { pdf.setDrawColor(11, 122, 134); pdf.setLineDashPattern([1.2, 0.8], 0); pdf.line(X(k.a.x), Z(k.a.z), X(k.b.x), Z(k.b.z)); pdf.setLineDashPattern([], 0); pdf.setFont('courier', 'bold'); pdf.setFontSize(6.5); pdf.setTextColor(11, 122, 134); T(`${k.n} ${fm(k.dist)} m`, (X(k.a.x) + X(k.b.x)) / 2, (Z(k.a.z) + Z(k.b.z)) / 2 - 1, { align: 'center' }); });
  r.issues.forEach(k => { pdf.setFillColor(...SEV_RGB[k.severity]); pdf.setDrawColor(255, 255, 255); pdf.setLineWidth(0.3); pdf.circle(X(k.point.x), Z(k.point.z), 2.3, 'FD'); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(k.n > 99 ? 4.5 : 6); pdf.setTextColor(255, 255, 255); T(String(k.n), X(k.point.x), Z(k.point.z) + 0.9, { align: 'center' }); });
  y = oy + ph + 5;
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7.5); pdf.setTextColor(...mute); T('Numbered markers match section 3. Red = insufficient/collision, amber = tight, dashed = not a floor obstacle.', M, y); y += 2;

  // ---- compliance summary ----
  h2('2 · Compliance summary');
  table([{ h: 'Check', w: 100 }, { h: 'Result', w: CW - 100, align: 'r' }], [
    ['Capacity', `${r.counts.seats} of ${r.counts.maxCapacity} seats - ${r.status.overCap ? 'over limit' : 'within limit'}`],
    ['Fire egress (as evaluated by ZKR Atelier)', r.status.overCap ? 'Over limit' : 'Compliant'],
    ['Accessibility clearance', r.status.accessible ? 'Pass' : { t: 'Fail - clearances below 0.50 m', rgb: SEV_RGB.critical }],
    ['Collisions', String(r.tally.collision)],
    ['Insufficient clearances (< 0.50 m)', String(r.tally.critical)],
    ['Tight clearances (0.50 - 0.90 m)', String(r.tally.warning)],
    ['Tightest gap found', Number.isFinite(r.status.tightest) ? `${fm(r.status.tightest)} m` : '-'],
    ['Project score / space efficiency', `${r.status.score} / ${r.status.efficiency}%`],
  ]);
  plain('Egress here means seat count against the template capacity limit; drawn egress paths are illustrative and not measured.', true);

  // ---- issues ----
  h2(`3 · Detected issues (${r.issues.length})`);
  if (!r.issues.length) plain('No collisions or sub-threshold clearances were detected.', true);
  else table([{ h: '#', w: 10 }, { h: 'State', w: 28 }, { h: 'Objects', w: 78 }, { h: 'Gap', w: 22, align: 'r' }, { h: 'Location (x, z)', w: CW - 138, align: 'r' }],
    r.issues.map(k => [String(k.n), { t: SEVERITY_LABEL[k.severity], rgb: SEV_RGB[k.severity] }, `${k.a} <-> ${k.b}`, gapText(k.clearance), `${fm(k.point.x)}, ${fm(k.point.z)}`]));

  // ---- measurements ----
  h2(`4 · Measurements (${r.measurements.length})`);
  if (!r.measurements.length) plain('No measurements were taken.', true);
  else table([{ h: '#', w: 12 }, { h: 'Distance', w: 26, align: 'r' }, { h: 'Read', w: 62 }, { h: 'From', w: 41, align: 'r' }, { h: 'To', w: CW - 141, align: 'r' }],
    r.measurements.map(k => [k.n, `${fm(k.dist)} m`, MEAS_LABEL[k.status], `${fm(k.a.x)}, ${fm(k.a.z)}`, `${fm(k.b.x)}, ${fm(k.b.z)}`]));

  // ---- cost ----
  h2('5 · Cost summary');
  if (!r.counts.objects) plain('No objects placed - no cost to report.', true);
  else {
    table([{ h: 'Item', w: 92 }, { h: 'Qty', w: 16, align: 'r' }, { h: 'Unit', w: 30, align: 'r' }, { h: 'Total', w: CW - 138, align: 'r' }],
      [...r.counts.byType.map(g => [g.name, String(g.count), g.price ? usd(g.price) : 'included', usd(g.total)]),
        ['Furniture subtotal', '', '', usd(r.cost.subtotal)],
        [`Delivery & install (${r.cost.deliveryRate * 100}%)`, '', '', usd(r.cost.delivery)],
        [`Contingency (${r.cost.contingencyRate * 100}%)`, '', '', usd(r.cost.contingency)]],
      { total: ['Total estimate', usd(r.cost.total)] });
  }

  // ---- schedule ----
  h2('6 · Object schedule');
  if (!r.schedule.length) plain('No objects placed.', true);
  else table([{ h: 'Object', w: 62 }, { h: 'Category', w: 30 }, { h: 'x, z (m)', w: 30, align: 'r' }, { h: 'Rot.', w: 16, align: 'r' }, { h: 'Footprint (m)', w: CW - 138, align: 'r' }],
    r.schedule.map(s => [s.name, s.category, `${fm(s.x)}, ${fm(s.z)}`, Math.round(s.rot) + ' deg', s.w != null ? `${fm(s.w)} x ${fm(s.d)}` : '-']));

  // ---- basis ----
  h2('7 · Basis of checks');
  r.basis.forEach(b => plain('- ' + b));
  y += 2; plain('This is a planning aid based on the rules above; it is not a certification of code compliance. Costs are estimates from the catalog prices in the application. Coordinates are measured from the room centre.', true);
  footer();
  return pdf;
}

export function downloadText(filename, text, mime) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
