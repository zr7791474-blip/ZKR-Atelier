import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutlinePass } from 'three/addons/postprocessing/OutlinePass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { bus } from './bus.js';
import { MIN_ACCESSIBLE_CLEARANCE, COLLISION_BUFFER, NON_FLOOR_TYPES, analyzeLayout, footprintOf, footprintClearance } from './spatial-analysis.js';
import { ws, clearIssue } from './ws.js';
import { initWorkspace } from './workspace.js';

// ========== MATERIAL LIBRARY ==========
// One shared, named set of materials so every factory draws from the same
// palette instead of hand-rolling roughness/metalness values inconsistently.
// Cached (not re-created per call) since MeshStandardMaterial instances are
// cheap to share across many meshes — this also cuts draw-call/material
// churn versus the old one-material-per-object-per-call pattern.
//
// Declared immediately after the THREE import (rather than further down
// near the furniture factories that mostly use it) because several
// module-top-level statements — e.g. the outdoor bench placement loop —
// call factory functions like makeOutdoorBenchMesh() synchronously during
// initial scene construction, well before the old declaration site further
// down the file. `const` bindings are hoisted but left in the temporal
// dead zone until their declaration line actually executes, so referencing
// MATERIALS from a function invoked that early threw
// "ReferenceError: Cannot access 'MATERIALS' before initialization" and
// aborted the whole module — which is what produced the blank viewport and
// empty catalog/template panels (every render/populate call after that
// point in the file never ran). Moving the object literal here removes the
// ordering hazard entirely; it only depends on THREE, which is already
// imported above.
const MATERIALS = {
  oak:          () => new THREE.MeshStandardMaterial({ color: 0x8B6F47, roughness: 0.42, metalness: 0 }),
  walnut:       () => new THREE.MeshStandardMaterial({ color: 0x3E2C22, roughness: 0.38, metalness: 0 }),
  paintedWood:  (hex) => new THREE.MeshStandardMaterial({ color: hex, roughness: 0.55, metalness: 0 }),
  blackMetal:   () => new THREE.MeshStandardMaterial({ color: 0x2A2826, roughness: 0.35, metalness: 0.55 }),
  brushedMetal: () => new THREE.MeshStandardMaterial({ color: 0x9AA0A6, roughness: 0.32, metalness: 0.85 }),
  polishedMetal:() => new THREE.MeshStandardMaterial({ color: 0xC9CCCF, roughness: 0.12, metalness: 0.95 }),
  concrete:     () => new THREE.MeshStandardMaterial({ color: 0xAFA99C, roughness: 0.92, metalness: 0 }),
  stone:        () => new THREE.MeshStandardMaterial({ color: 0xC7BFAE, roughness: 0.75, metalness: 0 }),
  marble:       () => new THREE.MeshStandardMaterial({ color: 0xE9E4D8, roughness: 0.22, metalness: 0.05 }),
  glass:        () => new THREE.MeshPhysicalMaterial({ color: 0xF5F1EA, roughness: 0.06, transparent: true, opacity: 0.35, metalness: 0.02, transmission: 0.45, clearcoat: 0.7 }),
  fabric:       (hex) => new THREE.MeshStandardMaterial({ color: hex, roughness: 0.9, metalness: 0 }),
  leather:      (hex) => new THREE.MeshStandardMaterial({ color: hex, roughness: 0.5, metalness: 0.05 }),
  plaster:      () => new THREE.MeshStandardMaterial({ color: 0xEFE9DD, roughness: 0.85, metalness: 0 }),
  ceramic:      (hex = 0xF5F1EA) => new THREE.MeshStandardMaterial({ color: hex, roughness: 0.18, metalness: 0.02 }),
  foliage:      () => new THREE.MeshStandardMaterial({ color: 0x4B6B4E, roughness: 0.75, metalness: 0 }),
};

// ========== I18N ==========
// Central translation dictionary — EN/FR/AR genuinely implemented; the
// remaining four languages named in the brief are intentionally left out
// of this dictionary and surfaced in the UI as disabled "Coming soon"
// options rather than faked with partial/placeholder text.
const I18N = {
  en: {
    'nav.project': 'Project', 'nav.template': 'Template',
    'view.perspective': '3D Perspective', 'view.city': 'City Overview', 'view.floor': 'Floor Plan',
    'nav.fireEgress': 'Fire Egress', 'nav.costEstimate': 'Cost Estimate', 'nav.exportPdf': 'Export PDF',
    'breadcrumb.workspace': 'Design Workspace', 'breadcrumb.city': 'City Overview', 'breadcrumb.floor': 'Floor Plan',
    'save.saved': 'Saved', 'save.saving': 'Saving…',
    'notif.title': 'Activity', 'notif.empty': 'No activity yet.', 'notif.clear': 'Clear all',
    'panel.performance': 'Performance & Analytics', 'panel.compliance': 'Compliance Check',
    'panel.financial': 'Financial Tracker', 'panel.insight': 'Design Intelligence',
    'panel.lighting': 'Lighting', 'panel.capacity': 'Capacity Planner',
    'compliance.fireEgress': 'Fire egress', 'compliance.accessibility': 'Accessibility', 'compliance.capacity': 'Capacity',
    'compliance.compliant': 'Compliant', 'compliance.overLimit': 'Over limit', 'compliance.withinLimit': 'Within limit',
    'compliance.tightClearance': 'Tight clearance',
    'financial.cost': 'Estimated cost', 'financial.furniture': 'Furniture subtotal', 'financial.builtValue': 'Built value',
    'score.label': 'Project score',
    'light.morning': 'Morning', 'light.noon': 'Noon', 'light.golden': 'Golden Hr', 'light.evening': 'Evening',
    'light.night': 'Night', 'light.live': 'Live', 'light.overcast': 'Overcast', 'light.bluehour': 'Blue Hr',
    'insight.empty': 'Add furniture to see live layout suggestions.',
    'lang.comingSoon': 'Coming soon',
    'measure.compliant': 'Accessible clearance', 'measure.tight': 'Tight — below recommended', 'measure.violation': 'Too narrow — non-compliant',
  },
  fr: {
    'nav.project': 'Projet', 'nav.template': 'Modèle',
    'view.perspective': 'Perspective 3D', 'view.city': 'Vue de la ville', 'view.floor': 'Plan de l\'étage',
    'nav.fireEgress': 'Issues de secours', 'nav.costEstimate': 'Estimation des coûts', 'nav.exportPdf': 'Exporter en PDF',
    'breadcrumb.workspace': 'Espace de conception', 'breadcrumb.city': 'Vue de la ville', 'breadcrumb.floor': 'Plan de l\'étage',
    'save.saved': 'Enregistré', 'save.saving': 'Enregistrement…',
    'notif.title': 'Activité', 'notif.empty': 'Aucune activité pour le moment.', 'notif.clear': 'Tout effacer',
    'panel.performance': 'Performance et analyses', 'panel.compliance': 'Contrôle de conformité',
    'panel.financial': 'Suivi financier', 'panel.insight': 'Intelligence de conception',
    'panel.lighting': 'Éclairage', 'panel.capacity': 'Planificateur de capacité',
    'compliance.fireEgress': 'Issue de secours', 'compliance.accessibility': 'Accessibilité', 'compliance.capacity': 'Capacité',
    'compliance.compliant': 'Conforme', 'compliance.overLimit': 'Dépassement', 'compliance.withinLimit': 'Dans la limite',
    'compliance.tightClearance': 'Dégagement insuffisant',
    'financial.cost': 'Coût estimé', 'financial.furniture': 'Sous-total mobilier', 'financial.builtValue': 'Valeur construite',
    'score.label': 'Score du projet',
    'light.morning': 'Matin', 'light.noon': 'Midi', 'light.golden': 'Heure dorée', 'light.evening': 'Soir',
    'light.night': 'Nuit', 'light.live': 'Direct', 'light.overcast': 'Couvert', 'light.bluehour': 'Heure bleue',
    'insight.empty': 'Ajoutez du mobilier pour voir des suggestions en direct.',
    'lang.comingSoon': 'Bientôt disponible',
    'measure.compliant': 'Dégagement accessible', 'measure.tight': 'Insuffisant — sous la recommandation', 'measure.violation': 'Trop étroit — non conforme',
  },
  ar: {
    'nav.project': 'المشروع', 'nav.template': 'القالب',
    'view.perspective': 'منظور ثلاثي الأبعاد', 'view.city': 'نظرة عامة على المدينة', 'view.floor': 'مخطط الطابق',
    'nav.fireEgress': 'مخارج الطوارئ', 'nav.costEstimate': 'تقدير التكلفة', 'nav.exportPdf': 'تصدير PDF',
    'breadcrumb.workspace': 'مساحة التصميم', 'breadcrumb.city': 'نظرة عامة على المدينة', 'breadcrumb.floor': 'مخطط الطابق',
    'save.saved': 'تم الحفظ', 'save.saving': 'جارٍ الحفظ…',
    'notif.title': 'النشاط', 'notif.empty': 'لا يوجد نشاط بعد.', 'notif.clear': 'مسح الكل',
    'panel.performance': 'الأداء والتحليلات', 'panel.compliance': 'فحص الامتثال',
    'panel.financial': 'المتابعة المالية', 'panel.insight': 'ذكاء التصميم',
    'panel.lighting': 'الإضاءة', 'panel.capacity': 'مخطط السعة',
    'compliance.fireEgress': 'مخرج الحريق', 'compliance.accessibility': 'إمكانية الوصول', 'compliance.capacity': 'السعة',
    'compliance.compliant': 'مطابق', 'compliance.overLimit': 'تجاوز الحد', 'compliance.withinLimit': 'ضمن الحد',
    'compliance.tightClearance': 'تباعد غير كافٍ',
    'financial.cost': 'التكلفة المقدّرة', 'financial.furniture': 'إجمالي الأثاث', 'financial.builtValue': 'القيمة الإنشائية',
    'score.label': 'تقييم المشروع',
    'light.morning': 'الصباح', 'light.noon': 'الظهيرة', 'light.golden': 'الساعة الذهبية', 'light.evening': 'المساء',
    'light.night': 'الليل', 'light.live': 'مباشر', 'light.overcast': 'غائم', 'light.bluehour': 'الساعة الزرقاء',
    'insight.empty': 'أضف أثاثًا لرؤية اقتراحات فورية للتخطيط.',
    'lang.comingSoon': 'قريبًا',
    'measure.compliant': 'تباعد ملائم لإمكانية الوصول', 'measure.tight': 'ضيق — أقل من الموصى به', 'measure.violation': 'ضيق جدًا — غير مطابق',
  },
};
function t(key) {
  return (I18N[state.lang] && I18N[state.lang][key]) || I18N.en[key] || key;
}
function applyStaticTranslations() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.getAttribute('data-i18n'));
  });
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.setAttribute('title', t(el.getAttribute('data-i18n-title')));
  });
}
function applyLanguage(lang, opts = {}) {
  if (!I18N[lang]) return;
  state.lang = lang;
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  const langValueEl = document.getElementById('langValue');
  if (langValueEl) langValueEl.textContent = lang.toUpperCase();
  document.querySelectorAll('#langDropdownMenu button[data-lang]').forEach(b => {
    b.classList.toggle('active', b.dataset.lang === lang);
    b.setAttribute('aria-selected', String(b.dataset.lang === lang));
  });
  applyStaticTranslations();
  updateStats(); // re-render dynamic, state-derived text (compliance labels, insights, etc.) in the new language
  if (!opts.silent) {
    showToast(lang === 'fr' ? 'Langue changée en Français' : lang === 'ar' ? 'تم تغيير اللغة إلى العربية' : 'Language changed to English', 'fa-globe');
    flashSaveStatus();
  }
}

// MIN_ACCESSIBLE_CLEARANCE (and the other clearance thresholds) now live in
// spatial-analysis.js — one source of truth for the compliance card, the 3D
// overlay, the measure tool and the report.

// ========== STATE ==========
const state = {
  view: 'perspective',
  template: 'cafe',
  brandColor: '#17B6C4',
  fireSafety: false,
  selectedItem: null,      // catalog key currently armed for placement
  activeItem: null,        // placed item currently selected (for rotate/delete)
  placedItems: [],
  costPanelOpen: false,
  roomArea: 120, // m²
  maxCapacity: 40,
  cityVisible: true,
  furnitureFilter: 'all',
  templateFilter: 'Commercial',
  cityScale: 'interior',
  cityBuildMode: false,
  cityBuildType: 'mixedUse',
  selectedCityEntity: null,
  cityTime: 10.5,
  cityValueBase: 96400000,
  timeAuto: true,
  lightPreset: 'live',
  lang: 'en',
};


// ========== THREE.JS SETUP ==========
const container = document.getElementById('canvasContainer');
const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(40, container.clientWidth / container.clientHeight, 0.1, 360);
camera.position.set(10, 8, 12);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setSize(container.clientWidth, container.clientHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
container.appendChild(renderer.domElement);

// ========== WEBGL CONTEXT LOSS RECOVERY ==========
// Without this, a lost GPU context (driver crash/reset, tab backgrounded on
// a mobile browser under memory pressure, etc.) leaves the canvas frozen on
// a stale frame forever with no indication anything is wrong — the render
// loop keeps calling into a dead context silently. This won't reconstruct
// the entire scene graph (that would need a full re-run of scene setup),
// but it stops wasted render calls immediately and tells the person
// honestly what happened instead of a silent freeze, and automatically
// recovers if the browser restores the context (the common case).
let webglContextLost = false;
renderer.domElement.addEventListener('webglcontextlost', (e) => {
  e.preventDefault(); // signals to the browser that we intend to handle recovery ourselves
  webglContextLost = true;
  console.error('ZKR Atelier: WebGL context was lost.');
  showToast('Graphics context lost — attempting to recover…', 'fa-triangle-exclamation');
});
renderer.domElement.addEventListener('webglcontextrestored', () => {
  webglContextLost = false;
  // Renderer state (compiled programs, uploaded textures) is gone with the
  // old context; forcing every material to recompile on next render is the
  // lightweight recovery path three.js supports without a full scene rebuild.
  scene.traverse((obj) => { if (obj.material) [].concat(obj.material).forEach(m => { m.needsUpdate = true; }); });
  showToast('Graphics context recovered', 'fa-circle-check');
});


const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 4;
controls.maxDistance = 150;
controls.minPolarAngle = 0;
controls.maxPolarAngle = Math.PI * 0.49;
controls.target.set(0, 1, 0);

// ========== FIRST-PERSON WALKTHROUGH ==========
// A genuinely separate camera-control mode (not another `cameraViews` entry
// — those do fixed eased transitions to a named framing, which doesn't fit
// free WASD+mouse-look movement), toggled independently of state.view so
// re-entering afterwards returns to whatever view/scale the user was
// actually in. OrbitControls and PointerLockControls both drive the SAME
// camera object but are never enabled at the same time.
const fpControls = new PointerLockControls(camera, renderer.domElement);
state.firstPerson = false;
const _fpSaved = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), fov: 40, target: new THREE.Vector3(), orbitEnabled: true };
const _fpKeys = { forward: false, back: false, left: false, right: false, run: false };
const _fpVelocity = new THREE.Vector3();
const _fpForward = new THREE.Vector3();
const _fpRight = new THREE.Vector3();

function enterFirstPerson() {
  if (state.firstPerson) return;
  _fpSaved.position.copy(camera.position);
  _fpSaved.quaternion.copy(camera.quaternion);
  _fpSaved.fov = camera.fov;
  _fpSaved.target.copy(controls.target);
  _fpSaved.orbitEnabled = controls.enabled;
  state.firstPerson = true;
  controls.enabled = false;
  // Start at a believable standing eye-height near the current look target
  // rather than jumping to a fixed world origin, so entering Walk mode from
  // wherever the user was orbiting feels continuous rather than a hard cut.
  camera.position.set(controls.target.x, 1.65, controls.target.z + 3);
  camera.fov = 62; // wider FOV reads as "walking through a space" vs the tighter framing camera used for orbit/plan views
  camera.updateProjectionMatrix();
  document.getElementById('firstPersonBtn')?.classList.add('active');
  document.getElementById('canvasContainer')?.classList.add('fp-active');
  fpControls.lock();
}

function exitFirstPerson() {
  if (!state.firstPerson) return;
  state.firstPerson = false;
  _fpKeys.forward = _fpKeys.back = _fpKeys.left = _fpKeys.right = _fpKeys.run = false;
  _fpVelocity.set(0, 0, 0);
  camera.position.copy(_fpSaved.position);
  camera.quaternion.copy(_fpSaved.quaternion);
  camera.fov = _fpSaved.fov;
  camera.updateProjectionMatrix();
  controls.target.copy(_fpSaved.target);
  controls.enabled = _fpSaved.orbitEnabled;
  controls.update();
  document.getElementById('firstPersonBtn')?.classList.remove('active');
  document.getElementById('canvasContainer')?.classList.remove('fp-active');
  if (document.pointerLockElement === renderer.domElement) document.exitPointerLock();
}

// The Pointer Lock API itself releases the lock on Escape (browser
// default) — listening for the lock being lost, rather than trying to
// intercept Escape ourselves, is what correctly restores the saved camera
// state regardless of *why* the lock ended (Escape, alt-tab, browser UI).
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement !== renderer.domElement && state.firstPerson) {
    exitFirstPerson();
  }
});

window.addEventListener('keydown', (e) => {
  if (!state.firstPerson) return;
  if (e.code === 'KeyW' || e.code === 'ArrowUp') _fpKeys.forward = true;
  else if (e.code === 'KeyS' || e.code === 'ArrowDown') _fpKeys.back = true;
  else if (e.code === 'KeyA' || e.code === 'ArrowLeft') _fpKeys.left = true;
  else if (e.code === 'KeyD' || e.code === 'ArrowRight') _fpKeys.right = true;
  else if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') _fpKeys.run = true;
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'KeyW' || e.code === 'ArrowUp') _fpKeys.forward = false;
  else if (e.code === 'KeyS' || e.code === 'ArrowDown') _fpKeys.back = false;
  else if (e.code === 'KeyA' || e.code === 'ArrowLeft') _fpKeys.left = false;
  else if (e.code === 'KeyD' || e.code === 'ArrowRight') _fpKeys.right = false;
  else if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') _fpKeys.run = false;
});

// Simple, honest bounds: keeps the walker within a generous city-scale
// radius and above ground level. This is NOT real collision detection
// against buildings/furniture — that would need a physics/collision
// library this project doesn't have — just enough to stop someone walking
// underground or infinitely off into the void.
function updateFirstPersonMovement(dt) {
  if (!state.firstPerson) return;
  const speed = (_fpKeys.run ? 9 : 4.2) * dt;
  _fpForward.set(0, 0, -1).applyQuaternion(camera.quaternion); _fpForward.y = 0; _fpForward.normalize();
  _fpRight.set(1, 0, 0).applyQuaternion(camera.quaternion); _fpRight.y = 0; _fpRight.normalize();
  _fpVelocity.set(0, 0, 0);
  if (_fpKeys.forward) _fpVelocity.add(_fpForward);
  if (_fpKeys.back) _fpVelocity.sub(_fpForward);
  if (_fpKeys.right) _fpVelocity.add(_fpRight);
  if (_fpKeys.left) _fpVelocity.sub(_fpRight);
  if (_fpVelocity.lengthSq() > 0) _fpVelocity.normalize().multiplyScalar(speed);
  camera.position.add(_fpVelocity);
  camera.position.y = 1.65; // fixed eye height — no jumping/flying, no vertical collision needed
  const R = 140; // generous city-scale radius, well past the built district
  camera.position.x = THREE.MathUtils.clamp(camera.position.x, -R, R);
  camera.position.z = THREE.MathUtils.clamp(camera.position.z, -R, R);
}

// ========== POST-PROCESSING (real-time realism pass) ==========
// A genuine post-processing pipeline, not a CSS filter: screen-space ambient
// occlusion for contact shadows/depth, a restrained bloom for warm/emissive
// highlights (pendant lights, signage, headlights at night), and an outline
// pass used for the cyan "selected object" cue instead of a hand-rolled
// wireframe box. Gated behind `state.postFX` (icon-rail toggle) so lower-end
// machines can drop straight back to a single forward render — realism
// should never come at the cost of the tool staying usable, per the brief's
// own performance section.
state.postFX = true;
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));

const ssaoPass = new SSAOPass(scene, camera, container.clientWidth, container.clientHeight);
ssaoPass.kernelRadius = 0.42;
ssaoPass.minDistance = 0.0015;
ssaoPass.maxDistance = 0.12;
ssaoPass.output = SSAOPass.OUTPUT.Default;
composer.addPass(ssaoPass);

const outlinePass = new OutlinePass(new THREE.Vector2(container.clientWidth, container.clientHeight), scene, camera);
outlinePass.edgeStrength = 5;
outlinePass.edgeGlow = 0.7;
outlinePass.edgeThickness = 1.6;
outlinePass.pulsePeriod = 2.4;
outlinePass.visibleEdgeColor.set(0x00f0ff);
outlinePass.hiddenEdgeColor.set(0x0a4a55);
outlinePass.selectedObjects = [];
composer.addPass(outlinePass);

const bloomPass = new UnrealBloomPass(new THREE.Vector2(container.clientWidth, container.clientHeight), 0.32, 0.55, 0.86);
composer.addPass(bloomPass);

// OutputPass re-applies the renderer's tone mapping + color space at the end
// of the chain — required with EffectComposer in this three.js version,
// since the composer's intermediate render targets bypass the renderer's
// own automatic output conversion.
composer.addPass(new OutputPass());

function setPostFX(enabled) {
  state.postFX = enabled;
  const btn = document.getElementById('postFxToggleBtn');
  if (btn) btn.classList.toggle('active', enabled);
  // Keep the individual pass flags in sync with the current quality tier
  // even though the render loop already fully bypasses the composer when
  // postFX is off (`if (state.postFX) composer.render(); else
  // renderer.render(...)`) — without this, ssaoPass/bloomPass.enabled would
  // sit stale at whatever they were last set to, which is harmless today
  // but a landmine for anyone touching the render loop later.
  const cfg = QUALITY_TIERS[state.quality];
  if (cfg) {
    ssaoPass.enabled = enabled && cfg.ssao;
    bloomPass.enabled = enabled && cfg.bloom;
  }
}

// ========== ADAPTIVE QUALITY ==========
// Four real tiers, each actually changing renderer cost (not just a label):
// pixel ratio, shadow map resolution, SSAO sample count/enabled, and bloom
// enabled. "Auto" isn't offered as a separate mode — instead a lightweight
// runtime monitor (see checkAdaptivePerformance in the tick loop) silently
// steps quality DOWN one tier if the frame rate stays poor for a sustained
// period, and reports the change once via a toast so it's never a silent,
// confusing behavior change.
const QUALITY_TIERS = {
  ultra:  { pixelRatioCap: 2,    shadowMapSize: 2048, ssao: true,  ssaoKernel: 16, bloom: true  },
  high:   { pixelRatioCap: 2,    shadowMapSize: 1536, ssao: true,  ssaoKernel: 12, bloom: true  },
  medium: { pixelRatioCap: 1.5,  shadowMapSize: 1024, ssao: true,  ssaoKernel: 8,  bloom: false },
  low:    { pixelRatioCap: 1,    shadowMapSize: 512,  ssao: false, ssaoKernel: 4,  bloom: false },
};
state.quality = 'high';
function setQuality(tier, opts = {}) {
  const cfg = QUALITY_TIERS[tier];
  if (!cfg) return;
  state.quality = tier;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, cfg.pixelRatioCap));
  sunLight.shadow.mapSize.set(cfg.shadowMapSize, cfg.shadowMapSize);
  // Shadow map size changes require disposing the old shadow-map render
  // target or three.js keeps rendering into the stale (wrong-size) one.
  if (sunLight.shadow.map) { sunLight.shadow.map.dispose(); sunLight.shadow.map = null; }
  ssaoPass.enabled = state.postFX && cfg.ssao;
  ssaoPass.kernelRadius = cfg.ssaoKernel > 10 ? 0.42 : 0.3;
  bloomPass.enabled = state.postFX && cfg.bloom;
  document.querySelectorAll('#qualityDropdownMenu button[data-quality]').forEach(b => {
    b.classList.toggle('active', b.dataset.quality === tier);
  });
  if (!opts.silent) showToast(`Rendering quality: ${tier[0].toUpperCase()}${tier.slice(1)}`, 'fa-gauge-high');
}

// Lightweight, conservative auto-downgrade: samples frame time over a
// rolling window and steps down exactly one tier if it's been sustained-bad
// for ~3 seconds — never jumps straight to Low, never fights the user's own
// explicit choice by upgrading back on its own (avoids visible flicker
// between tiers). Runs from the tick loop but only checks every 500ms.
const _qualityOrder = ['ultra', 'high', 'medium', 'low'];
let _fpsAccum = 0, _fpsFrames = 0, _fpsCheckTimer = 0, _sustainedBadChecks = 0;
function checkAdaptivePerformance(dt) {
  _fpsAccum += dt; _fpsFrames++;
  _fpsCheckTimer += dt;
  if (_fpsCheckTimer < 0.5) return;
  const avgFps = _fpsFrames / _fpsAccum;
  _fpsCheckTimer = 0; _fpsAccum = 0; _fpsFrames = 0;
  const idx = _qualityOrder.indexOf(state.quality);
  if (avgFps < 32 && idx < _qualityOrder.length - 1) {
    _sustainedBadChecks++;
    if (_sustainedBadChecks >= 6) { // ~3s of sustained poor performance
      _sustainedBadChecks = 0;
      setQuality(_qualityOrder[idx + 1]);
      showToast('Performance was low — automatically reduced rendering quality', 'fa-gauge-high');
    }
  } else {
    _sustainedBadChecks = 0;
  }
}

// ========== ZOOM HELPERS ==========
// Shared, clamped dolly used by both the toolbar zoom buttons and (below)
// the cursor-focus wheel behavior. The toolbar buttons previously mutated
// camera.position directly with no distance check — OrbitControls' own
// minDistance/maxDistance only guard ITS internal wheel/pinch handling,
// not arbitrary external camera moves — so repeated clicks could push the
// camera through the floor (zoom in) or lose the scene entirely (zoom out).
function dollyCamera(factor, focusPoint) {
  const point = focusPoint || controls.target;
  const currentDistance = camera.position.distanceTo(point);
  if (currentDistance < 1e-6) return;
  const newDistance = Math.max(controls.minDistance, Math.min(controls.maxDistance, currentDistance * factor));
  const actualFactor = newDistance / currentDistance;
  camera.position.sub(point).multiplyScalar(actualFactor).add(point);
}

// OrbitControls already handles mouse-wheel and touch-pinch dolly toward
// controls.target — left untouched so touch/tablet pinch-zoom keeps
// working exactly as before. This listener runs alongside it (no
// preventDefault/stopPropagation, so it never competes with OrbitControls'
// own handling) and just nudges the orbit pivot a little toward whatever
// ground point is under the cursor on each wheel tick. The net effect over
// a sustained scroll is that the camera naturally re-centers on the area
// the user is actually looking at, without replacing or fighting
// OrbitControls' own zoom math.
const wheelRaycaster = new THREE.Raycaster();
const wheelNDC = new THREE.Vector2();
const wheelGroundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
function getGroundPointUnderCursor(clientX, clientY) {
  const rect = renderer.domElement.getBoundingClientRect();
  wheelNDC.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  wheelNDC.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  wheelRaycaster.setFromCamera(wheelNDC, camera);
  const hit = new THREE.Vector3();
  const ok = wheelRaycaster.ray.intersectPlane(wheelGroundPlane, hit);
  // Guard against near-horizontal rays (plane intersection far away or
  // behind the camera) producing a wildly distant point.
  if (ok && hit.distanceTo(camera.position) < controls.maxDistance * 3) return hit;
  return null;
}
renderer.domElement.addEventListener('wheel', (e) => {
  const point = getGroundPointUnderCursor(e.clientX, e.clientY);
  if (point) controls.target.lerp(point, 0.045);
}, { passive: true });

