# ZKR Atelier — Planning Instrument

## Running it

This app uses ES module imports (`import * as THREE from 'three'`) and an
import map, which browsers only allow over `http://` or `https://`, not
`file://`. Serve the folder with any static server, for example:

```bash
# Python
python3 -m http.server 8080

# or Node
npx serve .
```

Then open `http://localhost:8080`. An internet connection is required —
Three.js, Tailwind, Font Awesome, jsPDF, and the Google Fonts are loaded
from CDNs rather than bundled locally.

## Structure

```
index.html            Markup shell only — no inline CSS/JS
css/
  main.css            Original design tokens, components, and layout rules
  enhancements.css     New UX pass: panel collapse/resize, accordions, nav
                       and toolbar regrouping — loaded after main.css and
                       wins deliberately
js/
  app.js              The original application logic — 3D scene, city,
                       furniture, templates, capacity/fire-egress/costing,
                       export — unchanged in behavior
  ui-enhancements.js  New, additive-only: panel rail-collapse, drag-to-resize
                       dividers, and accordion sections. Doesn't touch any
                       state or ID that app.js depends on.
```

## What changed in this pass

### Camera + mouse controls (priority 1–2 from the brief)
- **Fixed a real, unguarded bug**: the toolbar zoom in/out buttons moved
  `camera.position` directly with no distance clamp. `OrbitControls`'
  `minDistance`/`maxDistance` only guard its own internal wheel/pinch
  handling — not external camera moves — so repeated clicks could push the
  camera through the floor (zoom in) or lose the scene (zoom out) with no
  limit. Extracted a shared `dollyCamera(factor, focusPoint)` helper that
  clamps to the existing limits, used by both buttons now.
- **Fixed a real interaction-priority bug**: `renderer.domElement` (where
  `OrbitControls` attaches) is a *child* of `container` (where the
  furniture drag-to-move listener attaches). A mousedown during an armed
  furniture drag was bubbling to both handlers simultaneously — the camera
  would orbit *while* the furniture was being dragged, exactly the
  "interaction fights itself" failure the brief called out. Fixed by
  disabling `controls.enabled` for the duration of the actual drag (not the
  whole "armed" state, so the user can still orbit before committing to a
  drag) and restoring it on release.
- **Closed the edge case that fix could have introduced**: if a drag is
  cancelled (e.g. `Escape`) while a camera-flight animation
  (`focusOnPoint` / `transitionToView`) is mid-flight, blindly restoring
  `controls.enabled = true` would let user input interrupt the animation.
  Added a shared `cameraTransitionActive` flag set by both animation
  functions; the drag-cancel paths now only restore control if nothing
  else currently owns it.
- **Added cursor-focused zoom feel** without replacing `OrbitControls`'
  zoom (kept exactly as-is, so touch/pinch-zoom on tablets is untouched):
  a parallel `wheel` listener (passive, no `preventDefault`/
  `stopPropagation`, so it never competes with `OrbitControls`' own
  handling) raycasts the ground plane under the cursor and nudges
  `controls.target` toward it on each tick — so sustained scrolling
  naturally re-centers on the area being looked at, the way the brief
  asked for, without a risky wholesale zoom-system replacement.

### QA performed this pass
**Verified:** JS syntax after every edit (including catching and fixing a
self-introduced syntax error — an `str_replace` accidentally deleted a
function signature line — before it went any further, not left for later).
Zero duplicate top-level declarations file-wide. HTML tag balance. Traced
every `controls.enabled` write site in the file by hand to confirm none of
the fixes left an unguarded or conflicting state transition.
**Logically checked, not measured:** the wheel-listener's ground-plane
raycast is reasoned to be cheap (a plane intersection, no scene traversal)
rather than benchmarked.
**Cannot verify in this environment:** actual in-browser feel of the zoom/
drag interactions — same standing limitation as every prior pass, restated
here because this pass is specifically about interaction *feel*, where
that limitation matters most.

### Full furniture catalog (previously 6 of ~24 factories were upgraded — now all of them)
Every factory in `ITEM_CATALOG` now uses the shared geometry/material
helpers: `roundedBoxGeometry`, `roundedPanelGeometry`, `materialVariant`,
`taperedLegGeometry`, and a new `MATERIALS` library (oak, walnut, painted
wood, black/brushed/polished metal, concrete, stone, marble, glass, fabric,
leather, plaster, ceramic, foliage) so every piece reads as one coherent
system instead of some items looking upgraded and others looking like the
original primitives next to them. Covered: round/oval/rect tables, desk,
counter, reception desk, dining/accent chairs, stool, armchair, sofa, bed,
display shelf, tall bookshelf, clothing rack, gallery pedestal, planter,
pendant light, rug, painting, column, glass partition, outdoor bench,
umbrella table, planter box. Construction details added where they read as
real furniture rather than filler: a table stretcher bar and edge band, a
slight book-lean on shelves, a fluted column instead of a bare cylinder, a
partition rebuilt as actual glass (`MeshPhysicalMaterial` with transmission)
matching what it's already labeled as ("Glass Partition") in the catalog.

