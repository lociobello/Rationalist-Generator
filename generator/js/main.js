// Rationalist Building Generator — scene, camera, darkroom and export.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

import { GeoBuilder } from './geo.js';
import { buildBuilding } from './building.js';
import { buildSite } from './site.js';
import { getMaterial, setMaxAnisotropy, setPatina, SCHEMES } from './materials.js';
import { createSky } from './sky.js';
import { FilmShader } from './film.js';
import { generate, caption, sanitize, TYPOLOGIES } from './presets.js';
import { randomSeed, hashSeed, mulberry32 } from './rng.js';
import { saveFile, zip, encodeCode, decodeCode, inClaude } from './io.js';
import { initUI } from './ui.js';

// ---------------------------------------------------------------- state
const S_DEFAULT = {
  mode: 'archivio', view: 'scorcio', sunAz: 52, sunEl: 38, clouds: 0.45, filter: 'rosso', exposure: 1.0,
  contrast: 1.3, grain: 0.45, tone: 'neutro', vignette: 0.5, dust: 0.2, shift: true, ao: true,
};
const state = {
  seed: 17,
  count: 1, // buildings generated in this visit: 001, 002, …
  typology: 'palazzo',
  P: null,
  S: { ...S_DEFAULT },
  info: null,
  stats: { triangles: 0 },
};

// ---------------------------------------------------------------- renderer
const viewport = document.getElementById('viewport');
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.82;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
setMaxAnisotropy(renderer.capabilities.getMaxAnisotropy());

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, 1, 0.5, 5000);
camera.position.set(-60, 2, 90);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.09;
controls.maxPolarAngle = Math.PI * 0.82;
controls.minDistance = 8;
controls.maxDistance = 900;
controls.screenSpacePanning = true;

// sky + environment
const sky = createSky();
scene.add(sky.mesh);
const envScene = new THREE.Scene();
const envSky = new THREE.Mesh(sky.mesh.geometry, sky.mesh.material);
envScene.add(envSky);
const pmrem = new THREE.PMREMGenerator(renderer);
let envRT = null;

const sun = new THREE.DirectionalLight(0xfff1de, 2.4);
sun.shadow.radius = 1.5;
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
sun.shadow.bias = -0.00025;
sun.shadow.normalBias = 0.035;
scene.add(sun, sun.target);
const hemi = new THREE.HemisphereLight(0xbfd3e8, 0x8c8474, 0.85);
scene.add(hemi);
scene.fog = new THREE.Fog(0xb4bfca, 400, 2600);