// ========== SKY DOME (atmospheric gradient environment) ==========
function makeSkyDome() {
  const skyGeo = new THREE.SphereGeometry(90, 24, 16);
  const uniforms = {
    topColor: { value: new THREE.Color(0xBFD4E8) },
    bottomColor: { value: new THREE.Color(0xF3ECDD) },
    offset: { value: 8 },
    exponent: { value: 0.6 },
  };
  const skyMat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: `
      varying vec3 vWorldPosition;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 topColor; uniform vec3 bottomColor;
      uniform float offset; uniform float exponent;
      varying vec3 vWorldPosition;
      void main() {
        float h = normalize(vWorldPosition + vec3(0.0, offset, 0.0)).y;
        gl_FragColor = vec4(mix(bottomColor, topColor, max(pow(max(h, 0.0), exponent), 0.0)), 1.0);
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
  });
  return new THREE.Mesh(skyGeo, skyMat);
}
const skyDome = makeSkyDome();
scene.add(skyDome);
scene.fog = new THREE.Fog(0xEFE7D6, 26, 82);

// ========== LIGHTING ==========
const ambient = new THREE.AmbientLight(0xfff5e8, 0.55);
scene.add(ambient);

const sunLight = new THREE.DirectionalLight(0xfff0d5, 1.05);
sunLight.position.set(9, 16, 7);
sunLight.castShadow = true;
sunLight.shadow.mapSize.width = 2048;
sunLight.shadow.mapSize.height = 2048;
sunLight.shadow.camera.left = -22;
sunLight.shadow.camera.right = 22;
sunLight.shadow.camera.top = 22;
sunLight.shadow.camera.bottom = -22;
sunLight.shadow.camera.near = 0.5;
sunLight.shadow.camera.far = 60;
sunLight.shadow.bias = -0.0005;
sunLight.shadow.radius = 4;
scene.add(sunLight);

const hemiLight = new THREE.HemisphereLight(0xcfe0ee, 0xc4b394, 0.45);
scene.add(hemiLight);

const fillLight = new THREE.DirectionalLight(0xc4b394, 0.25);
fillLight.position.set(-6, 5, -4);
scene.add(fillLight);

// ========== ROOM ==========
const ROOM_W = 12, ROOM_D = 10, ROOM_H = 3.4;
const roomGroup = new THREE.Group();
scene.add(roomGroup);

// Floor
const floorMat = new THREE.MeshStandardMaterial({ color: 0xE8DCC4, roughness: 0.88, metalness: 0 });
const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_W, ROOM_D), floorMat);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
floor.userData.isFloor = true;
roomGroup.add(floor);

// Optional planning grid — off by default, toggled with the toolbar/'G' key.
// 0.5m spacing reads clearly at interior scale without cluttering the wood floor.
const planningGrid = new THREE.GridHelper(Math.max(ROOM_W, ROOM_D), Math.max(ROOM_W, ROOM_D) * 2, 0x4A5568, 0x4A5568);
planningGrid.material.transparent = true;
planningGrid.material.opacity = 0.16;
planningGrid.position.y = 0.012;
planningGrid.visible = false;
roomGroup.add(planningGrid);
function toggleGrid(force) {
  planningGrid.visible = force !== undefined ? force : !planningGrid.visible;
  showToast(planningGrid.visible ? 'Grid on' : 'Grid off', 'fa-border-all');
  const btn = document.getElementById('gridToggleBtn');
  if (btn) btn.classList.toggle('active', planningGrid.visible);
}

// Floor plank lines (subtle wood pattern)
const plankGroup = new THREE.Group();
const plankMat = new THREE.LineBasicMaterial({ color: 0xb8a88a, transparent: true, opacity: 0.18 });
for (let i = -ROOM_D/2; i <= ROOM_D/2; i += 0.4) {
  const geom = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-ROOM_W/2, 0.002, i),
    new THREE.Vector3(ROOM_W/2, 0.002, i)
  ]);
  plankGroup.add(new THREE.Line(geom, plankMat));
}
roomGroup.add(plankGroup);

// Walls
const wallMat = new THREE.MeshStandardMaterial({ color: 0xF5F1EA, roughness: 0.95 });

const wallBack = new THREE.Mesh(new THREE.BoxGeometry(ROOM_W, ROOM_H, 0.15), wallMat);
wallBack.position.set(0, ROOM_H/2, -ROOM_D/2);
wallBack.receiveShadow = true;
wallBack.castShadow = true;
roomGroup.add(wallBack);

const wallLeft = new THREE.Mesh(new THREE.BoxGeometry(0.15, ROOM_H, ROOM_D), wallMat);
wallLeft.position.set(-ROOM_W/2, ROOM_H/2, 0);
wallLeft.receiveShadow = true;
wallLeft.castShadow = true;
roomGroup.add(wallLeft);

// A short return wall + entrance canopy on the open (east) side, so the building reads
// as a real storefront against the street rather than a floating slab.
const wallFrontStub = new THREE.Mesh(new THREE.BoxGeometry(0.15, ROOM_H, 2.6), wallMat);
wallFrontStub.position.set(ROOM_W/2, ROOM_H/2, -ROOM_D/2 + 1.3);
wallFrontStub.castShadow = true; wallFrontStub.receiveShadow = true;
roomGroup.add(wallFrontStub);

const canopy = new THREE.Mesh(
  new THREE.BoxGeometry(1.6, 0.08, 2.2),
  new THREE.MeshStandardMaterial({ color: 0x9AA0A6, roughness: 0.32, metalness: 0.85 })
);
canopy.position.set(ROOM_W/2 + 0.7, ROOM_H - 0.35, 3.6);
canopy.castShadow = true;
roomGroup.add(canopy);
// Slim support rods under the canopy — a floating flat slab reads as
// unfinished; two thin struts anchor it back to the facade convincingly.
const canopyStrutMat = new THREE.MeshStandardMaterial({ color: 0x9AA0A6, roughness: 0.32, metalness: 0.85 });
[-0.9, 0.9].forEach(dz => {
  const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.5, 8), canopyStrutMat);
  strut.rotation.z = Math.PI / 2.6;
  strut.position.set(ROOM_W/2 + 0.35, ROOM_H - 0.55, 3.6 + dz);
  roomGroup.add(strut);
});

// Stone plinth — a grounded base band around the two solid walls gives the
// atelier a real material transition at street level instead of one flat
// render color floor-to-parapet, the single biggest "hero building" cue.
// (Inlined rather than pulled from the MATERIALS library below: this block
// runs at module top-level during initial scene setup, before that const
// is declared further down the file — referencing it here would hit the
// temporal dead zone and throw at load time.)
const plinthMat = new THREE.MeshStandardMaterial({ color: 0xC7BFAE, roughness: 0.75, metalness: 0 });
const plinthH = 0.62;
const plinthBack = new THREE.Mesh(new THREE.BoxGeometry(ROOM_W + 0.05, plinthH, 0.19), plinthMat);
plinthBack.position.set(0, plinthH / 2, -ROOM_D/2);
plinthBack.castShadow = true; plinthBack.receiveShadow = true;
roomGroup.add(plinthBack);
const plinthLeft = new THREE.Mesh(new THREE.BoxGeometry(0.19, plinthH, ROOM_D + 0.05), plinthMat);
plinthLeft.position.set(-ROOM_W/2, plinthH / 2, 0);
plinthLeft.castShadow = true; plinthLeft.receiveShadow = true;
roomGroup.add(plinthLeft);

// Baseboards
const baseMat = new THREE.MeshStandardMaterial({ color: 0x2A2826, roughness: 0.7 });
const baseBack = new THREE.Mesh(new THREE.BoxGeometry(ROOM_W, 0.08, 0.02), baseMat);
baseBack.position.set(0, 0.04, -ROOM_D/2 + 0.085);
roomGroup.add(baseBack);
const baseLeft = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.08, ROOM_D), baseMat);
baseLeft.position.set(-ROOM_W/2 + 0.085, 0.04, 0);
roomGroup.add(baseLeft);

// Door opening on right wall (visual: gap indicator on floor)
const doorMarker = new THREE.Mesh(
  new THREE.PlaneGeometry(1.2, 0.1),
  new THREE.MeshBasicMaterial({ color: 0xC75D3F, transparent: true, opacity: 0 })
);
doorMarker.rotation.x = -Math.PI / 2;
doorMarker.position.set(ROOM_W/2 - 0.1, 0.003, 4);
roomGroup.add(doorMarker);

// Signage plate above canopy — reads the current template name
const signCanvas = document.createElement('canvas');
signCanvas.width = 512; signCanvas.height = 128;
const signCtx = signCanvas.getContext('2d');
const signTexture = new THREE.CanvasTexture(signCanvas);
function drawSign(label) {
  signCtx.clearRect(0, 0, 512, 128);
  signCtx.fillStyle = '#2A2826';
  signCtx.fillRect(0, 0, 512, 128);
  signCtx.fillStyle = state.brandColor;
  signCtx.fillRect(0, 0, 10, 128);
  signCtx.fillStyle = '#F5F1EA';
  signCtx.font = "bold 46px 'Manrope', sans-serif";
  signCtx.textAlign = 'center';
  signCtx.textBaseline = 'middle';
  signCtx.fillText(label.toUpperCase(), 266, 64);
  signTexture.needsUpdate = true;
}
const signMesh = new THREE.Mesh(
  new THREE.PlaneGeometry(2.6, 0.65),
  new THREE.MeshStandardMaterial({ map: signTexture, roughness: 0.6, emissive: new THREE.Color(state.brandColor), emissiveIntensity: 0.22 })
);
signMesh.position.set(ROOM_W/2 - 0.05, ROOM_H + 0.15, 3.6);
signMesh.rotation.y = -Math.PI / 2;
roomGroup.add(signMesh);

// Windows
function addWindow(x, w, h, y) {
  const windowMat = new THREE.MeshStandardMaterial({
    color: 0xfff5e0, emissive: 0xfff5e0, emissiveIntensity: 0.5, roughness: 1
  });
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(w, h), windowMat);
  glass.position.set(x, y, -ROOM_D/2 + 0.09);
  roomGroup.add(glass);

  const frameMat = new THREE.MeshStandardMaterial({ color: 0x2A2826, roughness: 0.6 });
  const t = 0.05;
  const parts = [
    { size: [w + t*2, t, 0.06], pos: [x, y + h/2 + t/2, -ROOM_D/2 + 0.1] },
    { size: [w + t*2, t, 0.06], pos: [x, y - h/2 - t/2, -ROOM_D/2 + 0.1] },
    { size: [t, h + t*2, 0.06], pos: [x - w/2 - t/2, y, -ROOM_D/2 + 0.1] },
    { size: [t, h + t*2, 0.06], pos: [x + w/2 + t/2, y, -ROOM_D/2 + 0.1] },
    { size: [t * 0.7, h, 0.06], pos: [x, y, -ROOM_D/2 + 0.1] },
  ];
  parts.forEach(p => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(...p.size), frameMat);
    m.position.set(...p.pos);
    roomGroup.add(m);
  });
}
addWindow(-3.2, 2.8, 1.8, 1.65);
addWindow(2.2, 2.4, 1.8, 1.65);

function setRoomFinish(floorColor) {
  floorMat.color.set(floorColor);
}

// ========== CITY ENVIRONMENT ==========
// A stylized low-poly block surrounding the storefront: sidewalk, street, buildings,
// trees, lamps, benches and a couple of slow-moving cars. Built once, geometry-light.
const cityGroup = new THREE.Group();
scene.add(cityGroup);

// Lightweight procedural surface noise for the large flat ground planes
// (sidewalk concrete, asphalt, lawn) that previously used one completely
// flat MeshStandardMaterial color. Generated once at scene setup (not per
// frame, not per tile) via Canvas — no external texture assets or extra
// rendering dependency needed. A tiling speckle pattern reads as aggregate/
// wear at a glance without adding real geometry or draw calls.
function makeSurfaceNoiseTexture(baseColor, { density = 900, alpha = 0.05, size = 256 } = {}) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = typeof baseColor === 'number' ? `#${baseColor.toString(16).padStart(6, '0')}` : baseColor;
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < density; i++) {
    const x = Math.random() * size, y = Math.random() * size;
    const r = 0.4 + Math.random() * 1.5;
    const light = Math.random() < 0.5;
    ctx.fillStyle = `rgba(${light ? '255,255,255' : '0,0,0'},${(Math.random() * alpha).toFixed(3)})`;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function makeWindowTexture(base, lit, cols = 3) {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 96;
  const ctx = c.getContext('2d');
  ctx.fillStyle = typeof base === 'number' ? `#${base.toString(16).padStart(6, '0')}` : base;
  ctx.fillRect(0, 0, 64, 96);

  // A second, correlated canvas holds ONLY the lit windows (white on black) so
  // it can be used as an emissiveMap. Without this, setting a uniform
  // `emissive` color on the whole facade material makes the entire wall glow
  // at night, not just the windows — the classic "black cube with a glowing
  // wall" look. Using the SAME per-window on/off decision for both canvases
  // keeps the diffuse pattern and the glow mask in sync.
  const glowCanvas = document.createElement('canvas');
  glowCanvas.width = 64; glowCanvas.height = 96;
  const gctx = glowCanvas.getContext('2d');
  gctx.fillStyle = '#000000';
  gctx.fillRect(0, 0, 64, 96);

  const rows = 5; // cols now comes from the function parameter (facade variation, see makeBuilding)
  for (let r = 0; r < rows; r++) {
    for (let cIdx = 0; cIdx < cols; cIdx++) {
      const on = Math.random() < lit;
      const w = 64 / cols, h = 96 / rows;
      const x = cIdx * w + w * 0.22, y = r * h + h * 0.22, rw = w * 0.56, rh = h * 0.56;
      if (on) {
        // Slight warm color-temperature variation per window (candle-warm to
        // cooler halogen/LED) instead of one flat lit color everywhere.
        const warmth = 0.55 + Math.random() * 0.45;
        const r255 = 255, g255 = Math.round(210 + warmth * 30), b255 = Math.round(150 + warmth * 70);
        ctx.fillStyle = `rgb(${r255},${g255},${b255})`;
        gctx.fillStyle = `rgb(${r255},${g255},${b255})`;
      } else {
        ctx.fillStyle = 'rgba(20,22,28,0.55)';
      }
      ctx.fillRect(x, y, rw, rh);
      if (on) gctx.fillRect(x, y, rw, rh);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  const glowTex = new THREE.CanvasTexture(glowCanvas);
  glowTex.wrapS = glowTex.wrapT = THREE.RepeatWrapping;
  return { map: tex, emissiveMap: glowTex };
}

// Maps the loose "type" labels used throughout the district/catalog data onto a small set of
// architectural families, each with its own roof, ground-floor treatment, and entrance language —
// so buildings read as different building *types*, not the same box in a different color.
const BUILDING_FAMILIES = {
  office:      { roof: 'parapet',   entrance: 'canopy_glass', ground: 'glazed_band',  signColor: 0x1F3A56 },
  civic:       { roof: 'cornice',   entrance: 'portico',      ground: 'stone_base',   signColor: 0x2A4A6B },
  library:     { roof: 'cornice',   entrance: 'portico',      ground: 'stone_base',   signColor: 0x2A4A6B },
  culture:     { roof: 'cornice',   entrance: 'portico',      ground: 'stone_base',   signColor: 0x5B4A8C },
  // Roof changed from 'parapet' (flat) to 'mansard' (pitched pyramidal) —
  // residential buildings are the majority of every district's street
  // frontage, so this is what actually shifts the city's skyline from
  // "flat-roofed glass blocks" toward the pitched-roof, low-rise
  // row-house streetscape the reference shows. Same warm-brown roof
  // material as hospitality, entrance/ground untouched.
  residential: { roof: 'mansard',   entrance: 'stoop',        ground: 'plain',        signColor: null },
  hospitality: { roof: 'mansard',   entrance: 'canopy_warm',  ground: 'glazed_band',  signColor: 0xB8860B },
  retail:      { roof: 'shopfront', entrance: 'awning',       ground: 'storefront',   signColor: 0x17B6C4 },
  workshop:    { roof: 'sawtooth',  entrance: 'roller_door',  ground: 'plain',        signColor: null },
  education:   { roof: 'parapet',   entrance: 'portico',      ground: 'band_windows', signColor: 0x4A6741 },
  // Also switched to a pitched roof for the same reason as residential.
  'mixed-use': { roof: 'mansard',   entrance: 'canopy_glass', ground: 'storefront',   signColor: 0x899CA8 },
};
function resolveBuildingFamily(type) {
  const key = (type || '').toLowerCase().replace(/\s+/g, '-');
  if (BUILDING_FAMILIES[key]) return BUILDING_FAMILIES[key];
  // Loose keyword fallback for labels that don't match exactly (e.g. "Studios", "Retail").
  if (/retail|market|shop|store/.test(key)) return BUILDING_FAMILIES.retail;
  if (/hotel|restaurant|hospitality|cafe/.test(key)) return BUILDING_FAMILIES.hospitality;
  if (/resident|apartment|terrace|house/.test(key)) return BUILDING_FAMILIES.residential;
  if (/workshop|industrial|foundry|forge|warehouse/.test(key)) return BUILDING_FAMILIES.workshop;
  if (/school|education/.test(key)) return BUILDING_FAMILIES.education;
  if (/civic|library|culture|gallery|exchange/.test(key)) return BUILDING_FAMILIES.civic;
  if (/office|studio/.test(key)) return BUILDING_FAMILIES.office;
  return BUILDING_FAMILIES.office;
}

// Deterministic pseudo-random 0..1 from a building's own spec — same inputs
// always produce the same facade, so reloading the page (or leaving and
// returning to City Overview) never reshuffles the skyline. This is the
// standard GLSL-style sine-hash trick, adapted for plain JS.
function facadeSeed(w, h, d, colorNum) {
  const n = Math.sin(w * 12.9898 + h * 78.233 + d * 37.719 + (typeof colorNum === 'number' ? colorNum : 0) * 0.00001) * 43758.5453;
  return n - Math.floor(n);
}

function makeBuilding(w, h, d, baseColor, litRatio, type = 'office') {
  const family = resolveBuildingFamily(type);
  const g = new THREE.Group();
  const floorH = 2.7;
  const floors = Math.max(1, Math.round(h / floorH));
  // Controlled facade variation: same building family/roof/entrance
  // language throughout (so the district still reads as one coherent
  // architectural style), but the window-bay rhythm varies per building —
  // 2, 3, or 4 columns per repeat — so same-family buildings stop looking
  // like the exact same box in a different color.
  const seed = facadeSeed(w, h, d, typeof baseColor === 'number' ? baseColor : 0);
  const winCols = 2 + Math.floor(seed * 3); // 2, 3, or 4
  const winTex = makeWindowTexture(baseColor, litRatio, winCols);
  winTex.map.repeat.set(Math.max(1, Math.round(w / (1.6 + seed))), floors);
  winTex.emissiveMap.repeat.copy(winTex.map.repeat);
  // Neutral white emissive color: the actual warm/cool tint per window
  // already lives in the emissiveMap pixels themselves (baked per-window in
  // makeWindowTexture), so the material's own `emissive` just needs to pass
  // that color through at the right overall brightness — tinting it again
  // here would double-color every window the same way and erase the
  // per-window warmth variation.
  const sideMat = new THREE.MeshStandardMaterial({
    map: winTex.map, emissiveMap: winTex.emissiveMap,
    emissive: 0xffffff, emissiveIntensity: 0.03, roughness: 0.9,
  });
  const plainMat = new THREE.MeshStandardMaterial({ color: baseColor, roughness: 0.95 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x2A2826, roughness: 0.8 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [sideMat, sideMat, plainMat, plainMat, sideMat, sideMat]);
  body.position.y = h / 2;
  body.castShadow = true; body.receiveShadow = true;
  g.add(body);

  // Floor separation bands — thin ledges that read as real storeys rather than a single texture
  const bandMat = new THREE.MeshStandardMaterial({ color: 0x2A2826, roughness: 0.85 });
  for (let f = 1; f < floors; f++) {
    const band = new THREE.Mesh(new THREE.BoxGeometry(w * 1.01, 0.05, d * 1.01), bandMat);
    band.position.y = f * (h / floors);
    g.add(band);
  }

  // Balconies are a residential-only signifier — other families get their own ground/roof language instead.
  if (family.entrance === 'stoop' && floors >= 3) {
    const balconyMat = new THREE.MeshStandardMaterial({ color: 0xB9B2A0, roughness: 0.7 });
    const railMat = new THREE.MeshStandardMaterial({ color: 0x2A2826, metalness: 0.3, roughness: 0.5 });
    for (let f = 2; f < floors; f += 2) {
      const bw = w * 0.34;
      const balc = new THREE.Mesh(new THREE.BoxGeometry(bw, 0.06, 0.55), balconyMat);
      const side = (f % 4 === 2) ? 1 : -1;
      balc.position.set(side * (w * 0.22), f * (h / floors) - 0.15, d / 2 + 0.28);
      balc.castShadow = true; g.add(balc);
      const rail = new THREE.Mesh(new THREE.BoxGeometry(bw, 0.32, 0.03), railMat);
      rail.position.set(side * (w * 0.22), f * (h / floors) + 0.03, d / 2 + 0.55);
      g.add(rail);
    }
  }

  // ---- Podium: a wider base plinth beneath the tower, on institutional/
  // office/mixed-use buildings tall enough for the massing to read (a
  // podium on a 1-floor retail box would just look like a mistake). Cheap:
  // one extra box reusing an existing material, no new texture. ----
  const podiumEligible = floors >= 4 && (family.ground === 'stone_base' || family.ground === 'glazed_band');
  const hasPodium = podiumEligible && seed < 0.4;
  if (hasPodium) {
    const podiumH = floorH * 1.05;
    const podium = new THREE.Mesh(
      new THREE.BoxGeometry(w * 1.14, podiumH, d * 1.14),
      family.ground === 'stone_base' ? plainMat : darkMat
    );
    podium.position.y = podiumH / 2;
    podium.castShadow = true; podium.receiveShadow = true;
    g.add(podium);
  }

  // ---- Setback: real added massing (not a texture trick) — a genuinely
  // narrower, shorter volume stacked on top of the main body, so the
  // skyline silhouette actually steps back on tall buildings instead of
  // every building being a single extruded box regardless of height.
  // Gated to roof families where a stepped-tower reads correctly; mansard
  // (hospitality) and sawtooth (workshop) roofs already ARE the building's
  // distinctive top element, so a setback tower under those would look
  // architecturally confused rather than intentional.
  const setbackEligibleRoof = family.roof === 'parapet' || family.roof === 'cornice' || family.roof === 'shopfront';
  const hasSetback = floors >= 6 && setbackEligibleRoof && seed > 0.5;
  const insetW = w * 0.68, insetD = d * 0.68;
  let roofBaseH = h, roofFootprintW = w, roofFootprintD = d;
  if (hasSetback) {
    const setbackFloors = Math.max(1, Math.round(floors * 0.22));
    const setbackH = setbackFloors * floorH;
    const setback = new THREE.Mesh(new THREE.BoxGeometry(insetW, setbackH, insetD), plainMat);
    setback.position.y = h + setbackH / 2;
    setback.castShadow = true; setback.receiveShadow = true;
    g.add(setback);
    // Thin parapet ledge marks the step clearly instead of the two volumes
    // just silently touching where it would be hard to read as intentional.
    const ledge = new THREE.Mesh(new THREE.BoxGeometry(w * 1.02, 0.06, d * 1.02), darkMat);
    ledge.position.y = h + 0.03;
    g.add(ledge);
    roofBaseH = h + setbackH;
    roofFootprintW = insetW;
    roofFootprintD = insetD;
  }

  // ---- Roof: the single biggest silhouette cue for building family ----
  if (family.roof === 'mansard') {
    // Hospitality: a shallow pitched cap suggests a hotel/restaurant roofline rather than a flat office top.
    const mansard = new THREE.Mesh(new THREE.CylinderGeometry(0, Math.max(w, d) * 0.42, h * 0.16, 4), new THREE.MeshStandardMaterial({ color: 0x5A4A3C, roughness: 0.85 }));
    mansard.rotation.y = Math.PI / 4;
    mansard.scale.set(w / Math.max(w, d), 1, d / Math.max(w, d));
    mansard.position.y = h + (h * 0.08);
    mansard.castShadow = true;
    g.add(mansard);
  } else if (family.roof === 'sawtooth') {
    // Workshop/industrial: repeated shed-roof teeth read immediately as light-industrial, not office.
    const teeth = Math.max(2, Math.round(w / 1.8));
    for (let i = 0; i < teeth; i++) {
      const tooth = new THREE.Mesh(new THREE.BoxGeometry(w / teeth * 0.92, 0.4, d), new THREE.MeshStandardMaterial({ color: 0x3A3E42, roughness: 0.7, metalness: 0.15 }));
      tooth.position.set(-w / 2 + (i + 0.5) * (w / teeth), h + 0.2, 0);
      tooth.rotation.z = 0.12;
      g.add(tooth);
    }
  } else if (family.roof === 'shopfront') {
    // Retail: a slim projecting cornice/fascia — the horizontal line a storefront hangs a sign from.
    const fascia = new THREE.Mesh(new THREE.BoxGeometry(roofFootprintW * 1.06, 0.32, roofFootprintD * 1.06), new THREE.MeshStandardMaterial({ color: family.signColor, roughness: 0.6 }));
    fascia.position.y = roofBaseH + 0.16;
    fascia.castShadow = true;
    g.add(fascia);
  } else if (family.roof === 'cornice') {
    // Civic/culture: a deeper, stepped cap suggests institutional gravity.
    const cornice = new THREE.Mesh(new THREE.BoxGeometry(roofFootprintW * 1.08, 0.28, roofFootprintD * 1.08), darkMat);
    cornice.position.y = roofBaseH + 0.14; cornice.castShadow = true;
    g.add(cornice);
    const cap2 = new THREE.Mesh(new THREE.BoxGeometry(roofFootprintW * 0.96, 0.16, roofFootprintD * 0.96), plainMat);
    cap2.position.y = roofBaseH + 0.32;
    g.add(cap2);
  } else {
    // Default flat parapet (office / residential / mixed-use / education)
    const cap = new THREE.Mesh(new THREE.BoxGeometry(roofFootprintW * 1.03, 0.18, roofFootprintD * 1.03), darkMat);
    cap.position.y = roofBaseH + 0.09; cap.castShadow = true;
    g.add(cap);
  }

  // ---- Ground floor treatment ----
  const groundH = Math.min(2.6, floorH * 0.94);
  if (family.ground === 'glazed_band' || family.ground === 'storefront') {
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x203040, roughness: 0.15, metalness: 0.35, transparent: true, opacity: 0.88 });
    const band = new THREE.Mesh(new THREE.BoxGeometry(w * 0.98, groundH * 0.72, 0.06), glassMat);
    band.position.set(0, groundH / 2 + 0.05, d / 2 + 0.02);
    g.add(band);
    const mullionMat = new THREE.MeshStandardMaterial({ color: 0x1A1A1A, roughness: 0.6, metalness: 0.4 });
    const mullionCount = Math.max(2, Math.round(w / 1.4));
    for (let m = 1; m < mullionCount; m++) {
      const mull = new THREE.Mesh(new THREE.BoxGeometry(0.05, groundH * 0.72, 0.08), mullionMat);
      mull.position.set(-w / 2 + (m * w) / mullionCount, groundH / 2 + 0.05, d / 2 + 0.03);
      g.add(mull);
    }
  } else if (family.ground === 'stone_base') {
    const base = new THREE.Mesh(new THREE.BoxGeometry(w * 1.04, groundH * 0.5, d * 1.04), new THREE.MeshStandardMaterial({ color: 0xC9C2B2, roughness: 0.95 }));
    base.position.y = groundH * 0.25;
    base.receiveShadow = true;
    g.add(base);
  } else if (family.ground === 'band_windows') {
    const bandGlass = new THREE.Mesh(new THREE.BoxGeometry(w * 0.9, groundH * 0.32, 0.05), new THREE.MeshStandardMaterial({ color: 0x9DBFCB, roughness: 0.3, metalness: 0.1, transparent: true, opacity: 0.85 }));
    bandGlass.position.set(0, groundH * 0.55, d / 2 + 0.02);
    g.add(bandGlass);
  }

  // ---- Entrance ----
  if (family.entrance === 'canopy_glass' || family.entrance === 'canopy_warm') {
    const canopyColor = family.entrance === 'canopy_warm' ? 0xB8860B : 0x41536B;
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(w * 0.36, 0.06, 0.9), new THREE.MeshStandardMaterial({ color: canopyColor, roughness: 0.4, metalness: 0.3 }));
    canopy.position.set(0, 2.15, d / 2 + 0.5);
    canopy.castShadow = true;
    g.add(canopy);
    const postMat = new THREE.MeshStandardMaterial({ color: 0x2A2826, roughness: 0.5 });
    [-1, 1].forEach(side => {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 2.1, 8), postMat);
      post.position.set(side * w * 0.16, 1.05, d / 2 + 0.86);
      g.add(post);
    });
  } else if (family.entrance === 'awning') {
    const awning = new THREE.Mesh(new THREE.BoxGeometry(w * 0.5, 0.05, 0.7), new THREE.MeshStandardMaterial({ color: family.signColor, roughness: 0.75 }));
    awning.position.set(0, groundH * 0.86, d / 2 + 0.4);
    awning.rotation.x = -0.18;
    awning.castShadow = true;
    g.add(awning);
  } else if (family.entrance === 'portico') {
    const step = new THREE.Mesh(new THREE.BoxGeometry(w * 0.42, 0.1, 0.5), new THREE.MeshStandardMaterial({ color: 0xC9C2B2, roughness: 0.9 }));
    step.position.set(0, 0.05, d / 2 + 0.3);
    g.add(step);
    const columnMat = new THREE.MeshStandardMaterial({ color: 0xE5DED2, roughness: 0.7 });
    [-0.14, 0.14].forEach(side => {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.1, groundH * 0.92, 10), columnMat);
      col.position.set(side * w, groundH * 0.46, d / 2 + 0.5);
      col.castShadow = true;
      g.add(col);
    });
  } else if (family.entrance === 'stoop') {
    const stoop = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.32, 0.7), new THREE.MeshStandardMaterial({ color: 0xB9B2A0, roughness: 0.85 }));
    stoop.position.set(0, 0.16, d / 2 + 0.35);
    g.add(stoop);
  } else if (family.entrance === 'roller_door') {
    const door = new THREE.Mesh(new THREE.BoxGeometry(w * 0.4, groundH * 0.7, 0.04), new THREE.MeshStandardMaterial({ color: 0x8A8F94, roughness: 0.6, metalness: 0.4 }));
    door.position.set(0, groundH * 0.35, d / 2 + 0.03);
    g.add(door);
  }

  // ---- Signage: a small identifying panel for public-facing building families ----
  if (family.signColor && (family.entrance === 'awning' || family.entrance === 'canopy_glass' || family.entrance === 'canopy_warm')) {
    const sign = new THREE.Mesh(new THREE.BoxGeometry(w * 0.3, 0.32, 0.04), new THREE.MeshStandardMaterial({ color: family.signColor, roughness: 0.45, metalness: 0.2 }));
    sign.position.set(0, groundH + 0.35, d / 2 + 0.05);
    g.add(sign);
  }

  return g;
}

// ========== PROCEDURAL HOUSES ==========
// A single flexible factory that produces visually distinct houses from a parameter
// object, rather than instancing one repeated mesh. Used to populate a believable
// residential block instead of a generic row of identical low-poly boxes.
function createHouse(opts) {
  const o = Object.assign({
    width: 4.2, depth: 4.6, floors: 1, roofType: 'flat', // 'flat' | 'gable' | 'hip'
    wallColor: 0xE4D9C4, roofColor: 0x5A4A3C, windowStyle: 'plain', // 'plain' | 'shutters'
    balcony: false, garage: false, garden: true, fence: false, entranceStyle: 'plain',
  }, opts);
  const g = new THREE.Group();
  const floorH = 2.6;
  const h = o.floors * floorH;

  const wallMat = new THREE.MeshStandardMaterial({ color: o.wallColor, roughness: 0.92 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(o.width, h, o.depth), wallMat);
  body.position.y = h / 2; body.castShadow = true; body.receiveShadow = true;
  g.add(body);

  // Floor bands
  const bandMat = new THREE.MeshStandardMaterial({ color: 0x3A342C, roughness: 0.8 });
  for (let f = 1; f < o.floors; f++) {
    const band = new THREE.Mesh(new THREE.BoxGeometry(o.width * 1.01, 0.04, o.depth * 1.01), bandMat);
    band.position.y = f * floorH;
    g.add(band);
  }

  // Windows — a simple grid on the front facade, styled per floor
  const winMat = new THREE.MeshStandardMaterial({ color: 0xBFE0EE, roughness: 0.15, metalness: 0.1, emissive: 0x8FB8CC, emissiveIntensity: 0.35 });
  const frameMat = new THREE.MeshStandardMaterial({ color: o.windowStyle === 'shutters' ? 0x6B4A3A : 0x2A2826, roughness: 0.7 });
  const winCols = o.width > 5 ? 3 : 2;
  for (let f = 0; f < o.floors; f++) {
    for (let c = 0; c < winCols; c++) {
      const wx = -o.width/2 + (o.width / (winCols + 1)) * (c + 1);
      const wy = floorH * f + floorH * 0.55;
      const win = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.8), winMat);
      win.position.set(wx, wy, o.depth/2 + 0.02);
      g.add(win);
      const frame = new THREE.Mesh(new THREE.BoxGeometry(0.63, 0.88, 0.04), frameMat);
      frame.position.set(wx, wy, o.depth/2 + 0.01);
      g.add(frame);
      if (o.windowStyle === 'shutters') {
        [-1, 1].forEach(side => {
          const shutter = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.82, 0.03), frameMat);
          shutter.position.set(wx + side * 0.38, wy, o.depth/2 + 0.03);
          g.add(shutter);
        });
      }
    }
  }

  // Roof
  if (o.roofType === 'gable') {
    const roofMat = new THREE.MeshStandardMaterial({ color: o.roofColor, roughness: 0.85 });
    const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(o.width, o.depth) * 0.72, 1.15, 4), roofMat);
    roof.rotation.y = Math.PI / 4;
    roof.position.y = h + 0.55;
    roof.scale.set(1, 1, o.depth / o.width);
    roof.castShadow = true;
    g.add(roof);
  } else if (o.roofType === 'hip') {
    const roofMat = new THREE.MeshStandardMaterial({ color: o.roofColor, roughness: 0.85 });
    const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(o.width, o.depth) * 0.66, 0.9, 4), roofMat);
    roof.rotation.y = Math.PI / 4;
    roof.position.y = h + 0.45;
    roof.scale.set(o.width / o.depth, 1, 1);
    roof.castShadow = true;
    g.add(roof);
  } else {
    const cap = new THREE.Mesh(new THREE.BoxGeometry(o.width * 1.04, 0.16, o.depth * 1.04), new THREE.MeshStandardMaterial({ color: 0x2A2826, roughness: 0.8 }));
    cap.position.y = h + 0.08; cap.castShadow = true;
    g.add(cap);
  }

  // Balcony (front, upper floor)
  if (o.balcony && o.floors >= 2) {
    const balcMat = new THREE.MeshStandardMaterial({ color: 0xCFC6B2, roughness: 0.7 });
    const railMat = new THREE.MeshStandardMaterial({ color: 0x2A2826, metalness: 0.3, roughness: 0.5 });
    const balc = new THREE.Mesh(new THREE.BoxGeometry(o.width * 0.55, 0.07, 0.85), balcMat);
    balc.position.set(0, floorH * (o.floors - 1) + 0.02, o.depth/2 + 0.42);
    balc.castShadow = true; g.add(balc);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(o.width * 0.55, 0.42, 0.03), railMat);
    rail.position.set(0, floorH * (o.floors - 1) + 0.24, o.depth/2 + 0.84);
    g.add(rail);
  }

  // Entrance door + small canopy/path
  const doorMat = new THREE.MeshStandardMaterial({ color: o.entranceStyle === 'plain' ? 0x3A2E22 : state.brandColor, roughness: 0.6 });
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.75, 1.5, 0.06), doorMat);
  door.position.set(-o.width/2 + 0.9, 0.75, o.depth/2 + 0.03);
  g.add(door);
  const step = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.08, 0.4), new THREE.MeshStandardMaterial({ color: 0xC9C2AF, roughness: 0.9 }));
  step.position.set(-o.width/2 + 0.9, 0.04, o.depth/2 + 0.3);
  g.add(step);

  // Garage
  if (o.garage) {
    const garageMat = new THREE.MeshStandardMaterial({ color: 0x8A8578, roughness: 0.6 });
    const door2 = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.7, 0.05), garageMat);
    door2.position.set(o.width/2 - 1.0, 0.85, o.depth/2 + 0.03);
    g.add(door2);
    const driveway = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.6), new THREE.MeshStandardMaterial({ color: 0xB7AF9C, roughness: 0.95 }));
    driveway.rotation.x = -Math.PI/2;
    driveway.position.set(o.width/2 - 1.0, 0.008, o.depth/2 + 1.9);
    g.add(driveway);
  }

  // Garden — a small lawn patch + a couple of trimmed shrubs
  if (o.garden) {
    const lawn = new THREE.Mesh(new THREE.PlaneGeometry(o.width * 0.9, 1.4), new THREE.MeshStandardMaterial({ color: 0x6E8A54, roughness: 1 }));
    lawn.rotation.x = -Math.PI/2;
    lawn.position.set(0, 0.006, o.depth/2 + 1.3);
    g.add(lawn);
    [-1, 1].forEach(side => {
      if (o.garage && side > 0) return;
      const shrub = new THREE.Mesh(new THREE.IcosahedronGeometry(0.24, 0), new THREE.MeshStandardMaterial({ color: 0x4C6B3D, roughness: 0.85 }));
      shrub.position.set(side * (o.width/2 - 0.5), 0.24, o.depth/2 + 0.5);
      shrub.castShadow = true; g.add(shrub);
    });
  }

  // Fence
  if (o.fence) {
    const fenceMat = new THREE.MeshStandardMaterial({ color: 0xE8E2D2, roughness: 0.8 });
    const fenceZ = o.depth/2 + 2.1;
    for (let x = -o.width/2 - 0.3; x <= o.width/2 + 0.3; x += 0.55) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.5, 0.06), fenceMat);
      post.position.set(x, 0.25, fenceZ);
      g.add(post);
    }
    const rail = new THREE.Mesh(new THREE.BoxGeometry(o.width + 0.6, 0.05, 0.05), fenceMat);
    rail.position.set(0, 0.4, fenceZ);
    g.add(rail);
  }

  return g;
}

function makeTree(scale = 1) {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.09, 0.13, 1.1, 7),
    new THREE.MeshStandardMaterial({ color: 0x6B5138, roughness: 0.9 })
  );
  trunk.position.y = 0.55; trunk.castShadow = true;
  g.add(trunk);
  const canopy = new THREE.Group();
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x4C6B3D, roughness: 0.85 });
  const leafMat2 = new THREE.MeshStandardMaterial({ color: 0x5A7A48, roughness: 0.85 });
  [[0, 1.55, 0, 0.62, leafMat], [0.32, 1.35, 0.1, 0.42, leafMat2], [-0.3, 1.4, -0.15, 0.4, leafMat2]].forEach(([x,y,z,r,m]) => {
    const s = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), m);
    s.position.set(x, y, z); s.castShadow = true; g.add(canopy.add ? s : s);
    canopy.add(s);
  });
  g.add(canopy);
  g.userData.canopy = canopy;
  g.userData.swayPhase = Math.random() * Math.PI * 2;
  g.scale.setScalar(scale);
  return g;
}

function makeLamp() {
  const g = new THREE.Group();
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x2A2826, metalness: 0.4, roughness: 0.5 });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 2.6, 8), poleMat);
  pole.position.y = 1.3; pole.castShadow = true; g.add(pole);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.03, 0.03), poleMat);
  arm.position.set(0.18, 2.55, 0); g.add(arm);
  const headMat = new THREE.MeshStandardMaterial({ color: 0xFFE9B8, emissive: 0xFFD37A, emissiveIntensity: 1.1 });
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 10), headMat);
  head.position.set(0.36, 2.5, 0); g.add(head);
  g.userData.glowMat = headMat;
  return g;
}

function makeOutdoorBenchMesh() {
  const g = new THREE.Group();
  const wood = MATERIALS.oak();
  const iron = MATERIALS.blackMetal();
  for (let i = 0; i < 4; i++) {
    const slat = new THREE.Mesh(roundedBoxGeometry(1.3, 0.04, 0.09, 0.015, 2), wood);
    slat.position.set(0, 0.42, -0.15 + i * 0.1); slat.castShadow = true; g.add(slat);
  }
  [-0.55, 0.55].forEach(x => {
    const leg = new THREE.Mesh(roundedBoxGeometry(0.05, 0.42, 0.32, 0.015, 2), iron);
    leg.position.set(x, 0.21, 0); leg.castShadow = true; g.add(leg);
  });
  const back = new THREE.Mesh(roundedBoxGeometry(1.3, 0.35, 0.04, 0.015, 2), wood);
  back.position.set(0, 0.65, -0.19); back.castShadow = true; g.add(back);
  return g;
}

function makeCar(color, type = 'sedan') {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.4 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0xCFE3F0, roughness: 0.2, metalness: 0.1, transparent: true, opacity: 0.85 });
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x1A1A1A, roughness: 0.8 });
  const lightMat = new THREE.MeshStandardMaterial({ color: 0xFFF3D0, emissive: 0xFFE9A8, emissiveIntensity: 0.8 });

  let bw = 1.9, bh = 0.42, bd = 0.9, wheelBase = 0.65;
  if (type === 'compact') { bw = 1.5; bh = 0.4; bd = 0.82; wheelBase = 0.5; }
  if (type === 'van') { bw = 2.1; bh = 0.62; bd = 0.98; wheelBase = 0.75; }
  if (type === 'taxi') { bw = 1.9; bh = 0.42; bd = 0.9; wheelBase = 0.65; }

  const body = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), bodyMat);
  body.position.y = bh * 0.85; body.castShadow = true; g.add(body);

  if (type === 'van') {
    const cargo = new THREE.Mesh(new THREE.BoxGeometry(bw * 0.62, 0.5, bd * 0.98), bodyMat);
    cargo.position.set(-bw * 0.12, bh * 0.85 + 0.5, 0); cargo.castShadow = true; g.add(cargo);
  } else {
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(bw * 0.52, 0.32, bd * 0.9), glassMat);
    cabin.position.set(-bw * 0.05, bh * 0.85 + 0.34, 0); cabin.castShadow = true; g.add(cabin);
  }
  if (type === 'taxi') {
    const sign = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.1, 0.14), new THREE.MeshStandardMaterial({ color: 0xF2C230, emissive: 0xF2C230, emissiveIntensity: 0.4 }));
    sign.position.set(-bw * 0.05, bh * 0.85 + 0.55, 0); g.add(sign);
  }
  // Headlights
  [-1, 1].forEach(side => {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.08, 0.16), lightMat);
    lamp.position.set(bw/2 - 0.01, bh * 0.7, side * bd * 0.3);
    g.add(lamp);
  });
  [[-wheelBase, -bd*0.46], [wheelBase, -bd*0.46], [-wheelBase, bd*0.46], [wheelBase, bd*0.46]].forEach(([x,z]) => {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.16, 12), wheelMat);
    w.rotation.z = Math.PI/2; w.position.set(x, 0.17, z); g.add(w);
  });
  return g;
}

function makeTrashBin() {
  const g = new THREE.Group();
  const bin = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.14, 0.42, 10), new THREE.MeshStandardMaterial({ color: 0x2A2826, roughness: 0.6, metalness: 0.3 }));
  bin.position.y = 0.21; bin.castShadow = true; g.add(bin);
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.03, 10), new THREE.MeshStandardMaterial({ color: 0x1A1A1A, roughness: 0.5 }));
  lid.position.y = 0.42; g.add(lid);
  return g;
}

function makeBikeRack() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x2A2826, metalness: 0.4, roughness: 0.5 });
  for (let i = 0; i < 3; i++) {
    const loop = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.02, 6, 12, Math.PI), mat);
    loop.rotation.x = Math.PI / 2; loop.rotation.z = Math.PI;
    loop.position.set(-0.4 + i * 0.4, 0.24, 0);
    g.add(loop);
  }
  return g;
}

function makeUtilityBox() {
  const g = new THREE.Group();
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.55, 0.3), new THREE.MeshStandardMaterial({ color: 0x5C6B5A, roughness: 0.8 }));
  box.position.y = 0.275; box.castShadow = true; g.add(box);
  return g;
}

// Ground: sidewalk ring + street strip + crosswalk, sized well beyond the storefront
const SIDEWALK_COLOR = 0xD9D3C4, STREET_COLOR = 0x413E3C;
const sidewalkNoiseTex = makeSurfaceNoiseTexture(SIDEWALK_COLOR, { density: 1100, alpha: 0.045 });
sidewalkNoiseTex.repeat.set(14, 11); // tiled across the 46x38 plane below — small tile so speckle stays fine-grained, not blotchy
const sidewalk = new THREE.Mesh(
  new THREE.PlaneGeometry(46, 38),
  // color left neutral white: sidewalkNoiseTex already bakes SIDEWALK_COLOR
  // into the canvas fill, so multiplying by the same color again here would
  // double-darken/desaturate it (map color × material color).
  new THREE.MeshStandardMaterial({ color: 0xffffff, map: sidewalkNoiseTex, roughness: 0.95 })
);
sidewalk.rotation.x = -Math.PI / 2;
sidewalk.position.y = -0.01;
sidewalk.receiveShadow = true;
cityGroup.add(sidewalk);

// Sidewalk expansion joints (subtle)
const jointMat = new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.06 });
for (let x = -22; x <= 22; x += 2.2) {
  const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x, 0, -19), new THREE.Vector3(x, 0, 19)]);
  cityGroup.add(new THREE.Line(geo, jointMat));
}

// Street (east side, beyond the sidewalk)
const STREET_X = 12.5, STREET_W = 6.5;
const streetNoiseTex = makeSurfaceNoiseTexture(STREET_COLOR, { density: 1400, alpha: 0.05 });
streetNoiseTex.repeat.set(3, 16); // narrow-and-long tiling to match the street's own proportions
const street = new THREE.Mesh(
  new THREE.PlaneGeometry(STREET_W, 34),
  new THREE.MeshStandardMaterial({ color: 0xffffff, map: streetNoiseTex, roughness: 0.85 })
);
street.rotation.x = -Math.PI / 2;
street.position.set(STREET_X, -0.005, 0);
street.receiveShadow = true;
cityGroup.add(street);
// Curb
const curb = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.14, 34), new THREE.MeshStandardMaterial({ color: 0xC9C2AF, roughness: 0.9 }));
curb.position.set(STREET_X - STREET_W/2, 0.06, 0);
curb.castShadow = true;
cityGroup.add(curb);
// Lane dashes
const dashMat = new THREE.MeshBasicMaterial({ color: 0xEFE6C8 });
for (let z = -16; z <= 16; z += 2.4) {
  const dash = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 1.1), dashMat);
  dash.rotation.x = -Math.PI/2; dash.position.set(STREET_X, 0.003, z);
  cityGroup.add(dash);
}
// Crosswalk near the entrance (z ~ 3.5–5.5)
for (let i = 0; i < 6; i++) {
  const stripe = new THREE.Mesh(new THREE.PlaneGeometry(0.35, STREET_W - 1), new THREE.MeshBasicMaterial({ color: 0xEDE6D6 }));
  stripe.rotation.x = -Math.PI/2; stripe.rotation.z = Math.PI/2;
  stripe.position.set(STREET_X, 0.004, 3.3 + i * 0.55);
  cityGroup.add(stripe);
}

