// ZKR Atelier — spatial analysis (pure: no DOM, no three.js).
//
// One source of truth for "what is too close to what, and where". The
// Accessibility card, the Design-Intelligence tips, the 3D compliance
// overlay, the collision markers, the inspector and the exported report all
// read the result of analyzeLayout(), so they can never disagree.
//
// Thresholds are the ones the app already used — nothing here invents a new
// compliance number:
//   MIN_ACCESSIBLE_CLEARANCE  0.9 m    (accessibility card + measure tool)
//   CRITICAL_CLEARANCE        0.495 m  (0.9 × 0.55: the card's pass/fail line)
//   COLLISION_BUFFER          0.08 m   (findCollidingItem's placement buffer)
//
// What changed vs. the old inline loop in updateStats(), and why:
//  1. Footprints are the item's real bounding footprint (oriented rectangle,
//     or a circle for round items) instead of a circle whose radius was a
//     hard-coded 0.4 m for every template / restored / undo-restored item.
//  2. Items that do not occupy circulation floor space (ceiling pendants,
//     floor rugs, wall art) are not floor obstacles, so they are skipped.
//  3. A seat next to a table/desk/counter is an intentional working group,
//     not a clearance problem, so seat↔surface pairs are skipped.
//  4. Touching a wall (gap < COLLISION_BUFFER) means "placed against the
//     wall" (the placement clamp allows it); only a *sliver* gap between
//     0.08 m and the thresholds is an unusable channel worth flagging.
// All four are listed in ANALYSIS_BASIS so the report can state them.

export const MIN_ACCESSIBLE_CLEARANCE = 0.9;
export const CRITICAL_FACTOR = 0.55;
export const CRITICAL_CLEARANCE = MIN_ACCESSIBLE_CLEARANCE * CRITICAL_FACTOR; // 0.495
export const COLLISION_BUFFER = 0.08;

export const NON_FLOOR_TYPES = new Set(['pendant', 'rug', 'painting']);
export const ROUND_TYPES = new Set(['round_table', 'out_table', 'stool', 'plant', 'column']);

export const ANALYSIS_BASIS = [
  `Minimum accessible clearance: ${MIN_ACCESSIBLE_CLEARANCE.toFixed(2)} m between objects, and between objects and room boundaries.`,
  `Critical (fails the accessibility check) below ${CRITICAL_CLEARANCE.toFixed(3)} m; warning between ${CRITICAL_CLEARANCE.toFixed(3)} m and ${MIN_ACCESSIBLE_CLEARANCE.toFixed(2)} m.`,
  `Collision: footprints overlap or are closer than ${COLLISION_BUFFER.toFixed(2)} m (the same buffer used when placing objects).`,
  'Footprints are each object\'s bounding footprint: an oriented rectangle, or a circle for round objects. This is a planning approximation, not a survey.',
  'Ceiling pendants, area rugs and wall art do not obstruct floor circulation and are not checked.',
  'A seat adjacent to a table, desk or counter is treated as an intentional working group and is not checked against that surface.',
  `An object touching a room boundary (gap under ${COLLISION_BUFFER.toFixed(2)} m) is treated as placed against the wall.`,
];

export function classifyClearance(c) {
  if (c < COLLISION_BUFFER) return 'collision';
  if (c < CRITICAL_CLEARANCE) return 'critical';
  if (c < MIN_ACCESSIBLE_CLEARANCE) return 'warning';
  return 'ok';
}
const SEVERITY_RANK = { ok: 0, warning: 1, critical: 2, collision: 3 };
export const worseOf = (a, b) => (SEVERITY_RANK[b] > SEVERITY_RANK[a] ? b : a);

// ---------- footprints ----------
// item: { type, position:{x,z}, rotation, dims?:{w,d,cx,cz}, footprintRadius? }
// Three.js rotation.y = θ maps local (x,z) → (x·cosθ + z·sinθ, −x·sinθ + z·cosθ).
function rotate(lx, lz, theta) {
  const c = Math.cos(theta), s = Math.sin(theta);
  return { x: lx * c + lz * s, z: -lx * s + lz * c };
}

export function footprintOf(item) {
  const dims = item.dims || (() => { const s = (item.footprintRadius || 0.4) * 2; return { w: s, d: s, cx: 0, cz: 0 }; })();
  const { x: px, z: pz } = item.position;
  const off = rotate(dims.cx || 0, dims.cz || 0, item.rotation || 0);
  const cx = px + off.x, cz = pz + off.z;
  if (ROUND_TYPES.has(item.type)) {
    return { kind: 'circle', cx, cz, r: Math.max(dims.w, dims.d) / 2 };
  }
  const hw = dims.w / 2, hd = dims.d / 2;
  const pts = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([lx, lz]) => {
    const r = rotate(lx, lz, item.rotation || 0);
    return { x: cx + r.x, z: cz + r.z };
  });
  return { kind: 'poly', pts, cx, cz, r: Math.hypot(hw, hd) };
}

