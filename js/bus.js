// Minimal event bus so the new workspace modules (inspector, overlay, modes,
// command palette, cost delta, report) can react to what app.js does without
// app.js importing any of them. app.js emits; modules subscribe.
//
// Events:
//   'layout'     — placed items or their positions changed (after updateStats)
//   'selection'  — the selected placed item changed (payload: { item|null })
//   'itemchange' — the selected item moved/rotated (payload: { item })
//   'mode'       — working mode changed (payload: { mode, previous })
//   'measure'    — measurements list/tool state changed
const listeners = new Map();
export const bus = {
  on(name, fn) {
    if (!listeners.has(name)) listeners.set(name, new Set());
    listeners.get(name).add(fn);
    return () => listeners.get(name)?.delete(fn);
  },
  emit(name, detail) {
    listeners.get(name)?.forEach(fn => {
      try { fn(detail); } catch (e) { console.error(`ZKR bus handler for "${name}" failed`, e); }
    });
  },
};
