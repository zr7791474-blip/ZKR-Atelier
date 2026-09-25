// Spatial overlay — "what is wrong, and where is it wrong?" inside the scene.
//
// Reads state.analysis (the same result behind the Accessibility card and the
// report) and draws it on the floor, CAD-style:
//   • Collision markers  — always on (outside Presentation): a floor ring at the
//     overlap plus a small numbered pin. Click the pin → the inspector shows the
//     issue (which objects, overlap depth, location) and both objects highlight.
//   • Compliance overlay — optional (Inspect mode / O key / command palette):
//     each floor footprint is tinted green / amber / red by its worst state and
//     every sub-threshold gap gets a dimension line with its value.
// Restrained by design: flat fills at low opacity, hairline outlines, no glow.
import * as THREE from 'three';
import { bus } from './bus.js';
import { ws, fmtM, selectIssue, findIssue, issueKey } from './ws.js';
import { footprintPolygon, NON_FLOOR_TYPES } from './spatial-analysis.js';

const SEV_COLOR = { ok: 0x4C8B5A, warning: 0xD6A94A, critical: 0xC43A3A, collision: 0xC43A3A };
const FILL_OPACITY = { ok: 0.14, warning: 0.30, critical: 0.36, collision: 0.42 };
const MAX_DIM_LABELS = 40;