// materials are painted lazily, on first use (materials.js)
const drawMat = new THREE.MeshLambertMaterial({ color: 0xffffff, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
const drawDark = new THREE.MeshLambertMaterial({ color: 0xcfcac2, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
const lineMat = new THREE.LineBasicMaterial({ color: 0x2a2724 });

// ---------------------------------------------------------------- composer
const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 });
const composer = new EffectComposer(renderer, rt);
const renderPass = new RenderPass(scene, camera);
const gtao = new GTAOPass(scene, camera, 4, 4);
gtao.updateGtaoMaterial({ radius: 1.6, distanceExponent: 1.4, thickness: 2.0, scale: 1.0, samples: 16, distanceFallOff: 1.0 });
gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
gtao.blendIntensity = 0.9;
const outputPass = new OutputPass();
const filmPass = new ShaderPass(FilmShader);
composer.addPass(renderPass);
composer.addPass(gtao);
composer.addPass(outputPass);
composer.addPass(filmPass);

// ---------------------------------------------------------------- world
const world = new THREE.Group(); world.name = 'world';
const buildingGroup = new THREE.Group(); buildingGroup.name = 'building';
const siteGroup = new THREE.Group(); siteGroup.name = 'site';
const groundGroup = new THREE.Group(); groundGroup.name = 'ground';
world.add(groundGroup, buildingGroup, siteGroup);
scene.add(world);
let edges = [];

function materialFor(key) {
  const sc = SCHEMES[state.P.material] || SCHEMES.travertino;
  if (key === 'wall') return getMaterial(sc.wall);
  if (key === 'trim') return getMaterial(sc.trim);
  return getMaterial(key);
}

function disposeGroup(g) {
  for (const c of [...g.children]) {
    c.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    g.remove(c);
  }
}

function rebuild() {
  const P = state.P;
  const t0 = performance.now();
  disposeGroup(buildingGroup); disposeGroup(siteGroup); disposeGroup(groundGroup);
  edges = [];
  const G = new GeoBuilder();
  const info = buildBuilding(G, P, state.seed);
  state.info = info;
  const meshes = G.meshes(materialFor);
  meshes.forEach((m) => buildingGroup.add(m));

  const GS = new GeoBuilder();
  const site = buildSite(GS, P, info, state.seed);
  GS.meshes(materialFor).forEach((m) => siteGroup.add(m));
  info.piazza = site.piazza;

  buildGround(P, info);
  const st = G.stats(), st2 = GS.stats();
  state.stats = { triangles: st.triangles + st2.triangles, ms: Math.round(performance.now() - t0) };
  fitShadow();
  applyMode();
  requestRender();
  ui && ui.onRebuilt();
}

let rebuildPending = false;
function scheduleRebuild() {
  if (rebuildPending) return;
  rebuildPending = true;
  requestAnimationFrame(() => { rebuildPending = false; rebuild(); });
}

function buildGround(P, info) {
  const G = new GeoBuilder();
  const R = 2400;
  const groundKey = P.env === 'mare' ? 'sand' : 'ground';
  G.quad(groundKey, [-R, 0, R], [R, 0, R], [R, 0, -R], [-R, 0, -R], 0, 1, 0);
  const pz = info.piazza;
  if (P.env !== 'campagna') {
    G.quad('paving', [pz.x0, 0.03, pz.z1], [pz.x1, 0.03, pz.z1], [pz.x1, 0.03, pz.z0], [pz.x0, 0.03, pz.z0], 0, 1, 0);
  } else {
    const B = info.bounds;
    G.quad('paving', [B.x0 - 4, 0.03, info.front + 22], [B.x1 + 4, 0.03, info.front + 22], [B.x1 + 4, 0.03, B.z0 - 4], [B.x0 - 4, 0.03, B.z0 - 4], 0, 1, 0);
  }
  if (P.env === 'mare') {
    const zs = pz.z0 - 18;
    G.quad('sea', [-R, 0.08, zs], [R, 0.08, zs], [R, 0.08, -R], [-R, 0.08, -R], 0, 1, 0);
  }
  G.meshes(materialFor, { castShadow: false, receiveShadow: true }).forEach((m) => groundGroup.add(m));
}

// ---------------------------------------------------------------- age
// How weathered the stone is: from freshly clad to decades of rain.
function applyAge() {
  const r = mulberry32(hashSeed(state.seed + ':age'));
  setPatina(0.2 + r.next() * 0.75, state.seed);
}

// ---------------------------------------------------------------- light, sky, shadows
function sunDirection() {
  const az = THREE.MathUtils.degToRad(state.S.sunAz), el = THREE.MathUtils.degToRad(state.S.sunEl);
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).normalize();
}

function fitShadow() {
  const B = state.info.bounds;
  const c = new THREE.Vector3((B.x0 + B.x1) / 2, B.y1 / 3, (B.z0 + B.z1) / 2);
  const R = Math.hypot(B.x1 - B.x0, B.z1 - B.z0, B.y1) * 0.5 + 30;
  const d = sunDirection();
  sun.position.copy(c).addScaledVector(d, R * 2);
  sun.target.position.copy(c);
  const cam = sun.shadow.camera;
  cam.left = -R; cam.right = R; cam.top = R; cam.bottom = -R; cam.near = 1; cam.far = R * 4;
  cam.updateProjectionMatrix();
  sun.shadow.needsUpdate = true;
}

let envTimer = 0;
function updateSky(immediate) {
  const S = state.S;
  const d = sunDirection();
  sky.uniforms.sunDir.value.copy(d);
  sky.uniforms.cover.value = S.clouds > 0.01 ? 0.18 + S.clouds * 0.5 : 0;
  const r = hashSeed(state.seed + ':sky');
  sky.uniforms.offset.value.set((r % 1000) / 37, ((r >> 10) % 1000) / 41);
  sky.uniforms.groundCol.value.copy(sky.uniforms.horizon.value);
  // light warms and softens as the sun gets low
  const low = 1 - Math.min(1, S.sunEl / 45);
  sun.color.setRGB(1, 0.95 - low * 0.12, 0.86 - low * 0.25);
  sun.intensity = 1.7 + Math.min(1, S.sunEl / 30) * 0.9;
  hemi.intensity = 0.45 + S.clouds * 0.25;
  if (state.info) fitShadow();
  clearTimeout(envTimer);
  const doEnv = () => {
    if (envRT) envRT.dispose();
    envRT = pmrem.fromScene(envScene, 0.02, 0.1, 3000);
    scene.environment = envRT.texture;
    scene.environmentIntensity = 0.35;
    requestRender();
  };
  if (immediate) doEnv(); else envTimer = setTimeout(doEnv, 180);
  requestRender();
}

// ---------------------------------------------------------------- darkroom
const FILTERS = { none: [0.3, 0.59, 0.11], giallo: [0.42, 0.53, 0.05], rosso: [0.78, 0.22, 0.0] };
const TONES = {
  neutro: [[0.07, 0.068, 0.065], [1.0, 0.99, 0.965]],
  seppia: [[0.12, 0.075, 0.04], [1.0, 0.94, 0.82]],
  selenio: [[0.08, 0.065, 0.085], [0.985, 0.975, 0.97]],
};
function applyFilm(width, height) {
  const S = state.S, u = filmPass.uniforms;
  u.mode.value = { archivio: 0, cartolina: 1, colore: 2, disegno: 3 }[S.mode];
  u.filterW.value = FILTERS[S.filter] || FILTERS.none;
  u.exposure.value = S.exposure;
  u.contrast.value = S.contrast;
  u.grain.value = S.mode === 'colore' ? S.grain * 0.3 : S.grain;
  u.grainSize.value = Math.max(1, height / 720);
  u.vignette.value = S.vignette;
  u.soft.value = S.mode === 'disegno' ? 0 : 0.28;
  u.seed.value = (state.seed % 997) / 97;
  u.toneShadow.value = TONES[S.tone][0];
  u.toneLight.value = TONES[S.tone][1];
  u.dust.value = S.mode === 'archivio' || S.mode === 'cartolina' ? S.dust : 0;
  u.resolution.value = [width, height];
}

function applyMode() {
  const drawing = state.S.mode === 'disegno';
  for (const g of [buildingGroup, siteGroup]) {
    g.children.forEach((m) => {
      if (!m.isMesh) return;
      const key = m.userData.key;
      if (drawing) m.material = (key === 'glass' || key === 'dark' || key === 'frame' || key === 'foliage' || key === 'cypress' || key === 'coat') ? drawDark : drawMat;
      else m.material = materialFor(key);
    });
  }
  groundGroup.children.forEach((m) => { m.material = drawing ? (m.userData.key === 'sea' ? drawDark : drawMat) : materialFor(m.userData.key); });
  if (drawing && !edges.length) {
    for (const m of buildingGroup.children) {
      if (!m.isMesh) continue;
      const e = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry, 28), lineMat);
      e.userData.edges = true;
      buildingGroup.add(e); edges.push(e);
    }
    for (const m of siteGroup.children) {
      if (!m.isMesh) continue;
      const e = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry, 40), lineMat);
      siteGroup.add(e); edges.push(e);
    }
  }
  edges.forEach((e) => { e.visible = drawing; });
  sky.mesh.visible = !drawing;
  scene.background = drawing ? new THREE.Color(0xf4f2ee) : null;
  const hz = sky.uniforms.horizon.value, avg = (hz.r + hz.g + hz.b) / 3;
  const haze = new THREE.Color(hz.r * 0.65 + avg * 0.35, hz.g * 0.65 + avg * 0.35, hz.b * 0.65 + avg * 0.35).multiplyScalar(1.18);
  scene.fog.color.copy(drawing ? new THREE.Color(0xf4f2ee) : haze);
  gtao.enabled = state.S.ao;
  hemi.intensity = drawing ? 1.6 : 0.45 + state.S.clouds * 0.25;
  requestRender();
}