// Perimeter buildings — beyond the street, wrapping the back of the block (commercial/office massing)
const buildingColors = [0xC9BBA0, 0xB6A488, 0x9FADB8, 0xC2967A, 0xA9A79A, 0xB3907C];
const buildingSpecs = [
  [STREET_X + 4.2, -10, 3.4, 6.5, 3.2],
  [STREET_X + 4.6, -3, 3.6, 8.5, 3.0],
  [STREET_X + 4.2, 4, 3.2, 5.5, 3.6],
  [STREET_X + 5.0, 11, 4.0, 10.5, 3.0],
  [-2, -15.5, 5.0, 6.5, 4.6],
  [5, -15.5, 4.4, 5.5, 4.0],
];
buildingSpecs.forEach(([x, z, w, h, d], i) => {
  const b = makeBuilding(w, h, d, buildingColors[i % buildingColors.length], 0.28 + Math.random() * 0.2);
  b.position.set(x, 0, z);
  b.rotation.y = Math.PI;
  cityGroup.add(b);
});

// Residential block — the west side of the neighborhood, five distinct houses
// built from the same procedural factory with different parameters.
const housesGroup = new THREE.Group();
cityGroup.add(housesGroup);
const houseSpecs = [
  // House A — modern minimalist: flat roof, garage, wide glazing
  { x: -14.5, z: -9, opts: { width: 5.0, depth: 5.4, floors: 1, roofType: 'flat', wallColor: 0xEDEAE2, windowStyle: 'plain', garage: true, garden: true, entranceStyle: 'plain' } },
  // House B — Mediterranean: warm walls, tiled hip roof, shutters
  { x: -14.5, z: -2.5, opts: { width: 4.6, depth: 4.8, floors: 2, roofType: 'hip', wallColor: 0xE0C49A, roofColor: 0xB05B3A, windowStyle: 'shutters', balcony: true, garden: true } },
  // House C — contemporary townhouse: narrow, 2 floors, balcony + garage
  { x: -14.5, z: 3.5, opts: { width: 3.6, depth: 5.2, floors: 2, roofType: 'flat', wallColor: 0xD8D2C4, windowStyle: 'plain', balcony: true, garage: true, garden: false, fence: true } },
  // House D — luxury villa: larger footprint, 3 floors, terrace
  { x: -19.5, z: -5.5, opts: { width: 6.4, depth: 6.0, floors: 3, roofType: 'flat', wallColor: 0xF2EEE3, windowStyle: 'plain', balcony: true, garage: true, garden: true } },
  // House E — compact family house: 2 floors, gable roof, fence
  { x: -19.8, z: 2.5, opts: { width: 4.0, depth: 4.4, floors: 2, roofType: 'gable', wallColor: 0xDCCBA8, roofColor: 0x5A4A3C, windowStyle: 'shutters', garden: true, fence: true } },
];
houseSpecs.forEach(spec => {
  const h = createHouse(spec.opts);
  h.position.set(spec.x, 0, spec.z);
  h.rotation.y = Math.PI / 2;
  housesGroup.add(h);
});

// Trees along the sidewalk edge, both sides of the entrance
const treeSpots = [
  [8.2, -8], [8.2, -2.2], [8.2, 2.4], [8.2, 8.2],
  [-8.6, -8], [-8.6, 0], [-8.6, 8],
  [2, 8.6], [-2.5, 8.6], [2, -8.6], [-4, -8.6],
];
const trees = [];
treeSpots.forEach(([x, z]) => {
  const t = makeTree(0.85 + Math.random() * 0.35);
  t.position.set(x, 0, z);
  cityGroup.add(t);
  trees.push(t);
});

// Street lamps
const lampSpots = [[STREET_X - 0.9, -9], [STREET_X - 0.9, -1], [STREET_X - 0.9, 7], [-8.3, -6], [-8.3, 6]];
const lamps = [];
lampSpots.forEach(([x, z]) => {
  const l = makeLamp();
  l.position.set(x, 0, z);
  cityGroup.add(l);
  lamps.push(l);
});

// Benches
[[6.6, -6.4], [6.6, 6.6], [-7, -3]].forEach(([x, z], i) => {
  const b = makeOutdoorBenchMesh();
  b.position.set(x, 0, z);
  b.rotation.y = i === 2 ? Math.PI/2 : Math.PI;
  cityGroup.add(b);
});

// Planters near entrance
[[7.3, 3.6], [7.3, 5.2]].forEach(([x, z]) => {
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.24, 0.4, 12), new THREE.MeshStandardMaterial({ color: 0x8B6F47, roughness: 0.8 }));
  pot.position.set(x, 0.2, z); pot.castShadow = true; cityGroup.add(pot);
  const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(0.26, 0), new THREE.MeshStandardMaterial({ color: 0x4C6B3D, roughness: 0.85 }));
  leaf.position.set(x, 0.55, z); leaf.castShadow = true; cityGroup.add(leaf);
});

// Cars — drive back and forth along the street, with a couple of body variants
const cars = [
  { mesh: makeCar(0x8B4A3F, 'sedan'), z: -14, speed: 1.6, dir: 1, base: 1.4 },
  { mesh: makeCar(0x3F5A78, 'compact'), z: 6, speed: 1.1, dir: -1, base: 1.4 },
  { mesh: makeCar(0xC7A93F, 'taxi'), z: -4, speed: 1.3, dir: 1, base: -1.1 },
];
const commercialVan = { mesh: makeCar(0xB6B0A2, 'van'), z: 10, speed: 0.9, dir: -1, base: -1.1 };
cars.forEach(c => {
  c.mesh.position.set(STREET_X + c.base, 0, c.z);
  c.mesh.rotation.y = c.dir > 0 ? -Math.PI/2 : Math.PI/2;
  cityGroup.add(c.mesh);
});
commercialVan.mesh.position.set(STREET_X + commercialVan.base, 0, commercialVan.z);
commercialVan.mesh.rotation.y = commercialVan.dir > 0 ? -Math.PI/2 : Math.PI/2;
commercialVan.mesh.visible = false;
cityGroup.add(commercialVan.mesh);

// Street furniture — trash bins, a bike rack, utility boxes
[[STREET_X - 1.1, -6.5], [STREET_X - 1.1, 2], [-8.6, -3.5]].forEach(([x, z]) => {
  const bin = makeTrashBin(); bin.position.set(x, 0, z); cityGroup.add(bin);
});
const bikeRack = makeBikeRack(); bikeRack.position.set(6.4, 0, -3.2); bikeRack.rotation.y = Math.PI/2; cityGroup.add(bikeRack);
[[-16.9, -6], [STREET_X + 2.2, -12]].forEach(([x, z]) => {
  const ub = makeUtilityBox(); ub.position.set(x, 0, z); cityGroup.add(ub);
});
// Parking bay lines beside the street (quiet, procedural stripes)
const parkLineMat = new THREE.MeshBasicMaterial({ color: 0xDCD3BE, transparent: true, opacity: 0.5 });
for (let i = 0; i < 4; i++) {
  const line = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 2.4), parkLineMat);
  line.rotation.x = -Math.PI/2; line.position.set(STREET_X - STREET_W/2 + 1.3 + i * 1.6, 0.004, -11.5);
  cityGroup.add(line);
}

function setCityVisible(v) {
  cityGroup.visible = v;
  skyDome.visible = v;
}

// Template-reactive neighborhood: swap the street's mood based on the selected
// scenario category, without rebuilding geometry.
function updateCityForTemplate(category) {
  const busy = category === 'Commercial' || category === 'Hospitality';
  commercialVan.mesh.visible = busy;
  // Quieter residential streets: fewer pedestrians, cars idle slower
  const quiet = category === 'Residential';
  npcs.forEach((p, i) => { p.visible = quiet ? i % 2 === 0 : true; });
  cars.forEach(c => { c.speedMul = quiet ? 0.55 : 1; });
  housesGroup.visible = true; // houses always present — they read naturally from any angle
}

// ========== NPCs — pedestrians on the sidewalk loop ==========
const npcColors = [0xC75D3F, 0x3F6B5C, 0x5B4A8C, 0x2A4A6B, 0xA8485E, 0xD49B3B, 0x4A4744, 0x6B8E4E];
function makePerson(colorIdx) {
  const g = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: 0xE0B08C, roughness: 0.8 });
  const cloth = new THREE.MeshStandardMaterial({ color: npcColors[colorIdx % npcColors.length], roughness: 0.85 });
  const pants = new THREE.MeshStandardMaterial({ color: 0x2A2826, roughness: 0.8 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 0.42, 4, 8), cloth);
  body.position.y = 0.98; body.castShadow = true; g.add(body);
  const legs = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.55, 8), pants);
  legs.position.y = 0.42; legs.castShadow = true; g.add(legs);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 10), skin);
  head.position.y = 1.34; head.castShadow = true; g.add(head);
  g.userData.legs = legs;
  return g;
}

const NPC_PATH = [
  new THREE.Vector3(7.4, 0, -9), new THREE.Vector3(7.4, 0, 9),
  new THREE.Vector3(-8.2, 0, 9), new THREE.Vector3(-8.2, 0, -9),
];
function pathPoint(t) {
  const segs = NPC_PATH.length;
  const normalized = Number.isFinite(t) ? ((t % 1) + 1) % 1 : 0;
  const f = normalized * segs;
  const i = Math.min(segs - 1, Math.max(0, Math.floor(f)));
  const frac = f - i;
  const a = NPC_PATH[i] || NPC_PATH[0];
  const b = NPC_PATH[(i + 1) % segs] || NPC_PATH[0];
  return new THREE.Vector3().lerpVectors(a, b, frac);
}
const npcs = [];
const NPC_COUNT = 8;
for (let i = 0; i < NPC_COUNT; i++) {
  const p = makePerson(i);
  const scale = 0.92 + Math.random() * 0.16;
  p.scale.setScalar(scale);
  p.userData.t = i / NPC_COUNT;
  p.userData.speed = 0.009 + Math.random() * 0.009;
  p.userData.bobPhase = Math.random() * Math.PI * 2;
  p.userData.pauseTimer = 4 + Math.random() * 8;
  p.userData.paused = false;
  const start = pathPoint(p.userData.t);
  p.position.copy(start);
  cityGroup.add(p);
  npcs.push(p);
}

// ========== ZKR CITY — DISTRICTS, ENTITY DATA & LIVING SYSTEMS ==========
// This layer extends the original neighborhood instead of replacing it: the room planner
// remains the smallest scale of a city that can be read, selected, and incrementally built.
const zkrCityGroup = new THREE.Group();
cityGroup.add(zkrCityGroup);
const cityEntities = [];
const cityPickables = [];
const cityBuildPlots = [];
const cityTraffic = [];
const cityWalkers = [];
const cityWindowMaterials = [];
let citySelectionHelper = null;
let citySelectionAnchor = null; // mesh world position captured at selection time, for cheap per-frame following
let cityHudAccumulator = 0;

const CITY_DISTRICTS = [
  { id: 'core', name: 'Civic Core', code: 'C-01', type: 'Civic + office', center: [29, -30], color: 0x6888A6, activity: 'Council session and office arrival' },
  { id: 'maker', name: 'Makers Yard', code: 'M-02', type: 'Studios + market', center: [-30, -28], color: 0xB87545, activity: 'Market stalls and workshop shift' },
  { id: 'canal', name: 'Canal Quarter', code: 'Q-03', type: 'Residential', center: [-30, 27], color: 0x6E8C74, activity: 'School walk and canal promenade' },
  { id: 'garden', name: 'Garden Loop', code: 'G-04', type: 'Park + hospitality', center: [30, 27], color: 0xB69A5B, activity: 'Park activity and evening dining' },
];

const RESIDENT_PROFILES = [
  { name: 'Amina Ali', role: 'Retail curator', activity: 'Opening the Makers Market', district: 'Makers Yard', status: 'Walking' },
  { name: 'Jules Park', role: 'Urban gardener', activity: 'Tending Garden Loop beds', district: 'Garden Loop', status: 'Working' },
  { name: 'Noah Stein', role: 'Civic analyst', activity: 'Arriving at Civic Core', district: 'Civic Core', status: 'Commuting' },
  { name: 'Mara Bell', role: 'Resident architect', activity: 'Reviewing a Canal Quarter permit', district: 'Canal Quarter', status: 'Meeting' },
  { name: 'Theo Reed', role: 'Barista', activity: 'Starting the Canal House morning shift', district: 'Canal Quarter', status: 'Working' },
  { name: 'Aya Morita', role: 'Gallery host', activity: 'Setting the civic gallery display', district: 'Civic Core', status: 'Preparing' },
  { name: 'Iris Quinn', role: 'Student', activity: 'Crossing to the library plaza', district: 'Garden Loop', status: 'Walking' },
  { name: 'Ren Okafor', role: 'Courier', activity: 'Delivering to Makers Yard', district: 'Makers Yard', status: 'On route' },
];

const CITY_BUILD_CATALOG = {
  mixedUse: { label: 'Mixed-use block', type: 'Mixed-use', floors: 5, residents: 96, value: 9400000, color: 0x899CA8, width: 5.4, depth: 4.8 },
  residence: { label: 'Courtyard residences', type: 'Residential', floors: 4, residents: 74, value: 6800000, color: 0xD1C1A5, width: 5.1, depth: 5.2 },
  civic: { label: 'Civic studio', type: 'Civic', floors: 3, residents: 18, value: 5100000, color: 0xA7B7C3, width: 5.8, depth: 4.2 },
  market: { label: 'Market hall', type: 'Retail', floors: 2, residents: 22, value: 3700000, color: 0xBF8154, width: 6.2, depth: 4.6 },
};

// Street hierarchy: `tier` distinguishes the primary cross-town spine
// ('primary') from the shorter, district-local streets ('secondary')
// that branch off it. This only changes surface color/markings — the
// road's actual footprint (x, z, width, depth, the two call sites'
// existing values) is untouched, so lot lines, camera framing, and every
// other system that assumes today's road geometry keeps working exactly
// as before.
function addCityRoad(x, z, width, depth, tier = 'secondary') {
  const isPrimary = tier === 'primary';
  const road = new THREE.Mesh(
    new THREE.PlaneGeometry(width, depth),
    new THREE.MeshStandardMaterial({ color: isPrimary ? 0x212C3A : 0x2C3A4C, roughness: isPrimary ? 0.82 : 0.92 })
  );
  road.rotation.x = -Math.PI / 2;
  road.position.set(x, -0.028, z);
  road.receiveShadow = true;
  zkrCityGroup.add(road);

  const isVertical = depth > width;
  const extent = isVertical ? depth : width;

  if (isPrimary) {
    // Arterial marking language: a solid double centerline (the spine
    // carries through-traffic and shouldn't read as casually crossable)
    // plus tighter, brighter dashed lane lines either side of it.
    const centerMat = new THREE.MeshBasicMaterial({ color: 0xE8C558, transparent: true, opacity: 0.75 });
    const laneMat = new THREE.MeshBasicMaterial({ color: 0xE2D7BE, transparent: true, opacity: 0.62 });
    const centerGap = 0.16;
    [-centerGap, centerGap].forEach(offset => {
      const line = new THREE.Mesh(
        new THREE.PlaneGeometry(isVertical ? 0.1 : extent - 4, isVertical ? extent - 4 : 0.1),
        centerMat
      );
      line.rotation.x = -Math.PI / 2;
      line.position.set(x + (isVertical ? offset : 0), -0.023, z + (isVertical ? 0 : offset));
      zkrCityGroup.add(line);
    });
    const laneOffset = Math.min(width, depth) / 2 - 0.9;
    [-laneOffset, laneOffset].forEach(offset => {
      for (let i = -extent / 2 + 2; i < extent / 2; i += 2.6) {
        const dash = new THREE.Mesh(new THREE.PlaneGeometry(isVertical ? 0.1 : 0.9, isVertical ? 0.9 : 0.1), laneMat);
        dash.rotation.x = -Math.PI / 2;
        dash.position.set(
          x + (isVertical ? offset : i),
          -0.024,
          z + (isVertical ? i : offset)
        );
        zkrCityGroup.add(dash);
      }
    });
  } else {
    // Secondary/local street: the original sparse single dashed centerline —
    // unchanged from before, so existing district streets keep their look.
    const ruleMat = new THREE.MeshBasicMaterial({ color: 0xE2D7BE, transparent: true, opacity: 0.56 });
    for (let i = -extent / 2 + 2; i < extent / 2; i += 3.4) {
      const dash = new THREE.Mesh(new THREE.PlaneGeometry(isVertical ? 0.14 : 1.2, isVertical ? 1.2 : 0.14), ruleMat);
      dash.rotation.x = -Math.PI / 2;
      dash.position.set(x + (isVertical ? 0 : i), -0.024, z + (isVertical ? i : 0));
      zkrCityGroup.add(dash);
    }
  }
}

// Shared grass material/texture for all parks — was previously a new
// MeshStandardMaterial (flat color, no texture) created fresh inside
// addCityPark on every call. One texture + one material reused across every
// park instance: cheaper (fewer GPU resources, matters more as more parks
// are added later) and gives the lawn actual visual texture instead of a
// flat green plane.
const grassNoiseTex = makeSurfaceNoiseTexture(0x6D825A, { density: 1600, alpha: 0.06 });
grassNoiseTex.repeat.set(6, 6);
const grassMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: grassNoiseTex, roughness: 1 });

function addCityPark(x, z, width, depth) {
  const park = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), grassMat);
  park.rotation.x = -Math.PI / 2;
  park.position.set(x, -0.016, z);
  park.receiveShadow = true;
  zkrCityGroup.add(park);
  const pathMat = new THREE.MeshBasicMaterial({ color: 0xD6CCB8, transparent: true, opacity: 0.9 });
  const pathA = new THREE.Mesh(new THREE.PlaneGeometry(width * 0.78, 0.46), pathMat);
  pathA.rotation.x = -Math.PI / 2; pathA.position.set(x, -0.012, z); zkrCityGroup.add(pathA);
  const pathB = new THREE.Mesh(new THREE.PlaneGeometry(0.46, depth * 0.78), pathMat);
  pathB.rotation.x = -Math.PI / 2; pathB.position.set(x, -0.011, z); zkrCityGroup.add(pathB);
  // Furniture offsets below were tuned for the original ~10-13 unit parks.
  // Scale them *down* (never up, so every existing call site keeps its
  // exact prior look) for smaller commons/plazas, so trees and lamps stay
  // inside the plaza footprint instead of spilling past its edge.
  const furnitureScale = Math.min(1, width / 10, depth / 10);
  [[-2.8,-2.2], [2.7,-2.5], [-2.3,2.4], [2.8,2.6], [0,3.3]].forEach(([dx,dz], i) => {
    const tree = makeTree(0.92 + (i % 2) * 0.16);
    tree.position.set(x + dx * furnitureScale, 0, z + dz * furnitureScale);
    zkrCityGroup.add(tree); trees.push(tree);
  });
  const bench = makeOutdoorBenchMesh(); bench.position.set(x - 1.4 * furnitureScale, 0, z + 0.8 * furnitureScale); bench.rotation.y = Math.PI / 2; zkrCityGroup.add(bench);
  const lamp = makeLamp(); lamp.position.set(x + 3.7 * furnitureScale, 0, z - 2.7 * furnitureScale); zkrCityGroup.add(lamp); lamps.push(lamp);
}

function registerCityEntity(mesh, data) {
  const entity = { mesh, ...data };
  mesh.userData.cityEntity = entity;
  cityEntities.push(entity);
  cityPickables.push(mesh);
  mesh.traverse(node => {
    if (node.isMesh && node.material && node.material.map && node.material.emissive) cityWindowMaterials.push(node.material);
  });
  return entity;
}

function makeDistrictBuilding(district, index, spec) {
  const building = makeBuilding(spec.width, spec.floors * 2.65, spec.depth, spec.color, 0.22 + (index % 3) * 0.08, spec.type);
  building.position.set(district.center[0] + spec.x, 0, district.center[1] + spec.z);
  building.rotation.y = spec.rotation || 0;
  zkrCityGroup.add(building);
  return registerCityEntity(building, {
    kind: 'building',
    name: spec.name,
    district: district.name,
    type: spec.type,
    floors: spec.floors,
    residents: spec.residents,
    value: spec.value,
    status: spec.status || 'Active',
    footprintWidth: spec.width,
    footprintDepth: spec.depth,
  });
}

function addAtelierParcel() {
  // The Atelier occupies a Canal Quarter parcel, connected to the district road by a pedestrian datum path.
  const x = -21.5, z = 35.2;
  const parcel = new THREE.Mesh(new THREE.PlaneGeometry(8.6, 7.8), new THREE.MeshStandardMaterial({ color: 0xD8D0BF, roughness: 0.96 }));
  parcel.rotation.x = -Math.PI / 2;
  parcel.position.set(x, -0.014, z);
  parcel.receiveShadow = true;
  zkrCityGroup.add(parcel);
  const walk = new THREE.Mesh(new THREE.PlaneGeometry(1.25, 5.8), new THREE.MeshStandardMaterial({ color: 0xB9B1A0, roughness: 0.94 }));
  walk.rotation.x = -Math.PI / 2;
  walk.position.set(x, -0.01, 30.8);
  zkrCityGroup.add(walk);
  // Building family changed from the default 'office' (flat parapet roof,
  // dark glass-tower blue) to 'hospitality' — this is a real geometry
  // change, not a recolor: it swaps in the pyramidal mansard roof, the
  // full-width ground-floor glass band with mullions, and the warm
  // entrance canopy already built for hospitality-type buildings
  // elsewhere in the city (see BUILDING_FAMILIES / makeBuilding above),
  // reused here because they're the actual pitched-roof, glass-fronted,
  // warm-material architecture a restaurant should read as, matching the
  // reference's building character instead of the generic glass-office
  // look the Atelier had before.
  const atelier = makeBuilding(6.7, 5.3, 5.5, 0xC9A876, 0.56, 'hospitality');
  atelier.position.set(x, 0, z);
  zkrCityGroup.add(atelier);
  const datum = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.08, 0.16), new THREE.MeshStandardMaterial({ color: 0x17B6C4, roughness: 0.58, metalness: 0.24 }));
  datum.position.set(x, 2.0, z + 2.82);
  zkrCityGroup.add(datum);
  const portal = new THREE.Mesh(new THREE.BoxGeometry(1.25, 2.2, 0.13), new THREE.MeshStandardMaterial({ color: 0xD8D0BF, roughness: 0.78 }));
  portal.position.set(x, 1.1, z + 2.82);
  zkrCityGroup.add(portal);
  const marker = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.44, 0.16), new THREE.MeshStandardMaterial({ color: 0x17B6C4, roughness: 0.48, metalness: 0.2 }));
  marker.position.set(x - 2.25, 2.55, z + 2.84);
  zkrCityGroup.add(marker);
  return registerCityEntity(atelier, {
    kind: 'building', name: 'ZKR Atelier', district: 'Canal Quarter', type: 'Planning studio', floors: 2,
    residents: 40, value: 8400000, status: 'Live', footprintWidth: 6.7, footprintDepth: 5.5,
  });
}

// Deterministic civic composition: within Civic Core, Makers Yard, and
// Canal Quarter (Garden Loop already has its own dedicated 13x13 park
// and is left as originally designed — see buildDistricts below), each
// district's landmark building anchors a plaza rather than just being
// "one of three roughly-triangular buildings." The landmark is chosen
// from the district's own `type` data (a Civic/Culture/Library use, or
// the tallest building if none of those types are present), placed at a
// fixed northern anchor slot, and the plaza sits between it and the
// local street — so arriving from the street you cross an open civic
// space before reaching the anchor building. The two remaining buildings
// flank the plaza east/west, with the taller of the two given the flank
// slot nearer the primary cross-town spine (consistent with "tall
// buildings gravitate toward the primary road" for the buildings that
// aren't the landmark itself).
//
// This is a pure function of each district's existing specs (name,
// type, floors, width, depth) — no Math.random, no call-order
// dependence — so the same input always produces the same layout.
// The three anchor slots below were sized against every building's
// actual footprint (verified with a standalone overlap script) with a
// comfortable margin, so no combination of landmark/flank assignment
// can ever produce an overlap.
const CIVIC_LANDMARK_OFFSET = { x: 0, z: 15.5 };
const CIVIC_FLANK_A_OFFSET = { x: -8.7, z: 6.6 };
const CIVIC_FLANK_B_OFFSET = { x: 8.7, z: 6.6 };
const CIVIC_PLAZA = { x: 0, z: 6.6, width: 7, depth: 7 };
const LANDMARK_TYPES = ['Civic', 'Culture', 'Library'];

function composeCivicDistrict(center, specs, orientation = 1) {
  // orientation flips the whole landmark/plaza/flank cluster across the
  // street (north vs south of the district's local street). Canal Quarter
  // uses -1: its "north" side is already occupied by the fixed ZKR Atelier
  // parcel (see addAtelierParcel, at absolute (-21.5, 35.2) — roughly
  // (+8.5, +8.2) relative to Canal Quarter's own center), so its civic
  // cluster is oriented south instead, verified collision-free against the
  // Atelier by rendering actual runtime building positions (see below).
  const landmarkOffset = { x: CIVIC_LANDMARK_OFFSET.x, z: CIVIC_LANDMARK_OFFSET.z * orientation };
  const flankAOffset = { x: CIVIC_FLANK_A_OFFSET.x, z: CIVIC_FLANK_A_OFFSET.z * orientation };
  const flankBOffset = { x: CIVIC_FLANK_B_OFFSET.x, z: CIVIC_FLANK_B_OFFSET.z * orientation };

  const landmarkPool = specs.filter(spec => LANDMARK_TYPES.includes(spec.type));
  const landmark = (landmarkPool.length ? landmarkPool : specs)
    .reduce((tallest, spec) => (spec.floors > tallest.floors ? spec : tallest));
  const flankCandidates = specs.filter(spec => spec !== landmark).sort((a, b) => b.floors - a.floors);

  const flankASpine = Math.hypot(center[0] + flankAOffset.x, center[1] + flankAOffset.z);
  const flankBSpine = Math.hypot(center[0] + flankBOffset.x, center[1] + flankBOffset.z);
  const [nearFlank, farFlank] = flankASpine <= flankBSpine ? [flankAOffset, flankBOffset] : [flankBOffset, flankAOffset];

  return specs.map(spec => {
    if (spec === landmark) return { ...spec, x: landmarkOffset.x, z: landmarkOffset.z, rotation: 0 };
    if (spec === flankCandidates[0]) return { ...spec, x: nearFlank.x, z: nearFlank.z, rotation: 0 };
    return { ...spec, x: farFlank.x, z: farFlank.z, rotation: 0 };
  });
}

// Citywide ground plane — previously absent: every district, road and plaza
// sat on individually-sized planes with nothing connecting them, so the
// space *between* them (visible in every wide/city-scale shot) rendered as
// the sky dome's flat gradient fill showing through, not real geometry —
// no texture, no shadow reception, a visible cause of the "too empty/too
// generic" city-scale views. This is a single large, low, textured plane
// added once beneath everything else (every other ground element already
// sits at y between -0.028 and 0.012, so -0.05 stays safely under all of
// them with no z-fighting) — purely a visual base layer, not part of any
// collision or placement system, so nothing about furniture/city logic
// changes. Sized to stay under the first-person walk radius (R=140) with
// margin on every side.
const cityGroundTex = makeSurfaceNoiseTexture(0xE6DFCE, { density: 1400, alpha: 0.035 });
cityGroundTex.repeat.set(48, 48);
const cityGroundMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: cityGroundTex, roughness: 1 });
const cityGroundMesh = new THREE.Mesh(new THREE.PlaneGeometry(320, 320), cityGroundMat);
cityGroundMesh.rotation.x = -Math.PI / 2;
cityGroundMesh.position.y = -0.05;
cityGroundMesh.receiveShadow = true;
zkrCityGroup.add(cityGroundMesh);

// Per-district ground tint — district.color already existed in
// CITY_DISTRICTS but, verified by searching every use site, was never
// actually read anywhere: all four districts rendered as the identical
// beige regardless of name. A soft, low-opacity color wash sitting just
// above the new base ground plane (y -0.045, still below every road/park/
// plaza surface at -0.028 or higher) gives each district a distinct,
// intentional atmosphere at city scale without touching any existing
// geometry, color, or position.
function addDistrictGroundTint(district) {
  const tint = new THREE.Mesh(
    new THREE.CircleGeometry(29, 40),
    new THREE.MeshBasicMaterial({ color: district.color, transparent: true, opacity: 0.07, depthWrite: false })
  );
  tint.rotation.x = -Math.PI / 2;
  tint.position.set(district.center[0], -0.045, district.center[1]);
  zkrCityGroup.add(tint);
}

// Per-district plaza landmark — a small, purely decorative marker placed
// at the exact plaza center point. Verified empty: the five trees, bench
// and lamp placed by addCityPark all use non-zero (dx,dz) offsets (see
// their offset table above), so (0,0) — the plaza's literal center, where
// its cross-paths already intersect — has never had anything placed on
// it. Each district gets its own silhouette (civic flagpole, market
// awning, canal bollard, garden obelisk) built from the district's own
// `color` field, so the four plazas read as different places rather than
// the same square with different buildings around it. Not registered as
// a cityEntity/pickable — decorative only, doesn't touch click-selection,
// activity feed, or any other existing system.
function addPlazaLandmark(district, orientation) {
  const x = district.center[0] + CIVIC_PLAZA.x;
  const z = district.center[1] + CIVIC_PLAZA.z * orientation;
  const g = new THREE.Group();
  const accent = new THREE.MeshStandardMaterial({ color: district.color, roughness: 0.5, metalness: 0.18 });
  const stone = new THREE.MeshStandardMaterial({ color: 0xD8D0BF, roughness: 0.92 });

  if (district.id === 'core') {
    const plinth = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.6, 0.18, 20), stone);
    plinth.position.y = 0.09; g.add(plinth);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 3.1, 10), new THREE.MeshStandardMaterial({ color: 0xB8C0C8, metalness: 0.6, roughness: 0.35 }));
    pole.position.y = 1.72; g.add(pole);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.68, 0.44), accent);
    flag.position.set(0.35, 2.95, 0); flag.material.side = THREE.DoubleSide; g.add(flag);
  } else if (district.id === 'maker') {
    const postMat = stone;
    [[-0.55, -0.4], [0.55, -0.4], [-0.55, 0.4], [0.55, 0.4]].forEach(([px, pz]) => {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 2.05, 8), postMat);
      post.position.set(px, 1.02, pz); g.add(post);
    });
    const awning = new THREE.Mesh(new THREE.BoxGeometry(1.32, 0.08, 1.02), accent);
    awning.position.y = 2.1; g.add(awning);
    const trim = new THREE.Mesh(new THREE.BoxGeometry(1.32, 0.05, 0.05), new THREE.MeshStandardMaterial({ color: 0xF4F0E7, roughness: 0.8 }));
    trim.position.set(0, 2.05, 0.51); g.add(trim);
  } else if (district.id === 'canal') {
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.36, 0.14, 16), stone);
    base.position.y = 0.07; g.add(base);
    const bollard = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.62, 12), accent);
    bollard.position.y = 0.4; g.add(bollard);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.115, 12, 8), accent);
    cap.position.y = 0.73; g.add(cap);
  } else {
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.14, 0.5), stone);
    base.position.y = 0.07; g.add(base);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.15, 1.55, 4), accent);
    shaft.position.y = 0.92; g.add(shaft);
    const finial = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), accent);
    finial.position.y = 1.76; g.add(finial);
  }

  g.traverse(node => { if (node.isMesh) { node.castShadow = true; node.receiveShadow = true; } });
  g.position.set(x, 0, z);
  zkrCityGroup.add(g);
}

function buildDistricts() {
  addCityRoad(0, 0, 14, 148, 'primary');
  addCityRoad(0, 0, 148, 14, 'primary');
  addCityRoad(-30, -28, 44, 5.4, 'secondary');
  addCityRoad(29, -30, 44, 5.4, 'secondary');
  addCityRoad(-30, 27, 44, 5.4, 'secondary');
  addCityRoad(30, 27, 44, 5.4, 'secondary');

  // Palette shifted from cool blue-grays/steel tones to the warm pastel
  // row-house palette the reference shows (sage green, terracotta, dusty
  // blue, cream, ochre) — a real, deliberate city-wide color change, not
  // a single building. Widths/depths/positions/floors/residents/value are
  // all untouched, so collision layout and every stat this data feeds
  // stay exactly as verified before.
  const buildingSets = [
    [
      { name: 'ZKR Civic Exchange', type: 'Civic', floors: 8, residents: 340, value: 21800000, width: 6.4, depth: 5.4, x: -7, z: -6, color: 0xC9BBA0 },
      { name: 'Helix Offices', type: 'Office', floors: 6, residents: 248, value: 15600000, width: 5.4, depth: 5.0, x: 5, z: -5, color: 0xA9A6C4, rotation: Math.PI/2 },
      { name: 'Archive House', type: 'Library', floors: 4, residents: 82, value: 7900000, width: 6.0, depth: 4.8, x: -1, z: 6, color: 0xE3D9BE },
    ],
    [
      { name: 'Foundry Lofts', type: 'Studios', floors: 5, residents: 154, value: 11700000, width: 5.4, depth: 5.5, x: -7, z: -5, color: 0xCC8B5C },
      { name: 'Canal Market Hall', type: 'Retail', floors: 2, residents: 44, value: 6300000, width: 7.0, depth: 5.2, x: 5, z: -4, color: 0xD9A15E },
      { name: 'Forge Courtyard', type: 'Workshop', floors: 3, residents: 74, value: 4800000, width: 5.0, depth: 4.8, x: 0, z: 6, color: 0xB57D52, rotation: Math.PI/2 },
    ],
    [
      { name: 'Tide Apartments', type: 'Residential', floors: 4, residents: 284, value: 17600000, width: 5.8, depth: 5.4, x: -7, z: -5, color: 0x8FAE93 },
      { name: 'Juniper Terrace', type: 'Residential', floors: 3, residents: 148, value: 9600000, width: 5.6, depth: 5.0, x: 5, z: -4, color: 0xE6C9A8 },
      { name: 'Canal School', type: 'Education', floors: 3, residents: 116, value: 7200000, width: 6.2, depth: 4.8, x: 0, z: 6, color: 0x9DBFC2 },
    ],
    [
      { name: 'Garden Hotel', type: 'Hospitality', floors: 4, residents: 216, value: 19400000, width: 6.4, depth: 5.6, x: -7, z: -5, color: 0xD8B27A },
      { name: 'Vine Restaurant', type: 'Hospitality', floors: 2, residents: 62, value: 5500000, width: 5.7, depth: 5.0, x: 5, z: -4, color: 0xC9A876 },
      { name: 'Orchid Gallery', type: 'Culture', floors: 2, residents: 38, value: 4100000, width: 6.3, depth: 4.4, x: 0, z: 6, color: 0xE8DFC8 },
    ],
  ];
  const CIVIC_ORIENTATION = { core: 1, maker: 1, canal: -1, garden: 1 }; // see composeCivicDistrict for why Canal Quarter flips

  CITY_DISTRICTS.forEach((district, index) => {
    const placedSet = composeCivicDistrict(district.center, buildingSets[index], CIVIC_ORIENTATION[district.id]);
    placedSet.forEach((spec, i) => makeDistrictBuilding(district, i, spec));
  });

  // Public-space hierarchy: every district gets a real civic plaza (not a
  // token square) sitting between its local street and its landmark
  // building, framed on either side by the two remaining buildings — see
  // composeCivicDistrict above for the placement logic and why these
  // dimensions are collision-safe against every possible landmark/flank
  // assignment. Garden Loop previously had a bespoke 13x13 park centered
  // exactly on the district center — which, verified against actual
  // runtime building positions, silently overlapped its own local street
  // and two of its three buildings (a pre-existing geometry bug, not
  // something this pass introduced). The same plaza treatment used for
  // the other three districts fixes that while keeping Garden Loop's own
  // buildings untouched.
  CITY_DISTRICTS.forEach(district => {
    const orientation = CIVIC_ORIENTATION[district.id];
    addCityPark(district.center[0] + CIVIC_PLAZA.x, district.center[1] + CIVIC_PLAZA.z * orientation, CIVIC_PLAZA.width, CIVIC_PLAZA.depth);
    addPlazaLandmark(district, orientation);
  });
  CITY_DISTRICTS.forEach(addDistrictGroundTint);
  addCityPark(-4, 24, 10, 12);
  addAtelierParcel();
}

function createBuildPlot(id, x, z) {
  const mat = new THREE.MeshBasicMaterial({ color: 0x17B6C4, transparent: true, opacity: 0.16, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(6.6, 5.8), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(x, 0.012, z);
  mesh.userData.cityBuildPlot = { id, x, z, occupied: false };
  const outline = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(6.6, 5.8)), new THREE.LineBasicMaterial({ color: 0x17B6C4, transparent: true, opacity: 0.9 }));
  outline.rotation.x = -Math.PI / 2;
  outline.position.copy(mesh.position); outline.position.y += 0.01;
  zkrCityGroup.add(mesh, outline);
  cityBuildPlots.push({ mesh, outline, ...mesh.userData.cityBuildPlot });
}