### Lighting
- Soft-shadow fix from the previous pass, confirmed still in place
  (`renderer.shadowMap.type = THREE.PCFSoftShadowMap`).
- Pendant lights now emit a real `THREE.PointLight` (warm, short-range,
  no shadow-casting to keep cost down) in addition to the emissive bulb
  mesh, so they actually illuminate the furniture beneath them. Checked
  the total dynamic light count against the busiest template (up to 6
  pendants + 4 base scene lights = 10 total, all but one non-shadow-casting)
  before deciding this was a safe addition rather than assuming it.

### Atelier facade ("the hero building")
- Added a stone plinth band around the two solid walls — a material
  transition at street level, the single biggest "grounded, designed
  building" cue that was missing.
- Canopy now uses a brushed-metal material and has two support struts
  instead of floating as a flat slab.
- The storefront sign's emissive glow is now tied to the actual brand
  color (was a fixed gray regardless of brand), and updates live when the
  brand color changes — same mechanism that already redraws the sign text.

### A bug caught and fixed before shipping, not after
While adding the plinth/canopy materials, the first draft referenced a
`MATERIALS_PRE` object that doesn't exist, from code that runs at module
top-level *before* the real `MATERIALS` library is declared later in the
file — a temporal-dead-zone `ReferenceError` on load. Caught by inspection
before testing, not left in: rewritten to use inline materials with a
comment explaining why (this code executes during initial scene
construction, not inside a function called later).

### QA performed this pass
**Verified (static, deterministic):** JS syntax (`node --check` as ES
module) after every edit, not just at the end; HTML tag balance; CSS brace
balance in both stylesheets; zero duplicate top-level `const`/`function`
declarations across the whole file; every furniture factory cross-checked
against `ITEM_CATALOG` to confirm none were missed; the rounded-geometry
helper's bounding box traced by hand against `BoxGeometry` semantics.
**Logically checked, not exhaustively proven:** the pendant point-light
count is reasoned to be safe based on total scene light count and lack of
shadow-casting, not measured on a GPU. The new facade geometry's exact
visual proportions (plinth height, canopy strut angle) are chosen values,
not verified against a render.
**Cannot verify in this environment:** actual visual appearance. This
sandbox has no network access to the CDNs the app loads (Three.js,
Tailwind, Font Awesome, Google Fonts), so nothing in this project has been
seen rendered in a browser at any point across any pass. Everything above
is code-correctness verification, not visual QA.

### Furniture, materials, and lighting (previously the weakest area — flagged, now actually addressed)
- **Soft shadows fixed.** `sunLight.shadow.radius = 4` was already configured
  but inert — `radius` only has an effect under `PCFSoftShadowMap`, and the
  renderer was set to `PCFShadowMap` (hard-edged shadows), so that setting
  was silently doing nothing. One-line fix, immediately softer, more
  realistic shadow edges everywhere, at no performance cost.
- **New shared furniture-quality helpers** (`roundedBoxGeometry`,
  `roundedPanelGeometry`, `materialVariant`, `taperedLegGeometry`) so pieces
  get rounded edges instead of raw box corners, tapered legs instead of
  square posts, and subtle per-instance color variation instead of every
  copy of the same chair being an identical clone. Verified the geometry
  math by hand (both rounded-geometry helpers produce the same bounding box
  as `BoxGeometry(width, height, depth)`, centered at origin — confirmed via
  the rotation matrix, not just assumed).
- **Rebuilt the highest-visibility pieces** with these helpers: dining chair,
  accent chair, round table, rectangular table, armchair, sofa — these are
  the items every template places the most of, so this is where the
  "looks procedural" complaint was most visible. Round table also gained a
  visible edge band; rectangular table gained a stretcher bar between legs
  (real furniture construction detail, not just a slab on posts).
- Leg/geometry reuse was kept consistent with the original's efficient
  pattern (one shared geometry per call, not one per leg) — checked
  specifically so this didn't quietly regress performance while chasing
  visual quality.

### Honest scope note
This pass deliberately did NOT touch: city building variety, the atelier's
own architecture, the remaining furniture factories (stools, desks,
shelving, counters, beds, etc. still use the older primitive geometry), or
a full material library (wood/stone/concrete/fabric PBR sets). Those are
real, valid parts of the original ask that are still outstanding — flagging
that explicitly rather than implying "the visual pass is done" because a
few pieces got upgraded.