// ---------------------------------------------------------------- camera
let camAnim = null;
const fitCam = new THREE.PerspectiveCamera();

// Place a camera so every corner of the building's box lands inside the
// frame (with margin). Bisection on the distance; works with lens shift.
function fitPose({ fov, dir, target, eye = null, shift, margin = 0.86 }) {
  const B = state.info.mass;
  const corners = [];
  for (const x of [B.x0, B.x1]) for (const y of [B.y0, B.y1]) for (const z of [B.z0, B.z1]) corners.push(new THREE.Vector3(x, y, z));
  fitCam.fov = fov; fitCam.aspect = camera.aspect; fitCam.near = 0.5; fitCam.far = 5000;
  const t = new THREE.Vector3().fromArray(target);
  const place = (d) => {
    fitCam.position.set(t.x + dir[0] * d, eye != null ? eye : t.y + dir[1] * d, t.z + dir[2] * d);
    fitCam.updateProjectionMatrix();
    if (shift) {
      const dx = t.x - fitCam.position.x, dy = t.y - fitCam.position.y, dz = t.z - fitCam.position.z;
      const dh = Math.hypot(dx, dz);
      fitCam.lookAt(fitCam.position.x + dx, fitCam.position.y, fitCam.position.z + dz);
      fitCam.projectionMatrix.elements[9] = (dy / dh) * fitCam.projectionMatrix.elements[5];
    } else fitCam.lookAt(t);
    fitCam.updateMatrixWorld();
    fitCam.matrixWorldInverse.copy(fitCam.matrixWorld).invert();
  };
  const ok = (d) => {
    place(d);
    const v = new THREE.Vector3();
    for (const c of corners) {
      v.copy(c).applyMatrix4(fitCam.matrixWorldInverse);
      if (v.z > -0.5) return false;
      v.applyMatrix4(fitCam.projectionMatrix);
      if (Math.abs(v.x) > margin || Math.abs(v.y) > margin) return false;
    }
    return true;
  };
  let lo = 5, hi = 4000;
  for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (ok(m)) hi = m; else lo = m; }
  place(hi);
  return { fov, pos: fitCam.position.toArray(), target, shift };
}