function addCityTraffic() {
  // The spine route is a closed loop cars follow via loopPathPoint. It was
  // previously two straight lanes at z=-3.1/+3.1 spanning the full x range,
  // which is symmetric around the origin and therefore drove straight
  // through the Atelier parcel (x:[-6,6], z:[-5,5]) — the reported bug.
  // Fixed by adding a rectangular notch on each lane between x=-8 and x=8
  // (2 units of clearance past the parcel's walls on both sides) so both
  // lanes detour around the building instead of through it, while the rest
  // of the loop is untouched.
  const spineRoute = [
    new THREE.Vector3(-68,0,-3.1), new THREE.Vector3(-8,0,-3.1),
    new THREE.Vector3(-8,0,-8),    new THREE.Vector3(8,0,-8),
    new THREE.Vector3(8,0,-3.1),   new THREE.Vector3(68,0,-3.1),
    new THREE.Vector3(68,0,3.1),   new THREE.Vector3(8,0,3.1),
    new THREE.Vector3(8,0,8),      new THREE.Vector3(-8,0,8),
    new THREE.Vector3(-8,0,3.1),   new THREE.Vector3(-68,0,3.1),
  ];
  const canalRoute = [new THREE.Vector3(-52,0,25.8), new THREE.Vector3(-8,0,25.8), new THREE.Vector3(-8,0,28.2), new THREE.Vector3(-52,0,28.2)];
  [[0x587A9B,'sedan',0.05,1.7], [0xB87343,'compact',0.30,1.2], [0xC9A645,'taxi',0.58,1.45], [0xA9ABA9,'van',0.78,1.0], [0x5D7867,'sedan',0.88,1.5]].forEach(([color,type,progress,speed], i) => {
    const mesh = makeCar(color, type); mesh.position.y = 0; zkrCityGroup.add(mesh);
    cityTraffic.push({ mesh, route: i >= 3 ? canalRoute : spineRoute, progress, speed, direction: i % 2 ? -1 : 1 });
  });
}

function loopPathPoint(points, t) {
  const total = points.length;
  const safe = ((t % 1) + 1) % 1;
  const pos = safe * total;
  const index = Math.floor(pos) % total;
  return new THREE.Vector3().lerpVectors(points[index], points[(index + 1) % total], pos - Math.floor(pos));
}

function seedCityResidents() {
  const routeA = [new THREE.Vector3(-47,0,-35), new THREE.Vector3(-11,0,-35), new THREE.Vector3(-11,0,-19), new THREE.Vector3(-47,0,-19)];
  const routeB = [new THREE.Vector3(13,0,19), new THREE.Vector3(46,0,19), new THREE.Vector3(46,0,37), new THREE.Vector3(13,0,37)];
  RESIDENT_PROFILES.forEach((profile, index) => {
    const person = makePerson(index + 2);
    person.scale.setScalar(0.88 + (index % 3) * 0.07);
    person.userData.walkRoute = index % 2 ? routeA : routeB;
    person.userData.walkT = index / RESIDENT_PROFILES.length;
    person.userData.walkSpeed = 0.010 + (index % 4) * 0.002;
    person.userData.bobPhase = index * 0.8;
    person.userData.cityEntity = { mesh: person, kind: 'person', ...profile };
    const start = loopPathPoint(person.userData.walkRoute, person.userData.walkT);
    person.position.copy(start);
    zkrCityGroup.add(person);
    cityEntities.push(person.userData.cityEntity);
    cityPickables.push(person);
    cityWalkers.push(person);
  });
  npcs.forEach((person, index) => {
    const profile = RESIDENT_PROFILES[index % RESIDENT_PROFILES.length];
    person.userData.cityEntity = { mesh: person, kind: 'person', ...profile };
    cityPickables.push(person);
  });
}

function constructCityBuilding(plot, key = state.cityBuildType) {
  if (!plot || plot.occupied) return;
  const spec = CITY_BUILD_CATALOG[key] || CITY_BUILD_CATALOG.mixedUse;
  const building = makeBuilding(spec.width, spec.floors * 2.65, spec.depth, spec.color, 0.34, spec.type);
  building.position.set(plot.x, 0, plot.z);
  zkrCityGroup.add(building);
  registerCityEntity(building, { kind: 'building', name: spec.label, district: 'Growth Plot', type: spec.type, floors: spec.floors, residents: spec.residents, value: spec.value, status: 'New build' });
  plot.occupied = true;
  plot.mesh.visible = false; plot.outline.visible = false;
  state.cityBuildMode = false;
  document.getElementById('cityBuildBtn').classList.remove('active');
  updateCityInterface();
  selectCityEntity(building.userData.cityEntity);
  showToast(`${spec.label} commissioned at ${plot.id}`, 'fa-building');
}

// Branded selection marker: four architectural corner brackets at the footprint plus a thin
// elevation line, evoking a site-survey annotation rather than a raw engine debug wireframe.
function buildSiteSelectionMarker(box3, color) {
  const group = new THREE.Group();
  const size = new THREE.Vector3();
  box3.getSize(size);
  const armLen = THREE.MathUtils.clamp(Math.min(size.x, size.z) * 0.22, 0.35, 1.1);
  const thickness = 0.045;
  const y = box3.min.y + 0.03;
  const corners = [
    { x: box3.min.x, z: box3.min.z, dx: 1, dz: 1 },
    { x: box3.max.x, z: box3.min.z, dx: -1, dz: 1 },
    { x: box3.min.x, z: box3.max.z, dx: 1, dz: -1 },
    { x: box3.max.x, z: box3.max.z, dx: -1, dz: -1 },
  ];
  corners.forEach(c => {
    const armX = new THREE.Mesh(new THREE.BoxGeometry(armLen, thickness, thickness), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95 }));
    armX.position.set(c.x + c.dx * armLen / 2, y, c.z);
    group.add(armX);
    const armZ = new THREE.Mesh(new THREE.BoxGeometry(thickness, thickness, armLen), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95 }));
    armZ.position.set(c.x, y, c.z + c.dz * armLen / 2);
    group.add(armZ);
  });
  // Thin elevation line at the near corner, communicating height without boxing the whole volume.
  const vLine = new THREE.Mesh(new THREE.CylinderGeometry(thickness / 2, thickness / 2, size.y, 6), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.3 }));
  vLine.position.set(box3.min.x, box3.min.y + size.y / 2, box3.min.z);
  group.add(vLine);
  return group;
}
function disposeSelectionMarker(marker) {
  if (!marker) return;
  scene.remove(marker);
  marker.traverse(c => {
    if (c.geometry) c.geometry.dispose();
    if (c.material) c.material.dispose();
  });
}

function deselectCityEntity() {
  if (!state.selectedCityEntity) return;
  state.selectedCityEntity = null;
  citySelectionAnchor = null;
  disposeSelectionMarker(citySelectionHelper);
  citySelectionHelper = null;
  document.getElementById('citySelectionCard').classList.remove('active');
}
document.getElementById('closeCitySelection').addEventListener('click', (e) => {
  e.stopPropagation();
  deselectCityEntity();
});

function selectCityEntity(entity) {
  if (!entity) return;
  state.selectedCityEntity = entity;
  disposeSelectionMarker(citySelectionHelper);
  const box = new THREE.Box3().setFromObject(entity.mesh);
  citySelectionAnchor = entity.mesh.position.clone();
  citySelectionHelper = buildSiteSelectionMarker(box, 0x17B6C4);
  scene.add(citySelectionHelper);
  const isPerson = entity.kind === 'person';
  const isAtelier = entity.name === 'ZKR Atelier';
  document.getElementById('citySelectionCard').classList.add('active');
  document.getElementById('citySelectionName').textContent = entity.name;
  document.getElementById('citySelectionMeta').textContent = isPerson ? `${entity.role.toUpperCase()} / ${entity.district.toUpperCase()} / ${entity.status.toUpperCase()}` : `${entity.type.toUpperCase()} / ${entity.district.toUpperCase()} / ${entity.status.toUpperCase()}`;
  document.getElementById('citySelectionDetail').innerHTML = isPerson
    ? `<span>Activity<b>${entity.status}</b></span><span>District<b>${entity.district}</b></span><span>Now<b>Live</b></span>`
    : isAtelier
      // The one building in the city that isn't just static data — this is
      // the actual project score computed from the furniture layout you
      // built, the same number shown in the right-hand analytics panel.
      // Selecting your own café here is the moment the two views connect.
      ? `<span>Project score<b>${state.projectScore ?? '—'}</b></span><span>Seats<b>${document.getElementById('seatsStat')?.textContent ?? '0'}</b></span><span>Layout<b>${state.spaceEfficiencyPct ?? 0}% efficient</b></span>`
      : `<span>Floors<b>${entity.floors}</b></span><span>Residents<b>${entity.residents}</b></span><span>Value<b>$${Math.round(entity.value / 1000000)}M</b></span>`;
  showToast(isPerson ? `${entity.name} · ${entity.activity}` : isAtelier ? `This is the café you're designing — score ${state.projectScore ?? '—'}` : `${entity.name} selected`, isPerson ? 'fa-user' : 'fa-building');
}

function updateCityInterface() {
  const buildings = cityEntities.filter(entity => entity.kind === 'building');
  const residents = buildings.reduce((total, entity) => total + (entity.residents || 0), 0);
  const value = state.cityValueBase + buildings.reduce((total, entity) => total + (entity.value || 0), 0);
  const night = state.cityTime < 6.25 || state.cityTime >= 18.5;
  const activity = Math.round((night ? 38 : 74) + Math.sin(state.cityTime * 0.8) * 7 + cityWalkers.length * 0.35);
  document.getElementById('cityPopulation').textContent = residents.toLocaleString();
  document.getElementById('cityBuildingsCount').textContent = buildings.length;
  document.getElementById('cityActivityPct').textContent = activity;
  document.getElementById('cityActivityShort').textContent = `${activity}%`;
  document.getElementById('panelPopulation').textContent = residents.toLocaleString();
  document.getElementById('panelValue').textContent = `$${Math.round(value / 1000000)}M`;
  document.getElementById('panelTraffic').textContent = `${cityTraffic.length + cars.length}`;
  document.getElementById('panelCycle').textContent = night ? 'Night' : 'Day';
  document.getElementById('cityPhase').textContent = night ? 'NIGHT / LIT' : 'DAY / ACTIVE';
  const hours = Math.floor(state.cityTime) % 24;
  const minutes = Math.floor((state.cityTime % 1) * 60).toString().padStart(2, '0');
  document.getElementById('cityClock').textContent = `${hours.toString().padStart(2, '0')}:${minutes}`;
  document.getElementById('cityModeBadge').textContent = state.cityScale === 'interior' ? 'Interior' : state.cityScale.toUpperCase();
  document.getElementById('cityActivityList').innerHTML = CITY_DISTRICTS.slice(0, 3).map((district, index) => `<div class="city-activity"><i class="fa-solid ${index === 1 ? 'fa-person-walking' : 'fa-signal'}"></i><span><strong>${district.name}</strong> · ${district.activity}</span></div>`).join('');
}

function renderCityDistricts() {
  const strip = document.getElementById('cityDistrictStrip');
  strip.innerHTML = CITY_DISTRICTS.map(district => `<button class="district-chip" data-district="${district.id}">${district.code} · ${district.name}</button>`).join('');
  strip.querySelectorAll('button').forEach(button => button.addEventListener('click', () => focusDistrict(button.dataset.district)));
}

buildDistricts();
createBuildPlot('PLOT / 05', -18, 18);
createBuildPlot('PLOT / 06', 18, -18);
createBuildPlot('PLOT / 07', 48, 18);
addCityTraffic();
seedCityResidents();
updateCityInterface();
renderCityDistricts();

// ========== FURNITURE FACTORIES ==========
// ========== FURNITURE VISUAL KIT ==========
// Shared helpers so every piece of furniture gets the same quality bar
// instead of each factory hand-rolling its own primitives: rounded edges
// instead of raw box corners, tapered/rounded legs instead of square posts,
// and per-instance material variation so five identical chairs don't read
// as five clones of the same asset.

// A box with rounded corners in its footprint (X/Z plane), built by
// extruding a rounded rectangle vertically — a drop-in replacement for
// `new THREE.BoxGeometry(width, height, depth)` with the same axis meaning
// (X=width, Y=height/vertical thickness, Z=depth), but with a much better
// silhouette for anything with a visible edge: tabletops, seats, cushions.
function roundedBoxGeometry(width, height, depth, radius = 0.03, segments = 3) {
  const shape = new THREE.Shape();
  const x = -width / 2, y = -depth / 2;
  const r = Math.min(radius, width / 2, depth / 2);
  shape.moveTo(x, y + r);
  shape.lineTo(x, y + depth - r);
  shape.quadraticCurveTo(x, y + depth, x + r, y + depth);
  shape.lineTo(x + width - r, y + depth);
  shape.quadraticCurveTo(x + width, y + depth, x + width, y + depth - r);
  shape.lineTo(x + width, y + r);
  shape.quadraticCurveTo(x + width, y, x + width - r, y);
  shape.lineTo(x + r, y);
  shape.quadraticCurveTo(x, y, x, y + r);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: height, bevelEnabled: true, bevelThickness: Math.min(0.012, height / 4),
    bevelSize: Math.min(0.012, r * 0.4), bevelSegments: 2, curveSegments: segments,
  });
  geo.translate(0, 0, -height / 2);
  geo.rotateX(-Math.PI / 2); // extrusion axis (height) -> world Y; shape's Y (depth) -> world Z
  geo.computeVertexNormals();
  return geo;
}
// Vertical-panel variant (chair backs, upright cushion faces) — the rounded
// rect faces the caller directly (no rotation), since these are positioned
// and rotated by the caller to stand upright.
function roundedPanelGeometry(w, h, d, radius = 0.03, segments = 3) {
  const shape = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  const r = Math.min(radius, w / 2, h / 2);
  shape.moveTo(x, y + r);
  shape.lineTo(x, y + h - r);
  shape.quadraticCurveTo(x, y + h, x + r, y + h);
  shape.lineTo(x + w - r, y + h);
  shape.quadraticCurveTo(x + w, y + h, x + w, y + h - r);
  shape.lineTo(x + w, y + r);
  shape.quadraticCurveTo(x + w, y, x + w - r, y);
  shape.lineTo(x + r, y);
  shape.quadraticCurveTo(x, y, x, y + r);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: d, bevelEnabled: true, bevelThickness: Math.min(0.01, d / 4),
    bevelSize: Math.min(0.01, r * 0.4), bevelSegments: 2, curveSegments: segments,
  });
  geo.translate(0, 0, -d / 2);
  geo.computeVertexNormals();
  return geo;
}

// Nudges a base color's lightness/hue slightly per call so repeated
// instances of the same material (five identical chairs, a run of tables)
// don't look like exact stamped clones — subtle, not noticeable as
// "randomized", just enough to break up flat repetition.
function materialVariant(hex, opts = {}) {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  const jitter = (opts.jitter ?? 0.035);
  hsl.l = Math.max(0.05, Math.min(0.95, hsl.l + (Math.random() - 0.5) * jitter));
  hsl.h = (hsl.h + (Math.random() - 0.5) * 0.01 + 1) % 1;
  c.setHSL(hsl.h, hsl.s, hsl.l);
  return new THREE.MeshStandardMaterial({
    color: c, roughness: opts.roughness ?? 0.6, metalness: opts.metalness ?? 0,
    envMapIntensity: opts.envMapIntensity ?? 1,
  });
}
// Tapered leg (slightly narrower at the floor) reads far less "primitive"
// than a plain box/cylinder post, at effectively the same triangle cost.
function taperedLegGeometry(topRadius, bottomRadius, height, segments = 8) {
  return new THREE.CylinderGeometry(topRadius, bottomRadius, height, segments);
}

function makeRoundTable() {
  const g = new THREE.Group();
  const topMat = materialVariant(0x8B6F47, { roughness: 0.4 });
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.04, 40), topMat);
  top.position.y = 0.74; top.castShadow = true; top.receiveShadow = true; g.add(top);
  // Slim edge-band gives the tabletop a visible thickness detail instead of a bare disc edge.
  const edge = new THREE.Mesh(
    new THREE.TorusGeometry(0.55, 0.012, 8, 40),
    new THREE.MeshStandardMaterial({ color: 0x3A2E20, roughness: 0.35, metalness: 0.1 })
  );
  edge.rotation.x = Math.PI / 2; edge.position.y = 0.74; g.add(edge);
  const pedestal = new THREE.Mesh(
    taperedLegGeometry(0.055, 0.09, 0.74, 16),
    new THREE.MeshStandardMaterial({ color: 0x2A2826, roughness: 0.35, metalness: 0.45 })
  );
  pedestal.position.y = 0.37; pedestal.castShadow = true; g.add(pedestal);
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.3, 0.3, 0.03, 24),
    new THREE.MeshStandardMaterial({ color: 0x2A2826, roughness: 0.4 })
  );
  base.position.y = 0.015; base.castShadow = true; g.add(base);
  return g;
}

function makeOvalTable() {
  const g = makeRoundTable();
  g.scale.set(1.55, 1, 0.85);
  return g;
}

function makeRectTable() {
  const g = new THREE.Group();
  const top = new THREE.Mesh(
    roundedBoxGeometry(1.6, 0.045, 0.85, 0.02, 2),
    materialVariant(0x8B6F47, { roughness: 0.4 })
  );
  top.position.y = 0.74; top.castShadow = true; top.receiveShadow = true; g.add(top);
  const legMat = new THREE.MeshStandardMaterial({ color: 0x2A2826, roughness: 0.35, metalness: 0.4 });
  const legGeom = taperedLegGeometry(0.022, 0.032, 0.74, 8);
  [[-0.72, -0.35], [0.72, -0.35], [-0.72, 0.35], [0.72, 0.35]].forEach(([x,z]) => {
    const leg = new THREE.Mesh(legGeom, legMat);
    leg.position.set(x, 0.37, z); leg.castShadow = true; g.add(leg);
  });
  // A thin stretcher bar between the long-side leg pairs reads as real
  // furniture construction rather than four posts floating under a slab.
  const stretcherMat = legMat;
  [-0.35, 0.35].forEach(z => {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.03, 0.03), stretcherMat);
    bar.position.set(0, 0.15, z); g.add(bar);
  });
  return g;
}

function makeChair(branded = false) {
  const g = new THREE.Group();
  const seatColor = branded ? state.brandColor : 0x2A2826;
  const seatMat = materialVariant(seatColor, { roughness: 0.65, jitter: 0.02 });
  const seat = new THREE.Mesh(roundedBoxGeometry(0.4, 0.05, 0.4, 0.035, 2), seatMat);
  seat.position.y = 0.45; seat.castShadow = true; seat.receiveShadow = true;
  if (branded) seat.userData.brand = true;
  g.add(seat);
  const back = new THREE.Mesh(roundedPanelGeometry(0.4, 0.45, 0.035, 0.05, 2), seatMat);
  back.position.set(0, 0.7, -0.18); back.castShadow = true;
  if (branded) back.userData.brand = true;
  g.add(back);
  // Tapered round legs read as designed furniture; square box posts (the
  // previous geometry) read as placeholder blocks.
  const legMat = new THREE.MeshStandardMaterial({ color: 0x4A4744, roughness: 0.45, metalness: 0.35 });
  const legGeom = taperedLegGeometry(0.016, 0.024, 0.45, 8);
  [[-0.17, -0.17], [0.17, -0.17], [-0.17, 0.17], [0.17, 0.17]].forEach(([x,z]) => {
    const leg = new THREE.Mesh(legGeom, legMat);
    leg.position.set(x, 0.225, z); leg.castShadow = true; g.add(leg);
  });
  return g;
}

function makeStool() {
  const g = new THREE.Group();
  const seat = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.18, 0.05, 20),
    materialVariant(state.brandColor, { roughness: 0.7, jitter: 0.02 })
  );
  seat.position.y = 0.65; seat.castShadow = true; seat.userData.brand = true; g.add(seat);
  const edge = new THREE.Mesh(
    new THREE.TorusGeometry(0.18, 0.008, 6, 20),
    new THREE.MeshStandardMaterial({ color: 0x2A2826, roughness: 0.35 })
  );
  edge.rotation.x = Math.PI / 2; edge.position.y = 0.675; g.add(edge);
  const leg = new THREE.Mesh(
    taperedLegGeometry(0.028, 0.038, 0.65, 12),
    new THREE.MeshStandardMaterial({ color: 0x2A2826, roughness: 0.35, metalness: 0.5 })
  );
  leg.position.y = 0.325; leg.castShadow = true; g.add(leg);
  const foot = new THREE.Mesh(
    new THREE.CylinderGeometry(0.2, 0.2, 0.02, 20),
    new THREE.MeshStandardMaterial({ color: 0x2A2826, roughness: 0.5 })
  );
  foot.position.y = 0.01; g.add(foot);
  return g;
}

function makeArmchair() {
  const g = new THREE.Group();
  const cloth = materialVariant(0xC4BAA8, { roughness: 0.9, jitter: 0.02 });
  // Upholstery reads as soft, not sharp-cornered wood — a noticeably bigger
  // rounding radius than the hard-surface furniture uses.
  const seat = new THREE.Mesh(roundedBoxGeometry(0.62, 0.32, 0.6, 0.09, 3), cloth);
  seat.position.y = 0.24; seat.castShadow = true; g.add(seat);
  const back = new THREE.Mesh(roundedBoxGeometry(0.62, 0.55, 0.16, 0.09, 3), cloth);
  back.position.set(0, 0.62, -0.24); back.castShadow = true; g.add(back);
  [-0.3, 0.3].forEach(x => {
    const arm = new THREE.Mesh(roundedBoxGeometry(0.12, 0.35, 0.6, 0.05, 2), cloth);
    arm.position.set(x, 0.42, 0); arm.castShadow = true; g.add(arm);
  });
  const cushion = new THREE.Mesh(
    roundedBoxGeometry(0.4, 0.09, 0.4, 0.08, 3),
    materialVariant(state.brandColor, { roughness: 0.8, jitter: 0.02 })
  );
  cushion.position.set(0, 0.42, 0.02); cushion.userData.brand = true; cushion.castShadow = true; g.add(cushion);
  const legMat = new THREE.MeshStandardMaterial({ color: 0x2A2826, roughness: 0.4, metalness: 0.35 });
  const legGeom = taperedLegGeometry(0.02, 0.028, 0.24, 8);
  [[-0.25,-0.25],[0.25,-0.25],[-0.25,0.25],[0.25,0.25]].forEach(([x,z]) => {
    const leg = new THREE.Mesh(legGeom, legMat);
    leg.position.set(x, 0.12, z); leg.castShadow = true; g.add(leg);
  });
  return g;
}

function makeBed() {
  const g = new THREE.Group();
  const frame = new THREE.Mesh(roundedBoxGeometry(1.6, 0.28, 2.0, 0.03, 2), materialVariant(0x8B6F47, { roughness: 0.55 }));
  frame.position.y = 0.14; frame.castShadow = true; frame.receiveShadow = true; g.add(frame);
  const mattress = new THREE.Mesh(roundedBoxGeometry(1.5, 0.22, 1.9, 0.07, 2), new THREE.MeshStandardMaterial({ color: 0xF5F1EA, roughness: 0.9 }));
  mattress.position.y = 0.39; mattress.castShadow = true; g.add(mattress);
  const duvet = new THREE.Mesh(roundedBoxGeometry(1.5, 0.1, 1.3, 0.06, 2), materialVariant(state.brandColor, { roughness: 0.85, jitter: 0.02 }));
  duvet.position.set(0, 0.53, 0.25); duvet.userData.brand = true; duvet.castShadow = true; g.add(duvet);
  [[-0.5,0],[0.5,0]].forEach(([x]) => {
    const pillow = new THREE.Mesh(roundedBoxGeometry(0.55, 0.14, 0.35, 0.06, 2), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }));
    pillow.position.set(x, 0.55, -0.72); pillow.castShadow = true; g.add(pillow);
  });
  const headboard = new THREE.Mesh(roundedBoxGeometry(1.62, 0.75, 0.08, 0.04, 2), new THREE.MeshStandardMaterial({ color: 0x2A2826, roughness: 0.65 }));
  headboard.position.set(0, 0.55, -1.0); headboard.castShadow = true; g.add(headboard);
  return g;
}

function makeCounter() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    roundedBoxGeometry(3.0, 0.95, 0.7, 0.025, 2),
    materialVariant(0xF5F1EA, { roughness: 0.7 })
  );
  body.position.y = 0.475; body.castShadow = true; body.receiveShadow = true; g.add(body);
  const strip = new THREE.Mesh(
    new THREE.BoxGeometry(3.0, 0.1, 0.02),
    new THREE.MeshStandardMaterial({ color: state.brandColor, roughness: 0.5 })
  );
  strip.position.set(0, 0.55, 0.36); strip.castShadow = true; strip.userData.brand = true; g.add(strip);
  const strip2 = new THREE.Mesh(
    new THREE.BoxGeometry(3.0, 0.03, 0.02),
    new THREE.MeshStandardMaterial({ color: state.brandColor, roughness: 0.5 })
  );
  strip2.position.set(0, 0.2, 0.36); strip2.userData.brand = true; g.add(strip2);
  const top = new THREE.Mesh(
    roundedBoxGeometry(3.05, 0.05, 0.75, 0.015, 2),
    new THREE.MeshStandardMaterial({ color: 0x2A2826, roughness: 0.25, metalness: 0.25 })
  );
  top.position.y = 0.97; top.castShadow = true; top.receiveShadow = true; g.add(top);
  const machine = new THREE.Mesh(
    roundedBoxGeometry(0.5, 0.45, 0.45, 0.03, 2),
    new THREE.MeshStandardMaterial({ color: 0xC4BAA8, roughness: 0.35, metalness: 0.55 })
  );
  machine.position.set(-0.9, 1.22, 0); machine.castShadow = true; g.add(machine);
  const groupHead = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.05, 0.1, 12),
    new THREE.MeshStandardMaterial({ color: 0x2A2826, roughness: 0.3, metalness: 0.65 })
  );
  groupHead.position.set(-0.9, 1.0, 0.22); g.add(groupHead);
  const display = new THREE.Mesh(
    roundedBoxGeometry(0.8, 0.55, 0.55, 0.02, 2),
    new THREE.MeshPhysicalMaterial({ color: 0xF5F1EA, roughness: 0.08, transparent: true, opacity: 0.35, metalness: 0.05, transmission: 0.4, clearcoat: 0.6 })
  );
  display.position.set(0.85, 1.25, 0); g.add(display);
  const displayTop = new THREE.Mesh(
    roundedBoxGeometry(0.82, 0.04, 0.57, 0.012, 2),
    new THREE.MeshStandardMaterial({ color: 0x2A2826, roughness: 0.3 })
  );
  displayTop.position.set(0.85, 1.54, 0); g.add(displayTop);
  return g;
}

function makeReceptionDesk() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(roundedBoxGeometry(2.2, 1.05, 0.6, 0.025, 2), materialVariant(0x2A2826, { roughness: 0.5 }));
  body.position.y = 0.525; body.castShadow = true; body.receiveShadow = true; g.add(body);
  const strip = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.12, 0.02), new THREE.MeshStandardMaterial({ color: state.brandColor }));
  strip.position.set(0, 0.65, 0.31); strip.userData.brand = true; g.add(strip);
  const top = new THREE.Mesh(roundedBoxGeometry(2.3, 0.05, 0.68, 0.02, 2), new THREE.MeshStandardMaterial({ color: 0xC4BAA8, roughness: 0.3 }));
  top.position.y = 1.08; top.castShadow = true; g.add(top);
  // Wordmark plinth
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.28, 0.05), new THREE.MeshStandardMaterial({ color: state.brandColor, roughness: 0.5 }));
  plinth.position.set(0, 1.4, -0.28); plinth.userData.brand = true; g.add(plinth);
  return g;
}

function makeGalleryPedestal() {
  const g = new THREE.Group();
  const col = new THREE.Mesh(roundedBoxGeometry(0.42, 0.9, 0.42, 0.01, 2), MATERIALS.plaster());
  col.position.y = 0.45; col.castShadow = true; col.receiveShadow = true; g.add(col);
  const art = new THREE.Mesh(new THREE.IcosahedronGeometry(0.2, 0), materialVariant(state.brandColor, { roughness: 0.35, metalness: 0.3 }));
  art.position.y = 1.08; art.userData.brand = true; art.castShadow = true; g.add(art);
  return g;
}

function makeShelf() {
  const g = new THREE.Group();
  const woodMat = MATERIALS.oak();
  [-0.45, 0.45].forEach(x => {
    const side = new THREE.Mesh(roundedBoxGeometry(0.04, 1.8, 0.35, 0.012, 2), woodMat);
    side.position.set(x, 0.9, 0); side.castShadow = true; g.add(side);
  });
  [0.05, 0.5, 0.95, 1.4].forEach(y => {
    const sh = new THREE.Mesh(roundedBoxGeometry(0.94, 0.03, 0.35, 0.01, 2), woodMat);
    sh.position.set(0, y, 0); sh.castShadow = true; sh.receiveShadow = true; g.add(sh);
  });
  const back = new THREE.Mesh(
    new THREE.BoxGeometry(0.9, 1.7, 0.01),
    MATERIALS.paintedWood(state.brandColor)
  );
  back.position.set(0, 0.9, -0.16); back.userData.brand = true; g.add(back);
  const colors = [0xC4BAA8, 0x8B6F47, state.brandColor, 0x4A6741];
  [0.27, 0.72, 1.17].forEach((y, idx) => {
    for (let i = 0; i < 3; i++) {
      const c = colors[(idx + i) % colors.length];
      const item = new THREE.Mesh(
        roundedBoxGeometry(0.16, 0.22, 0.16, 0.02, 2),
        materialVariant(c, { roughness: 0.6, jitter: 0.02 })
      );
      item.position.set(-0.3 + i * 0.3, y + 0.13, 0);
      item.castShadow = true;
      if ((idx + i) % 4 === 2) item.userData.brand = true;
      g.add(item);
    }
  });
  return g;
}

function makeBookshelfTall() {
  const g = new THREE.Group();
  const woodMat = MATERIALS.walnut();
  [-0.5, 0.5].forEach(x => {
    const side = new THREE.Mesh(roundedBoxGeometry(0.05, 2.4, 0.32, 0.014, 2), woodMat);
    side.position.set(x, 1.2, 0); side.castShadow = true; g.add(side);
  });
  const shelfYs = [0.05, 0.5, 0.95, 1.4, 1.85, 2.3];
  shelfYs.forEach(y => {
    const sh = new THREE.Mesh(roundedBoxGeometry(1.05, 0.03, 0.32, 0.01, 2), woodMat);
    sh.position.set(0, y, 0); sh.castShadow = true; g.add(sh);
  });
  const bookColors = [0x8B4A3F, 0x3F6B5C, 0x2A4A6B, 0xD49B3B, 0x5B4A8C, 0xC4BAA8];
  for (let row = 0; row < shelfYs.length - 1; row++) {
    for (let i = 0; i < 6; i++) {
      const h = 0.28 + Math.random() * 0.14;
      const book = new THREE.Mesh(new THREE.BoxGeometry(0.055, h, 0.24), materialVariant(bookColors[(row+i) % bookColors.length], { roughness: 0.7, jitter: 0.03 }));
      book.position.set(-0.42 + i * 0.16, shelfYs[row] + h/2 + 0.03, 0);
      book.rotation.z = (Math.random() - 0.5) * 0.05; // slight lean — a shelf of perfectly upright books reads as fake
      book.castShadow = true; g.add(book);
    }
  }
  return g;
}

function makeRack() {
  const g = new THREE.Group();
  const poleMat = MATERIALS.brushedMetal();
  [-0.45, 0.45].forEach(x => {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.6, 12), poleMat);
    pole.position.set(x, 0.8, 0); pole.castShadow = true; g.add(pole);
  });
  const topBar = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.0, 12), poleMat);
  topBar.rotation.z = Math.PI / 2; topBar.position.y = 1.55; g.add(topBar);
  const baseMat2 = MATERIALS.blackMetal();
  [-0.45, 0.45].forEach(x => {
    const f = new THREE.Mesh(roundedBoxGeometry(0.05, 0.04, 0.3, 0.015, 2), baseMat2);
    f.position.set(x, 0.02, 0); g.add(f);
  });
  for (let i = 0; i < 5; i++) {
    const h = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 0.4, 12), materialVariant(state.brandColor, { roughness: 0.7, jitter: 0.03 }));
    h.position.set(-0.32 + i * 0.16, 1.2, 0); h.userData.brand = true; g.add(h);
  }
  return g;
}

function makeDesk() {
  const g = new THREE.Group();
  const top = new THREE.Mesh(
    roundedBoxGeometry(1.4, 0.04, 0.7, 0.018, 2),
    MATERIALS.ceramic(0xC4BAA8)
  );
  top.position.y = 0.74; top.castShadow = true; top.receiveShadow = true; g.add(top);
  const legMat = MATERIALS.blackMetal();
  [-0.6, 0.6].forEach(x => {
    const leg = new THREE.Mesh(roundedBoxGeometry(0.04, 0.74, 0.5, 0.015, 2), legMat);
    leg.position.set(x, 0.37, 0); leg.castShadow = true; g.add(leg);
  });
  const accent = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.04, 0.05, 16),
    MATERIALS.paintedWood(state.brandColor)
  );
  accent.position.set(0.5, 0.76, 0); accent.userData.brand = true; g.add(accent);
  // Small laptop accessory for a lived-in look
  const laptop = new THREE.Mesh(roundedBoxGeometry(0.34, 0.02, 0.24, 0.01, 2), MATERIALS.brushedMetal());
  laptop.position.set(-0.2, 0.77, 0.05); laptop.castShadow = true; g.add(laptop);
  const screen = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.22, 0.015), new THREE.MeshStandardMaterial({ color: 0x1A1A1A, emissive: 0x223344, emissiveIntensity: 0.4 }));
  screen.position.set(-0.2, 0.88, -0.06); screen.rotation.x = -0.25; screen.castShadow = true; g.add(screen);
  return g;
}

function makePlant() {
  const g = new THREE.Group();
  const pot = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22, 0.18, 0.35, 20),
    MATERIALS.ceramic(0x8B6F47)
  );
  pot.position.y = 0.175; pot.castShadow = true; pot.receiveShadow = true; g.add(pot);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.012, 6, 20), MATERIALS.ceramic(0x8B6F47));
  rim.rotation.x = Math.PI / 2; rim.position.y = 0.35; g.add(rim);
  const leafMat = MATERIALS.foliage();
  for (let i = 0; i < 6; i++) {
    const r = 0.14 + Math.random() * 0.1;
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), leafMat);
    const angle = (i / 6) * Math.PI * 2 + Math.random() * 0.5;
    leaf.position.set(Math.cos(angle) * 0.08, 0.5 + Math.random() * 0.3, Math.sin(angle) * 0.08);
    leaf.scale.y = 1.3; leaf.castShadow = true; g.add(leaf);
  }
  const top = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), leafMat);
  top.position.y = 0.85; top.scale.y = 1.4; top.castShadow = true; g.add(top);
  return g;
}

function makePlanterBox() {
  const g = new THREE.Group();
  const box = new THREE.Mesh(roundedBoxGeometry(0.9, 0.4, 0.35, 0.02, 2), MATERIALS.blackMetal());
  box.position.y = 0.2; box.castShadow = true; box.receiveShadow = true; g.add(box);
  const leafMat = MATERIALS.foliage();
  for (let i = 0; i < 3; i++) {
    const s = new THREE.Mesh(new THREE.IcosahedronGeometry(0.2, 0), leafMat);
    s.position.set(-0.28 + i * 0.28, 0.5, 0); s.castShadow = true; g.add(s);
  }
  return g;
}

function makePendant() {
  const g = new THREE.Group();
  const cord = new THREE.Mesh(
    new THREE.CylinderGeometry(0.005, 0.005, 1.4, 6),
    MATERIALS.blackMetal()
  );
  cord.position.y = 2.7; g.add(cord);
  const shade = new THREE.Mesh(
    new THREE.ConeGeometry(0.2, 0.28, 18, 1, true),
    new THREE.MeshStandardMaterial({
      color: state.brandColor, roughness: 0.4, side: THREE.DoubleSide, metalness: 0.3
    })
  );
  shade.position.y = 2.0; shade.userData.brand = true; shade.castShadow = true; g.add(shade);
  const bulb = new THREE.Mesh(
    new THREE.SphereGeometry(0.05, 12, 12),
    new THREE.MeshStandardMaterial({ color: 0xfff5e0, emissive: 0xffd5a0, emissiveIntensity: 2 })
  );
  bulb.position.y = 1.95; g.add(bulb);
  // A real point light, not just an emissive sphere, so pendants actually
  // cast warm light onto the floor/furniture beneath them at night.
  const lamp = new THREE.PointLight(0xffcf9e, 0.55, 3.2, 2);
  lamp.position.y = 1.95; g.add(lamp);
  return g;
}

function makeSofa() {
  const g = new THREE.Group();
  const upholstery = materialVariant(0xC4BAA8, { roughness: 0.9, jitter: 0.02 });
  const base = new THREE.Mesh(roundedBoxGeometry(1.8, 0.4, 0.75, 0.1, 3), upholstery);
  base.position.y = 0.2; base.castShadow = true; base.receiveShadow = true; g.add(base);
  const back = new THREE.Mesh(roundedBoxGeometry(1.8, 0.55, 0.2, 0.1, 3), upholstery);
  back.position.set(0, 0.6, -0.28); back.castShadow = true; g.add(back);
  [-0.82, 0.82].forEach(x => {
    const arm = new THREE.Mesh(roundedBoxGeometry(0.15, 0.5, 0.75, 0.06, 2), upholstery);
    arm.position.set(x, 0.45, 0); arm.castShadow = true; g.add(arm);
  });
  const cushionMat = materialVariant(state.brandColor, { roughness: 0.8, jitter: 0.02 });
  [-0.45, 0.45].forEach(x => {
    const c = new THREE.Mesh(roundedBoxGeometry(0.75, 0.13, 0.6, 0.08, 3), cushionMat);
    c.position.set(x, 0.46, 0.05); c.castShadow = true; c.userData.brand = true; g.add(c);
  });
  const legMat = new THREE.MeshStandardMaterial({ color: 0x2A2826, roughness: 0.4, metalness: 0.35 });
  const legGeom = taperedLegGeometry(0.017, 0.024, 0.1, 8);
  [[-0.85, -0.32], [0.85, -0.32], [-0.85, 0.32], [0.85, 0.32]].forEach(([x,z]) => {
    const leg = new THREE.Mesh(legGeom, legMat);
    leg.position.set(x, 0.05, z); leg.castShadow = true; g.add(leg);
  });
  return g;
}

