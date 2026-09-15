// ZKR Atelier — additive UX layer.
// Nothing here touches app.js state or IDs it depends on; this only adds
// desktop panel collapse, drag-to-resize, and accordion behavior on top of
// the existing markup once it's in the DOM.

// The panel widths are actual CSS grid tracks (see .workspace in
// enhancements.css), driven by --panel-left-w / --panel-right-w custom
// properties — not inline widths on the panel elements themselves, since a
// fixed-track grid ignores a child's own width. Collapse and resize both
// just write those two properties.
const workspaceEl = document.querySelector('.workspace');
const lastWidth = { left: 274, right: 304 };

function setTrackWidth(side, px) {
  if (!workspaceEl) return;
  workspaceEl.style.setProperty(side === 'left' ? '--panel-left-w' : '--panel-right-w', px + 'px');
}

function initRailCollapse() {
  const pairs = [
    { panel: document.getElementById('leftPanel'), btn: document.getElementById('leftRailCollapse'), side: 'left' },
    { panel: document.getElementById('rightPanel'), btn: document.getElementById('rightRailCollapse'), side: 'right' },
  ];
  pairs.forEach(({ panel, btn, side }) => {
    if (!panel || !btn) return;
    btn.addEventListener('click', () => {
      const collapsed = panel.classList.toggle('rail-collapsed');
      btn.setAttribute('aria-expanded', String(!collapsed));
      btn.title = collapsed ? 'Expand panel' : 'Collapse panel';
      setTrackWidth(side, collapsed ? 52 : lastWidth[side]);
      // Give three.js a tick to re-measure the canvas after the width transition.
      window.dispatchEvent(new Event('resize'));
      setTimeout(() => window.dispatchEvent(new Event('resize')), 240);
    });
  });
}

function initRailResize() {
  const configs = [
    { panel: document.getElementById('leftPanel'), handle: document.getElementById('leftRailResizer'), min: 220, max: 420, side: 'left' },
    { panel: document.getElementById('rightPanel'), handle: document.getElementById('rightRailResizer'), min: 240, max: 460, side: 'right' },
  ];
  configs.forEach(({ panel, handle, min, max, side }) => {
    if (!panel || !handle) return;
    let dragging = false;
    let startX = 0;
    let startWidth = 0;

    const onMove = (e) => {
      if (!dragging) return;
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const delta = side === 'left' ? (clientX - startX) : (startX - clientX);
      const next = Math.max(min, Math.min(max, startWidth + delta));
      setTrackWidth(side, next);
      lastWidth[side] = next;
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      handle.classList.remove('active');
      document.body.style.cursor = '';
      window.dispatchEvent(new Event('resize'));
    };
    const onDown = (e) => {
      if (panel.classList.contains('rail-collapsed')) return;
      dragging = true;
      handle.classList.add('active');
      startX = e.touches ? e.touches[0].clientX : e.clientX;
      startWidth = panel.getBoundingClientRect().width;
      document.body.style.cursor = 'col-resize';
      e.preventDefault();
    };

    handle.addEventListener('mousedown', onDown);
    handle.addEventListener('touchstart', onDown, { passive: false });
    window.addEventListener('mousemove', onMove);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchend', onUp);
  });
}

// Turns each non-scrolling .panel-section in the side panels into a
// collapsible accordion: wraps everything after .panel-title into a
// .panel-section-body, and adds a chevron toggle. Sections that are the
// primary scrollable work areas (Furniture list, Placed Items) are left
// alone since collapsing your main content area isn't useful.
function initAccordions() {
  const sections = document.querySelectorAll('.panel-left .panel-section:not(.scroll), .panel-right .panel-section:not(.scroll)');
  sections.forEach((section) => {
    const title = section.querySelector('.panel-title');
    if (!title) return;

    // Move every sibling after the title into a body wrapper.
    const bodyInner = document.createElement('div');
    bodyInner.className = 'panel-section-body-inner';
    let node = title.nextSibling;
    const toMove = [];
    while (node) { toMove.push(node); node = node.nextSibling; }
    toMove.forEach((n) => bodyInner.appendChild(n));

    const body = document.createElement('div');
    body.className = 'panel-section-body';
    body.appendChild(bodyInner);
    section.appendChild(body);

    const toggle = document.createElement('span');
    toggle.className = 'panel-section-toggle';
    toggle.innerHTML = '<i class="fa-solid fa-chevron-down" aria-hidden="true" style="font-size:9px;"></i>';
    title.appendChild(toggle);

    section.classList.add('collapsible');
    title.setAttribute('role', 'button');
    title.setAttribute('tabindex', '0');
    title.setAttribute('aria-expanded', 'true');

    const toggleSection = () => {
      const collapsed = section.classList.toggle('collapsed');
      title.setAttribute('aria-expanded', String(!collapsed));
    };
    title.addEventListener('click', toggleSection);
    title.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleSection(); }
    });
  });
}

function boot() {
  initRailCollapse();
  initRailResize();
  initAccordions();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