function viewPose(name) {
  const info = state.info, B = info.mass;
  const W = B.x1 - B.x0;
  const Htot = Math.max(info.top, info.towerTop || 0);
  const cx = (B.x0 + B.x1) / 2, cz = (B.z0 + B.z1) / 2;
  const deg = THREE.MathUtils.degToRad;
  switch (name) {
    case 'frontale':
      return fitPose({ fov: 24, dir: [0, 0, 1], target: [cx, Htot * 0.45, info.zMain], eye: 1.65, shift: true, margin: 0.88 });
    case 'basso': {
      const x = info.xMin, z = info.zMain + state.P.reveal;
      const eye = (info.podium && !info.stairs ? 0 : 0) + 0.6;
      return { fov: 68, pos: [x - 7, eye, Math.max(z + 10, info.front + 2)], target: [x + Math.min(W * 0.3, 30), Htot * 0.78, z - 4], shift: false };
    }
    case 'aereo': {
      const az = deg(28), el = deg(31);
      return fitPose({ fov: 26, dir: [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)], target: [cx, Htot * 0.15, cz], shift: false, margin: 0.9 });
    }
    default: {
      // three-quarter view at 38°; in tall frames a more oblique angle is
      // tried too, and the one that shows the building largest wins
      const angles = camera.aspect < 1.25 ? [-38, -48, -58] : [-38];
      let best = null;
      for (const ang of angles) {
        const a = deg(ang);
        const pose = fitPose({ fov: 34, dir: [Math.sin(a), 0, Math.cos(a)], target: [cx, Htot * 0.52, cz + (info.zMain - cz) * 0.5], eye: 1.7, shift: true, margin: 0.93 });
        const d = Math.hypot(pose.pos[0] - cx, pose.pos[2] - cz);
        if (!best || d < best.d * 0.9) best = { pose, d };
      }
      return best.pose;
    }
  }
}