function makeRug() {
  const g = new THREE.Group();
  const rug = new THREE.Mesh(new THREE.CircleGeometry(0.9, 32), MATERIALS.fabric(state.brandColor));
  rug.rotation.x = -Math.PI/2; rug.position.y = 0.006; rug.receiveShadow = true; rug.userData.brand = true; g.add(rug);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.78, 0.86, 32), MATERIALS.fabric(0xF5F1EA));
  ring.material.side = THREE.DoubleSide;
  ring.rotation.x = -Math.PI/2; ring.position.y = 0.007; g.add(ring);
  return g;
}

function makePainting() {
  const g = new THREE.Group();
  const frame = new THREE.Mesh(roundedBoxGeometry(0.7, 0.9, 0.04, 0.01, 2), MATERIALS.blackMetal());
  frame.position.y = 1.6; frame.castShadow = true; g.add(frame);
  const canvasMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.58, 0.78), MATERIALS.fabric(state.brandColor));
  canvasMesh.material.roughness = 0.9;
  canvasMesh.position.set(0, 1.6, 0.023); canvasMesh.userData.brand = true; g.add(canvasMesh);
  const stripe = new THREE.Mesh(new THREE.PlaneGeometry(0.58, 0.2), MATERIALS.plaster());
  stripe.position.set(0, 1.75, 0.024); g.add(stripe);
  return g;
}

function makeColumn() {
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 3.0, 20), MATERIALS.plaster());
  shaft.position.y = 1.5; shaft.castShadow = true; shaft.receiveShadow = true; g.add(shaft);
  // Subtle fluting reads far better up close than a bare smooth cylinder.
  for (let i = 0; i < 12; i++) {
    const angle = (i / 12) * Math.PI * 2;
    const flute = new THREE.Mesh(new THREE.BoxGeometry(0.012, 2.7, 0.012), new THREE.MeshStandardMaterial({ color: 0xD8D0BE, roughness: 0.85 }));
    flute.position.set(Math.cos(angle) * 0.215, 1.5, Math.sin(angle) * 0.215);
    g.add(flute);
  }
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.32, 0.12, 20), MATERIALS.blackMetal());
  base.position.y = 0.06; g.add(base);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.26, 0.12, 20), MATERIALS.blackMetal());
  cap.position.y = 2.96; g.add(cap);
  return g;
}

function makePartition() {
  const g = new THREE.Group();
  const panel = new THREE.Mesh(roundedBoxGeometry(1.2, 1.5, 0.05, 0.015, 2), MATERIALS.glass());
  panel.position.y = 0.75; panel.castShadow = true; g.add(panel);
  const frame = new THREE.Mesh(roundedBoxGeometry(1.22, 0.05, 0.07, 0.015, 2), MATERIALS.paintedWood(state.brandColor));
  frame.position.y = 1.5; frame.userData.brand = true; g.add(frame);
  const legMat = MATERIALS.blackMetal();
  [-0.55, 0.55].forEach(x => {
    const leg = new THREE.Mesh(roundedBoxGeometry(0.06, 0.1, 0.3, 0.015, 2), legMat);
    leg.position.set(x, 0.05, 0); g.add(leg);
  });
  return g;
}

function makeOutdoorBench() { return makeOutdoorBenchMesh(); }

function makeOutdoorUmbrellaTable() {
  const g = new THREE.Group();
  const table = makeRoundTable();
  table.scale.setScalar(0.75);
  g.add(table);
  const pole = new THREE.Mesh(taperedLegGeometry(0.03, 0.035, 2.0, 12), MATERIALS.blackMetal());
  pole.position.y = 1.55; g.add(pole);
  const canopyMesh = new THREE.Mesh(new THREE.ConeGeometry(0.85, 0.45, 12), new THREE.MeshStandardMaterial({ color: state.brandColor, roughness: 0.6, side: THREE.DoubleSide }));
  canopyMesh.position.y = 2.35; canopyMesh.userData.brand = true; canopyMesh.castShadow = true; g.add(canopyMesh);
  return g;
}

// ========== CATALOG ==========
const ITEM_CATALOG = {
  round_table:  { name: 'Round Table',      icon: 'fa-circle',              price: 480,  seats: 0, factory: makeRoundTable, cat: 'surfaces' },
  oval_table:   { name: 'Oval Table',       icon: 'fa-ellipsis',            price: 720,  seats: 0, factory: makeOvalTable,  cat: 'surfaces' },
  rect_table:   { name: 'Rectangle Table',  icon: 'fa-table-cells',         price: 620,  seats: 0, factory: makeRectTable,  cat: 'surfaces' },
  desk:         { name: 'Work Desk',        icon: 'fa-table-list',          price: 380,  seats: 1, factory: makeDesk,       cat: 'surfaces' },
  counter:      { name: 'Service Counter',  icon: 'fa-mug-saucer',          price: 3800, seats: 0, factory: makeCounter,    cat: 'surfaces' },
  reception:    { name: 'Reception Desk',   icon: 'fa-bell-concierge',      price: 2400, seats: 0, factory: makeReceptionDesk, cat: 'surfaces' },

  chair:        { name: 'Dining Chair',     icon: 'fa-chair',               price: 95,   seats: 1, factory: () => makeChair(false), cat: 'comfort' },
  accent_chair: { name: 'Accent Chair',     icon: 'fa-chair',               price: 145,  seats: 1, factory: () => makeChair(true),  cat: 'comfort' },
  stool:        { name: 'Bar Stool',        icon: 'fa-circle-half-stroke',  price: 110,  seats: 1, factory: makeStool,      cat: 'comfort' },
  armchair:     { name: 'Armchair',         icon: 'fa-couch',               price: 620,  seats: 1, factory: makeArmchair,   cat: 'comfort' },
  sofa:         { name: 'Lounge Sofa',      icon: 'fa-couch',               price: 1450, seats: 3, factory: makeSofa,       cat: 'comfort' },
  bed:          { name: 'Bed',              icon: 'fa-bed',                 price: 980,  seats: 0, factory: makeBed,        cat: 'comfort' },

  shelf:        { name: 'Display Shelf',    icon: 'fa-box-archive',         price: 680,  seats: 0, factory: makeShelf,      cat: 'storage' },
  bookshelf:    { name: 'Tall Bookshelf',   icon: 'fa-book',                price: 940,  seats: 0, factory: makeBookshelfTall, cat: 'storage' },
  rack:         { name: 'Clothing Rack',    icon: 'fa-shirt',               price: 420,  seats: 0, factory: makeRack,       cat: 'storage' },
  pedestal:     { name: 'Gallery Pedestal', icon: 'fa-cube',                price: 340,  seats: 0, factory: makeGalleryPedestal, cat: 'storage' },

  plant:        { name: 'Planter',          icon: 'fa-seedling',            price: 85,   seats: 0, factory: makePlant,      cat: 'decor' },
  pendant:      { name: 'Pendant Light',    icon: 'fa-lightbulb',           price: 165,  seats: 0, factory: makePendant,    cat: 'decor' },
  rug:          { name: 'Area Rug',         icon: 'fa-square',              price: 220,  seats: 0, factory: makeRug,        cat: 'decor' },
  painting:     { name: 'Wall Art',         icon: 'fa-image',               price: 260,  seats: 0, factory: makePainting,   cat: 'decor' },
  column:       { name: 'Column',           icon: 'fa-monument',            price: 0,    seats: 0, factory: makeColumn,     cat: 'decor' },
  partition:    { name: 'Glass Partition',  icon: 'fa-table-cells-large',   price: 540,  seats: 0, factory: makePartition,  cat: 'decor' },

  out_bench:    { name: 'Outdoor Bench',    icon: 'fa-chair',               price: 380,  seats: 2, factory: makeOutdoorBench, cat: 'outdoor' },
  out_table:    { name: 'Umbrella Table',   icon: 'fa-umbrella',            price: 890,  seats: 0, factory: makeOutdoorUmbrellaTable, cat: 'outdoor' },
  out_planter:  { name: 'Planter Box',      icon: 'fa-leaf',                price: 160,  seats: 0, factory: makePlanterBox, cat: 'outdoor' },
};

const FURNITURE_CATEGORIES = [
  { key: 'all', label: 'All' },
  { key: 'comfort', label: 'Seating' },
  { key: 'surfaces', label: 'Surfaces' },
  { key: 'storage', label: 'Storage' },
  { key: 'decor', label: 'Decor' },
  { key: 'outdoor', label: 'Outdoor' },
];

function renderFurnitureTabs() {
  const wrap = document.getElementById('furnitureCategoryTabs');
  wrap.innerHTML = '';
  FURNITURE_CATEGORIES.forEach(c => {
    const chip = document.createElement('div');
    chip.className = 'chip' + (state.furnitureFilter === c.key ? ' active' : '');
    chip.textContent = c.label;
    chip.addEventListener('click', () => { state.furnitureFilter = c.key; renderFurnitureTabs(); renderItemLibrary(); });
    wrap.appendChild(chip);
  });
}

function renderItemLibrary() {
  const itemLibrary = document.getElementById('itemLibrary');
  itemLibrary.innerHTML = '';

  const buildCard = (key, item) => {
    const card = document.createElement('div');
    card.className = 'item-card' + (state.selectedItem === key ? ' active' : '');
    card.dataset.item = key;
    card.innerHTML = `
      <div class="item-icon"><i class="fa-solid ${item.icon} text-[13px]"></i></div>
      <div class="flex-1 min-w-0">
        <div class="text-[11.5px] font-semibold truncate">${item.name}</div>
        <div class="text-[10px] font-mono mt-0.5" style="color: var(--charcoal-3);">
          ${item.price ? '$' + item.price : 'included'}${item.seats ? ' · ' + item.seats + ' seat' : ''}
        </div>
      </div>
    `;
    card.addEventListener('click', () => selectItem(key));
    return card;
  };

  if (state.furnitureFilter !== 'all') {
    // A specific category chip is active — keep the simple flat grid,
    // exactly as before.
    itemLibrary.classList.add('flat-grid');
    Object.entries(ITEM_CATALOG).forEach(([key, item]) => {
      if (item.cat !== state.furnitureFilter) return;
      itemLibrary.appendChild(buildCard(key, item));
    });
    return;
  }
  itemLibrary.classList.remove('flat-grid');

  // "All" — group into collapsible sections, one per real category, so
  // browsing the full catalog reads as a structured asset tree rather than
  // one long undifferentiated grid. Collapse state persists for the
  // session in state.collapsedCatalogSections (a plain Set, not saved to
  // localStorage — purely a browsing convenience, not project data).
  if (!state.collapsedCatalogSections) state.collapsedCatalogSections = new Set();
  FURNITURE_CATEGORIES.filter(c => c.key !== 'all').forEach(cat => {
    const entries = Object.entries(ITEM_CATALOG).filter(([, item]) => item.cat === cat.key);
    if (!entries.length) return;
    const collapsed = state.collapsedCatalogSections.has(cat.key);
    const section = document.createElement('div');
    section.className = 'catalog-section' + (collapsed ? ' collapsed' : '');
    const head = document.createElement('div');
    head.className = 'catalog-section-head';
    head.innerHTML = `<span>${cat.label}<span class="count">${entries.length}</span></span><i class="fa-solid fa-chevron-down" aria-hidden="true"></i>`;
    head.addEventListener('click', () => {
      if (state.collapsedCatalogSections.has(cat.key)) state.collapsedCatalogSections.delete(cat.key);
      else state.collapsedCatalogSections.add(cat.key);
      renderItemLibrary();
    });
    const grid = document.createElement('div');
    grid.className = 'catalog-section-grid';
    entries.forEach(([key, item]) => grid.appendChild(buildCard(key, item)));
    section.appendChild(head);
    section.appendChild(grid);
    itemLibrary.appendChild(section);
  });
}
renderFurnitureTabs();
renderItemLibrary();

function disposeGhostItem() {
  if (!ghostItem) return;
  scene.remove(ghostItem);
  ghostItem.traverse(c => {
    if (c.geometry) c.geometry.dispose();
    if (c.material) {
      // Ghost materials are always clones made for the transparent preview (see mousemove
      // handler below), so disposing them here is always safe and never affects a shared original.
      if (Array.isArray(c.material)) c.material.forEach(m => m.dispose());
      else c.material.dispose();
    }
  });
  ghostItem = null;
}

function selectItem(key) {
  deselectActiveItem();
  if (state.selectedItem === key) {
    state.selectedItem = null;
    container.classList.remove('placing');
    disposeGhostItem();
    renderItemLibrary();
    return;
  }
  state.selectedItem = key;
  container.classList.add('placing');
  disposeGhostItem();
  renderItemLibrary();
  showToast(`${ITEM_CATALOG[key].name} selected — click floor to place`, 'fa-hand-pointer');
}

// ========== PLACEMENT ==========
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let ghostItem = null;
let suppressHistory = false; // used while undo/redo replay placements

function getMouseIntersection(e) {
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  return raycaster.intersectObject(floor)[0];
}

function getPlacedIntersection(e) {
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  const meshes = state.placedItems.map(i => i.mesh);
  const hits = raycaster.intersectObjects(meshes, true);
  if (!hits.length) return null;
  let obj = hits[0].object;
  while (obj.parent && !state.placedItems.find(i => i.mesh === obj)) obj = obj.parent;
  return state.placedItems.find(i => i.mesh === obj) || null;
}

function setCityRayFromEvent(e) {
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
}

function getCityEntityIntersection(e) {
  setCityRayFromEvent(e);
  const hits = raycaster.intersectObjects(cityPickables, true);
  if (!hits.length) return null;
  let node = hits[0].object;
  while (node && !node.userData.cityEntity) node = node.parent;
  return node?.userData.cityEntity || null;
}

function getBuildPlotIntersection(e) {
  setCityRayFromEvent(e);
  const hits = raycaster.intersectObjects(cityBuildPlots.filter(plot => !plot.occupied).map(plot => plot.mesh), false);
  if (!hits.length) return null;
  return cityBuildPlots.find(plot => plot.mesh === hits[0].object) || null;
}

let ghostRadius = 0.4;
let ghostSelf = null;   // true footprint of the placement preview (type, dims, rotation)
let ghostInvalid = false;
container.addEventListener('mousemove', (e) => {
  if (!state.selectedItem) return;
  const hit = getMouseIntersection(e);
  if (!hit) return;
  if (!ghostItem) {
    ghostItem = ITEM_CATALOG[state.selectedItem].factory();
    ghostItem.traverse(c => {
      if (c.isMesh) {
        c.material = c.material.clone();
        c.material.transparent = true;
        c.material.opacity = 0.45;
        c.castShadow = false;
      }
    });
    scene.add(ghostItem);
    ghostRadius = getFootprintRadius(ghostItem);
    ghostSelf = { type: state.selectedItem, dims: getFootprintDims(ghostItem), rotation: 0 };
  }
  const clamped = clampToRoom(hit.point.x, hit.point.z, ghostRadius, ghostSelf);
  const colliding = !!findCollidingItem(clamped.x, clamped.z, ghostRadius, null, ghostSelf);
  ghostInvalid = colliding;
  ghostItem.position.set(clamped.x, 0, clamped.z);
  setGhostValidity(!colliding);
});

// Tints the drag-preview furniture red/green so users can see, before
// clicking, whether a spot is actually placeable.
function setGhostValidity(valid) {
  if (!ghostItem) return;
  ghostItem.traverse(c => {
    if (!c.isMesh || !c.material || !c.material.color) return;
    if (!c.userData.__baseColor) c.userData.__baseColor = c.material.color.getHex();
    c.material.color.setHex(valid ? c.userData.__baseColor : 0xB1443A);
  });
}

// ========== FLOOR PLAN ANNOTATIONS ==========
// `.fp-label` already existed in the stylesheet but nothing ever populated
// it — Floor Plan mode was just the same 3D scene from a top-down camera,
// with zero of the dimension/room-label annotations a real floor plan
// needs. Reuses the exact screen-space projection technique already
// proven out by the measurement label below, and reads dimensions from the
// same ROOM_W/ROOM_D/projectName sources everything else already uses —
// no parallel state, no new source of truth.
const floorplanOverlayEl = document.getElementById('floorplanOverlay');
function makeFpLabel(text) {
  const el = document.createElement('div');
  el.className = 'fp-label';
  el.textContent = text;
  floorplanOverlayEl.appendChild(el);
  return el;
}
const fpWidthLabel = makeFpLabel('');
const fpDepthLabel = makeFpLabel('');
const fpRoomNameLabel = makeFpLabel('');
fpRoomNameLabel.classList.add('fp-label--room');
const _fpScratchWorld = new THREE.Vector3();
const _fpScratchProj = new THREE.Vector3();
function projectToScreen(x, y, z) {
  _fpScratchWorld.set(x, y, z);
  _fpScratchProj.copy(_fpScratchWorld).project(camera);
  const rect = renderer.domElement.getBoundingClientRect();
  return {
    x: (_fpScratchProj.x * 0.5 + 0.5) * rect.width,
    y: (-_fpScratchProj.y * 0.5 + 0.5) * rect.height,
    behind: _fpScratchProj.z >= 1,
  };
}
function updateFloorPlanLabels() {
  if (state.view !== 'top') return;
  fpWidthLabel.textContent = ROOM_W.toFixed(1) + ' m';
  fpDepthLabel.textContent = ROOM_D.toFixed(1) + ' m';
  const roomName = (document.getElementById('projectName')?.textContent.trim() || '').toUpperCase();
  fpRoomNameLabel.textContent = roomName;
  fpRoomNameLabel.style.visibility = roomName ? 'visible' : 'hidden'; // missing metadata → skip, don't show an empty chip
  const w = projectToScreen(0, 0.02, ROOM_D / 2 + 0.6);
  const d = projectToScreen(-ROOM_W / 2 - 0.6, 0.02, 0);
  const c = projectToScreen(0, 0.02, -ROOM_D / 2 + 0.7);
  [[fpWidthLabel, w], [fpDepthLabel, d], [fpRoomNameLabel, c]].forEach(([el, p]) => {
    el.style.display = p.behind ? 'none' : 'block';
    el.style.left = p.x + 'px';
    el.style.top = p.y + 'px';
    el.style.transform = 'translate(-50%, -50%)';
  });
}

// ========== MEASUREMENT TOOL ==========
// Lives in js/measure.js (multiple persistent measurements, snapping, live
// preview). Created by initWorkspace(); reachable as ws.ctx.measure.

// A click that follows an orbit/pan drag is not a click on the scene. Without
// this, releasing the mouse after orbiting placed items / selected / measured.
let _downPos = null;
container.addEventListener('pointerdown', (e) => { _downPos = { x: e.clientX, y: e.clientY }; }, true);
const wasDrag = (e) => !!_downPos && Math.hypot(e.clientX - _downPos.x, e.clientY - _downPos.y) > 6;

container.addEventListener('click', (e) => {
  if (e.target.closest('.hud, .city-ops, .city-stat-ribbon, .city-district-strip')) return;
  const canvasRect = renderer.domElement.getBoundingClientRect();
  const isWithinCanvas = e.clientX >= canvasRect.left && e.clientX <= canvasRect.right && e.clientY >= canvasRect.top && e.clientY <= canvasRect.bottom;
  if (!isWithinCanvas) return;
  if (wasDrag(e)) return;
  if (ws.ctx?.measure.active) { ws.ctx.measure.click(e); return; }
  if (ws.mode === 'present') return; // presentation: the scene is for looking at
  if (state.cityBuildMode) {
    const plot = getBuildPlotIntersection(e);
    if (plot) constructCityBuilding(plot);
    else showToast('Choose a copper build plot to commission a building', 'fa-compass-drafting');
    return;
  }
  if (state.cityScale !== 'interior' && !state.selectedItem) {
    const entity = getCityEntityIntersection(e);
    if (entity) selectCityEntity(entity);
    else deselectCityEntity();
    return;
  }
  if (state.selectedItem) {
    const hit = getMouseIntersection(e);
    if (hit) {
      if (ghostInvalid) {
        showToast('That spot overlaps something — pick a clear space', 'fa-ban');
        return;
      }
      placeItem(state.selectedItem, hit.point);
    }
    return;
  }
  // No tool armed: try selecting an existing placed item
  const found = getPlacedIntersection(e);
  if (found) setActiveItem(found);
  else deselectActiveItem();
});

// Footprint radius approximates each item's floor-plan extent as a circle
// (max half-width/half-depth of its bounding box). This is a deliberate
// broad-phase simplification rather than full oriented-box collision — it's
// cheap, rotation-invariant, and accurate enough at furniture scale — but it
// means two long, thin items placed end-to-end will show a slightly larger
// gap than strictly necessary. Good tradeoff for interactive placement.
function getFootprintRadius(mesh) {
  const box = new THREE.Box3().setFromObject(mesh);
  const size = box.getSize(new THREE.Vector3());
  return Math.max(0.28, Math.max(size.x, size.z) / 2);
}
// Real footprint of a freshly built (unrotated, unscaled) mesh in its local
// frame: width (x), depth (z), height (y) and the footprint centre offset.
// Stored on every placed item so the inspector, the clearance analysis and
// the report all read the same true dimensions instead of a circle radius.
function getFootprintDims(mesh) {
  const box = new THREE.Box3().setFromObject(mesh);
  const size = box.getSize(new THREE.Vector3());
  const ctr = box.getCenter(new THREE.Vector3());
  return { w: size.x, d: size.z, h: size.y, cx: ctr.x, cz: ctr.z };
}
function clampToRoom(x, z, radius, self) {
  // With a true footprint (self = {type, dims, rotation}) the item may sit
  // right against a wall: its real extents are kept inside the room, instead of
  // a circle margin that pushed long items (a 3 m counter) ~1.5 m off the wall.
  if (self && self.dims) {
    const fp = footprintOf({ type: self.type, dims: self.dims, rotation: self.rotation || 0, position: { x: 0, z: 0 } });
    const pts = fp.kind === 'circle' ? [{ x: fp.cx - fp.r, z: fp.cz - fp.r }, { x: fp.cx + fp.r, z: fp.cz + fp.r }] : fp.pts;
    const xs = pts.map(p => p.x), zs = pts.map(p => p.z);
    return {
      x: Math.max(-ROOM_W / 2 - Math.min(...xs), Math.min(ROOM_W / 2 - Math.max(...xs), x)),
      z: Math.max(-ROOM_D / 2 - Math.min(...zs), Math.min(ROOM_D / 2 - Math.max(...zs), z)),
    };
  }
  const m = Math.max(0.3, radius);
  return {
    x: Math.max(-ROOM_W / 2 + m, Math.min(ROOM_W / 2 - m, x)),
    z: Math.max(-ROOM_D / 2 + m, Math.min(ROOM_D / 2 - m, z)),
  };
}
// Placement/move collision uses the SAME footprint test as the compliance
// analysis (spatial-analysis.js): a candidate collides when its footprint is
// closer than COLLISION_BUFFER (0.08 m) to another floor object's real
// footprint. `self` ({type, dims, rotation}) gives the candidate its own true
// footprint; without it the candidate is treated as a circle of `radius`.
// Ceiling pendants, rugs and wall art never block placement (they are not
// floor obstacles) — previously a table could not be placed on a rug.
function findCollidingItem(x, z, radius, excludeId, self) {
  if (self && NON_FLOOR_TYPES.has(self.type)) return null;
  const cand = self && self.dims
    ? footprintOf({ type: self.type, dims: self.dims, rotation: self.rotation || 0, position: { x, z } })
    : { kind: 'circle', cx: x, cz: z, r: radius };
  for (const p of state.placedItems) {
    if (excludeId != null && p.id === excludeId) continue;
    if (NON_FLOOR_TYPES.has(p.type)) continue;
    const fp = footprintOf(p);
    if (Math.hypot(fp.cx - cand.cx, fp.cz - cand.cz) > fp.r + cand.r + COLLISION_BUFFER) continue; // cheap reject
    if (footprintClearance(cand, fp).clearance < COLLISION_BUFFER) return p;
  }
  return null;
}
// Spiral outward from the requested point looking for a clash-free, in-room
// spot. Returns null if nothing opens up nearby (room too full there).
function findNearestValidSpot(x, z, radius, excludeId, maxRadius = 2.4, self) {
  const c0 = clampToRoom(x, z, radius, self);
  if (!findCollidingItem(c0.x, c0.z, radius, excludeId, self)) return c0;
  const steps = 14;
  for (let r = 0.3; r <= maxRadius; r += 0.3) {
    for (let i = 0; i < steps; i++) {
      const angle = (i / steps) * Math.PI * 2;
      const c = clampToRoom(x + Math.cos(angle) * r, z + Math.sin(angle) * r, radius, self);
      if (!findCollidingItem(c.x, c.z, radius, excludeId, self)) return c;
    }
  }
  return null;
}

// ========== DRAG-TO-MOVE (existing placed items) ==========
// Engaged via the floating context toolbar's Move button. One press arms a
// single drag: mousedown-move-mouseup repositions the selected item, with
// the same boundary + collision rules as fresh placement, then disarms.
let moveArmed = false;
let movingItem = null;
let isDraggingItem = false;
let moveValid = true;

function armMoveSelected() {
  if (!state.activeItem) return;
  moveArmed = true;
  movingItem = state.activeItem;
  container.classList.add('move-armed');
  showToast('Drag the selected item to a new spot', 'fa-arrows-up-down-left-right');
}
function disarmMove() {
  moveArmed = false;
  isDraggingItem = false;
  movingItem = null;
  container.classList.remove('move-armed');
  // Only restore camera control if nothing else (a focus/view-transition
  // flight) currently owns it — otherwise this could steal control back
  // mid-animation if a drag is cancelled while a camera flight is playing.
  if (!cameraTransitionActive) controls.enabled = true;
}

container.addEventListener('mousedown', (e) => {
  if (!moveArmed || !movingItem) return;
  const hit = getMouseIntersection(e);
  if (!hit) return;
  isDraggingItem = true;
  // Without this, OrbitControls (attached to the canvas, a child of
  // `container`) receives the same mousedown/mousemove and orbits the
  // camera at the same time the item is being dragged — the two
  // interactions fight each other. Disabled only for the actual drag, not
  // the whole "armed" state, so the user can still orbit to a better angle
  // before committing to the drag.
  controls.enabled = false;
});
container.addEventListener('mousemove', (e) => {
  if (!isDraggingItem || !movingItem) return;
  const hit = getMouseIntersection(e);
  if (!hit) return;
  const radius = movingItem.footprintRadius || 0.4;
  const clamped = clampToRoom(hit.point.x, hit.point.z, radius, movingItem);
  moveValid = !findCollidingItem(clamped.x, clamped.z, radius, movingItem.id, movingItem);
  movingItem.mesh.position.set(clamped.x, 0, clamped.z);
  if (selectionRing) {
    selectionRing.position.set(clamped.x, 0.015, clamped.z);
    selectionRing.material.color.set(moveValid ? state.brandColor : 0xB1443A);
  }
});
window.addEventListener('mouseup', () => {
  if (!isDraggingItem || !movingItem) return;
  isDraggingItem = false;
  if (!cameraTransitionActive) controls.enabled = true;
  const item = movingItem;
  const radius = item.footprintRadius || 0.4;
  const from = { x: item.position.x, z: item.position.z };
  const wantPos = { x: item.mesh.position.x, z: item.mesh.position.z };
  const spot = moveValid ? wantPos : (findNearestValidSpot(wantPos.x, wantPos.z, radius, item.id, 2.4, item) || from);
  item.mesh.position.set(spot.x, 0, spot.z);
  item.position.x = spot.x; item.position.z = spot.z;
  if (selectionRing) {
    selectionRing.position.set(spot.x, 0.015, spot.z);
    selectionRing.material.color.set(state.brandColor);
  }
  if (Math.abs(from.x - spot.x) > 0.001 || Math.abs(from.z - spot.z) > 0.001) {
    pushHistory({ action: 'move', id: item.id, from, to: spot });
  } else if (!moveValid) {
    showToast('No clear space there — item stayed put', 'fa-ban');
  }
  disarmMove();
  updateStats();
  bus.emit('itemchange', { item });
});

// Numeric edits from the inspector go through the same rules as dragging:
// clamp to the room, refuse to land on top of another object, and record a
// normal 'move' history entry so Ctrl+Z works.
function setItemPositionChecked(item, x, z) {
  const radius = item.footprintRadius || 0.4;
  const c = clampToRoom(x, z, radius, item);
  const hit = findCollidingItem(c.x, c.z, radius, item.id, item);
  if (hit) return { ok: false, reason: `Overlaps ${hit.name}`, clamped: c };
  const from = { x: item.position.x, z: item.position.z };
  if (Math.abs(from.x - c.x) < 0.0005 && Math.abs(from.z - c.z) < 0.0005) return { ok: true, unchanged: true, x: c.x, z: c.z };
  applyItemPosition(item.id, c);
  pushHistory({ action: 'move', id: item.id, from, to: { x: c.x, z: c.z } });
  return { ok: true, x: c.x, z: c.z, adjusted: Math.abs(c.x - x) > 0.0005 || Math.abs(c.z - z) > 0.0005 };
}
function setItemRotationRad(item, rad) {
  const from = item.rotation;
  if (Math.abs(from - rad) < 1e-4) return;
  applyItemRotation(item.id, rad);
  pushHistory({ action: 'rotate', id: item.id, from, to: rad });
}

function duplicateActiveItem() {
  if (!state.activeItem) { showToast('Select an item to duplicate', 'fa-clone'); return null; }
  const src = state.activeItem;
  const item = placeItem(src.type, new THREE.Vector3(src.position.x + 0.7, 0, src.position.z + 0.7), src.rotation);
  if (item) { setActiveItem(item); showToast(`${item.name} duplicated`, 'fa-clone'); }
  return item;
}

// Shared by every camera-flight animation (focusOnPoint, transitionToView)
// so other systems — like disarmMove() below — never re-enable controls in
// the middle of an animated camera move and steal it back from the flight.
let cameraTransitionActive = false;
function focusOnPoint(point, distance = 4.5) {
  const dir = camera.position.clone().sub(controls.target);
  if (dir.lengthSq() < 0.0001) dir.set(6, 5, 6);
  dir.normalize().multiplyScalar(distance);
  const targetPos = point.clone().add(dir);
  const startPos = camera.position.clone();
  const startTarget = controls.target.clone();
  const duration = 650;
  const startTime = performance.now();
  controls.enabled = false;
  cameraTransitionActive = true;
  (function animate() {
    const t = Math.min(1, (performance.now() - startTime) / duration);
    const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    camera.position.lerpVectors(startPos, targetPos, eased);
    controls.target.lerpVectors(startTarget, point, eased);
    controls.update();
    if (t < 1) requestAnimationFrame(animate);
    else { controls.enabled = true; cameraTransitionActive = false; }
  })();
}
function focusSelected() {
  if (!state.activeItem) { showToast('Select an item to focus on', 'fa-crosshairs'); return; }
  if (state.cityScale !== 'interior') setCityScale('interior');
  focusOnPoint(new THREE.Vector3(state.activeItem.position.x, 0.6, state.activeItem.position.z), 4.5);
}

function placeItem(type, position, rotY = 0, opts = {}) {
  const item = ITEM_CATALOG[type];
  const mesh = item.factory();
  let x, z;
  // Radius/dims come from the real mesh on every path. The legacy
  // skipBoundaryCheck path (templates, restored sessions, undo) used to pin
  // the radius at 0.4 m for every item regardless of size, which made large
  // pieces "small" to the collision system and small ones "large".
  const radius = getFootprintRadius(mesh);
  const dims = getFootprintDims(mesh);
  if (opts.skipBoundaryCheck) {
    // Legacy path used by curated template layouts and undo/redo history
    // restoration — unchanged from the original flat-margin behavior so
    // existing templates render exactly as before.
    const margin = 0.5;
    x = Math.max(-ROOM_W/2 + margin, Math.min(ROOM_W/2 - margin, position.x));
    z = Math.max(-ROOM_D/2 + margin, Math.min(ROOM_D/2 - margin, position.z));
  } else {
    const spot = findNearestValidSpot(position.x, position.z, radius, null, 2.4, { type, dims, rotation: rotY });
    if (!spot) {
      showToast('No clear space there — try another spot', 'fa-ban');
      return null;
    }
    x = spot.x; z = spot.z;
  }
  mesh.position.set(x, 0, z);
  mesh.rotation.y = rotY;
  
  if (!opts.skipAnim) {
    mesh.scale.set(0.01, 0.01, 0.01);
    const targetScale = 1;
    const startTime = performance.now();
    (function animateIn() {
      const t = Math.min(1, (performance.now() - startTime) / 300);
      const eased = 1 - Math.pow(1 - t, 3);
      mesh.scale.setScalar(0.01 + (targetScale - 0.01) * eased);
      if (t < 1) requestAnimationFrame(animateIn);
    })();
  }
  
  const placed = {
    id: opts.id || (Date.now() + Math.random()),
    type, position: { x, z }, rotation: rotY, mesh,
    name: item.name, price: item.price, seats: item.seats,
    footprintRadius: radius, dims,
  };
  state.placedItems.push(placed);
  scene.add(mesh);
  updateStats();

  if (!suppressHistory) pushHistory({ action: 'add', item: snapshotItem(placed) });
  return placed;
}

function placeItemAt(type, x, z, rotY = 0) {
  return placeItem(type, new THREE.Vector3(x, 0, z), rotY, { skipAnim: true, skipBoundaryCheck: true });
}

function snapshotItem(placed) {
  return { id: placed.id, type: placed.type, x: placed.position.x, z: placed.position.z, rotation: placed.rotation };
}

function removePlacedItem(placed, opts = {}) {
  const idx = state.placedItems.findIndex(i => i.id === placed.id);
  if (idx === -1) return;
  scene.remove(placed.mesh);
  placed.mesh.traverse(c => {
    if (c.geometry) c.geometry.dispose();
    if (c.material) {
      // Materials may carry a texture map (e.g. signage); dispose it too to avoid leaking GPU textures.
      if (Array.isArray(c.material)) {
        c.material.forEach(m => { if (m.map) m.map.dispose(); m.dispose(); });
      } else {
        if (c.material.map) c.material.map.dispose();
        c.material.dispose();
      }
    }
  });
  state.placedItems.splice(idx, 1);
  if (state.activeItem && state.activeItem.id === placed.id) deselectActiveItem();
  updateStats();
  if (!suppressHistory && !opts.skipHistory) pushHistory({ action: 'remove', item: snapshotItem(placed) });
}

function clearAll(opts = {}) {
  if (state.placedItems.length && !opts.skipHistory) {
    pushHistory({ action: 'bulkRemove', items: state.placedItems.map(snapshotItem) });
  }
  state.placedItems.forEach(i => {
    scene.remove(i.mesh);
    i.mesh.traverse(c => {
      if (c.geometry) c.geometry.dispose();
      if (c.material) {
        if (Array.isArray(c.material)) {
          c.material.forEach(m => { if (m.map) m.map.dispose(); m.dispose(); });
        } else {
          if (c.material.map) c.material.map.dispose();
          c.material.dispose();
        }
      }
    });
  });
  state.placedItems = [];
  deselectActiveItem();
  updateStats();
  if (!opts.silent) showToast('All items cleared', 'fa-trash');
}

// ========== SELECTION (for rotate / delete of existing items) ==========
let selectionRing = null;
function setActiveItem(placed) {
  disarmMove();
  state.activeItem = placed;
  if (!selectionRing) {
    selectionRing = new THREE.Mesh(
      new THREE.RingGeometry(0.55, 0.64, 32),
      new THREE.MeshBasicMaterial({ color: 0xC75D3F, transparent: true, opacity: 0.85, side: THREE.DoubleSide })
    );
    selectionRing.rotation.x = -Math.PI / 2;
    scene.add(selectionRing);
  }
  selectionRing.visible = true;
  selectionRing.position.set(placed.position.x, 0.015, placed.position.z);
  selectionRing.material.color.set(state.brandColor);
  // A pending insight-highlight auto-clear (see highlightPlacedItems) must
  // not later fire and wipe out a genuine, newer selection's outline — and
  // the outline color itself must be reset to the cyan "selected" cue in
  // case an insight highlight had left it amber. Without both of these, an
  // insight click followed shortly by a real selection could show the wrong
  // color, or have that color yanked away ~2.6s later by the old timer.
  clearTimeout(_insightHighlightTimer);
  outlinePass.visibleEdgeColor.set(0x00f0ff);
  outlinePass.hiddenEdgeColor.set(0x0a4a55);
  // Cyan outline on the object itself (per the brief: "soft cyan/blue
  // outline" as the selection cue) — separate from the brand-colored floor
  // ring, which communicates footprint/placement validity, not selection.
  outlinePass.selectedObjects = [placed.mesh];
  bus.emit('selection', { item: placed });
}
function deselectActiveItem() {
  const had = state.activeItem;
  state.activeItem = null;
  if (selectionRing) selectionRing.visible = false;
  clearTimeout(_insightHighlightTimer); // same reasoning as setActiveItem above
  outlinePass.selectedObjects = [];
  disarmMove();
  if (had) bus.emit('selection', { item: null });
}