export function initSpatialOverlay(ctx) {
  const { scene, camera, renderer, state, outlinePass } = ctx;
  const group = new THREE.Group(); group.name = 'spatial-overlay'; scene.add(group);
  const layer = document.createElement('div'); layer.className = 'sp-layer'; document.body.appendChild(layer);
  const quad = new THREE.PlaneGeometry(1, 1); quad.rotateX(-Math.PI / 2);
  const ringGeo = new THREE.RingGeometry(0.85, 1, 32); ringGeo.rotateX(-Math.PI / 2);
  let anchors = [];     // { el, x, z, y } DOM elements pinned to a floor point
  let selectedRing = null;
  let outlineOwned = false;
  const tmp = new THREE.Vector3();

  const mat = (c, o = 1) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, depthWrite: false, side: THREE.DoubleSide });
  const lineMat = (c, o = 0.9) => new THREE.LineBasicMaterial({ color: c, transparent: true, opacity: o });

  function clear() {
    group.children.slice().forEach(o => { o.traverse(n => { if (n.material) n.material.dispose(); if (n.geometry && n.geometry !== quad && n.geometry !== ringGeo) n.geometry.dispose(); }); group.remove(o); });
    anchors.forEach(a => a.el.remove()); anchors = []; selectedRing = null;
  }

  function segment(a, b, color, y = 0.06, w = 0.03, o = 1) {
    const g = new THREE.Group();
    const L = Math.hypot(b.x - a.x, b.z - a.z); if (L < 0.005) return g;
    const ang = -Math.atan2(b.z - a.z, b.x - a.x);
    const line = new THREE.Mesh(quad, mat(color, o)); line.scale.set(L, 1, w); line.position.set((a.x + b.x) / 2, y, (a.z + b.z) / 2); line.rotation.y = ang; g.add(line);
    [a, b].forEach(p => { const t = new THREE.Mesh(quad, mat(color, o)); t.scale.set(w, 1, 0.16); t.position.set(p.x, y, p.z); t.rotation.y = ang; g.add(t); });
    return g;
  }
  function ring(pt, radius, color, o = 0.9) {
    const r = new THREE.Mesh(ringGeo, mat(color, o)); r.position.set(pt.x, 0.075, pt.z); r.scale.set(radius, 1, radius); return r;
  }
  function anchor(el, x, z, y = 0.05) { layer.appendChild(el); anchors.push({ el, x, z, y }); }

  function pin(rec, n) {
    const b = document.createElement('button'); b.type = 'button';
    b.className = 'sp-pin sp-pin--' + rec.severity; b.dataset.key = issueKey(rec);
    b.setAttribute('aria-label', `${rec.severity === 'collision' ? 'Collision' : 'Clearance issue'} ${n}: ${fmtM(Math.abs(rec.clearance))} metres — inspect`);
    b.innerHTML = `<span>${n}</span>`;
    b.addEventListener('click', (e) => { e.stopPropagation(); pickIssue(rec); });
    b.addEventListener('pointerdown', (e) => e.stopPropagation());
    return b;
  }
  function dimLabel(rec) {
    const b = document.createElement('button'); b.type = 'button';
    b.className = 'sp-dim sp-dim--' + rec.severity; b.dataset.key = issueKey(rec);
    b.textContent = rec.clearance < 0 ? `−${fmtM(-rec.clearance)}` : fmtM(rec.clearance);
    b.title = 'Clearance (m) — click to inspect';
    b.addEventListener('click', (e) => { e.stopPropagation(); pickIssue(rec); });
    b.addEventListener('pointerdown', (e) => e.stopPropagation());
    return b;
  }
  function pickIssue(rec) { selectIssue(rec); focusIssue(rec); }
  function focusIssue(rec) { ctx.focusOnPoint(new THREE.Vector3(rec.point.x, 0.3, rec.point.z), 5.5); }

  function visible() { return state.cityScale === 'interior' && ws.mode !== 'present'; }

  function rebuild() {
    clear();
    const a = state.analysis;
    if (!a || !visible()) { layer.style.display = 'none'; group.visible = false; return; }
    layer.style.display = ''; group.visible = true;

    // ---- compliance overlay: footprints + clearance dimension lines ----
    if (ws.overlay) {
      state.placedItems.forEach(item => {
        if (NON_FLOOR_TYPES.has(item.type)) return;
        const fp = a.footprints.get(item.id); if (!fp) return;
        const sev = a.perItem.get(item.id)?.worst || 'ok';
        const pts = footprintPolygon(fp, 28);
        const shape = new THREE.Shape(pts.map(p => new THREE.Vector2(p.x, -p.z)));
        const geo = new THREE.ShapeGeometry(shape); geo.rotateX(-Math.PI / 2);
        const fill = new THREE.Mesh(geo, mat(SEV_COLOR[sev], FILL_OPACITY[sev])); fill.position.y = 0.035; group.add(fill);
        const loop = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts.map(p => new THREE.Vector3(p.x, 0.04, p.z))), lineMat(SEV_COLOR[sev], sev === 'ok' ? 0.55 : 0.95));
        group.add(loop);
      });
      const all = [...a.pairs, ...a.walls].filter(r => r.severity !== 'collision');
      all.forEach((rec, i) => {
        group.add(segment(rec.segment.a, rec.segment.b, SEV_COLOR[rec.severity]));
        if (i < MAX_DIM_LABELS) anchor(dimLabel(rec), rec.point.x, rec.point.z, 0.08);
      });
    }

    // ---- collision markers (always, outside Presentation) ----
    a.pairs.filter(r => r.severity === 'collision').forEach((rec, i) => {
      group.add(ring(rec.point, Math.max(0.16, Math.min(0.4, -rec.clearance + 0.12)), SEV_COLOR.collision));
      anchor(pin(rec, i + 1), rec.point.x, rec.point.z, 0.08);
    });
    drawSelected();
  }

  // selected issue: a larger ring + both objects outlined in amber
  function drawSelected() {
    if (selectedRing) { group.remove(selectedRing); selectedRing.material.dispose(); selectedRing = null; }
    const rec = ws.issueKey ? findIssue(ws.issueKey) : null;
    layer.querySelectorAll('.selected').forEach(e => e.classList.remove('selected'));
    if (!rec) return;
    selectedRing = ring(rec.point, 0.42, 0xF5F1EA, 1); group.add(selectedRing);
    layer.querySelector(`[data-key="${CSS.escape(ws.issueKey)}"]`)?.classList.add('selected');
  }
  function syncOutline() {
    const rec = ws.issueKey ? findIssue(ws.issueKey) : null;
    if (rec) {
      const ids = [rec.aId ?? rec.id, rec.bId].filter(v => v != null);
      outlinePass.selectedObjects = state.placedItems.filter(i => ids.includes(i.id)).map(i => i.mesh);
      outlinePass.visibleEdgeColor.set(0xF2A33C); outlinePass.hiddenEdgeColor.set(0x7a5420);
      outlineOwned = true;
    } else if (outlineOwned) {
      outlineOwned = false;
      outlinePass.visibleEdgeColor.set(0x00f0ff); outlinePass.hiddenEdgeColor.set(0x0a4a55);
      outlinePass.selectedObjects = state.activeItem ? [state.activeItem.mesh] : [];
    }
  }

  bus.on('layout', () => { rebuild(); syncOutline(); });
  bus.on('mode', rebuild);
  bus.on('overlay', rebuild);
  bus.on('scale', rebuild);
  bus.on('issue', () => { drawSelected(); syncOutline(); });
  bus.on('issue-focus', ({ rec }) => focusIssue(rec));

  return {
    rebuild,
    frame() {
      if (!group.visible) return;
      const rect = renderer.domElement.getBoundingClientRect();
      for (const a of anchors) {
        tmp.set(a.x, a.y, a.z).project(camera);
        const on = tmp.z < 1 && tmp.x > -1.1 && tmp.x < 1.1 && tmp.y > -1.1 && tmp.y < 1.1;
        a.el.style.display = on ? '' : 'none';
        if (on) { a.el.style.left = rect.left + (tmp.x * 0.5 + 0.5) * rect.width + 'px'; a.el.style.top = rect.top + (-tmp.y * 0.5 + 0.5) * rect.height + 'px'; }
      }
    },
  };
}