function setView(name, animate = true) {
  state.S.view = name;
  userMoved = false;
  const pose = viewPose(name);
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!animate || reduce) {
    camera.fov = pose.fov; camera.position.fromArray(pose.pos); controls.target.fromArray(pose.target);
    camera.updateProjectionMatrix(); controls.update(); camAnim = null; requestRender();
    return;
  }
  camAnim = {
    t0: performance.now(), dur: 900,
    fromPos: camera.position.clone(), toPos: new THREE.Vector3().fromArray(pose.pos),
    fromT: controls.target.clone(), toT: new THREE.Vector3().fromArray(pose.target),
    fromFov: camera.fov, toFov: pose.fov,
  };
}

// Architectural lens shift: keep the camera level and slide the image
// plane so verticals stay parallel, as with a view camera.
function applyShift(cam = camera) {
  cam.updateProjectionMatrix();
  if (!state.S.shift) return;
  const t = controls.target, p = cam.position;
  const dx = t.x - p.x, dy = t.y - p.y, dz = t.z - p.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.5) return;
  const pitch = Math.atan2(dy, d);
  if (Math.abs(pitch) > 0.75) return;
  cam.lookAt(p.x + dx, p.y, p.z + dz);
  cam.updateMatrixWorld();
  const e = cam.projectionMatrix.elements;
  e[9] = (dy / d) * e[5];
  cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
}

// ---------------------------------------------------------------- render loop
let needsRender = true;
function requestRender() { needsRender = true; }

function resize() {
  const w = viewport.clientWidth, h = viewport.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  const pr = renderer.getPixelRatio();
  composer.setPixelRatio(pr);
  composer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  // re-frame the preset view unless the visitor has moved the camera
  if (state.info && !userMoved) setView(state.S.view, false);
  requestRender();
}
let userMoved = false;
controls.addEventListener('start', () => { userMoved = true; camAnim = null; });
new ResizeObserver(resize).observe(viewport);

function frame(now) {
  requestAnimationFrame(frame);
  if (camAnim) {
    const k = Math.min(1, (now - camAnim.t0) / camAnim.dur);
    const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
    camera.position.lerpVectors(camAnim.fromPos, camAnim.toPos, e);
    controls.target.lerpVectors(camAnim.fromT, camAnim.toT, e);
    camera.fov = camAnim.fromFov + (camAnim.toFov - camAnim.fromFov) * e;
    if (k >= 1) camAnim = null;
    needsRender = true;
  }
  if (controls.update()) needsRender = true;
  if (camera.position.y < 0.35) { camera.position.y = 0.35; needsRender = true; }
  if (!needsRender) return;
  needsRender = false;
  applyShift();
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  applyFilm(size.x, size.y);
  composer.render();
}