// ========== UNDO / REDO ==========
const undoStack = [];
const redoStack = [];
function pushHistory(entry) {
  undoStack.push(entry);
  if (undoStack.length > 60) undoStack.shift();
  redoStack.length = 0;
  updateHistoryButtons();
  flashSaveStatus();
}
function updateHistoryButtons() {
  document.getElementById('undoBtn').disabled = undoStack.length === 0;
  document.getElementById('redoBtn').disabled = redoStack.length === 0;
}
function applyItemRotation(id, rotation) {
  const placed = state.placedItems.find(i => i.id === id);
  if (!placed) return;
  placed.rotation = rotation;
  placed.mesh.rotation.y = rotation;
  if (selectionRing && state.activeItem && state.activeItem.id === id) {
    selectionRing.position.set(placed.position.x, 0.015, placed.position.z);
  }
  updateStats();
  bus.emit('itemchange', { item: placed });
}
function applyItemPosition(id, pos) {
  const placed = state.placedItems.find(i => i.id === id);
  if (!placed) return;
  placed.position.x = pos.x;
  placed.position.z = pos.z;
  placed.mesh.position.set(pos.x, 0, pos.z);
  if (selectionRing && state.activeItem && state.activeItem.id === id) {
    selectionRing.position.set(pos.x, 0.015, pos.z);
  }
  updateStats();
  bus.emit('itemchange', { item: placed });
}

function undo() {
  const entry = undoStack.pop();
  if (!entry) return;
  suppressHistory = true;
  if (entry.action === 'add') {
    const placed = state.placedItems.find(i => i.id === entry.item.id);
    if (placed) removePlacedItem(placed, { skipHistory: true });
  } else if (entry.action === 'remove') {
    placeItem(entry.item.type, new THREE.Vector3(entry.item.x, 0, entry.item.z), entry.item.rotation, { skipAnim: true, id: entry.item.id, skipBoundaryCheck: true });
  } else if (entry.action === 'bulkRemove') {
    entry.items.forEach(it => placeItem(it.type, new THREE.Vector3(it.x, 0, it.z), it.rotation, { skipAnim: true, id: it.id, skipBoundaryCheck: true }));
  } else if (entry.action === 'rotate') {
    applyItemRotation(entry.id, entry.from);
  } else if (entry.action === 'move') {
    applyItemPosition(entry.id, entry.from);
  }
  suppressHistory = false;
  redoStack.push(entry);
  updateHistoryButtons();
  showToast('Undone', 'fa-rotate-left');
}
function redo() {
  const entry = redoStack.pop();
  if (!entry) return;
  suppressHistory = true;
  if (entry.action === 'add') {
    placeItem(entry.item.type, new THREE.Vector3(entry.item.x, 0, entry.item.z), entry.item.rotation, { skipAnim: true, id: entry.item.id, skipBoundaryCheck: true });
  } else if (entry.action === 'remove') {
    const placed = state.placedItems.find(i => i.id === entry.item.id);
    if (placed) removePlacedItem(placed, { skipHistory: true });
  } else if (entry.action === 'bulkRemove') {
    entry.items.forEach(it => {
      const placed = state.placedItems.find(i => i.id === it.id);
      if (placed) removePlacedItem(placed, { skipHistory: true });
    });
  } else if (entry.action === 'rotate') {
    applyItemRotation(entry.id, entry.to);
  } else if (entry.action === 'move') {
    applyItemPosition(entry.id, entry.to);
  }
  suppressHistory = false;
  undoStack.push(entry);
  updateHistoryButtons();
  showToast('Redone', 'fa-rotate-right');
}
document.getElementById('undoBtn').addEventListener('click', undo);
document.getElementById('redoBtn').addEventListener('click', redo);
document.getElementById('deleteSelected').addEventListener('click', () => {
  if (state.activeItem) removePlacedItem(state.activeItem);
});

// ========== TEMPLATE HELPERS ==========
function seatCluster(x, z, tableType, n) {
  placeItemAt(tableType, x, z);
  const offsets = {
    2: [[-0.85, 0, Math.PI/2], [0.85, 0, -Math.PI/2]],
    3: [[-0.85, 0, Math.PI/2], [0.85, 0, -Math.PI/2], [0, 0.85, Math.PI]],
    4: [[-0.85, 0, Math.PI/2], [0.85, 0, -Math.PI/2], [0, -0.85, 0], [0, 0.85, Math.PI]],
    6: [[-0.45,0.65,Math.PI],[0.45,0.65,Math.PI],[-0.45,-0.65,0],[0.45,-0.65,0],[-0.95,0,Math.PI/2],[0.95,0,-Math.PI/2]],
  };
  (offsets[n] || offsets[4]).forEach(([dx, dz, r]) => placeItemAt('chair', x + dx, z + dz, r));
}
function deskRow(xs, z, facing = Math.PI) {
  xs.forEach(x => { placeItemAt('desk', x, z); placeItemAt('chair', x, z + (facing === Math.PI ? 0.6 : -0.6), facing); });
}
function shelfWall(x, zs, rot) { zs.forEach(z => placeItemAt('shelf', x, z, rot)); }

// ========== TEMPLATES ==========
const TEMPLATES = {
  cafe: { label: 'Cafe', category: 'Commercial', icon: 'fa-mug-saucer', area: 860, capacity: 40, floor: 0xE8DCC4, build() {
    placeItemAt('counter', -3.2, -4);
    [[-1.8,-1.5],[1.8,-1.5],[-1.8,1.5],[1.8,1.5],[0,3.2]].forEach(([x,z]) => seatCluster(x, z, 'round_table', 4));
    [[-1.8,-1.5],[1.8,-1.5],[-1.8,1.5],[1.8,1.5]].forEach(([x,z]) => placeItemAt('pendant', x, z));
    placeItemAt('plant', -5.3, -4); placeItemAt('plant', 5.3, 4);
    placeItemAt('sofa', 4, 4.2, 0); placeItemAt('accent_chair', 4.8, -2.5, -Math.PI/2);
    placeItemAt('shelf', -5.4, 0, Math.PI/2); placeItemAt('rug', 0, 3.2);
  }},
  restaurant: { label: 'Restaurant', category: 'Commercial', icon: 'fa-utensils', area: 1500, capacity: 48, floor: 0xD9C9A8, build() {
    [-3,0,3].forEach(x => [-2.5,2.5].forEach(z => seatCluster(x, z, 'rect_table', 4)));
    placeItemAt('counter', -4.6, -4); placeItemAt('reception', 5, 4.4, -Math.PI/2);
    [-3,0,3].forEach(x => { placeItemAt('pendant', x, -2.5); placeItemAt('pendant', x, 2.5); });
    placeItemAt('plant', 5.3, -4); placeItemAt('plant', -5.3, 4); placeItemAt('painting', -5.9, -2);
  }},
  bakery: { label: 'Bakery', category: 'Commercial', icon: 'fa-bread-slice', area: 620, capacity: 22, floor: 0xF0E0C0, build() {
    placeItemAt('counter', -3.6, -4);
    shelfWall(-5.4, [-2, 1], Math.PI/2);
    [[-1.5,1.5],[1.8,1.5],[0.2,3.4]].forEach(([x,z]) => seatCluster(x, z, 'round_table', 2));
    placeItemAt('pendant', -1.5, 1.5); placeItemAt('pendant', 1.8, 1.5);
    placeItemAt('plant', 5.3, 4); placeItemAt('rug', 0.2, 3.4);
  }},
  bar: { label: 'Bar', category: 'Commercial', icon: 'fa-martini-glass', area: 980, capacity: 55, floor: 0x352C24, build() {
    placeItemAt('counter', -3.2, -4);
    for (let i = 0; i < 5; i++) placeItemAt('stool', -5 + i * 1.15, -3);
    [[-2.4,2],[0.6,2],[3.2,2]].forEach(([x,z]) => seatCluster(x, z, 'round_table', 3));
    placeItemAt('sofa', 4.6, -1, -Math.PI/2); placeItemAt('pendant', -1, -4); placeItemAt('pendant', 2, -4);
    placeItemAt('painting', -5.9, 2); placeItemAt('plant', 5.3, 4);
  }},
  boutique: { label: 'Boutique', category: 'Commercial', icon: 'fa-shirt', area: 680, capacity: 18, floor: 0xEFE7DA, build() {
    [-3,0,3].forEach(x => placeItemAt('rack', x, -2));
    shelfWall(-5.4, [0, 3], Math.PI/2); placeItemAt('shelf', 5.4, 0, -Math.PI/2);
    placeItemAt('counter', 3.5, -4); placeItemAt('sofa', -3.5, 4); placeItemAt('accent_chair', -1.5, 4);
    placeItemAt('plant', -5.3, -4); placeItemAt('plant', 5.3, 4);
    placeItemAt('pendant', 0, 0); placeItemAt('pendant', -3, -2); placeItemAt('pendant', 3, -2);
  }},
  retail: { label: 'Retail Store', category: 'Commercial', icon: 'fa-store', area: 1100, capacity: 26, floor: 0xE3D9C4, build() {
    shelfWall(-5.4, [-3,-1,1,3], Math.PI/2);
    [[-1.5,0],[1.5,0]].forEach(([x,z]) => placeItemAt('pedestal', x, z));
    placeItemAt('reception', 4.2, -4, -Math.PI/2); placeItemAt('rack', 2, 2.5); placeItemAt('rack', 4, 2.5);
    placeItemAt('plant', -5.3, 4); placeItemAt('rug', 0, 0);
  }},
  bookstore: { label: 'Bookstore', category: 'Commercial', icon: 'fa-book-open', area: 950, capacity: 24, floor: 0xC9AF84, build() {
    [-4,-1,2].forEach(x => placeItemAt('bookshelf', x, -2.3));
    [-4,-1,2].forEach(x => placeItemAt('bookshelf', x, 3.2, Math.PI));
    placeItemAt('reception', -5.2, 0.5, Math.PI/2);
    placeItemAt('armchair', 4.6, -1, -Math.PI/2); placeItemAt('armchair', 4.6, 1, -Math.PI/2);
    placeItemAt('rug', 4.6, 0); placeItemAt('pendant', 0, 0.5);
  }},
  beauty_salon: { label: 'Beauty Salon', category: 'Commercial', icon: 'fa-scissors', area: 720, capacity: 16, floor: 0xE7D6D6, build() {
    [-3.6,-0.6,2.4].forEach(x => { placeItemAt('desk', x, -3); placeItemAt('chair', x, -2, Math.PI); placeItemAt('painting', x, -4.6); });
    placeItemAt('sofa', -4.6, 3.6, 0); placeItemAt('armchair', -2.2, 4, 0);
    placeItemAt('shelf', 5.4, 0, -Math.PI/2); placeItemAt('plant', 5.3, -4); placeItemAt('pendant', 0, -3);
  }},
  coworking: { label: 'Co-working', category: 'Work', icon: 'fa-laptop', area: 1200, capacity: 34, floor: 0xDCD3C2, build() {
    deskRow([-2.5,0,2.5], -2, Math.PI); deskRow([-2.5,0,2.5], 2, Math.PI);
    seatCluster(4.5, -3, 'rect_table', 4);
    placeItemAt('plant', -5.3, -4); placeItemAt('plant', 5.3, 4);
    shelfWall(-5.4, [-2, 2], Math.PI/2);
    [-2.5,2.5].forEach(x => { placeItemAt('pendant', x, -2); placeItemAt('pendant', x, 2); });
  }},
  startup_office: { label: 'Startup Office', category: 'Work', icon: 'fa-rocket', area: 1400, capacity: 30, floor: 0xD8CFC0, build() {
    deskRow([-3.6,-1.8,0,1.8,3.6], -3);
    seatCluster(4.4, 3, 'rect_table', 4);
    placeItemAt('sofa', -4.4, 3.6, 0); placeItemAt('armchair', -2, 4, 0);
    placeItemAt('partition', 4.4, 0.5); placeItemAt('plant', -5.3, -1); placeItemAt('pendant', 0, -3);
  }},
  corporate_office: { label: 'Corporate Office', category: 'Work', icon: 'fa-building', area: 1800, capacity: 40, floor: 0xCFC7B8, build() {
    placeItemAt('reception', -4.6, -4.2, 0);
    deskRow([-3,-1,1,3], -1); deskRow([-3,-1,1,3], 1.6, -Math.PI);
    placeItemAt('partition', 0, 0.3); seatCluster(4.6, 3.6, 'oval_table', 4);
    placeItemAt('plant', 5.3, -4); placeItemAt('painting', -5.9, 2);
  }},
  photo_studio: { label: 'Photography Studio', category: 'Work', icon: 'fa-camera', area: 900, capacity: 14, floor: 0xEAEAE6, build() {
    placeItemAt('partition', 0, -4.3); placeItemAt('partition', -1.4, -4.3);
    placeItemAt('rack', -4.8, -3, Math.PI/2); placeItemAt('desk', 4.4, -3.6);
    placeItemAt('pedestal', 1.5, 1); placeItemAt('pedestal', -1.5, 1);
    placeItemAt('sofa', 4.4, 3.4, -Math.PI/2); placeItemAt('pendant', 0, 0);
  }},
  hotel_lobby: { label: 'Hotel Lobby', category: 'Hospitality', icon: 'fa-bell-concierge', area: 1600, capacity: 32, floor: 0xC9B48C, build() {
    placeItemAt('reception', -4.4, -4, 0);
    placeItemAt('sofa', -1, 2.4, Math.PI); placeItemAt('armchair', -2.6, 3.4, Math.PI*0.75);
    placeItemAt('armchair', 0.6, 3.4, Math.PI*1.25); placeItemAt('oval_table', -1, 3.2);
    placeItemAt('pedestal', 4.6, -3.6); placeItemAt('pedestal', 4.6, 3.6);
    placeItemAt('rug', -1, 2.8); placeItemAt('plant', 5.3, 0); placeItemAt('pendant', -1, 0.5);
  }},
  lounge: { label: 'Lounge', category: 'Hospitality', icon: 'fa-champagne-glasses', area: 1050, capacity: 36, floor: 0x36302A, build() {
    placeItemAt('counter', -4, -4);
    [[-1.5,0],[1.8,0],[0,3]].forEach(([x,z]) => { placeItemAt('sofa', x, z, x<0?Math.PI/2:(x>0?-Math.PI/2:0)); placeItemAt('round_table', x, z + (x===0?0.9:0)); });
    placeItemAt('armchair', -3, 3, Math.PI); placeItemAt('armchair', 3, -1, -Math.PI/2);
    placeItemAt('pendant', -1.5, 0); placeItemAt('pendant', 1.8, 0); placeItemAt('rug', 0, 1.5);
  }},
  guest_house: { label: 'Guest House', category: 'Hospitality', icon: 'fa-house-chimney', area: 540, capacity: 4, floor: 0xE3D6BE, build() {
    placeItemAt('bed', -2.6, 2.6);
    placeItemAt('armchair', 1.5, 3.6, -Math.PI/2); placeItemAt('desk', 3.6, -3);
    placeItemAt('chair', 3.6, -2, Math.PI); placeItemAt('bookshelf', -5.4, -2.5, Math.PI/2);
    placeItemAt('rug', -2.6, 2.6); placeItemAt('painting', -5.9, 1); placeItemAt('plant', 5.3, 4);
  }},
  library: { label: 'Library', category: 'Public', icon: 'fa-book', area: 1700, capacity: 40, floor: 0xB99B6B, build() {
    [-4.4,-2.4,0,2.4].forEach(x => placeItemAt('bookshelf', x, -3.6));
    [-4.4,-2.4,0,2.4].forEach(x => placeItemAt('bookshelf', x, 0, Math.PI));
    seatCluster(0.5, 3.4, 'rect_table', 4); placeItemAt('armchair', 4.6, -3, -Math.PI/2);
    placeItemAt('pendant', 0.5, 3.4);
  }},
  gallery: { label: 'Gallery', category: 'Public', icon: 'fa-palette', area: 1400, capacity: 60, floor: 0xF2F2EE, build() {
    [-4,-1.3,1.3,4].forEach(x => placeItemAt('painting', x, -4.85));
    placeItemAt('pedestal', -2, 0); placeItemAt('pedestal', 1.5, 1.5); placeItemAt('pedestal', 3, -1.5);
    placeItemAt('column', -4.8, 2); placeItemAt('column', 4.8, -2);
    placeItemAt('out_bench', 0, 3.6); placeItemAt('pendant', 0, 0);
  }},
  community_center: { label: 'Community Center', category: 'Public', icon: 'fa-people-roof', area: 2000, capacity: 70, floor: 0xDCD4C4, build() {
    [-3.4,0,3.4].forEach(x => seatCluster(x, -2, 'rect_table', 6));
    [-3.4,0,3.4].forEach(x => seatCluster(x, 2.6, 'rect_table', 6));
    placeItemAt('reception', -4.8, 4.4, Math.PI/2); placeItemAt('shelf', 5.4, 0, -Math.PI/2);
    placeItemAt('plant', 5.3, -4); placeItemAt('pendant', 0, 0.3);
  }},
  studio_apartment: { label: 'Studio Apartment', category: 'Residential', icon: 'fa-door-closed', area: 420, capacity: 2, floor: 0xE6DCC8, build() {
    placeItemAt('bed', -2.8, -2.4);
    seatCluster(2.6, -2.6, 'round_table', 2);
    placeItemAt('sofa', -1, 3.6, 0); placeItemAt('shelf', -5.4, 2, Math.PI/2);
    placeItemAt('rug', -2.8, -2.4); placeItemAt('plant', 5.3, 3); placeItemAt('painting', -5.9, -3.4);
  }},
  modern_apartment: { label: 'Modern Apartment', category: 'Residential', icon: 'fa-house', area: 780, capacity: 4, floor: 0xE0D5C0, build() {
    placeItemAt('bed', -3.4, -3);
    placeItemAt('sofa', 2.6, 3.4, Math.PI); placeItemAt('armchair', 4.6, 1.6, -Math.PI/2);
    seatCluster(-2.6, 3, 'rect_table', 4);
    placeItemAt('shelf', -5.4, -0.6, Math.PI/2); placeItemAt('rug', 2.6, 2); placeItemAt('painting', -5.9, 1.6);
  }},
  small_house: { label: 'Small House', category: 'Residential', icon: 'fa-house-chimney-window', area: 980, capacity: 5, floor: 0xD8CBB0, build() {
    placeItemAt('bed', -3.6, -3.2);
    placeItemAt('sofa', -3.6, 3, Math.PI); placeItemAt('armchair', -1.2, 3.8, Math.PI*0.8);
    seatCluster(2.6, -2.4, 'rect_table', 4);
    placeItemAt('bookshelf', 5.4, 1, -Math.PI/2); placeItemAt('plant', 5.3, -4); placeItemAt('rug', -2.4, 3.2);
  }},
  luxury_living_room: { label: 'Luxury Living Room', category: 'Residential', icon: 'fa-gem', area: 1250, capacity: 12, floor: 0x2C2822, build() {
    placeItemAt('sofa', -1, 2.6, Math.PI); placeItemAt('armchair', -3, 3.2, Math.PI*0.7); placeItemAt('armchair', 1.2, 3.2, Math.PI*1.3);
    placeItemAt('oval_table', -1, 2.8); placeItemAt('pedestal', 4.6, -3.4); placeItemAt('column', -5, -3.4);
    placeItemAt('column', 5, 3.4); placeItemAt('painting', -5.9, 1); placeItemAt('painting', -5.9, -1);
    placeItemAt('rug', -1, 3); placeItemAt('plant', 5.3, -1);
  }},
};

const TEMPLATE_CATEGORIES = ['Commercial', 'Work', 'Hospitality', 'Public', 'Residential'];

function renderTemplateCategoryTabs() {
  const wrap = document.getElementById('templateCategoryTabs');
  wrap.innerHTML = '';
  TEMPLATE_CATEGORIES.forEach(cat => {
    const chip = document.createElement('div');
    chip.className = 'chip' + (state.templateFilter === cat ? ' active' : '');
    chip.textContent = cat;
    chip.addEventListener('click', () => { state.templateFilter = cat; renderTemplateCategoryTabs(); renderTemplateGrid(); });
    wrap.appendChild(chip);
  });
}

function renderTemplateGrid() {
  const grid = document.getElementById('templateGrid');
  grid.innerHTML = '';
  Object.entries(TEMPLATES).forEach(([key, t]) => {
    if (t.category !== state.templateFilter) return;
    const card = document.createElement('button');
    card.className = 'template-card' + (state.template === key ? ' active' : '');
    card.dataset.template = key;
    card.innerHTML = `
      <div class="t-swatch" style="background:#${t.floor.toString(16).padStart(6,'0')};"></div>
      <i class="fa-solid ${t.icon} text-base t-icon" style="color: var(--charcoal-3);"></i>
      <div class="text-[11px] font-semibold mt-1.5">${t.label}</div>
      <div class="text-[9px] font-mono mt-0.5" style="color: var(--charcoal-3);">${t.area.toLocaleString()} sq ft</div>
    `;
    card.addEventListener('click', () => { loadTemplate(key); showToast(`Loaded ${t.label} template`, 'fa-folder-open'); });
    grid.appendChild(card);
  });
}
renderTemplateCategoryTabs();
renderTemplateGrid();

// ========== LOAD TEMPLATE ==========
function loadTemplate(name) {
  // NOTE: local param renamed from the original `t` to `tpl` — `t` is now
  // reserved globally for the i18n translation helper, and shadowing it
  // here would silently break any future t('...') call added inside this
  // function (it would resolve to the template object instead).
  const tpl = TEMPLATES[name];
  if (!tpl) return;
  clearAll({ skipHistory: true, silent: true });
  undoStack.length = 0; redoStack.length = 0; updateHistoryButtons();
  state.template = name;
  state.roomArea = Math.round(tpl.area * 0.0929);
  state.maxCapacity = tpl.capacity;
  setRoomFinish(tpl.floor);
  drawSign(tpl.label);

  suppressHistory = true;
  tpl.build();
  suppressHistory = false;

  document.getElementById('projectName').textContent = tpl.label + ' Concept';
  document.getElementById('templateBadge').textContent = tpl.label;
  document.getElementById('areaStat').innerHTML = `${state.roomArea} m² <span class="font-mono text-[10px] font-normal" style="color: var(--charcoal-3);">/ ${tpl.area.toLocaleString()} ft²</span>`;
  document.getElementById('areaStatSmall').textContent = state.roomArea + ' m²';

  state.templateFilter = tpl.category;
  renderTemplateCategoryTabs();
  renderTemplateGrid();
  updateCityForTemplate(tpl.category);
  updateBreadcrumb();
  renderTemplateDropdown();
  bus.emit('baseline'); // a template swap is not a cost "change" — reset the cost-delta baseline
}

// ========== STATS ==========
// Catalog facts the spatial analysis needs (kept out of that pure module).
function catalogInfo(type) {
  const c = ITEM_CATALOG[type];
  return c ? { seats: c.seats, cat: c.cat } : {};
}
function updateStats() {
  const seats = state.placedItems.reduce((s, i) => s + i.seats, 0);
  const total = state.placedItems.reduce((s, i) => s + i.price, 0);
  const pct = Math.min(100, Math.round((seats / state.maxCapacity) * 100));
  const density = seats / state.roomArea;
  
  animateNumber('capacityCount', seats);
  animateNumber('seatsStat', seats);
  document.getElementById('capacityMax').textContent = state.maxCapacity;
  document.getElementById('itemCount').textContent = `${state.placedItems.length} item${state.placedItems.length !== 1 ? 's' : ''}`;
  document.getElementById('occPercent').textContent = pct;
  document.getElementById('occFill').style.width = pct + '%';
  document.getElementById('capacityBar').style.width = pct + '%';
  document.getElementById('capacityPct').textContent = pct + '%';
  document.getElementById('densityStat').textContent = density.toFixed(2);
  document.getElementById('perSeatStat').textContent = seats > 0 ? (state.roomArea / seats).toFixed(1) + ' m²' : '—';
  document.getElementById('liveTotal').textContent = '$' + total.toLocaleString();
  document.getElementById('placedCount').textContent = state.placedItems.length;
  
  const overCapacity = seats > state.maxCapacity;
  document.getElementById('egressDot').style.background = overCapacity ? 'var(--danger)' : 'var(--success)';
  document.getElementById('egressStatus').textContent = overCapacity ? t('compliance.overLimit') : t('compliance.compliant');
  document.getElementById('egressStatus').style.color = overCapacity ? 'var(--danger)' : 'var(--charcoal)';

  // Compact "Performance & Analytics" card mirrors the same live data.
  const egressIcon = document.getElementById('complianceEgressIcon');
  const egressValueEl = document.getElementById('complianceEgressValue');
  if (egressIcon && egressValueEl) {
    egressIcon.classList.toggle('warn', overCapacity);
    egressIcon.innerHTML = overCapacity
      ? '<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>'
      : '<i class="fa-solid fa-circle-check" aria-hidden="true"></i>';
    egressValueEl.textContent = overCapacity ? t('compliance.overLimit') : t('compliance.compliant');
    egressValueEl.style.color = overCapacity ? 'var(--danger)' : '';
  }
  const capIcon = document.getElementById('complianceCapacityIcon');
  const capValueEl = document.getElementById('complianceCapacityValue');
  if (capIcon && capValueEl) {
    capIcon.classList.toggle('warn', overCapacity);
    capIcon.innerHTML = overCapacity
      ? '<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>'
      : '<i class="fa-solid fa-circle-check" aria-hidden="true"></i>';
    capValueEl.textContent = overCapacity ? `${seats}/${state.maxCapacity} ${t('compliance.overLimit').toLowerCase()}` : t('compliance.withinLimit');
    capValueEl.style.color = overCapacity ? 'var(--danger)' : '';
  }
  const analyticsFurniture = document.getElementById('analyticsFurnitureSubtotal');
  if (analyticsFurniture) analyticsFurniture.textContent = '$' + total.toLocaleString();

  // ---- Accessibility: one shared analysis (spatial-analysis.js) — the same
  // result drives this card, the Design-Intelligence tips, the 3D compliance
  // overlay + collision markers, the inspector and the exported report, so
  // they can never disagree. Thresholds are the app's existing ones. ----
  const analysis = analyzeLayout(state.placedItems, { width: ROOM_W, depth: ROOM_D }, catalogInfo);
  state.analysis = analysis;
  const tightestClearance = analysis.tightest;
  const tightestClearanceIds = analysis.tightestIds; // the specific placed item(s) responsible — lets the insight card highlight them in-scene, not just report a number
  const accessible = analysis.accessible;
  const accessIcon = document.getElementById('complianceAccessIcon');
  const accessValueEl = document.getElementById('complianceAccessValue');
  if (accessIcon && accessValueEl) {
    accessIcon.classList.toggle('warn', !accessible);
    accessIcon.innerHTML = accessible
      ? '<i class="fa-solid fa-circle-check" aria-hidden="true"></i>'
      : '<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>';
    accessValueEl.textContent = accessible ? t('compliance.compliant') : t('compliance.tightClearance');
    accessValueEl.style.color = accessible ? '' : 'var(--danger)';
  }

  // ---- Space efficiency: footprint area actually occupied by furniture
  // vs. total floor area. This is a real geometric ratio, not a guess —
  // though it's a simplification (circular footprints, no overlap
  // subtraction), so it reads as a useful proxy rather than a survey-grade
  // figure. ----
  const occupiedArea = state.placedItems.reduce((s, i) => s + Math.PI * i.footprintRadius * i.footprintRadius, 0);
  const spaceEfficiencyPct = state.roomArea > 0 ? Math.min(100, Math.round((occupiedArea / state.roomArea) * 100 * 3.1)) : 0;
  // (×3.1 empirically maps "circles-only footprint" coverage into the
  // ~35-75% band a real furnished floor plan actually reads as "efficient",
  // since usable furniture coverage of a well-laid-out room is well below
  // 100% by design — this is a heuristic scaling factor, documented here
  // rather than left as a mystery constant.)
  const effEl = document.getElementById('spaceEfficiencyStat');
  if (effEl) effEl.textContent = spaceEfficiencyPct + '% efficient';

  // ---- Project score: deterministic weighted blend of compliance,
  // capacity utilization, accessibility/circulation and space efficiency.
  // Every input is a real computed value above — nothing here is invented. ----
  const capacityUtilization = state.maxCapacity > 0 ? Math.min(1, seats / state.maxCapacity) : 0;
  const capacityScore = overCapacity ? 40 : capacityUtilization * 100;
  const complianceScore = overCapacity ? 30 : 100;
  const accessScore = accessible ? 100 : 45;
  const effScore = Math.max(0, 100 - Math.abs(spaceEfficiencyPct - 55)); // 55% reads as the "well-balanced" sweet spot
  const projectScore = Math.round(complianceScore * 0.35 + accessScore * 0.25 + capacityScore * 0.2 + effScore * 0.2);
  // Persisted on state (not just written to the DOM) so other views — the
  // city-scale selection card, specifically — can reference the same real
  // number instead of a second, disconnected figure. This is what actually
  // ties "the interior you designed" to "the building you see in the city."
  state.projectScore = projectScore;
  state.spaceEfficiencyPct = spaceEfficiencyPct;
  const scoreValEl = document.getElementById('scoreRingValue');
  const scoreFillEl = document.getElementById('scoreRingFill');
  if (scoreValEl && scoreFillEl) {
    scoreValEl.textContent = projectScore;
    const circumference = 2 * Math.PI * 23;
    scoreFillEl.style.strokeDasharray = circumference.toFixed(1);
    scoreFillEl.style.strokeDashoffset = (circumference * (1 - projectScore / 100)).toFixed(1);
    scoreFillEl.style.stroke = projectScore >= 75 ? 'var(--success, #4C8B5A)' : projectScore >= 50 ? 'var(--accent)' : 'var(--danger)';
  }

  // ---- Built value: a shell-construction estimate derived from the active
  // template's footprint area (a real per-project figure, not the citywide
  // total) plus the furniture actually placed. The per-m² shell rate is a
  // heuristic construction-cost assumption, not a live market figure —
  // documented here rather than left as an unexplained constant.
  const builtValueEl = document.getElementById('analyticsBuiltValue');
  if (builtValueEl) {
    const activeTemplate = TEMPLATES[state.template];
    const shellValue = (activeTemplate ? activeTemplate.area : state.roomArea) * 260;
    const builtValue = shellValue + total;
    builtValueEl.textContent = '$' + Math.round(builtValue).toLocaleString();
    // Real ratio (furniture spend vs. total built value), not decorative —
    // same two numbers already shown as text just above, visualized.
    const fitBar = document.getElementById('financialFitBar');
    if (fitBar) fitBar.style.width = Math.min(100, Math.round((total / builtValue) * 100)) + '%';
  }

  renderDesignIntelligence({ seats, total, density, overCapacity, tightestClearance, tightestClearanceIds, accessible, spaceEfficiencyPct, projectScore });

  updatePlacedList();
  updateCostPanel(total);
  updateHistoryButtons();

  if (selectionRing && state.activeItem) {
    const still = state.placedItems.find(i => i.id === state.activeItem.id);
    if (!still) deselectActiveItem();
  }
  bus.emit('layout', { analysis, total, seats });
}

const _numberAnims = new Map(); // tracks the in-flight RAF id per element so rapid updates don't race

// ========== DESIGN INTELLIGENCE ==========
// Real rule-based analysis over the current placedItems/state — every
// number quoted in a tip is read directly off the scene, never invented.
function renderDesignIntelligence({ seats, total, density, overCapacity, tightestClearance, tightestClearanceIds, accessible, spaceEfficiencyPct, projectScore }) {
  const card = document.getElementById('insightCard');
  if (!card) return;
  const tips = [];

  if (state.placedItems.length === 0) {
    card.innerHTML = `<div class="insight-empty">${t('insight.empty')}</div>`;
    return;
  }

  // Approximation: treats maxCapacity as an item-count cutoff over the
  // seating items in placement order, not an exact seats-per-item accounting
  // (a single item can provide more than one seat). Good enough to point at
  // genuinely seating-related, likely-excess items — the capacity numbers
  // in the tip text itself are the precise figures, this is just "what to
  // glow."
  const overCapacityIds = overCapacity
    ? state.placedItems.filter(i => ITEM_CATALOG[i.type]?.seats).slice(state.maxCapacity).map(i => i.id)
    : [];
  if (overCapacity) {
    tips.push({ level: 'warn', icon: 'fa-triangle-exclamation', relatedIds: overCapacityIds,
      text: `Seating (${seats}) exceeds the ${state.maxCapacity}-seat capacity limit — remove or relocate ${seats - state.maxCapacity} seat${seats - state.maxCapacity === 1 ? '' : 's'} to stay compliant.` });
  }

  if (!accessible && isFinite(tightestClearance)) {
    tips.push({ level: 'warn', icon: 'fa-person-walking-arrow-right', relatedIds: tightestClearanceIds,
      text: `Clearance between ${tightestClearanceIds.length > 1 ? 'two objects' : 'an object and the room boundary'} is only ${Math.max(0, tightestClearance).toFixed(2)}m — widen the gap to at least 0.9m for accessible circulation.` });
  }

  if (density > 0.45) {
    tips.push({ level: 'suggestion', icon: 'fa-compress',
      text: `Seating density is ${density.toFixed(2)} seats/m², on the high side — spacing seating out slightly usually improves perceived comfort and flow.` });
  } else if (density > 0 && density < 0.12 && state.placedItems.length > 2) {
    tips.push({ level: 'suggestion', icon: 'fa-expand',
      text: `Seating density is ${density.toFixed(2)} seats/m² — this floor has room for more covers if higher capacity is the goal.` });
  }

  if (spaceEfficiencyPct > 0 && spaceEfficiencyPct < 25) {
    tips.push({ level: 'suggestion', icon: 'fa-border-none',
      text: `Space efficiency is ${spaceEfficiencyPct}% — a fair amount of usable floor is still open for additional furniture or storage.` });
  } else if (spaceEfficiencyPct > 78) {
    tips.push({ level: 'warn', icon: 'fa-triangle-exclamation',
      text: `Space efficiency is ${spaceEfficiencyPct}% — the floor is close to fully packed, which typically hurts circulation and fire-egress margins.` });
  }

  const surfaceItems = state.placedItems.filter(i => ITEM_CATALOG[i.type]?.cat === 'surfaces');
  const comfortCount = state.placedItems.filter(i => ITEM_CATALOG[i.type]?.cat === 'comfort').length;
  if (surfaceItems.length > 0 && comfortCount === 0) {
    tips.push({ level: 'suggestion', icon: 'fa-chair', relatedIds: surfaceItems.map(i => i.id),
      text: `${surfaceItems.length} table/counter surface${surfaceItems.length === 1 ? ' is' : 's are'} placed with no seating yet — add chairs or stools to make this area usable.` });
  }

  if (tips.length === 0) {
    tips.push({ level: 'good', icon: 'fa-circle-check',
      text: `Layout is balanced — ${spaceEfficiencyPct}% space efficiency and full clearance compliance at a project score of ${projectScore}.` });
  }

  card.innerHTML = tips.slice(0, 4).map((tip, idx) => `
    <div class="insight-item insight-item--${tip.level}${tip.relatedIds?.length ? ' insight-item--clickable' : ''}" ${tip.relatedIds?.length ? `data-insight-idx="${idx}" role="button" tabindex="0" title="Click to highlight in the 3D view"` : ''}>
      <i class="fa-solid ${tip.icon}" aria-hidden="true"></i>
      <span>${tip.text}</span>
      ${tip.relatedIds?.length ? '<i class="fa-solid fa-cube insight-item-locate" aria-hidden="true"></i>' : ''}
    </div>
  `).join('');

  // Wire up "locate in scene" clicks — reuses the existing OutlinePass
  // rather than introducing a second highlight system, and briefly
  // deselects any active item first so the two selection states don't
  // visually conflict.
  card.querySelectorAll('[data-insight-idx]').forEach(el => {
    const tip = tips[Number(el.dataset.insightIdx)];
    const activate = () => highlightPlacedItems(tip.relatedIds);
    el.addEventListener('click', activate);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); } });
  });
}

// Temporarily outlines one or more placed items (by id) in the 3D view —
// used by Design-Intelligence insight cards so a reported issue ("tight
// clearance", "no seating yet") can be understood spatially instead of only
// as text. (Camera framing/auto-focus toward the flagged item is not
// implemented — this only highlights, it doesn't move the view.)
let _insightHighlightTimer;
function highlightPlacedItems(ids) {
  const meshes = state.placedItems.filter(i => ids.includes(i.id)).map(i => i.mesh);
  if (meshes.length === 0) return;
  deselectActiveItem();
  outlinePass.selectedObjects = meshes;
  outlinePass.visibleEdgeColor.set(0xF2A33C); // amber, distinct from the cyan "selected" cue, reads as "flagged" rather than "selected"
  outlinePass.hiddenEdgeColor.set(0x7a5420);
  clearTimeout(_insightHighlightTimer);
  _insightHighlightTimer = setTimeout(() => {
    outlinePass.selectedObjects = [];
    outlinePass.visibleEdgeColor.set(0x00f0ff);
    outlinePass.hiddenEdgeColor.set(0x0a4a55);
  }, 2600);
}

function animateNumber(id, target) {
  const el = document.getElementById(id);
  const current = parseInt(el.textContent) || 0;
  if (current === target) return;
  const prevAnim = _numberAnims.get(id);
  if (prevAnim) cancelAnimationFrame(prevAnim);
  const diff = target - current;
  const start = performance.now();
  const dur = 400;
  function tick() {
    const t = Math.min(1, (performance.now() - start) / dur);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = Math.round(current + diff * eased);
    if (t < 1) {
      _numberAnims.set(id, requestAnimationFrame(tick));
    } else {
      el.textContent = target;
      _numberAnims.delete(id);
    }
  }
  tick();
}

