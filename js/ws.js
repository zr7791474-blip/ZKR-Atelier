// Shared workspace state for the new modules. Kept separate from app.js's
// `state` so the original state shape is untouched; `ctx` is the bridge app.js
// hands over at startup (scene objects + the existing actions to reuse).
export const ws = {
  ctx: null,            // set by initWorkspace(ctx)
  mode: 'design',       // 'design' | 'inspect' | 'present'
  overlay: false,       // compliance overlay visible
  issue: null,          // currently selected spatial issue (pair / wall record)
};

export const esc = (v) => String(v).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
export const fmtM = (n, d = 2) => (Math.abs(n) < 0.005 ? 0 : n).toFixed(d);
export const money = (n) => '$' + Math.round(n).toLocaleString();
export const signedMoney = (n) => (n < 0 ? '−' : '+') + '$' + Math.abs(Math.round(n)).toLocaleString();

// ---- Spatial issue selection (a collision / clearance record picked from the
// 3D marker, the inspector list or the report list) ----
import { bus } from './bus.js';
export const issueKey = (r) => (r.bId != null ? `p:${r.aId}:${r.bId}` : `w:${r.id}:${r.wall}`);
export function findIssue(key) {
  const a = ws.ctx?.state.analysis;
  if (!a || !key) return null;
  return a.pairs.find(r => issueKey(r) === key) || a.walls.find(r => issueKey(r) === key) || null;
}
export function selectIssue(rec) {
  ws.ctx.deselectActiveItem();
  ws.issueKey = issueKey(rec);
  bus.emit('issue', { key: ws.issueKey });
}
export function clearIssue() {
  if (!ws.issueKey) return;
  ws.issueKey = null;
  bus.emit('issue', { key: null });
}
bus.on('selection', ({ item }) => { if (item) clearIssue(); });
// An issue that no longer exists after an edit is dropped automatically.
bus.on('layout', () => { if (ws.issueKey && !findIssue(ws.issueKey)) clearIssue(); });