// ---------------------------------------------------------------- photograph
// The print is a white card: the photograph with an even white margin, and
// below it the building's name and number on the left, RATIONALIST UTOPIA on
// the right, in the site's geometric face.
const CARD_FONT = 'Jost, "Futura PT", Futura, "Century Gothic", sans-serif';
async function takePhoto(ratio) {
  const sizes = { '1:1': [2048, 2048], '4:5': [1638, 2048], '3:2': [2400, 1600] };
  const [w, h] = sizes[ratio] || sizes['1:1'];
  try { await document.fonts?.load(`700 40px ${CARD_FONT}`); } catch { /* fall back */ }
  const oldPR = renderer.getPixelRatio();
  const oldSize = renderer.getSize(new THREE.Vector2());
  const oldAspect = camera.aspect;
  renderer.setPixelRatio(1);
  renderer.setSize(w, h, false);
  composer.setPixelRatio(1);
  composer.setSize(w, h);
  const oldFov = camera.fov;
  const oldPos = camera.position.clone(), oldTarget = controls.target.clone();
  camera.aspect = w / h;
  if (!userMoved && !camAnim) {
    // preset view: frame the building again for the print's own proportions
    const pose = viewPose(state.S.view);
    camera.fov = pose.fov; camera.position.fromArray(pose.pos); controls.target.fromArray(pose.target);
  } else if (w / h < oldAspect) {
    // a view the visitor composed: keep its horizontal framing
    const t = Math.tan(THREE.MathUtils.degToRad(oldFov) / 2) * oldAspect / (w / h);
    camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(t));
  }
  applyShift();
  applyFilm(w, h);
  composer.render();
  camera.fov = oldFov; camera.position.copy(oldPos); controls.target.copy(oldTarget);
  // card geometry, proportional to the photograph's width
  const m = Math.round(w * 0.0145);          // white margin around the photo
  const band = Math.round(w * 0.062);        // caption strip under the photo
  const out = document.createElement('canvas');
  out.width = w + 2 * m; out.height = h + m + band;
  const g = out.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, out.width, out.height);
  // copy immediately, before the drawing buffer is cleared
  g.drawImage(renderer.domElement, m, m, w, h);
  // restore the live view
  renderer.setPixelRatio(oldPR);
  renderer.setSize(oldSize.x, oldSize.y, false);
  composer.setPixelRatio(oldPR);
  composer.setSize(oldSize.x, oldSize.y);
  camera.aspect = oldAspect;
  requestRender();

  const cap = captionNow();
  const fs = Math.round(w * 0.0213);
  g.font = `700 ${fs}px ${CARD_FONT}`;
  g.fillStyle = '#111111';
  g.textBaseline = 'middle';
  const track = fs * 0.075;
  // letter-spaced text drawn glyph by glyph, so it looks the same in every browser
  const width = (t) => [...t].reduce((a, ch) => a + g.measureText(ch).width + track, -track);
  const draw = (t, x, y) => { for (const ch of t) { g.fillText(ch, x, y); x += g.measureText(ch).width + track; } };
  const y = h + m + band / 2;
  const name = cap.name.toUpperCase();
  draw(name, m, y);
  draw(cap.index, m + width(name) + fs * 1.45, y);
  const brand = 'RATIONALIST UTOPIA';
  draw(brand, m + w - width(brand), y);

  const blob = await new Promise((res) => out.toBlob(res, 'image/png'));
  return saveFile(`${fileBase()}-${ratio.replace(':', 'x')}.png`, blob);
}

function captionNow() {
  const c = caption(state.P, state.seed, 'en');
  c.index = String(state.count).padStart(3, '0');
  return c;
}
const slug = (t) => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const fileBase = () => { const c = captionNow(); return `RU-${c.index}-${slug(c.name)}-s${state.seed}`; };

// ---------------------------------------------------------------- GLB
async function exportGLB() {
  const wasDrawing = state.S.mode === 'disegno';
  if (wasDrawing) { state.S.mode = 'archivio'; applyMode(); }
  edges.forEach((e) => { e.visible = false; });
  const root = new THREE.Group();
  root.name = `RationalistUtopia_${state.P.typology}_${state.seed}`;
  const b = buildingGroup.clone(); b.children = b.children.filter((c) => !c.userData.edges);
  const s = siteGroup.clone(); s.children = s.children.filter((c) => c.isMesh);
  root.add(b, s);
  const exporter = new GLTFExporter();
  const buf = await exporter.parseAsync(root, { binary: true, onlyVisible: true });
  if (wasDrawing) { state.S.mode = 'disegno'; applyMode(); }
  const cap = captionNow();
  const base = fileBase();
  const glb = new Uint8Array(buf);
  if (inClaude()) {
    const code = await encodeCode(codePayload());
    const readme = `${cap.index} - ${cap.name}, ${cap.town}, ${cap.year}\nRationalist Utopia — Rationalist Generator\n\nCode: ${code}\nUnits: metres, Y up.\n`;
    return saveFile(`${base}.zip`, await zip([{ name: `${base}.glb`, data: glb }, { name: 'README.txt', data: readme }]));
  }
  return saveFile(`${base}.glb`, new Blob([glb], { type: 'model/gltf-binary' }));
}