// Polygon (for drawing / clipping); circles become n-gons.
export function footprintPolygon(fp, n = 20) {
  if (fp.kind === 'poly') return fp.pts;
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return { x: fp.cx + Math.cos(a) * fp.r, z: fp.cz + Math.sin(a) * fp.r };
  });
}

// ---------- geometry ----------
const sub = (a, b) => ({ x: a.x - b.x, z: a.z - b.z });
const dot = (a, b) => a.x * b.x + a.z * b.z;
const len = (a) => Math.hypot(a.x, a.z);

function closestOnSegment(p, a, b) {
  const ab = sub(b, a), l2 = dot(ab, ab);
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  return { x: a.x + ab.x * t, z: a.z + ab.z * t };
}
function segSegClosest(a1, a2, b1, b2) {
  // Endpoints-to-segment is sufficient for non-crossing segments (overlap handled separately).
  let best = null;
  const test = (p, s1, s2, flip) => {
    const q = closestOnSegment(p, s1, s2);
    const d = len(sub(p, q));
    if (!best || d < best.d) best = { d, pa: flip ? q : p, pb: flip ? p : q };
  };
  test(a1, b1, b2, false); test(a2, b1, b2, false); test(b1, a1, a2, true); test(b2, a1, a2, true);
  return best;
}

function polyAxes(pts) {
  const axes = [];
  for (let i = 0; i < pts.length; i++) {
    const e = sub(pts[(i + 1) % pts.length], pts[i]);
    const l = len(e); if (l === 0) continue;
    axes.push({ x: -e.z / l, z: e.x / l });
  }
  return axes;
}
function project(pts, axis) {
  let mn = Infinity, mx = -Infinity;
  for (const p of pts) { const v = dot(p, axis); if (v < mn) mn = v; if (v > mx) mx = v; }
  return [mn, mx];
}
function polyArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p.x * q.z - q.x * p.z; }
  return a / 2;
}
function ccw(pts) { return polyArea(pts) < 0 ? [...pts].reverse() : pts; }
function clipPolygon(subject, clip) {
  // Sutherland–Hodgman; both convex.
  let out = ccw(subject);
  const c = ccw(clip);
  for (let i = 0; i < c.length; i++) {
    const a = c[i], b = c[(i + 1) % c.length];
    const inside = (p) => (b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x) >= -1e-9;
    const inter = (p, q) => {
      const dx1 = q.x - p.x, dz1 = q.z - p.z, dx2 = b.x - a.x, dz2 = b.z - a.z;
      const den = dx1 * dz2 - dz1 * dx2 || 1e-12;
      const t = ((a.x - p.x) * dz2 - (a.z - p.z) * dx2) / den;
      return { x: p.x + dx1 * t, z: p.z + dz1 * t };
    };
    const input = out; out = [];
    for (let j = 0; j < input.length; j++) {
      const cur = input[j], prev = input[(j + input.length - 1) % input.length];
      if (inside(cur)) { if (!inside(prev)) out.push(inter(prev, cur)); out.push(cur); }
      else if (inside(prev)) out.push(inter(prev, cur));
    }
    if (!out.length) return [];
  }
  return out;
}
function centroid(pts) {
  if (!pts.length) return null;
  const a = polyArea(pts);
  if (Math.abs(a) < 1e-9) { return { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, z: pts.reduce((s, p) => s + p.z, 0) / pts.length }; }
  let cx = 0, cz = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length]; const f = p.x * q.z - q.x * p.z;
    cx += (p.x + q.x) * f; cz += (p.z + q.z) * f;
  }
  return { x: cx / (6 * a), z: cz / (6 * a) };
}