function updatePlacedList() {
  const list = document.getElementById('placedList');
  if (state.placedItems.length === 0) {
    list.innerHTML = `<div class="placed-list-empty"><i class="fa-solid fa-couch" aria-hidden="true"></i><span>No items yet.<br>Click a furniture piece<br>on the left to start.</span></div>`;
    return;
  }
  const grouped = {};
  state.placedItems.forEach(i => {
    if (!grouped[i.type]) grouped[i.type] = { count: 0, ...i };
    grouped[i.type].count++;
  });
  list.innerHTML = '';
  Object.values(grouped).forEach(g => {
    const row = document.createElement('div');
    row.className = 'flex items-center gap-2.5 p-2 rounded-md border';
    row.style.borderColor = 'var(--line-soft)';
    row.style.background = 'var(--surface-2)';
    row.innerHTML = `
      <div class="w-7 h-7 rounded flex items-center justify-center" style="background: var(--bg-2);">
        <i class="fa-solid ${ITEM_CATALOG[g.type].icon} text-[11px]"></i>
      </div>
      <div class="flex-1 min-w-0">
        <div class="text-[11px] font-semibold truncate">${g.name}</div>
        <div class="text-[10px] font-mono" style="color: var(--charcoal-3);">×${g.count} · $${g.price}</div>
      </div>
      <div class="text-[11px] font-mono font-semibold">$${(g.price * g.count).toLocaleString()}</div>
    `;
    list.appendChild(row);
  });
}

// Single source of truth for cost math — used by both the cost panel and PDF export
// so delivery/contingency rates can never drift out of sync between the two views.
const DELIVERY_RATE = 0.12;
const CONTINGENCY_RATE = 0.08;
function computeCostBreakdown(subtotal) {
  const delivery = subtotal * DELIVERY_RATE;
  const contingency = subtotal * CONTINGENCY_RATE;
  const total = subtotal + delivery + contingency;
  return { subtotal, delivery, contingency, total };
}

function updateCostPanel(subtotal) {
  const { delivery, contingency, total } = computeCostBreakdown(subtotal);
  document.getElementById('costSubtotal').textContent = '$' + subtotal.toLocaleString();
  document.getElementById('costDelivery').textContent = '$' + Math.round(delivery).toLocaleString();
  document.getElementById('costContingency').textContent = '$' + Math.round(contingency).toLocaleString();
  document.getElementById('costTotal').textContent = '$' + Math.round(total).toLocaleString();
  const analyticsCostEl = document.getElementById('analyticsCostTotal');
  if (analyticsCostEl) analyticsCostEl.textContent = '$' + Math.round(total).toLocaleString();
  
  const content = document.getElementById('costContent');
  const grouped = {};
  state.placedItems.forEach(i => {
    if (!grouped[i.type]) grouped[i.type] = { count: 0, ...i };
    grouped[i.type].count++;
  });
  
  if (Object.keys(grouped).length === 0) {
    content.innerHTML = `
      <div class="text-center py-12">
        <div class="w-14 h-14 mx-auto rounded-full flex items-center justify-center mb-3" style="background: var(--bg-2);">
          <i class="fa-solid fa-receipt text-xl" style="color: var(--oat-dark);"></i>
        </div>
        <div class="text-sm font-semibold mb-1">No items yet</div>
        <div class="text-[11px] leading-relaxed" style="color: var(--charcoal-3);">Place furniture in the canvas<br>to see cost breakdown.</div>
      </div>
    `;
    return;
  }
  
  content.innerHTML = '';
  Object.values(grouped).forEach(g => {
    const row = document.createElement('div');
    row.className = 'flex items-center gap-3 py-3 border-b';
    row.style.borderColor = 'var(--line-soft)';
    row.innerHTML = `
      <div class="w-10 h-10 rounded-lg flex items-center justify-center" style="background: var(--bg-2);">
        <i class="fa-solid ${ITEM_CATALOG[g.type].icon} text-sm"></i>
      </div>
      <div class="flex-1">
        <div class="text-[13px] font-semibold">${g.name}</div>
        <div class="text-[11px]" style="color: var(--charcoal-3);">$${g.price} × ${g.count}</div>
      </div>
      <div class="font-display font-bold">$${(g.price * g.count).toLocaleString()}</div>
    `;
    content.appendChild(row);
  });
}

// ========== BRAND COLOR ==========
function hexToRgb(hex) {
  const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return r ? `${parseInt(r[1], 16)}, ${parseInt(r[2], 16)}, ${parseInt(r[3], 16)}` : '0, 0, 0';
}

function setBrandColor(color) {
  state.brandColor = color;
  document.documentElement.style.setProperty('--accent', color);
  document.documentElement.style.setProperty('--accent-rgb', hexToRgb(color));
  document.getElementById('colorWrap').style.background = color;
  document.getElementById('brandHex').textContent = color.toUpperCase();
  
  document.getElementById('colorWrap').classList.remove('pulse-once');
  void document.getElementById('colorWrap').offsetWidth;
  document.getElementById('colorWrap').classList.add('pulse-once');
  
  state.placedItems.forEach(item => {
    item.mesh.traverse(c => {
      if (c.isMesh && c.userData.brand) c.material.color.set(color);
    });
  });
  if (egressGroup) {
    egressGroup.traverse(c => {
      if (c.isMesh && c.userData.egressPath) c.material.color.set(color);
    });
  }
  if (ghostItem) {
    ghostItem.traverse(c => {
      if (c.isMesh && c.userData.brand) c.material.color.set(color);
    });
  }
  if (selectionRing) selectionRing.material.color.set(color);
  signMesh.material.emissive.set(color);
  drawSign(TEMPLATES[state.template].label);
}

document.getElementById('brandColor').addEventListener('input', (e) => {
  setBrandColor(e.target.value);
  document.querySelectorAll('.swatch').forEach(s => { s.classList.remove('active'); s.setAttribute('aria-pressed', 'false'); });
});

document.querySelectorAll('.swatch').forEach(swatch => {
  swatch.addEventListener('click', () => {
    document.querySelectorAll('.swatch').forEach(s => { s.classList.remove('active'); s.setAttribute('aria-pressed', 'false'); });
    swatch.classList.add('active');
    swatch.setAttribute('aria-pressed', 'true');
    const color = swatch.dataset.color;
    document.getElementById('brandColor').value = color;
    setBrandColor(color);
    showToast('Brand color applied across the room', 'fa-palette');
  });
});

// ========== BREADCRUMB ==========
function updateBreadcrumb() {
  const trail = document.getElementById('breadcrumbTrail');
  if (!trail) return;
  const projectName = document.getElementById('projectName')?.textContent.trim() || 'Untitled Project';
  const district = 'CANAL QUARTER';
  let viewLabel = t('breadcrumb.workspace');
  if (state.view === 'city') viewLabel = t('breadcrumb.city');
  else if (state.view === 'top') viewLabel = t('breadcrumb.floor');
  if (ws.mode === 'inspect') viewLabel = 'Inspection';
  trail.textContent = `ZKR CITY / ${district} / ${projectName.toUpperCase()} / ${viewLabel.toUpperCase()}`;
}

// ========== GENERIC DROPDOWN HANDLING (template / language / notifications) ==========
// One shared open/close mechanism so behavior (outside-click, Escape,
// single-dropdown-at-a-time) is consistent across all three menus instead
// of three near-duplicate implementations.
const _dropdowns = []; // { trigger, menu, onOpen? }
function registerDropdown(trigger, menu, onOpen) {
  if (!trigger || !menu) return;
  _dropdowns.push({ trigger, menu, onOpen });
  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = menu.classList.contains('show');
    closeAllDropdowns();
    if (!isOpen) openDropdown(trigger, menu, onOpen);
  });
  trigger.addEventListener('keydown', (e) => {
    // Native <button> elements already fire a 'click' on Enter/Space by
    // default — calling trigger.click() manually here as well would
    // double-toggle (open then instantly close). Only needed for the
    // role="button" <div> triggers (template/language selectors), which
    // have no native activation behavior of their own.
    if (trigger.tagName === 'BUTTON') return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); trigger.click(); }
  });
}
function openDropdown(trigger, menu, onOpen) {
  menu.classList.add('show');
  trigger.classList.add('open');
  trigger.setAttribute('aria-expanded', 'true');
  if (onOpen) onOpen();
}
function closeAllDropdowns() {
  _dropdowns.forEach(({ trigger, menu }) => {
    menu.classList.remove('show');
    trigger.classList.remove('open');
    trigger.setAttribute('aria-expanded', 'false');
  });
  const dot = document.getElementById('notifDot');
  if (dot) dot.hidden = notificationLog.length === 0;
}
document.addEventListener('click', closeAllDropdowns);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAllDropdowns(); });

// ---- Template dropdown: populated live from TEMPLATES, no duplicate data ----
function renderTemplateDropdown() {
  const menu = document.getElementById('templateDropdownMenu');
  if (!menu) return;
  menu.innerHTML = Object.entries(TEMPLATES).map(([key, tpl]) => `
    <button data-template-key="${key}" class="${state.template === key ? 'active' : ''}" role="option" aria-selected="${state.template === key}">
      <i class="fa-solid ${tpl.icon}" style="width:14px; text-align:center; opacity:0.75;" aria-hidden="true"></i>
      <span>${tpl.label}</span>
      <span class="dropdown-item-meta">${tpl.capacity} seats</span>
    </button>
  `).join('');
  menu.querySelectorAll('button[data-template-key]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation(); // prevent bubbling into templateSelector's own toggle listener, which would reopen the menu we're closing
      const key = btn.dataset.templateKey;
      if (key !== state.template) {
        loadTemplate(key);
        showToast(`Loaded ${TEMPLATES[key].label} template`, 'fa-folder-open');
      }
      closeAllDropdowns();
      updateBreadcrumb();
    });
  });
}
registerDropdown(document.getElementById('templateSelector'), document.getElementById('templateDropdownMenu'), renderTemplateDropdown);

// ---- Project name: click-to-rename field ----
const projectNameEl = document.getElementById('projectName');
if (projectNameEl) {
  projectNameEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); projectNameEl.blur(); }
  });
  projectNameEl.addEventListener('blur', () => {
    if (!projectNameEl.textContent.trim()) projectNameEl.textContent = 'Untitled Project';
    updateBreadcrumb();
    flashSaveStatus();
  });
}

// ---- Language dropdown ----
registerDropdown(document.getElementById('langSelector'), document.getElementById('langDropdownMenu'));
document.querySelectorAll('#langDropdownMenu button[data-lang]').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation(); // same reopen-bubbling hazard as the template dropdown above
    if (btn.disabled) return;
    applyLanguage(btn.dataset.lang);
    closeAllDropdowns();
    updateBreadcrumb();
  });
});

// ---- Quality tier dropdown ----
registerDropdown(document.getElementById('qualitySelector'), document.getElementById('qualityDropdownMenu'));
document.querySelectorAll('#qualityDropdownMenu button[data-quality]').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation(); // same reopen-bubbling hazard noted on the other dropdowns
    setQuality(btn.dataset.quality);
    closeAllDropdowns();
  });
});

// ---- Notifications ----
registerDropdown(document.getElementById('notifBtn'), document.getElementById('notifMenu'), () => {
  renderNotifications();
  const dot = document.getElementById('notifDot');
  if (dot) dot.hidden = true; // opening the panel marks activity as read
});
document.getElementById('notifClearBtn')?.addEventListener('click', (e) => {
  e.stopPropagation();
  notificationLog.length = 0;
  renderNotifications();
});

// ---- Lighting presets ----
const LIGHT_PRESETS = {
  morning: 8, afternoon: 13, golden: 18.15, evening: 20, night: 1,
  overcast: 12.5, bluehour: 19.4,
};
document.querySelectorAll('.light-preset-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const preset = btn.dataset.preset;
    document.querySelectorAll('.light-preset-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.lightPreset = preset;
    if (preset === 'live') {
      state.timeAuto = true;
      showToast('Resumed live day/night cycle', 'fa-play');
    } else {
      state.timeAuto = false;
      state.cityTime = LIGHT_PRESETS[preset];
      showToast(`${btn.textContent.trim()} lighting applied`, 'fa-sun');
    }
    flashSaveStatus();
  });
});

// ========== FIRE SAFETY / EGRESS ==========
let egressGroup = null;
let egressArrows = [];

function toggleFireSafety() {
  state.fireSafety = !state.fireSafety;
  const btn = document.getElementById('fireSafetyBtn');
  btn.classList.toggle('active', state.fireSafety);
  if (state.fireSafety) showEgressPaths();
  else hideEgressPaths();
}

function showEgressPaths() {
  hideEgressPaths();
  egressGroup = new THREE.Group();
  egressArrows = [];
  
  const exitX = 5.5, exitZ = 4.5;
  
  const paths = [
    [
      new THREE.Vector3(-5, 0.02, -4),
      new THREE.Vector3(-5, 0.02, 2.5),
      new THREE.Vector3(0, 0.02, 2.5),
      new THREE.Vector3(exitX, 0.02, 2.5),
      new THREE.Vector3(exitX, 0.02, exitZ)
    ],
    [
      new THREE.Vector3(4, 0.02, -4),
      new THREE.Vector3(4, 0.02, 0),
      new THREE.Vector3(exitX, 0.02, 0),
      new THREE.Vector3(exitX, 0.02, exitZ)
    ]
  ];
  
  paths.forEach(points => {
    const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.3);
    
    const tubeGeom = new THREE.TubeGeometry(curve, 80, 0.06, 8, false);
    const tubeMat = new THREE.MeshBasicMaterial({
      color: state.brandColor, transparent: true, opacity: 0.35
    });
    const tube = new THREE.Mesh(tubeGeom, tubeMat);
    tube.userData.egressPath = true;
    egressGroup.add(tube);
    
    const arrowCount = 6;
    for (let i = 0; i < arrowCount; i++) {
      const arrowGeom = new THREE.ConeGeometry(0.18, 0.32, 8);
      const arrowMat = new THREE.MeshBasicMaterial({ color: state.brandColor });
      const arrow = new THREE.Mesh(arrowGeom, arrowMat);
      arrow.userData.phase = i / arrowCount;
      arrow.userData.curve = curve;
      egressGroup.add(arrow);
      egressArrows.push(arrow);
    }
  });
  
  const exitRing = new THREE.Mesh(
    new THREE.RingGeometry(0.5, 0.75, 24),
    new THREE.MeshBasicMaterial({ color: 0x6B8E4E, transparent: true, opacity: 0.9, side: THREE.DoubleSide })
  );
  exitRing.position.set(exitX, 0.04, exitZ);
  exitRing.rotation.x = -Math.PI / 2;
  egressGroup.add(exitRing);
  
  const exitRing2 = new THREE.Mesh(
    new THREE.RingGeometry(0.8, 0.85, 24),
    new THREE.MeshBasicMaterial({ color: 0x6B8E4E, transparent: true, opacity: 0.5, side: THREE.DoubleSide })
  );
  exitRing2.position.set(exitX, 0.04, exitZ);
  exitRing2.rotation.x = -Math.PI / 2;
  exitRing2.userData.pulseRing = true;
  egressGroup.add(exitRing2);
  
  const signPost = new THREE.Mesh(
    new THREE.CylinderGeometry(0.03, 0.03, 1.4, 6),
    new THREE.MeshStandardMaterial({ color: 0x2A2826 })
  );
  signPost.position.set(exitX, 0.7, exitZ);
  egressGroup.add(signPost);
  
  const signPlate = new THREE.Mesh(
    new THREE.BoxGeometry(0.6, 0.25, 0.03),
    new THREE.MeshStandardMaterial({ color: 0x6B8E4E, emissive: 0x6B8E4E, emissiveIntensity: 0.4 })
  );
  signPlate.position.set(exitX, 1.5, exitZ);
  egressGroup.add(signPlate);
  
  scene.add(egressGroup);
  showToast('Fire egress paths visible', 'fa-route');
}

function hideEgressPaths() {
  if (egressGroup) {
    scene.remove(egressGroup);
    egressGroup.traverse(c => {
      if (c.geometry) c.geometry.dispose();
      if (c.material) c.material.dispose();
    });
    egressGroup = null;
    egressArrows = [];
  }
}

// ========== VIEW TRANSITION ==========
const cameraViews = {
  perspective: { pos: new THREE.Vector3(10, 8, 12), target: new THREE.Vector3(0, 1, 0), fov: 40 },
  city: { pos: new THREE.Vector3(82, 64, 86), target: new THREE.Vector3(0, 0, 0), fov: 46 },
  district: { pos: new THREE.Vector3(43, 27, 42), target: new THREE.Vector3(28, 0, -28), fov: 42 },
  street: { pos: new THREE.Vector3(-20, 7, 19), target: new THREE.Vector3(-21.5, 1.3, 35.2), fov: 42 },
  top: { pos: new THREE.Vector3(0, 16, 0.01), target: new THREE.Vector3(0, 0, 0), fov: 34 }
};

let cameraAnim = null;
function transitionToView(view) {
  state.view = view;
  document.querySelectorAll('#viewToggle button').forEach(b => {
    b.classList.toggle('active', b.dataset.view === view);
  });
  
  document.getElementById('floorplanOverlay').classList.toggle('show', view === 'top');
  // Explicitly hide the floor-plan labels the instant we leave Floor Plan
  // (rather than only gating their position updates in the tick loop) so
  // no stale label is left visibly floating over the 3D/City views during
  // or after the camera-easing transition below.
  if (view !== 'top') {
    fpWidthLabel.style.display = 'none';
    fpDepthLabel.style.display = 'none';
    fpRoomNameLabel.style.display = 'none';
  }
  updateBreadcrumb();
  
  const target = cameraViews[view];
  const startPos = camera.position.clone();
  const startTarget = controls.target.clone();
  const startFov = camera.fov;
  const duration = 1100;
  const startTime = performance.now();
  controls.enabled = false;
  cameraTransitionActive = true;
  
  function animate() {
    const t = Math.min(1, (performance.now() - startTime) / duration);
    const eased = t < 0.5 ? 2*t*t : 1 - Math.pow(-2*t+2, 2)/2;
    camera.position.lerpVectors(startPos, target.pos, eased);
    controls.target.lerpVectors(startTarget, target.target, eased);
    camera.fov = startFov + (target.fov - startFov) * eased;
    camera.updateProjectionMatrix();
    controls.update();
    if (t < 1) cameraAnim = requestAnimationFrame(animate);
    else { controls.enabled = true; cameraTransitionActive = false; cameraAnim = null; }
  }
  if (cameraAnim) cancelAnimationFrame(cameraAnim);
  animate();
}

function setCityScale(scale) {
  const view = scale === 'city' ? 'city' : scale === 'district' ? 'district' : scale === 'street' ? 'street' : 'perspective';
  state.cityScale = scale;
  state.cityBuildMode = false;
  const showInterior = scale === 'interior';
  roomGroup.visible = showInterior;
  state.placedItems.forEach(item => { item.mesh.visible = showInterior; });
  if (ghostItem) ghostItem.visible = showInterior;
  if (selectionRing) selectionRing.visible = showInterior && !!state.activeItem;
  outlinePass.selectedObjects = (showInterior && state.activeItem) ? [state.activeItem.mesh] : [];
  if (egressGroup) egressGroup.visible = showInterior;
  scene.fog.near = scale === 'city' ? 86 : scale === 'district' ? 54 : 26;
  scene.fog.far = scale === 'city' ? 260 : scale === 'district' ? 170 : 82;
  document.getElementById('cityBuildBtn').classList.remove('active');
  transitionToView(view);
  const label = scale === 'interior' ? 'INTERIOR / 40MM' : scale === 'city' ? 'CITY / 4.2KM' : scale === 'district' ? 'DISTRICT / 800M' : 'STREET / 120M';
  document.getElementById('viewportReadout').innerHTML = `<b>CAM</b> · ${label}`;
  document.querySelectorAll('[data-city-scale]').forEach(button => button.classList.toggle('active', button.dataset.cityScale === scale));
  updateCityInterface();
  bus.emit('scale', { scale });
}

function focusDistrict(id) {
  const district = CITY_DISTRICTS.find(item => item.id === id);
  if (!district) return;
  state.cityScale = 'district';
  roomGroup.visible = false;
  state.placedItems.forEach(item => { item.mesh.visible = false; });
  if (ghostItem) ghostItem.visible = false;
  if (selectionRing) selectionRing.visible = false;
  outlinePass.selectedObjects = [];
  if (egressGroup) egressGroup.visible = false;
  scene.fog.near = 54;
  scene.fog.far = 170;
  // Pulled back from the original (+31,33,+31) offset: with the tallest
  // possible landmark (Civic Core's 8-floor ZKR Civic Exchange, the tallest
  // landmark of any district) on the same side as the camera, the tighter
  // offset let that building loom over most of the frame and crop the
  // plaza/flank composition — confirmed by rendering the actual scene from
  // this exact camera and comparing all four districts side by side, not
  // assumed. The wider, higher offset below keeps every district framed the
  // same relative way (so nothing about the "district" view's character
  // changes) while giving enough clearance that even the tallest landmark
  // no longer dominates the shot; re-rendered all four districts afterward
  // to confirm the improvement and that none of the other three regressed.
  cameraViews.district = { pos: new THREE.Vector3(district.center[0] + 40, 42, district.center[1] + 40), target: new THREE.Vector3(district.center[0], 0, district.center[1]), fov: 44 };
  transitionToView('district');
  document.getElementById('viewportReadout').innerHTML = `<b>CAM</b> · ${district.code} / DISTRICT`;
  document.querySelectorAll('.district-chip').forEach(button => button.classList.toggle('active', button.dataset.district === id));
  document.querySelectorAll('[data-city-scale]').forEach(button => button.classList.toggle('active', button.dataset.cityScale === 'district'));
  updateCityInterface();
  showToast(`${district.name} in focus`, 'fa-map-location-dot');
}

document.querySelectorAll('#viewToggle button').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.dataset.view === 'city') return setCityScale('city');
    if (btn.dataset.view === 'perspective') return setCityScale('interior');
    state.cityScale = 'interior';
    state.cityBuildMode = false;
    roomGroup.visible = true;
    state.placedItems.forEach(item => { item.mesh.visible = true; });
    if (egressGroup) egressGroup.visible = true;
    scene.fog.near = 26; scene.fog.far = 82;
    document.getElementById('viewportReadout').innerHTML = '<b>CAM</b> · PLAN / 1:100';
    document.querySelectorAll('[data-city-scale]').forEach(button => button.classList.remove('active'));
    updateCityInterface();
    transitionToView('top');
  });
});

// ========== CITY TOGGLE ==========
document.getElementById('cityToggle').addEventListener('click', () => {
  state.cityVisible = !state.cityVisible;
  document.getElementById('cityToggleSwitch').classList.toggle('on', state.cityVisible);
  setCityVisible(state.cityVisible);
  showToast(state.cityVisible ? 'City environment shown' : 'City environment hidden', 'fa-city');
});

document.querySelectorAll('[data-city-scale]').forEach(button => button.addEventListener('click', () => setCityScale(button.dataset.cityScale)));
document.getElementById('cityBuildBtn').addEventListener('click', () => {
  const enableBuild = !state.cityBuildMode;
  state.cityBuildMode = enableBuild;
  if (enableBuild) {
    // Only advance the build type when actually arming construction mode —
    // previously this cycled even on the click that closed the panel, silently
    // changing what would be built next time with no feedback to the user.
    state.cityBuildType = state.cityBuildType === 'mixedUse' ? 'residence' : state.cityBuildType === 'residence' ? 'civic' : state.cityBuildType === 'civic' ? 'market' : 'mixedUse';
    setCityScale('city');
    state.cityBuildMode = true;
  }
  document.getElementById('cityBuildBtn').classList.toggle('active', enableBuild);
  cityBuildPlots.forEach(plot => { if (!plot.occupied) { plot.mesh.visible = true; plot.outline.visible = true; } });
  showToast(enableBuild ? `${CITY_BUILD_CATALOG[state.cityBuildType].label} armed — select a build plot` : 'Construction mode closed', 'fa-compass-drafting');
});
document.getElementById('cityPhase').addEventListener('click', () => {
  state.cityTime = state.cityTime >= 18.5 ? 10.5 : 20.5;
  updateCityInterface();
  showToast(state.cityTime >= 18.5 ? 'Night cycle advanced' : 'Day cycle advanced', 'fa-moon');
});

// ========== COST PANEL ==========
// ========== FOCUS MANAGEMENT FOR OVERLAYS (dialog & drawer a11y) ==========
// Generic helper: moves focus into an overlay when it opens, restores it to whatever
// triggered the open when it closes, and traps Tab within the overlay while open.
function getFocusable(container) {
  return [...container.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
    .filter(el => el.offsetParent !== null);
}
let lastFocusedBeforeOverlay = null;
function openOverlayFocus(container) {
  lastFocusedBeforeOverlay = document.activeElement;
  const focusables = getFocusable(container);
  if (focusables.length) focusables[0].focus();
}
function closeOverlayFocus() {
  if (lastFocusedBeforeOverlay && document.body.contains(lastFocusedBeforeOverlay)) {
    lastFocusedBeforeOverlay.focus();
  }
  lastFocusedBeforeOverlay = null;
}
function trapTabKey(container, e) {
  const focusables = getFocusable(container);
  if (!focusables.length) return;
  const first = focusables[0], last = focusables[focusables.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}
const costPanelEl = document.getElementById('costPanel');
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Tab') return;
  if (exportModal.classList.contains('open')) trapTabKey(exportModal, e);
  else if (state.costPanelOpen) trapTabKey(costPanelEl, e);
});

function toggleCostPanel() {
  const willOpen = !state.costPanelOpen;
  state.costPanelOpen = willOpen;
  costPanelEl.classList.toggle('open', willOpen);
  if (willOpen) {
    updateCostPanel(state.placedItems.reduce((s,i) => s+i.price, 0));
    openOverlayFocus(costPanelEl);
  } else {
    closeOverlayFocus();
  }
}
document.getElementById('costBtn').addEventListener('click', toggleCostPanel);
document.getElementById('openCostBtn').addEventListener('click', toggleCostPanel);
document.getElementById('closeCost').addEventListener('click', toggleCostPanel);

// ========== TOOLBAR ==========
document.getElementById('fireSafetyBtn').addEventListener('click', toggleFireSafety);
document.getElementById('clearBtn').addEventListener('click', () => clearAll());

document.getElementById('zoomIn').addEventListener('click', () => dollyCamera(0.85));
document.getElementById('zoomOut').addEventListener('click', () => dollyCamera(1.15));
document.getElementById('resetView').addEventListener('click', () => setCityScale('interior'));
document.getElementById('rotateLeft').addEventListener('click', () => rotateSelected(-Math.PI/4));
document.getElementById('rotateRight').addEventListener('click', () => rotateSelected(Math.PI/4));

// ---------- Icon rail ----------
document.getElementById('gridToggleBtn')?.addEventListener('click', () => toggleGrid());
document.getElementById('measureToggleBtn')?.addEventListener('click', () => ws.ctx.measure.toggle());
document.getElementById('railLayersBtn')?.addEventListener('click', () => {
  document.getElementById('rightRailCollapse')?.click();
});
document.getElementById('railCostRailBtn')?.addEventListener('click', () => toggleCostPanel());
document.getElementById('postFxToggleBtn')?.addEventListener('click', () => {
  setPostFX(!state.postFX);
  showToast(state.postFX ? 'Realistic rendering on (SSAO + bloom)' : 'Realistic rendering off — faster, flatter shading', state.postFX ? 'fa-sparkles' : 'fa-bolt');
});
document.getElementById('firstPersonBtn')?.addEventListener('click', () => {
  if (state.firstPerson) exitFirstPerson();
  else enterFirstPerson();
});
document.getElementById('railCatalogBtn')?.addEventListener('click', () => {
  const leftPanel = document.getElementById('leftPanel');
  if (leftPanel && leftPanel.classList.contains('rail-collapsed')) {
    document.getElementById('leftRailCollapse')?.click();
  }
});
document.getElementById('railHelpBtn')?.addEventListener('click', openHelpModal);

// Top-bar utility cluster (added for the reference-aligned redesign) —
// these are alternate entry points to the exact same existing handlers,
// not new logic. Clicking the real rail button keeps every existing
// listener, state toggle, and aria-attribute update intact.
document.getElementById('topbarLayersBtn')?.addEventListener('click', () => document.getElementById('railLayersBtn')?.click());
document.getElementById('topbarHelpBtn')?.addEventListener('click', openHelpModal);
document.getElementById('topbarFullscreenBtn')?.addEventListener('click', () => {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen?.().catch(() => showToast('Fullscreen not available in this browser', 'fa-triangle-exclamation'));
  } else {
    document.exitFullscreen?.();
  }
});
document.addEventListener('fullscreenchange', () => {
  const btn = document.getElementById('topbarFullscreenBtn');
  const icon = btn?.querySelector('i');
  if (icon) icon.className = document.fullscreenElement ? 'fa-solid fa-compress' : 'fa-solid fa-expand';
});

// ---------- Keyboard shortcuts help modal ----------
const helpModalEl = document.getElementById('helpModal');
function openHelpModal() { helpModalEl.classList.add('open'); }
function closeHelpModal() { helpModalEl.classList.remove('open'); }
document.getElementById('closeHelp')?.addEventListener('click', closeHelpModal);
helpModalEl?.addEventListener('click', (e) => { if (e.target === helpModalEl) closeHelpModal(); });

// ---------- Floating context toolbar (Move / Rotate / Duplicate / Delete) ----------
const contextToolbarEl = document.getElementById('contextToolbar');
document.getElementById('ctxMove')?.addEventListener('click', () => {
  if (moveArmed) { disarmMove(); } else { armMoveSelected(); }
  updateContextToolbarState();
});
document.getElementById('ctxRotate')?.addEventListener('click', () => rotateSelected(Math.PI / 4));
document.getElementById('ctxDuplicate')?.addEventListener('click', () => duplicateActiveItem());
document.getElementById('ctxDelete')?.addEventListener('click', () => {
  if (state.activeItem) removePlacedItem(state.activeItem);
});
function updateContextToolbarState() {
  document.getElementById('ctxMove')?.classList.toggle('active', moveArmed);
}
// Dimension readout — a small floating label showing the selected item's
// real footprint, reusing the exact footprintRadius already used by the
// collision system (see checkCollision/occupiedArea above) so the number
// on screen always matches the number collision actually checks against,
// never a separately-invented display value.
const dimensionLabelEl = document.getElementById('dimensionLabel');
function updateDimensionLabel() {
  if (!dimensionLabelEl) return;
  if (!state.activeItem || state.cityScale !== 'interior') {
    dimensionLabelEl.classList.remove('visible');
    return;
  }
  // Real footprint (width × depth) from the item's own geometry; falls back
  // to the collision diameter only if an item somehow has no dims.
  const dm = state.activeItem.dims;
  dimensionLabelEl.textContent = dm
    ? `${dm.w.toFixed(2)} × ${dm.d.toFixed(2)} m`
    : `⌀ ${((state.activeItem.footprintRadius || 0.4) * 2).toFixed(1)}m`;
  dimensionLabelEl.classList.add('visible');
}
// Screen-position the floating toolbar above whatever's selected, each frame,
// so it tracks correctly through orbit/zoom/pan without any extra bookkeeping.
function updateContextToolbarPosition() {
  if (!contextToolbarEl) return;
  if (!state.activeItem || state.cityScale !== 'interior') {
    contextToolbarEl.classList.remove('visible');
    if (dimensionLabelEl) dimensionLabelEl.classList.remove('visible');
    return;
  }
  const item = state.activeItem;
  const radius = item.footprintRadius || 0.4;
  const worldPoint = new THREE.Vector3(item.position.x, radius * 0.6 + 0.35, item.position.z);
  const proj = worldPoint.clone().project(camera);
  if (proj.z > 1) { contextToolbarEl.classList.remove('visible'); if (dimensionLabelEl) dimensionLabelEl.classList.remove('visible'); return; }
  const rect = renderer.domElement.getBoundingClientRect();
  const sx = rect.left + (proj.x * 0.5 + 0.5) * rect.width;
  const sy = rect.top + (-proj.y * 0.5 + 0.5) * rect.height;
  contextToolbarEl.style.left = sx + 'px';
  contextToolbarEl.style.top = sy + 'px';
  contextToolbarEl.classList.add('visible');
  updateContextToolbarState();
  // Ground-level point (not the raised toolbar anchor) so the dimension
  // label reads at the base of the object, like a real plan annotation.
  const groundPoint = new THREE.Vector3(item.position.x, 0.02, item.position.z + radius + 0.25);
  const gproj = groundPoint.clone().project(camera);
  if (dimensionLabelEl && gproj.z <= 1) {
    const gx = rect.left + (gproj.x * 0.5 + 0.5) * rect.width;
    const gy = rect.top + (-gproj.y * 0.5 + 0.5) * rect.height;
    dimensionLabelEl.style.left = gx + 'px';
    dimensionLabelEl.style.top = gy + 'px';
  }
  updateDimensionLabel();
}

// Double-click a placed item to select and fly the camera to it — the
// fastest path to "focus selected" without adding a fifth toolbar button.
container.addEventListener('dblclick', (e) => {
  if (state.selectedItem || state.cityBuildMode) return;
  const found = getPlacedIntersection(e);
  if (found) { setActiveItem(found); focusSelected(); }
});

function rotateSelected(angle) {
  const item = state.activeItem || state.placedItems[state.placedItems.length - 1];
  if (!item) return;
  const prevRotation = item.rotation;
  item.rotation += angle;
  item.mesh.rotation.y = item.rotation;
  if (selectionRing && state.activeItem && state.activeItem.id === item.id) {
    selectionRing.position.set(item.position.x, 0.015, item.position.z);
  }
  if (!suppressHistory) pushHistory({ action: 'rotate', id: item.id, from: prevRotation, to: item.rotation });
  updateStats();
  bus.emit('itemchange', { item });
  showToast(`Rotated ${item.name}`, 'fa-rotate');
}

// ========== MOBILE PANEL DRAWERS ==========
// Below 900px the side panels become slide-in drawers instead of vanishing entirely,
// so furniture placement, templates, capacity, and costing all stay reachable on phones/tablets.
const leftPanelEl = document.getElementById('leftPanel');
const rightPanelEl = document.getElementById('rightPanel');
const leftPanelToggle = document.getElementById('leftPanelToggle');
const rightPanelToggle = document.getElementById('rightPanelToggle');
const panelScrim = document.getElementById('panelScrim');

function setPanelOpen(panelEl, toggleEl, open) {
  panelEl.classList.toggle('open', open);
  toggleEl.setAttribute('aria-expanded', String(open));
  const anyOpen = leftPanelEl.classList.contains('open') || rightPanelEl.classList.contains('open');
  panelScrim.classList.toggle('show', anyOpen);
  if (open) {
    const firstFocusable = panelEl.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (firstFocusable) firstFocusable.focus();
  }
}

leftPanelToggle.addEventListener('click', () => {
  const willOpen = !leftPanelEl.classList.contains('open');
  if (willOpen) setPanelOpen(rightPanelEl, rightPanelToggle, false);
  setPanelOpen(leftPanelEl, leftPanelToggle, willOpen);
});
rightPanelToggle.addEventListener('click', () => {
  const willOpen = !rightPanelEl.classList.contains('open');
  if (willOpen) setPanelOpen(leftPanelEl, leftPanelToggle, false);
  setPanelOpen(rightPanelEl, rightPanelToggle, willOpen);
});
panelScrim.addEventListener('click', () => {
  setPanelOpen(leftPanelEl, leftPanelToggle, false);
  setPanelOpen(rightPanelEl, rightPanelToggle, false);
});
window.matchMedia('(max-width: 900px)').addEventListener('change', (e) => {
  if (!e.matches) {
    // Returning to desktop width — clear mobile drawer state so panels render statically again.
    leftPanelEl.classList.remove('open');
    rightPanelEl.classList.remove('open');
    panelScrim.classList.remove('show');
    leftPanelToggle.setAttribute('aria-expanded', 'false');
    rightPanelToggle.setAttribute('aria-expanded', 'false');
  }
});

// ========== RESIZE ==========
window.addEventListener('resize', () => {
  const w = container.clientWidth;
  const h = container.clientHeight;
  if (w === 0 || h === 0) return; // avoid NaN aspect / zero-size renderer during layout transitions
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  composer.setSize(w, h);
  ssaoPass.setSize(w, h);
  outlinePass.setSize(w, h);
  bloomPass.setSize(w, h);
});