### Mandatory fix — cars driving through the atelier
The city traffic loop's "spine route" used two straight lanes at
`z:[-3.1, 3.1]` spanning the full city width. That's symmetric around the
origin, so it ran directly through the shop's own parcel
(`x:[-6,6], z:[-5,5]`) — cars were driving straight through the building.
Fixed by adding a rectangular detour (extra waypoints) around the parcel on
both lanes, with real clearance past the walls on every side. Verified
programmatically (segment-vs-rectangle check across all 12 route points)
that no part of the route intersects the parcel. Pedestrian walk routes
were already clear of the parcel — checked, not touched.

### Mandatory fixes (interior workspace)
- **Boundary enforcement is now footprint-aware.** Every item's real bounding-box
  size is used to clamp it inside the room, instead of a flat 0.5m margin —
  so large furniture can no longer have part of its footprint stick through
  a wall. Template-authored layouts and undo/redo history restoration keep
  the exact original (legacy) behavior via an explicit `skipBoundaryCheck`
  flag, so nothing about existing templates changed.
- **Collision detection** — a broad-phase, circle-based check (documented in
  code as a deliberate simplification: cheap, rotation-invariant, slightly
  generous on long thin items) blocks furniture from being dropped inside
  another piece. The placement preview tints red/green live so you can see
  validity before you click, and an invalid click is rejected with a toast
  instead of silently placing.
- **Drag-to-move existing items** — arm "Move" (via the floating context
  toolbar or by re-selecting), drag, and the same boundary/collision rules
  apply; if you drop on an invalid spot it snaps to the nearest clear space
  instead of leaving items stacked. Fully wired into undo/redo as a new
  `move` history action.
- **Camera limits** — min/max zoom distance already existed; added a pan
  clamp so dragging the orbit target can't send the camera arbitrarily far
  from the project ("lose the project").

### New professional tools
- **Floating context toolbar** (Move / Rotate / Duplicate / Delete) appears
  above whatever's selected, tracking it in screen space every frame.
- **Duplicate** (`Ctrl/Cmd+D`), **rotate alias** (`R`), **grid toggle**
  (`G`), **measurement tool** (click two floor points for a live distance
  label), and **double-click to focus the camera on an item** — all real,
  wired features, cross-checked against the existing shortcut list so
  nothing already bound (e.g. `F` for Fire Egress) was overwritten.
- **Keyboard shortcuts help modal** (`?` key or the rail's `?` icon).
- **Dark icon rail** (catalog / grid / measure / analytics-panel toggle /
  cost / help) styled after the reference direction you shared, driving
  real existing actions rather than decorative dead buttons.
- **Compact "Performance & Analytics" card** at the top of the right panel:
  Fire Egress + Capacity compliance status, and Estimated Cost + Furniture
  Subtotal. Both financial figures are the app's real computed numbers —
  deliberately not fabricating a "Built Value" metric that has no basis in
  this app's model, unlike the reference mockup's invented figure.

### From the previous pass (still in place)
- Refactored into `index.html` + `css/` + `js/` (see Structure below).
- Regrouped top nav, bottom toolbar, and side panels into clearer clusters.
- Panel rail-collapse and drag-resize — now correctly implemented via CSS
  grid custom properties (`--panel-left-w` / `--panel-right-w`) rather than
  inline widths, which don't affect a fixed-track grid. (A bug in the first
  pass's resize code was caught and fixed here.)
- Accordion sections for Capacity / Fire Egress / Spatial Register / Brand /
  Costing.
- Consolidated the four competing CSS "design passes" main.css had
  accumulated into one decisive layer (`enhancements.css`).

## Known scope limits — read before assuming these are done

The reference image and prior briefs also asked for: fully varied
procedural city architecture (the app already has a real, working traffic
and pedestrian system — cars follow routes via `loopPathPoint`, pedestrians
walk sidewalks with pause/resume behavior — so that wasn't rebuilt, only
left alone since it already works), a full oriented-box collision system
(this pass uses circle-approximated collision, documented above as a
conscious simplification), and literal 100% pixel-parity with a static,
painterly AI-generated illustration (not achievable for a real-time WebGL
scene without misrepresenting what was actually built — see the concrete
list of what *was* pulled from that reference above).

The `getFootprintRadius`, `findNearestValidSpot`, `armMoveSelected`, and
`focusOnPoint` functions in `js/app.js` are reasonable next places to build
from if you want to go further — e.g. true oriented-box collision, or a
snap-to-wall/snap-to-grid assist during drag.