// Signed clearance between two footprints: >0 gap, <0 penetration depth.
// Returns { clearance, point, segment:{a,b} } — `segment` joins the closest
// points (for a dimension line); `point` is where a marker should sit.
export function footprintClearance(A, B) {
  if (A.kind === 'circle' && B.kind === 'circle') {
    const d = Math.hypot(B.cx - A.cx, B.cz - A.cz);
    const clearance = d - A.r - B.r;
    const ux = d > 1e-9 ? (B.cx - A.cx) / d : 1, uz = d > 1e-9 ? (B.cz - A.cz) / d : 0;
    const pa = { x: A.cx + ux * A.r, z: A.cz + uz * A.r };
    const pb = { x: B.cx - ux * B.r, z: B.cz - uz * B.r };
    return { clearance, point: { x: (pa.x + pb.x) / 2, z: (pa.z + pb.z) / 2 }, segment: { a: pa, b: pb } };
  }
  const pa = footprintPolygon(A), pb = footprintPolygon(B);
  // Separating-axis test (exact for rect/rect; the circle-as-polygon error is < 1%).
  let minOverlap = Infinity;
  let separated = false;
  for (const axis of [...polyAxes(pa), ...polyAxes(pb)]) {
    const [a0, a1] = project(pa, axis), [b0, b1] = project(pb, axis);
    const overlap = Math.min(a1, b1) - Math.max(a0, b0);
    if (overlap <= 0) { separated = true; break; }
    if (overlap < minOverlap) minOverlap = overlap;
  }
  if (!separated) {
    const inter = clipPolygon(pa, pb);
    const point = centroid(inter) || { x: (A.cx + B.cx) / 2, z: (A.cz + B.cz) / 2 };
    return { clearance: -minOverlap, point, segment: { a: point, b: point } };
  }
  const found = [];
  for (let i = 0; i < pa.length; i++) {
    for (let j = 0; j < pb.length; j++) {
      found.push(segSegClosest(pa[i], pa[(i + 1) % pa.length], pb[j], pb[(j + 1) % pb.length]));
    }
  }
  const dmin = Math.min(...found.map(f => f.d));
  // Parallel facing edges produce several equally-close pairs; averaging them
  // puts the marker / dimension line at the middle of the shared span.
  const eq = found.filter(f => f.d <= dmin + 1e-6);
  const uniq = (k) => { const m = new Map(); eq.forEach(f => m.set(f[k].x.toFixed(4) + ',' + f[k].z.toFixed(4), f[k])); return [...m.values()]; };
  const mean = (pts) => ({ x: pts.reduce((s, p) => s + p.x, 0) / pts.length, z: pts.reduce((s, p) => s + p.z, 0) / pts.length });
  const sa = mean(uniq('pa')), sb = mean(uniq('pb'));
  return { clearance: dmin, point: { x: (sa.x + sb.x) / 2, z: (sa.z + sb.z) / 2 }, segment: { a: sa, b: sb } };
}

// Gap between a footprint and each of the four room boundaries (nearest first).
// Each entry carries a segment from the footprint to the boundary.
export function boundaryGaps(fp, room) {
  const pts = footprintPolygon(fp);
  const xs = pts.map(p => p.x), zs = pts.map(p => p.z);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const hx = room.width / 2, hz = room.depth / 2;
  const mid = (arr, key, v) => { const hit = arr.filter(p => Math.abs(p[key] - v) < 1e-6); return { x: hit.reduce((s, p) => s + p.x, 0) / hit.length, z: hit.reduce((s, p) => s + p.z, 0) / hit.length }; };
  const w = mid(pts, 'x', minX), e = mid(pts, 'x', maxX), n = mid(pts, 'z', minZ), s = mid(pts, 'z', maxZ);
  return [
    { wall: 'west',  gap: minX + hx, from: w, to: { x: -hx, z: w.z } },
    { wall: 'east',  gap: hx - maxX, from: e, to: { x: hx,  z: e.z } },
    { wall: 'north', gap: minZ + hz, from: n, to: { x: n.x, z: -hz } },
    { wall: 'south', gap: hz - maxZ, from: s, to: { x: s.x, z: hz } },
  ].sort((p, q) => p.gap - q.gap);
}