// ========== ANIMATION LOOP ==========
let lastTime = performance.now();
const _UP_AXIS = new THREE.Vector3(0, 1, 0); // reused each frame to avoid per-arrow GC churn
function tick(now) {
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;
  const t = now * 0.001;
  checkAdaptivePerformance(dt);
  updateFirstPersonMovement(dt);
  
  // Egress arrows
  if (egressArrows.length > 0) {
    egressArrows.forEach(arrow => {
      arrow.userData.phase = (arrow.userData.phase + dt * 0.35) % 1;
      const pos = arrow.userData.curve.getPoint(arrow.userData.phase);
      const tangent = arrow.userData.curve.getTangent(arrow.userData.phase).normalize();
      arrow.position.copy(pos);
      arrow.position.y = 0.1;
      arrow.quaternion.setFromUnitVectors(_UP_AXIS, tangent);
      const fade = Math.sin(arrow.userData.phase * Math.PI);
      arrow.material.opacity = 0.4 + fade * 0.6;
      arrow.material.transparent = true;
    });
  }
  if (egressGroup && egressGroup.visible) {
    egressGroup.traverse(c => {
      if (c.userData.pulseRing) {
        const s = 1 + Math.sin(t * 2) * 0.15;
        c.scale.set(s, s, 1);
        c.material.opacity = 0.4 + Math.sin(t * 2) * 0.2;
      }
    });
  }

  // Measurement / spatial-overlay DOM labels follow their 3D anchors
  workspaceFrame();

  // Floor Plan room/dimension labels — true early-return inside the
  // function itself when not in Floor Plan view, so this costs nothing
  // (no DOM writes at all) in the 3D/City views.
  updateFloorPlanLabels();

  // Selection ring pulse
  if (selectionRing && selectionRing.visible) {
    const s = 1 + Math.sin(t * 4) * 0.06;
    selectionRing.scale.set(s, s, 1);
  }

  if (state.cityVisible) {
    if (state.timeAuto) state.cityTime = (state.cityTime + dt * 0.16) % 24;
    const daylight = Math.max(0.04, Math.sin(((state.cityTime - 6) / 12) * Math.PI));
    const night = daylight < 0.18;
    ambient.intensity = (night ? 0.27 : 0.14) + daylight * 0.48;
    hemiLight.intensity = (night ? 0.22 : 0.12) + daylight * 0.38;
    sunLight.intensity = (night ? 0.22 : 0.15) + daylight * 0.98;
    sunLight.position.set(24 * Math.cos(state.cityTime * 0.26), 8 + daylight * 18, 18 * Math.sin(state.cityTime * 0.26));
    scene.fog.color.set(night ? 0x101B2C : 0xEFE7D6);
    skyDome.material.uniforms.topColor.value.set(night ? 0x101B2C : 0xBFD4E8);
    skyDome.material.uniforms.bottomColor.value.set(night ? 0x314463 : 0xF3ECDD);

    // Overcast / Blue Hour: real, distinct lighting moods layered on top of
    // the same time-based driver above rather than a second lighting
    // system. Overcast flattens contrast (diffuse fill dominates, sun
    // dimmed — genuinely different shadow character, not just a color
    // filter). Blue Hour cools the fog/sky toward blue instead of the warm
    // dusk tone the plain time-of-day curve would give at this hour.
    if (!state.timeAuto && state.lightPreset === 'overcast') {
      sunLight.intensity *= 0.35;
      ambient.intensity *= 1.55;
      hemiLight.intensity *= 1.35;
      scene.fog.color.set(0xB9BEC4);
      skyDome.material.uniforms.topColor.value.set(0x9AA3AC);
      skyDome.material.uniforms.bottomColor.value.set(0xC7CBCE);
    } else if (!state.timeAuto && state.lightPreset === 'bluehour') {
      sunLight.intensity *= 0.5;
      scene.fog.color.set(0x1E3352);
      skyDome.material.uniforms.topColor.value.set(0x16233F);
      skyDome.material.uniforms.bottomColor.value.set(0x3A5578);
    }
    // Window glow now ramps smoothly through dusk/dawn (via daylight, a
    // continuous 0→1 curve) instead of snapping at the old binary `night`
    // threshold — reads as a proper cinematic transition rather than lights
    // flicking on all at once. `emissive` itself is left neutral white
    // (set once at construction in makeBuilding) since the actual per-window
    // warm/cool tint is already baked into each building's emissiveMap —
    // touching `.emissive` here would flatten every window to one color and
    // undo that variation.
    const windowGlow = 1 - THREE.MathUtils.smoothstep(daylight, 0.08, 0.34);
    cityWindowMaterials.forEach(mat => { mat.emissiveIntensity = 0.03 + windowGlow * 1.15; });
    // Trees sway gently
    trees.forEach(tr => {
      const sway = Math.sin(t * 0.8 + tr.userData.swayPhase) * 0.04;
      tr.userData.canopy.rotation.z = sway;
      tr.userData.canopy.rotation.x = Math.cos(t * 0.6 + tr.userData.swayPhase) * 0.025;
    });
    // Lamps glow pulse
    lamps.forEach((l, i) => {
      l.userData.glowMat.emissiveIntensity = (night ? 1.75 : 0.28) + Math.sin(t * 1.4 + i) * 0.18;
    });
    // Cars drive along the street, looping
    cars.forEach(c => {
      c.z += c.speed * (c.speedMul || 1) * c.dir * dt * 3;
      if (c.z > 16) c.z = -16;
      if (c.z < -16) c.z = 16;
      c.mesh.position.z = c.z;
    });
    if (commercialVan.mesh.visible) {
      commercialVan.z += commercialVan.speed * commercialVan.dir * dt * 3;
      if (commercialVan.z > 16) commercialVan.z = -16;
      if (commercialVan.z < -16) commercialVan.z = 16;
      commercialVan.mesh.position.z = commercialVan.z;
    }
    // NPCs walk the sidewalk loop, with occasional natural pauses (window-shopping, waiting)
    npcs.forEach(p => {
      p.userData.pauseTimer -= dt;
      if (p.userData.pauseTimer <= 0) {
        p.userData.paused = !p.userData.paused;
        p.userData.pauseTimer = p.userData.paused ? 1.5 + Math.random() * 2.5 : 6 + Math.random() * 9;
      }
      if (!p.userData.paused) {
        p.userData.t = (p.userData.t + p.userData.speed * dt) % 1;
      }
      const pos = pathPoint(p.userData.t);
      const nextPos = pathPoint(p.userData.t + 0.01);
      p.position.set(pos.x, 0, pos.z);
      const dx = nextPos.x - pos.x, dz = nextPos.z - pos.z;
      if (Math.abs(dx) + Math.abs(dz) > 0.0001) p.rotation.y = Math.atan2(dx, dz);
      const bob = p.userData.paused ? 0 : Math.abs(Math.sin(t * 6 + p.userData.bobPhase)) * 0.03;
      p.userData.legs.scale.y = 1 - bob * 0.6;
      p.position.y = bob;
    });
    cityTraffic.forEach(vehicle => {
      vehicle.progress = (vehicle.progress + vehicle.speed * dt * (night ? 0.014 : 0.022) * vehicle.direction + 1) % 1;
      const pos = loopPathPoint(vehicle.route, vehicle.progress);
      const next = loopPathPoint(vehicle.route, vehicle.progress + 0.006 * vehicle.direction);
      vehicle.mesh.position.copy(pos);
      vehicle.mesh.rotation.y = Math.atan2(next.z - pos.z, next.x - pos.x);
    });
    cityWalkers.forEach((person, index) => {
      person.visible = !night || index % 2 === 0;
      person.userData.walkT = (person.userData.walkT + person.userData.walkSpeed * dt * (night ? 0.35 : 1)) % 1;
      const pos = loopPathPoint(person.userData.walkRoute, person.userData.walkT);
      const next = loopPathPoint(person.userData.walkRoute, person.userData.walkT + 0.01);
      person.position.set(pos.x, Math.abs(Math.sin(t * 5 + person.userData.bobPhase)) * 0.025, pos.z);
      person.rotation.y = Math.atan2(next.x - pos.x, next.z - pos.z);
      person.userData.legs.scale.y = 0.98 + Math.sin(t * 8 + index) * 0.04;
    });
    if (citySelectionHelper && citySelectionAnchor && state.selectedCityEntity) {
      // Cheap follow for a moving selection (e.g. a walking pedestrian): translate the
      // marker by how far the mesh has moved since selection, instead of rebuilding it.
      citySelectionHelper.position.copy(state.selectedCityEntity.mesh.position).sub(citySelectionAnchor);
    }
    cityHudAccumulator += dt;
    if (cityHudAccumulator > 0.75) { updateCityInterface(); cityHudAccumulator = 0; }
  }
  
  // Keep the orbit target from drifting arbitrarily far away when panning,
  // so a stray drag can't "lose" the project off in empty space.
  const maxTargetDist = state.cityScale === 'interior' ? 16 : 150;
  const targetDist = Math.hypot(controls.target.x, controls.target.z);
  if (targetDist > maxTargetDist) {
    const scale = maxTargetDist / targetDist;
    controls.target.x *= scale;
    controls.target.z *= scale;
  }

  // Floating context toolbar tracks the selected item's screen position
  updateContextToolbarPosition();

  controls.update();
  if (!webglContextLost) {
    if (state.postFX) composer.render(); else renderer.render(scene, camera);
  }
  requestAnimationFrame(tick);
}

// ========== TOAST ==========
const toast = document.getElementById('toast');
const toastMsg = document.getElementById('toastMsg');
const toastIcon = toast.querySelector('i');
let toastTimer;
const notificationLog = []; // real activity history, most recent first — backs the bell menu
function showToast(msg, icon = 'fa-circle-info') {
  toastMsg.textContent = msg;
  toastIcon.className = `fa-solid ${icon}`;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2400);
  notificationLog.unshift({ msg, icon, time: new Date() });
  if (notificationLog.length > 30) notificationLog.length = 30;
  renderNotifications();
}
function formatRelativeTime(date) {
  const secs = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  if (secs < 5) return 'just now';
  if (secs < 60) return secs + 's ago';
  const mins = Math.round(secs / 60);
  if (mins < 60) return mins + 'm ago';
  const hrs = Math.round(mins / 60);
  return hrs + 'h ago';
}
function renderNotifications() {
  const list = document.getElementById('notifList');
  const dot = document.getElementById('notifDot');
  if (!list) return;
  if (notificationLog.length === 0) {
    list.innerHTML = `<div class="notif-empty">${t('notif.empty')}</div>`;
  } else {
    list.innerHTML = notificationLog.slice(0, 12).map(n => `
      <div class="notif-item">
        <i class="fa-solid ${n.icon}" aria-hidden="true"></i>
        <div>
          <div class="notif-item-text">${n.msg}</div>
          <div class="notif-item-time">${formatRelativeTime(n.time)}</div>
        </div>
      </div>
    `).join('');
  }
  if (dot) dot.hidden = document.getElementById('notifMenu')?.classList.contains('show') || notificationLog.length === 0;
}

// ========== SAVE STATUS + LOCAL PERSISTENCE ==========
// Honest disclosure: there is no backend. "Saved" means the project is
// written to this browser's localStorage (survives reloads on this device/
// browser only) — not synced anywhere. That's communicated via the
// save-status tooltip in the HTML rather than implied falsely.
const STORAGE_KEY = 'zkr-atelier-session-v1';
let saveStatusTimer, persistTimer;
function flashSaveStatus() {
  const el = document.getElementById('saveStatus');
  const text = document.getElementById('saveStatusText');
  if (el && text) {
    el.classList.add('saving');
    text.textContent = t('save.saving');
  }
  clearTimeout(saveStatusTimer);
  saveStatusTimer = setTimeout(() => {
    if (el) el.classList.remove('saving');
    if (text) text.textContent = t('save.saved');
  }, 550);
  // Debounce the actual write so rapid actions (e.g. dragging) don't thrash
  // localStorage on every frame-level mutation.
  clearTimeout(persistTimer);
  persistTimer = setTimeout(saveProjectToStorage, 500);
}
function saveProjectToStorage() {
  try {
    const nameEl = document.getElementById('projectName');
    const data = {
      projectName: nameEl ? nameEl.textContent.trim() : 'Untitled Project',
      template: state.template,
      brandColor: state.brandColor,
      lang: state.lang,
      items: state.placedItems.map(snapshotItem),
      measurements: ws.ctx?.measure.serialize() || state.pendingMeasurements || [],
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    // Private-browsing / storage-disabled: fail silently, in-session state still works fine.
    console.warn('ZKR Atelier: could not persist session locally', e);
  }
}
function loadProjectFromStorage() {
  let data;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    data = JSON.parse(raw);
  } catch (e) {
    console.warn('ZKR Atelier: saved session was unreadable, starting fresh', e);
    return false;
  }
  if (!data || !TEMPLATES[data.template]) return false;
  loadTemplate(data.template);       // rebuilds correct walls/shell/signage for that template
  clearAll({ skipHistory: true, silent: true }); // then remove its default curated furniture set
  if (Array.isArray(data.items)) {
    suppressHistory = true;
    data.items.forEach(it => {
      if (ITEM_CATALOG[it.type]) {
        placeItem(it.type, { x: it.x, z: it.z }, it.rotation || 0, { id: it.id, skipAnim: true, skipBoundaryCheck: true });
      }
    });
    suppressHistory = false;
  }
  const nameEl = document.getElementById('projectName');
  if (nameEl && data.projectName) nameEl.textContent = data.projectName;
  if (data.brandColor) {
    document.getElementById('brandColor').value = data.brandColor;
    setBrandColor(data.brandColor);
  }
  if (data.lang && I18N[data.lang]) applyLanguage(data.lang, { silent: true });
  state.pendingMeasurements = Array.isArray(data.measurements) ? data.measurements : []; // restored once the measure tool exists
  updateStats();
  bus.emit('baseline');
  return true;
}

// ========== KEYBOARD ==========
window.addEventListener('keydown', (e) => {
  // (contenteditable added: typing a project name must not fire shortcuts)
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT' || e.target.isContentEditable) return;
  if (e.key !== 'Escape' && ws.mode !== 'design') {
    const mod = e.ctrlKey || e.metaKey;
    const editing = (mod && /^[zydZYD]$/.test(e.key)) || e.key === 'Delete' || e.key === 'Backspace' || (!mod && !e.altKey && /^[\[\]rR1-9]$/.test(e.key));
    if (editing) { e.preventDefault(); showToast('Switch to Design mode to edit the layout', 'fa-pen-ruler'); return; }
  }
  if (e.key === 'Escape') {
    // Escape closes whatever's on top first: export modal, then cost panel, then deselects.
    if (helpModalEl.classList.contains('open')) {
      closeHelpModal();
    } else if (exportModal.classList.contains('open')) {
      closeExportModal();
    } else if (state.costPanelOpen) {
      toggleCostPanel();
    } else if (leftPanelEl.classList.contains('open') || rightPanelEl.classList.contains('open')) {
      setPanelOpen(leftPanelEl, leftPanelToggle, false);
      setPanelOpen(rightPanelEl, rightPanelToggle, false);
    } else if (ws.ctx?.measure.active) {
      ws.ctx.measure.toggle(false);
    } else if (moveArmed) {
      disarmMove();
    } else if (state.selectedCityEntity) {
      deselectCityEntity();
    } else if (state.selectedItem) {
      selectItem(state.selectedItem);
    } else {
      deselectActiveItem();
    }
  } else if ((e.key === 'z' || e.key === 'Z') && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    if (e.shiftKey) redo(); else undo();
  } else if ((e.key === 'y' || e.key === 'Y') && (e.ctrlKey || e.metaKey)) {
    e.preventDefault(); redo();
  } else if ((e.key === 'd' || e.key === 'D') && (e.ctrlKey || e.metaKey)) {
    e.preventDefault(); duplicateActiveItem();
  } else if (e.ctrlKey || e.metaKey || e.altKey) {
    // Let every other Ctrl/Cmd/Alt combo pass through untouched (browser Find, tab-switching, etc.)
    // instead of silently double-firing an app shortcut alongside it.
  } else if (e.key === 'Delete' || e.key === 'Backspace') {
    if (state.activeItem) { e.preventDefault(); removePlacedItem(state.activeItem); }
  } else if (e.key === 'v' || e.key === 'V') {
    const order = ['perspective', 'city', 'top'];
    transitionToView(order[(order.indexOf(state.view) + 1) % order.length]);
  } else if (e.key === 'f' || e.key === 'F') {
    toggleFireSafety();
  } else if (e.key === 'c' || e.key === 'C') {
    toggleCostPanel();
  } else if (e.key === '[') {
    rotateSelected(-Math.PI/4);
  } else if (e.key === ']' || e.key === 'r' || e.key === 'R') {
    rotateSelected(Math.PI/4);
  } else if (e.key === 'g' || e.key === 'G') {
    toggleGrid();
  } else if (e.key === '?') {
    openHelpModal();
  } else if (e.key >= '1' && e.key <= '9') {
    const keys = Object.keys(ITEM_CATALOG).filter(k => state.furnitureFilter === 'all' || ITEM_CATALOG[k].cat === state.furnitureFilter);
    const idx = parseInt(e.key) - 1;
    if (keys[idx]) selectItem(keys[idx]);
  }
});

// ========== EXPORT ==========
const exportModal = document.getElementById('exportModal');
const exportCanvas = document.getElementById('exportCanvas');
const exportCtx = exportCanvas.getContext('2d');

// One reference per session so the layout sheet and the report always carry the same REF.
let _exportRef = null;
function getExportRef() {
  const prefix = state.template.substring(0, 3).toUpperCase();
  if (!_exportRef || !_exportRef.startsWith(prefix + '-')) _exportRef = prefix + '-' + Math.floor(Math.random() * 9000 + 1000);
  return _exportRef;
}
function openExportModal() {
  exportModal.classList.add('open');
  document.getElementById('exportRef').textContent = getExportRef();
  runExportAnimation();
  openOverlayFocus(exportModal);
}
function closeExportModal() {
  exportModal.classList.remove('open');
  closeOverlayFocus();
}
document.getElementById('exportBtn').addEventListener('click', openExportModal);
document.getElementById('closeExport').addEventListener('click', closeExportModal);
document.getElementById('closeExport2').addEventListener('click', closeExportModal);

function runExportAnimation() {
  exportCtx.clearRect(0, 0, 920, 560);
  
  const steps = [
    'Drawing floor plan',
    'Placing furniture',
    'Adding material schedule',
    'Checking fire compliance',
    'Finalizing layout sheet'
  ];
  const stepsEl = document.getElementById('exportSteps');
  stepsEl.innerHTML = '';
  steps.forEach((s, i) => {
    const el = document.createElement('div');
    el.className = 'step-item';
    el.dataset.idx = i;
    el.innerHTML = `<div class="step-dot"><span class="text-[9px] font-mono">${i+1}</span></div><span>${s}</span>`;
    stepsEl.appendChild(el);
  });
  
  let progress = 0;
  let currentStep = -1;
  
  function animate() {
    progress = Math.min(1, progress + 0.012);
    drawExportSheet(progress);
    
    const stepIdx = Math.floor(progress * steps.length);
    if (stepIdx > currentStep && stepIdx < steps.length) {
      currentStep = stepIdx;
      const el = stepsEl.children[currentStep - 1];
      if (el) {
        el.classList.add('done');
        el.querySelector('.step-dot').innerHTML = '<i class="fa-solid fa-check text-[9px]"></i>';
      }
    }
    
    if (progress < 1) requestAnimationFrame(animate);
    else {
      [...stepsEl.children].forEach(el => {
        el.classList.add('done');
        el.querySelector('.step-dot').innerHTML = '<i class="fa-solid fa-check text-[9px]"></i>';
      });
    }
  }
  animate();
}

function drawExportSheet(progress) {
  const ctx = exportCtx;
  const W = 920, H = 560;
  ctx.clearRect(0, 0, W, H);
  
  ctx.fillStyle = '#F5F1EA';
  ctx.fillRect(0, 0, W, H);
  
  ctx.strokeStyle = 'rgba(31, 58, 95, 0.06)';
  ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 20) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 0; y < H; y += 20) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  ctx.strokeStyle = 'rgba(31, 58, 95, 0.12)';
  for (let x = 0; x < W; x += 100) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 0; y < H; y += 100) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  
  ctx.fillStyle = '#2A2826';
  ctx.fillRect(0, 0, W, 36);
  ctx.fillStyle = '#F5F1EA';
  ctx.font = "bold 13px 'Manrope', sans-serif";
  ctx.fillText('ZKR ATELIER · LAYOUT SHEET', 18, 23);
  ctx.font = '11px JetBrains Mono, monospace';
  ctx.fillText(TEMPLATES[state.template].label.toUpperCase() + ' · ' + new Date().toLocaleDateString(), 200, 23);
  ctx.fillText('SHEET 01 / 04', W - 110, 23);
  
  const planX = 50, planY = 70, planW = 560, planH = 420;
  
  ctx.strokeStyle = '#2A2826';
  ctx.lineWidth = 3;
  ctx.strokeRect(planX, planY, planW, planH);
  
  ctx.fillStyle = '#F5F1EA';
  ctx.fillRect(planX + planW - 2, planY + planH * 0.7, 4, 60);
  ctx.strokeStyle = state.brandColor;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(planX + planW, planY + planH * 0.7 + 60, 30, Math.PI/2, Math.PI);
  ctx.stroke();
  
  ctx.fillStyle = '#F5F1EA';
  ctx.fillRect(planX + planW * 0.18, planY - 2, 130, 4);
  ctx.fillRect(planX + planW * 0.55, planY - 2, 110, 4);
  ctx.strokeStyle = '#1F3A5F';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(planX + planW * 0.18, planY); ctx.lineTo(planX + planW * 0.18 + 130, planY);
  ctx.moveTo(planX + planW * 0.55, planY); ctx.lineTo(planX + planW * 0.55 + 110, planY);
  ctx.stroke();
  
  ctx.strokeStyle = '#1F3A5F';
  ctx.fillStyle = '#1F3A5F';
  ctx.lineWidth = 1;
  ctx.font = '10px JetBrains Mono, monospace';
  ctx.beginPath();
  ctx.moveTo(planX, planY - 18); ctx.lineTo(planX + planW, planY - 18);
  ctx.stroke();
  for (let i = 0; i <= 4; i++) {
    const x = planX + (planW / 4) * i;
    ctx.beginPath(); ctx.moveTo(x, planY - 22); ctx.lineTo(x, planY - 14); ctx.stroke();
  }
  ctx.textAlign = 'center';
  ctx.fillText('12.0 m', planX + planW/2, planY - 26);
  ctx.beginPath();
  ctx.moveTo(planX - 18, planY); ctx.lineTo(planX - 18, planY + planH);
  ctx.stroke();
  for (let i = 0; i <= 4; i++) {
    const y = planY + (planH / 4) * i;
    ctx.beginPath(); ctx.moveTo(planX - 22, y); ctx.lineTo(planX - 14, y); ctx.stroke();
  }
  ctx.save();
  ctx.translate(planX - 30, planY + planH/2);
  ctx.rotate(-Math.PI/2);
  ctx.fillText('10.0 m', 0, 0);
  ctx.restore();
  ctx.textAlign = 'left';
  
  const visibleCount = Math.floor(state.placedItems.length * Math.min(1, progress * 1.5));
  state.placedItems.slice(0, visibleCount).forEach(item => {
    const px = planX + ((item.position.x + 6) / 12) * planW;
    const py = planY + ((item.position.z + 5) / 10) * planH;
    
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(item.rotation);
    
    const isSeat = ITEM_CATALOG[item.type].seats > 0;
    ctx.fillStyle = isSeat ? state.brandColor : '#2A2826';
    
    if (item.type === 'round_table' || item.type === 'oval_table') {
      ctx.beginPath(); ctx.arc(0, 0, 12, 0, Math.PI*2); ctx.fill();
      ctx.strokeStyle = '#2A2826'; ctx.lineWidth = 1; ctx.stroke();
    } else if (item.type === 'rect_table' || item.type === 'desk' || item.type === 'bed') {
      ctx.fillRect(-18, -10, 36, 20);
      ctx.strokeStyle = '#2A2826'; ctx.lineWidth = 1; ctx.strokeRect(-18, -10, 36, 20);
    } else if (item.type === 'chair' || item.type === 'accent_chair' || item.type === 'armchair') {
      ctx.fillRect(-5, -5, 10, 10);
    } else if (item.type === 'stool') {
      ctx.beginPath(); ctx.arc(0, 0, 5, 0, Math.PI*2); ctx.fill();
    } else if (item.type === 'sofa') {
      ctx.fillRect(-20, -8, 40, 16);
    } else if (item.type === 'counter' || item.type === 'reception') {
      ctx.fillRect(-30, -8, 60, 16);
      ctx.fillStyle = state.brandColor;
      ctx.fillRect(-30, -8, 60, 2);
    } else if (item.type === 'shelf' || item.type === 'bookshelf') {
      ctx.fillRect(-10, -4, 20, 8);
      ctx.fillStyle = state.brandColor;
      ctx.fillRect(-10, -4, 20, 1);
    } else if (item.type === 'rack') {
      ctx.strokeStyle = '#2A2826'; ctx.lineWidth = 1.5;
      ctx.strokeRect(-10, -4, 20, 8);
      ctx.fillStyle = state.brandColor;
      ctx.fillRect(-8, -2, 4, 4); ctx.fillRect(-2, -2, 4, 4);
      ctx.fillRect(4, -2, 4, 4);
    } else if (item.type === 'plant' || item.type === 'out_planter') {
      ctx.beginPath(); ctx.arc(0, 0, 6, 0, Math.PI*2);
      ctx.fillStyle = '#4A6741'; ctx.fill();
    } else if (item.type === 'pendant') {
      ctx.strokeStyle = '#2A2826'; ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(0, -3); ctx.lineTo(0, 3);
      ctx.stroke();
      ctx.fillStyle = state.brandColor;
      ctx.beginPath(); ctx.arc(0, 3, 3, 0, Math.PI*2); ctx.fill();
    } else if (item.type === 'pedestal' || item.type === 'column') {
      ctx.strokeStyle = '#2A2826'; ctx.lineWidth = 1.5;
      ctx.strokeRect(-6, -6, 12, 12);
    } else if (item.type === 'partition') {
      ctx.strokeStyle = state.brandColor; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-14, 0); ctx.lineTo(14, 0); ctx.stroke();
    } else if (item.type === 'rug') {
      ctx.strokeStyle = state.brandColor; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(0, 0, 10, 0, Math.PI*2); ctx.stroke();
    } else if (item.type === 'painting') {
      ctx.strokeStyle = '#2A2826'; ctx.lineWidth = 1.5;
      ctx.strokeRect(-6, -8, 12, 16);
    } else if (item.type === 'out_bench') {
      ctx.fillRect(-14, -4, 28, 8);
    } else if (item.type === 'out_table') {
      ctx.beginPath(); ctx.arc(0, 0, 9, 0, Math.PI*2); ctx.fill();
      ctx.strokeStyle = state.brandColor; ctx.lineWidth = 1.5; ctx.stroke();
    }
    ctx.restore();
  });
  
  if (progress > 0.55) {
    const alpha = Math.min(1, (progress - 0.55) * 2.5);
    ctx.globalAlpha = alpha;
    
    const infoX = 660, infoY = 70;
    
    ctx.strokeStyle = '#2A2826';
    ctx.lineWidth = 2;
    ctx.strokeRect(infoX, infoY, 230, 220);
    
    ctx.fillStyle = '#2A2826';
    ctx.fillRect(infoX, infoY, 230, 26);
    ctx.fillStyle = '#F5F1EA';
    ctx.font = "bold 11px 'Manrope', sans-serif";
    ctx.fillText('SCHEDULE', infoX + 12, infoY + 17);
    
    const seats = state.placedItems.reduce((s,i) => s+i.seats, 0);
    const total = state.placedItems.reduce((s,i) => s+i.price, 0);
    const totalWithFees = Math.round(total * 1.2);
    
    ctx.font = "11px 'Manrope', sans-serif";
    const rows = [
      ['Floor area', state.roomArea + ' m²'],
      ['Items', state.placedItems.length + ''],
      ['Seats', seats + ''],
      ['Density', (seats/state.roomArea).toFixed(2) + ' /m²'],
      ['Fire egress', seats > state.maxCapacity ? 'OVER LIMIT' : 'OK'],
      ['Subtotal', '$' + total.toLocaleString()],
      ['+ delivery', '$' + Math.round(total*0.12).toLocaleString()],
      ['Total', '$' + totalWithFees.toLocaleString()],
    ];
    rows.forEach((r, i) => {
      const y = infoY + 48 + i * 20;
      ctx.fillStyle = '#6B6863';
      ctx.fillText(r[0], infoX + 12, y);
      ctx.fillStyle = '#2A2826';
      ctx.font = 'bold 11px JetBrains Mono, monospace';
      ctx.textAlign = 'right';
      ctx.fillText(r[1], infoX + 218, y);
      ctx.font = "11px 'Manrope', sans-serif";
      ctx.textAlign = 'left';
    });
    
    ctx.fillStyle = state.brandColor;
    ctx.fillRect(infoX, infoY + 240, 230, 50);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = "bold 11px 'Manrope', sans-serif";
    ctx.fillText('BRAND COLOR', infoX + 12, infoY + 258);
    ctx.font = '11px JetBrains Mono, monospace';
    ctx.fillText(state.brandColor.toUpperCase(), infoX + 12, infoY + 278);
    
    if (progress > 0.85) {
      const stampAlpha = Math.min(1, (progress - 0.85) * 6);
      ctx.globalAlpha = alpha * stampAlpha;
      ctx.save();
      ctx.translate(infoX + 115, infoY + 360);
      ctx.rotate(-0.08);
      ctx.strokeStyle = seats > state.maxCapacity ? '#B0432E' : '#6B8E4E';
      ctx.lineWidth = 2;
      ctx.strokeRect(-70, -20, 140, 40);
      ctx.fillStyle = seats > state.maxCapacity ? '#B0432E' : '#6B8E4E';
      ctx.font = "bold 14px 'Manrope', sans-serif";
      ctx.textAlign = 'center';
      ctx.fillText(seats > state.maxCapacity ? 'REVIEW NEEDED' : 'COMPLIANT', 0, 5);
      ctx.restore();
      ctx.textAlign = 'left';
    }
    
    ctx.globalAlpha = 1;
  }
  
  ctx.strokeStyle = '#2A2826';
  ctx.fillStyle = '#2A2826';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(planX, planY + planH + 30);
  ctx.lineTo(planX + 100, planY + planH + 30);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(planX, planY + planH + 25); ctx.lineTo(planX, planY + planH + 35);
  ctx.moveTo(planX + 50, planY + planH + 28); ctx.lineTo(planX + 50, planY + planH + 32);
  ctx.moveTo(planX + 100, planY + planH + 25); ctx.lineTo(planX + 100, planY + planH + 35);
  ctx.stroke();
  ctx.font = '9px JetBrains Mono, monospace';
  ctx.fillText('0', planX - 3, planY + planH + 48);
  ctx.fillText('2 m', planX + 42, planY + planH + 48);
  ctx.fillText('4 m', planX + 92, planY + planH + 48);
  
  ctx.save();
  ctx.translate(planX + planW - 30, planY + 30);
  ctx.fillStyle = '#2A2826';
  ctx.beginPath();
  ctx.moveTo(0, -15); ctx.lineTo(5, 5); ctx.lineTo(0, 0); ctx.lineTo(-5, 5); ctx.closePath();
  ctx.fill();
  ctx.font = "bold 9px 'Manrope', sans-serif";
  ctx.textAlign = 'center';
  ctx.fillText('N', 0, -18);
  ctx.textAlign = 'left';
  ctx.restore();
  
  ctx.fillStyle = '#6B6863';
  ctx.font = '9px JetBrains Mono, monospace';
  ctx.fillText('ZKR Atelier · Generated ' + new Date().toLocaleString(), 18, H - 12);
}

// ========== DOWNLOAD ==========
document.getElementById('downloadPdf').addEventListener('click', () => {
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const imgData = exportCanvas.toDataURL('image/png');
  pdf.addImage(imgData, 'PNG', 8, 8, 281, 193);
  pdf.setFontSize(8);
  pdf.setTextColor(120, 120, 120);
  pdf.text('ZKR Atelier · ' + new Date().toLocaleString(), 8, 205);
  pdf.save(`zkr-${state.template}-layout.pdf`);
  showToast('PDF downloaded successfully', 'fa-circle-check');
  closeExportModal();
});

document.getElementById('exportCostBtn').addEventListener('click', () => {
  if (state.placedItems.length === 0) {
    showToast('Add furniture before exporting a quote', 'fa-triangle-exclamation');
    return;
  }
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const subtotal = state.placedItems.reduce((s,i) => s+i.price, 0);
  const total = Math.round(computeCostBreakdown(subtotal).total);
  
  pdf.setFillColor(245, 241, 234);
  pdf.rect(0, 0, 210, 297, 'F');
  
  pdf.setTextColor(40, 40, 40);
  pdf.setFontSize(22); pdf.setFont('helvetica', 'bold');
  pdf.text('Cost Estimate', 20, 30);
  pdf.setFontSize(10); pdf.setFont('helvetica', 'normal'); pdf.setTextColor(100, 100, 100);
  pdf.text(TEMPLATES[state.template].label.toUpperCase() + ' template · ' + new Date().toLocaleDateString(), 20, 38);
  
  pdf.setFontSize(11); pdf.setTextColor(40, 40, 40);
  let y = 55;
  pdf.setFont('helvetica', 'bold');
  pdf.text('ITEM', 20, y); pdf.text('QTY', 110, y); pdf.text('PRICE', 130, y); pdf.text('TOTAL', 170, y);
  pdf.setDrawColor(200, 200, 200); pdf.line(20, y + 2, 190, y + 2);
  y += 10;
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(10);
  
  const grouped = {};
  state.placedItems.forEach(i => {
    if (!grouped[i.type]) grouped[i.type] = { count: 0, ...i };
    grouped[i.type].count++;
  });
  Object.values(grouped).forEach(g => {
    pdf.text(g.name, 20, y);
    pdf.text(g.count + '', 115, y);
    pdf.text('$' + g.price, 130, y);
    pdf.text('$' + (g.price * g.count).toLocaleString(), 170, y);
    y += 7;
    if (y > 270) { pdf.addPage(); y = 20; }
  });
  
  y += 10;
  pdf.line(20, y, 190, y); y += 10;
  pdf.setFontSize(13); pdf.setFont('helvetica', 'bold');
  pdf.text('Total: $' + total.toLocaleString(), 130, y);
  
  pdf.save(`zkr-${state.template}-quote.pdf`);
  showToast('Quote PDF downloaded', 'fa-circle-check');
});

// ========== INIT ==========
applyLanguage('en', { silent: true });
// Sensible default quality tier from viewport width alone (a real, honest
// signal available with zero risk, unlike GPU-sniffing) — narrow viewports
// are far more likely to be lower-powered mobile/tablet hardware. The
// runtime auto-downgrade (checkAdaptivePerformance) still applies on top of
// whichever tier this picks, and the user can always override via the
// quality dropdown.
setQuality(container.clientWidth < 820 ? 'medium' : 'high', { silent: true });
setCityVisible(state.cityVisible);
const _restoredSession = loadProjectFromStorage();
if (!_restoredSession) loadTemplate('cafe');
updateBreadcrumb();
renderNotifications();

// ========== WORKSPACE LAYER (inspector, spatial overlay, modes, palette, measure, cost delta, report) ==========
// Everything in js/*.js beyond app.js reaches this file only through this
// context object: scene handles plus the existing actions it should reuse.
const workspaceFrame = initWorkspace({
  THREE, scene, camera, renderer, controls, container, outlinePass, state, ROOM_W, ROOM_D, ROOM_H,
  ITEM_CATALOG, TEMPLATES, FURNITURE_CATEGORIES,
  rightPanel: document.getElementById('rightPanel'),
  showToast, t, flashSaveStatus, computeCostBreakdown, updateBreadcrumb,
  getMouseIntersection, focusOnPoint, focusSelected,
  setActiveItem, deselectActiveItem, selectItem, disarmMove, armMoveSelected,
  setItemPositionChecked, setItemRotationRad, rotateSelected, duplicateActiveItem, removePlacedItem,
  undo, redo, historyState: () => ({ undo: undoStack.length, redo: redoStack.length }),
  setCityScale, transitionToView, toggleGrid, toggleFireSafety, toggleCostPanel, enterFirstPerson, exitFirstPerson,
  openExportModal, openHelpModal, clearIssue,
  closeDrawers: () => { setPanelOpen(leftPanelEl, leftPanelToggle, false); setPanelOpen(rightPanelEl, rightPanelToggle, false); },
  getProjectName: () => document.getElementById('projectName').textContent.trim() || 'Untitled Project',
  getExportRef,
});
ws.ctx.measure.restore(state.pendingMeasurements);
updateStats();               // first analysis → inspector, overlay, cost pill all sync
bus.emit('baseline');
// Test/inspection hook — only when the page is opened with ?debug
if (new URLSearchParams(location.search).has('debug')) window.__zkr = { state, ws, ITEM_CATALOG, TEMPLATES, loadTemplate, placeItemAt, ROOM_W, ROOM_D, bus };
setTimeout(() => setCityScale('city'), 180);
requestAnimationFrame(tick);

const WELCOME_SEEN_KEY = 'zkr-atelier-welcome-seen-v1';
const _showFirstRunToast = _restoredSession || !!localStorage.getItem(WELCOME_SEEN_KEY);
setTimeout(() => {
  if (_restoredSession) {
    showToast('Restored your saved session from this browser', 'fa-clock-rotate-left');
  } else if (_showFirstRunToast) {
    // Returning first-time user who already dismissed the welcome modal on
    // a prior visit — keep the quick mechanics reminder, skip re-explaining
    // the whole concept.
    showToast('Try clicking a chair, then the floor. Press V to cycle views.', 'fa-hand-pointer');
  }
  // First-ever visit: the welcome modal below covers this (both the "why"
  // and a shorter version of the "how"), so skip the toast entirely rather
  // than stacking a second, higher-z-index message on top of the modal.
}, 800);

// One-time purpose-framing welcome modal — explains *why* the city view
// exists (it's the same project, same live score, in its neighborhood),
// not just how to click things. Shown once per browser via localStorage,
// same persistence mechanism the project-save feature already uses, so
// it never re-interrupts a returning user.
if (!_restoredSession && !localStorage.getItem(WELCOME_SEEN_KEY)) {
  const welcomeModal = document.getElementById('welcomeModal');
  const dismissWelcome = () => {
    welcomeModal.classList.remove('open');
    try { localStorage.setItem(WELCOME_SEEN_KEY, '1'); } catch (e) { /* private browsing / storage disabled — non-fatal, modal just reappears next load */ }
  };
  setTimeout(() => welcomeModal?.classList.add('open'), 400);
  document.getElementById('welcomeDismiss')?.addEventListener('click', dismissWelcome);
  welcomeModal?.addEventListener('click', (e) => { if (e.target === welcomeModal) dismissWelcome(); });
}