// ---------------------------------------------------------------- codes
function codePayload() {
  const S = state.S;
  return { v: 1, seed: state.seed, P: state.P, S: { mode: S.mode, view: S.view, sunAz: S.sunAz, sunEl: S.sunEl, clouds: S.clouds, filter: S.filter, tone: S.tone, contrast: S.contrast, grain: S.grain, exposure: S.exposure } };
}
async function loadCode(code) {
  const obj = await decodeCode(code);
  if (!obj || !obj.P) return false;
  const base = generate(TYPOLOGIES.includes(obj.P.typology) ? obj.P.typology : 'palazzo', obj.seed || 1);
  state.seed = Math.max(1, Math.floor(Number(obj.seed) || 1));
  state.P = sanitize(obj.P, base);
  state.typology = state.P.typology;
  applyAge();
  if (obj.S) for (const k of Object.keys(obj.S)) if (k in S_DEFAULT && typeof obj.S[k] === typeof S_DEFAULT[k]) state.S[k] = obj.S[k];
  updateSky(true);
  rebuild();
  setView(state.S.view, false);
  ui && ui.sync();
  return true;
}

// ---------------------------------------------------------------- API used by the UI
const api = {
  state,
  // One press, one new building: a random typology (never the same twice in
  // a row), a random seed, and its own light, sky and age.
  newBuilding(typology = 'random', seed) {
    state.seed = seed ?? randomSeed();
    state.count += 1;
    let t = typology;
    if (t === 'random') {
      const pool = TYPOLOGIES.filter((x) => x !== state.P?.typology);
      t = pool[hashSeed(state.seed) % pool.length];
    }
    state.typology = t;
    state.P = generate(t, state.seed);
    const r = mulberry32(hashSeed(state.seed + ':light'));
    state.S.sunAz = Math.round(r.float(38, 64));
    state.S.sunEl = Math.round(r.float(24, 46));
    state.S.clouds = Math.round(r.float(0.12, 0.78) * 100) / 100;
    applyAge();
    updateSky();
    rebuild();
    setView(state.S.view, true);
    ui && ui.sync();
  },
  setParam(k, v) { state.P[k] = v; scheduleRebuild(); },
  setPhoto(k, v) {
    state.S[k] = v;
    if (ui && (k === 'view' || k === 'mode')) ui.sync();
    if (k === 'mode' || k === 'ao') applyMode();
    if (k === 'sunAz' || k === 'sunEl' || k === 'clouds') updateSky();
    if (k === 'view') setView(v, true);
    requestRender();
  },
  refit() { setView(state.S.view, true); },
  takePhoto, exportGLB, loadCode,
  code: () => encodeCode(codePayload()),
  caption: () => captionNow(),
  inClaude,
  requestRender,
};
api.debug = { renderer, scene, sun, hemi, camera, controls, gtao, filmPass, sky, getMaterial };
window.RBG = api;

// ---------------------------------------------------------------- boot
let ui = null;
async function boot() {
  let loaded = false;
  const h = decodeURIComponent(location.hash.slice(1));
  state.P = generate('palazzo', state.seed);
  if (h.startsWith('RU')) loaded = await loadCode(h);
  if (!loaded) {
    state.P = generate('palazzo', state.seed);
    applyAge();
    resize();
    rebuild();
    updateSky(true);
    setView('scorcio', false);
  }
  ui = initUI(api);
  ui.onRebuilt();
  const ld = document.getElementById('loading'); if (ld) ld.remove();
  requestAnimationFrame(frame);
  // paint the remaining claddings while the page is idle, so that pressing
  // Genera never waits for a texture
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 250));
  const rest = ['marmo', 'intonaco', 'mattone', 'ocra', 'sand', 'sea'];
  const next = () => { const n = rest.shift(); if (!n) return; getMaterial(n); idle(next); };
  setTimeout(() => idle(next), 1200);
}
resize();
boot();