// ---------- layout analysis ----------
// items: placed items. room: {width, depth}. info(type) → { seats, cat }.
export function analyzeLayout(items, room, info = () => ({})) {
  const floor = items.filter(i => !NON_FLOOR_TYPES.has(i.type));
  const fps = new Map(floor.map(i => [i.id, footprintOf(i)]));
  const isSeat = (t) => (info(t).seats || 0) > 0;
  const isSurface = (t) => info(t).cat === 'surfaces';

  const pairs = [];
  const walls = [];
  const perItem = new Map(floor.map(i => [i.id, { worst: 'ok', nearest: null, pairs: [], wall: null }]));
  let tightest = Infinity, tightestIds = [];
  const counts = { collision: 0, critical: 0, warning: 0 };

  const noteNearest = (id, clearance, other) => {
    const rec = perItem.get(id);
    if (!rec.nearest || clearance < rec.nearest.clearance) rec.nearest = { clearance, other };
  };

  for (let i = 0; i < floor.length; i++) {
    const a = floor[i], A = fps.get(a.id);
    for (let j = i + 1; j < floor.length; j++) {
      const b = floor[j], B = fps.get(b.id);
      if ((isSeat(a.type) && isSurface(b.type)) || (isSeat(b.type) && isSurface(a.type))) continue;
      const reach = A.r + B.r + MIN_ACCESSIBLE_CLEARANCE;
      if (Math.hypot(A.cx - B.cx, A.cz - B.cz) > reach) { // far apart — cheap lower bound only
        continue;
      }
      const res = footprintClearance(A, B);
      noteNearest(a.id, res.clearance, b.id); noteNearest(b.id, res.clearance, a.id);
      if (res.clearance < tightest) { tightest = res.clearance; tightestIds = [a.id, b.id]; }
      const severity = classifyClearance(res.clearance);
      if (severity === 'ok') continue;
      const rec = { aId: a.id, bId: b.id, clearance: res.clearance, severity, point: res.point, segment: res.segment };
      pairs.push(rec);
      counts[severity]++;
      for (const id of [a.id, b.id]) { const r = perItem.get(id); r.pairs.push(rec); r.worst = worseOf(r.worst, severity); }
    }
    // Each boundary is judged on its own: an item can touch one wall (placed
    // against it) and still leave an unusable sliver to another.
    const gaps = boundaryGaps(A, room);
    const againstWall = gaps.some(g => g.gap < COLLISION_BUFFER);
    const w = gaps.find(g => g.gap >= COLLISION_BUFFER) || gaps[0];
    perItem.get(a.id).wall = { wall: w.wall, gap: w.gap, againstWall };
    if (w.gap >= COLLISION_BUFFER) {
      noteNearest(a.id, w.gap, 'wall:' + w.wall);
      if (w.gap < tightest) { tightest = w.gap; tightestIds = [a.id]; }
      const severity = classifyClearance(w.gap);
      if (severity !== 'ok') {
        const rec = { id: a.id, wall: w.wall, clearance: w.gap, severity, segment: { a: w.from, b: w.to }, point: { x: (w.from.x + w.to.x) / 2, z: (w.from.z + w.to.z) / 2 } };
        walls.push(rec);
        counts[severity]++;
        const r = perItem.get(a.id); r.worst = worseOf(r.worst, severity); r.wallIssue = rec;
      }
    }
  }
  pairs.sort((p, q) => p.clearance - q.clearance);
  walls.sort((p, q) => p.clearance - q.clearance);
  const accessible = floor.length < 2 || !(tightest < CRITICAL_CLEARANCE);
  return { pairs, walls, tightest, tightestIds, counts, accessible, perItem, footprints: fps, evaluated: floor.length };
}

// ---------- snapping (measure tool) ----------
// Snap a floor point to object corners / edges / room boundary within `tol` m.
export function snapPoint(items, room, x, z, tol = 0.22) {
  const p = { x, z };
  let best = null;
  const consider = (q, kind, rank) => {
    const d = len(sub(q, p));
    if (d > tol) return;
    const score = d + rank * 0.08; // prefer corners over edges over walls when close
    if (!best || score < best.score) best = { x: q.x, z: q.z, kind, score };
  };
  const hx = room.width / 2, hz = room.depth / 2;
  [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]].forEach(([cx, cz]) => consider({ x: cx, z: cz }, 'room corner', 0));
  consider({ x: Math.max(-hx, Math.min(hx, x)), z: -hz }, 'wall', 2);
  consider({ x: Math.max(-hx, Math.min(hx, x)), z: hz }, 'wall', 2);
  consider({ x: -hx, z: Math.max(-hz, Math.min(hz, z)) }, 'wall', 2);
  consider({ x: hx, z: Math.max(-hz, Math.min(hz, z)) }, 'wall', 2);
  for (const it of items) {
    if (NON_FLOOR_TYPES.has(it.type)) continue;
    const fp = footprintOf(it);
    if (fp.kind === 'circle') {
      const d = Math.hypot(x - fp.cx, z - fp.cz) || 1;
      consider({ x: fp.cx + ((x - fp.cx) / d) * fp.r, z: fp.cz + ((z - fp.cz) / d) * fp.r }, 'edge', 1);
      consider({ x: fp.cx, z: fp.cz }, 'centre', 3);
      continue;
    }
    fp.pts.forEach(v => consider(v, 'corner', 0));
    for (let i = 0; i < 4; i++) consider(closestOnSegment(p, fp.pts[i], fp.pts[(i + 1) % 4]), 'edge', 1);
  }
  return best ? { x: best.x, z: best.z, kind: best.kind } : { x, z, kind: null };
}

// Human-readable severity wording, shared by every surface that shows it.
export const SEVERITY_LABEL = { ok: 'Compliant', warning: 'Tight', critical: 'Insufficient', collision: 'Collision' };
