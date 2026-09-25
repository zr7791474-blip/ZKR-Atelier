// Measurement tool — replaces the original one-shot tool in app.js.
//
// Workflow: press M (or the ruler in the rail) → click a start point → a live
// line follows the cursor with the running distance → click the end point to
// commit. Measurements persist (several at once, saved with the project) until
// deleted from the inspector or cleared. Points snap to object corners/edges
// and room boundaries (spatial-analysis.snapPoint). Colour uses the app's
// existing three-tier read of a distance against MIN_ACCESSIBLE_CLEARANCE, so
// a measured gap tells you whether it would pass.
import * as THREE from 'three';
import { bus } from './bus.js';
import { MIN_ACCESSIBLE_CLEARANCE, CRITICAL_FACTOR, snapPoint } from './spatial-analysis.js';

const COLORS = { compliant: 0x4C8B5A, tight: 0xD6A94A, violation: 0xC43A3A };
const NEUTRAL = 0x17B6C4;

export function statusOf(dist) {
  if (dist >= MIN_ACCESSIBLE_CLEARANCE) return 'compliant';
  if (dist >= MIN_ACCESSIBLE_CLEARANCE * CRITICAL_FACTOR) return 'tight';
  return 'violation';
}

export function createMeasureTool(ctx) {
  const { scene, camera, renderer, container, state, showToast, t } = ctx;
  const group = new THREE.Group(); group.name = 'measurements'; scene.add(group);
  const layer = document.createElement('div'); layer.className = 'measure-layer'; document.body.appendChild(layer);

  let active = false;
  let start = null;            // { x, z } pending start point
  let hover = null;            // { x, z, kind }
  let seq = 0;
  const items = [];            // { id, a, b, dist, status, mesh, label }
  const tmp = new THREE.Vector3();

  // shared geometry
  const quad = new THREE.PlaneGeometry(1, 1); quad.rotateX(-Math.PI / 2);
  const dotGeo = new THREE.CircleGeometry(0.07, 20); dotGeo.rotateX(-Math.PI / 2);
  const ringGeo = new THREE.RingGeometry(0.1, 0.14, 24); ringGeo.rotateX(-Math.PI / 2);

  const mat = (color, opacity = 1) => new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: false, side: THREE.DoubleSide });

  function segmentMesh(a, b, color) {
    const g = new THREE.Group();
    const L = Math.hypot(b.x - a.x, b.z - a.z);
    const line = new THREE.Mesh(quad, mat(color)); line.scale.set(L, 1, 0.035);
    line.position.set((a.x + b.x) / 2, 0.045, (a.z + b.z) / 2);
    line.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x);
    g.add(line);
    // perpendicular end ticks read as a dimension line, not a stray stroke
    [a, b].forEach(p => {
      const tick = new THREE.Mesh(quad, mat(color)); tick.scale.set(0.035, 1, 0.3);
      tick.position.set(p.x, 0.045, p.z); tick.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x);
      g.add(tick);
      const dot = new THREE.Mesh(dotGeo, mat(color)); dot.position.set(p.x, 0.05, p.z); g.add(dot);
    });
    return g;
  }
  function dispose(obj) { obj.traverse(o => { if (o.material) o.material.dispose(); }); group.remove(obj); }

  function makeLabel(text, cls) {
    const el = document.createElement('div');
    el.className = 'measure-label ' + cls; el.innerHTML = text; layer.appendChild(el); return el;
  }
  const labelHtml = (dist, status) => `<b>${dist.toFixed(2)} m</b>${status ? `<span>${t('measure.' + status)}</span>` : ''}`;

  // ---- preview (hover marker + rubber band) ----
  let previewGroup = null, previewLabel = null;
  function clearPreview() {
    if (previewGroup) { dispose(previewGroup); previewGroup = null; }
    if (previewLabel) { previewLabel.remove(); previewLabel = null; }
  }
  function updatePreview() {
    clearPreview();
    if (!active || !hover) return;
    previewGroup = new THREE.Group();
    const ring = new THREE.Mesh(ringGeo, mat(hover.kind ? 0xF5F1EA : NEUTRAL, 0.95)); ring.position.set(hover.x, 0.05, hover.z); previewGroup.add(ring);
    if (start) {
      const dist = Math.hypot(hover.x - start.x, hover.z - start.z);
      const st = statusOf(dist);
      previewGroup.add(segmentMesh(start, hover, COLORS[st]));
      previewLabel = makeLabel(labelHtml(dist, null), 'measure-label--live');
      previewLabel._pt = { x: (start.x + hover.x) / 2, z: (start.z + hover.z) / 2 };
    } else if (hover.kind) {
      previewLabel = makeLabel(`<span>${hover.kind}</span>`, 'measure-label--snap');
      previewLabel._pt = { x: hover.x, z: hover.z };
    }
    group.add(previewGroup);
  }

  // ---- commit / remove ----
  function commit(a, b) {
    const dist = Math.hypot(b.x - a.x, b.z - a.z);
    if (dist < 0.02) return;
    const status = statusOf(dist);
    const mesh = segmentMesh(a, b, COLORS[status]); group.add(mesh);
    const label = makeLabel(labelHtml(dist, status), 'measure-label--' + status);
    label._pt = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
    items.push({ id: 'm' + (++seq), a: { x: a.x, z: a.z }, b: { x: b.x, z: b.z }, dist, status, mesh, label });
    changed();
  }
  function changed() { ctx.flashSaveStatus?.(); bus.emit('measure', {}); }

  function snap(e) {
    const hit = ctx.getMouseIntersection(e);
    if (!hit) return null;
    return snapPoint(state.placedItems, { width: ctx.ROOM_W, depth: ctx.ROOM_D }, hit.point.x, hit.point.z, 0.22);
  }

  const api = {
    get active() { return active; },
    toggle(force) {
      active = force !== undefined ? force : !active;
      start = null; hover = null; clearPreview();
      container.classList.toggle('measure-mode', active);
      document.getElementById('measureToggleBtn')?.classList.toggle('active', active);
      if (active) {
        ctx.deselectActiveItem();
        if (state.selectedItem) ctx.selectItem(state.selectedItem); // disarm placement, same as the old tool
        if (ctx.getMode() === 'present') ctx.setMode('design');
        showToast('Measure: click a start point, then an end point', 'fa-ruler');
      } else showToast('Measure tool off', 'fa-ruler');
      bus.emit('measure', {});
    },
    // returns true when the click was consumed
    click(e) {
      if (!active) return false;
      const p = snap(e); if (!p) return true;
      if (!start) start = { x: p.x, z: p.z };
      else { commit(start, p); start = null; }
      hover = p; updatePreview(); bus.emit('measure', {});
      return true;
    },
    move(e) {
      if (!active) return;
      const p = snap(e); if (!p) return;
      hover = p; updatePreview();
    },
    // Esc: cancel a pending start first; returns true if it did something
    cancelPending() { if (!active || !start) return false; start = null; updatePreview(); bus.emit('measure', {}); return true; },
    pending() { return !!start; },
    list() { return items.map(({ id, dist, status, a, b }) => ({ id, dist, status, a, b })); },
    remove(id) {
      const i = items.findIndex(m => m.id === id); if (i < 0) return;
      dispose(items[i].mesh); items[i].label.remove(); items.splice(i, 1); changed();
    },
    clear() {
      if (!items.length) return;
      items.forEach(m => { dispose(m.mesh); m.label.remove(); }); items.length = 0; changed();
      showToast('Measurements cleared', 'fa-eraser');
    },
    serialize() { return items.map(({ a, b }) => ({ a, b })); },
    restore(arr) {
      items.forEach(m => { dispose(m.mesh); m.label.remove(); }); items.length = 0;
      (Array.isArray(arr) ? arr : []).forEach(m => { if (m?.a && m?.b && [m.a.x, m.a.z, m.b.x, m.b.z].every(Number.isFinite)) commit(m.a, m.b); });
    },
    setVisible(v) { group.visible = v; layer.style.display = v ? '' : 'none'; },
    // per-frame: keep DOM labels glued to their 3D midpoints
    frame() {
      if (!group.visible) return;
      const rect = renderer.domElement.getBoundingClientRect();
      const place = (el) => {
        if (!el?._pt) return;
        tmp.set(el._pt.x, 0.3, el._pt.z).project(camera);
        el.style.display = tmp.z < 1 && state.cityScale === 'interior' ? 'flex' : 'none';
        el.style.left = rect.left + (tmp.x * 0.5 + 0.5) * rect.width + 'px';
        el.style.top = rect.top + (-tmp.y * 0.5 + 0.5) * rect.height + 'px';
      };
      items.forEach(m => place(m.label)); place(previewLabel);
    },
  };

  container.addEventListener('mousemove', (e) => api.move(e));
  return api;
}
