# Verification Screenshots

Real in-game WebGL camera captures (headless Chromium, real GPU rendering —
not a 2D/top-down proxy), taken by clicking the app's own district chips
(`focusDistrict()`), after the district-camera framing fix in this pass.

01_civic_core_plaza.png              — C-01 Civic Core (orientation: north)
02_makers_yard_plaza.png             — M-02 Makers Yard (orientation: north)
03_canal_quarter_plaza_mirrored.png  — Q-03 Canal Quarter (orientation: south — mirrored, flipped to avoid the fixed Atelier parcel)
04_garden_loop_plaza.png             — G-04 Garden Loop (orientation: north)

Each shows the intended street -> plaza -> landmark hierarchy: local street
in frame, the civic plaza (grass, cross-path, trees, bench, lamp) framed by
two flanking buildings, with the district's landmark building visible
beyond it.
