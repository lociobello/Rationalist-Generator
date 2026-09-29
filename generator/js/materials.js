// Procedural materials. Every surface is painted on canvases at start-up
// (colour, height → normal map, roughness), so the generator ships without
// image files. UVs are in world metres; `tile` is the real size in metres
// that one repeat of a texture covers. Stone materials also receive a
// weathering pass in the shader: large-scale tone drift, rain streaks down
// the walls and soiling near the ground, driven by world position so that
// it never repeats.
import * as THREE from 'three';
import { mulberry32 } from './rng.js';

let MAX_ANISO = 8;
export function setMaxAnisotropy(n) { MAX_ANISO = n; }

// ---------------------------------------------------------------- noise
// Periodic value noise, fractal. Tiles exactly at the texture edge.
// Each octave is a random lattice (pX × pY cells) sampled with smoothstep
// interpolation through precomputed per-column / per-row tables.
function field(size, px, py, octaves, rng, gain = 0.5) {
  const out = new Float32Array(size * size);
  const x0 = new Int32Array(size), x1 = new Int32Array(size), wx = new Float32Array(size);
  let amp = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    const pX = px << o, pY = py << o;
    const g = new Float32Array(pX * pY);
    for (let i = 0; i < g.length; i++) g[i] = rng.next();
    for (let x = 0; x < size; x++) {
      const f = x * pX / size, xi = Math.floor(f), t = f - xi;
      x0[x] = xi % pX; x1[x] = (xi + 1) % pX; wx[x] = t * t * (3 - 2 * t);
    }
    for (let y = 0; y < size; y++) {
      const f = y * pY / size, yi = Math.floor(f), t = f - yi;
      const wy = t * t * (3 - 2 * t);
      const r0 = (yi % pY) * pX, r1 = ((yi + 1) % pY) * pX;
      const row = y * size;
      for (let x = 0; x < size; x++) {
        const a = g[r0 + x0[x]], b = g[r0 + x1[x]], c = g[r1 + x0[x]], d = g[r1 + x1[x]];
        const top = a + (b - a) * wx[x], bot = c + (d - c) * wx[x];
        out[row + x] += (top + (bot - top) * wy) * amp;
      }
    }
    norm += amp; amp *= gain;
  }
  const inv = 1 / norm;
  for (let i = 0; i < out.length; i++) out[i] *= inv;
  return out;
}
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ---------------------------------------------------------------- canvases
function canvasFrom(size, fill) { // fill(i, x, y, o) writes o[0..2] (0..255)
  const c = document.createElement('canvas');
  c.width = c.height = size;
  // CPU-backed canvas: we only write pixels once and hand them to WebGL
  const g = c.getContext('2d', { willReadFrequently: true });
  const img = g.createImageData(size, size);
  const d = img.data;
  const o = [0, 0, 0];
  for (let y = 0, i = 0; y < size; y++) for (let x = 0; x < size; x++, i++) {
    fill(i, x, y, o);
    const k = i * 4;
    d[k] = o[0]; d[k + 1] = o[1]; d[k + 2] = o[2]; d[k + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}
function greyCanvas(size, arr, lo = 0, hi = 1) {
  return canvasFrom(size, (i, x, y, o) => { o[0] = o[1] = o[2] = 255 * (lo + (hi - lo) * arr[i]); });
}
// Height field → tangent-space normal map (wraps at the edges)
function normalCanvas(size, h, strength) {
  return canvasFrom(size, (i, x, y, o) => {
    const xl = x === 0 ? size - 1 : x - 1, xr = x === size - 1 ? 0 : x + 1;
    const yu = y === 0 ? size - 1 : y - 1, yd = y === size - 1 ? 0 : y + 1;
    const dx = (h[y * size + xr] - h[y * size + xl]) * strength;
    const dy = (h[yd * size + x] - h[yu * size + x]) * strength;
    const l = 1 / Math.sqrt(dx * dx + dy * dy + 1);
    o[0] = (-dx * l * 0.5 + 0.5) * 255;
    o[1] = (dy * l * 0.5 + 0.5) * 255;
    o[2] = (l * 0.5 + 0.5) * 255;
  });
}
function tex(canvas, tile, color) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1 / tile, 1 / tile);
  t.anisotropy = MAX_ANISO;
  t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  return t;
}

// Masonry layout helper: which block a pixel falls in, and its distance to
// the nearest joint (in px).
function masonry(size, px, bw, bh, bond) {
  const W = bw * px, H = bh * px;
  const cols = Math.round(size / W);
  const m = { id: 0, edge: 0 };
  return (x, y) => {
    const row = Math.floor(y / H);
    const xx = x - (bond ? (row % 2) * bond * W : 0);
    const col = Math.floor(xx / W);
    const fx = xx - col * W, fy = y - row * H;
    m.edge = Math.min(fx, W - fx, fy, H - fy);
    m.id = row * 131 + ((col % cols) + cols) % cols;
    return m;
  };
}
const slabRand = (id, k) => { const s = Math.sin(id * 12.9898 + k * 78.233) * 43758.5453; return s - Math.floor(s); };

// ---------------------------------------------------------------- recipes
const SIZE = 1024;
const RECIPES = {
  // Travertine: banded ivory stone with elongated pores, 1.2 × 0.6 m slabs
  travertino() {
    const rng = mulberry32(1931), S = SIZE, tile = 4.8, px = S / tile;
    const band = field(S, 3, 24, 4, rng);        // horizontal layering
    const pore = field(S, 40, 320, 2, rng, 0.55); // elongated voids
    const cloud = field(S, 4, 4, 4, rng);
    const lay = masonry(S, px, 1.2, 0.6, 0);
    const H = new Float32Array(S * S), R = new Float32Array(S * S);
    const col = canvasFrom(S, (i, x, y, o) => {
      const m = lay(x, y);
      const t = slabRand(m.id, 1) - 0.5, hue = slabRand(m.id, 2) - 0.5;
      const b = band[i] - 0.5;
      const p = smooth(0.76, 0.86, pore[i] + (band[i] - 0.5) * 0.22);
      const j = smooth(2.2, 0.6, m.edge);
      let l = 0.96 + t * 0.06 + b * 0.14 + (cloud[i] - 0.5) * 0.06 - p * 0.22 - j * 0.35;
      l += smooth(3.2, 1.8, m.edge) * (1 - j) * 0.03; // arris catches the light
      H[i] = 0.7 + b * 0.12 - p * 0.45 - j * 0.6;
      R[i] = 0.74 + slabRand(m.id, 3) * 0.12 + p * 0.2 + j * 0.2;
      o[0] = 232 * l + hue * 10; o[1] = 221 * l + hue * 4; o[2] = 198 * l - hue * 6;
    });
    return { tile, col, H, R, bump: 3.2, rough: [0, 1] };
  },
  // Marble (Botticino-like): cloudy veins, honed surface, 1.5 × 1.0 m slabs
  marmo() {
    const rng = mulberry32(1932), S = SIZE, tile = 6, px = S / tile;
    const turb = field(S, 6, 6, 5, rng);
    const cloud = field(S, 3, 3, 4, rng);
    const lay = masonry(S, px, 1.5, 1.0, 0);
    const H = new Float32Array(S * S), R = new Float32Array(S * S);
    const col = canvasFrom(S, (i, x, y, o) => {
      const m = lay(x, y);
      const ang = slabRand(m.id, 4) * Math.PI;
      const u = (x * Math.cos(ang) + y * Math.sin(ang)) / S;
      const vein = Math.pow(1 - Math.abs(Math.sin((u * 5 + turb[i] * 4.5 + slabRand(m.id, 5) * 9) * Math.PI)), 9);
      const j = smooth(1.8, 0.5, m.edge);
      const t = slabRand(m.id, 6) - 0.5;
      const l = 0.94 + t * 0.04 + (cloud[i] - 0.5) * 0.07 - vein * 0.13 - j * 0.3;
      H[i] = 0.8 - j * 0.6;
      R[i] = 0.3 + slabRand(m.id, 7) * 0.12 + vein * 0.08 + j * 0.5;
      o[0] = 240 * l; o[1] = 236 * l; o[2] = 228 * l;
    });
    return { tile, col, H, R, bump: 1.6, rough: [0, 1] };
  },
  // Lime render: trowel clouds and fine grain
  intonaco() { return render([236, 232, 223], 1933, 0.045); },
  ocra() { return render([214, 170, 112], 1934, 0.09); },
  // Brick with recessed mortar, travertine trim handled by the scheme
  mattone() {
    const rng = mulberry32(1935), S = SIZE, tile = 2, px = S / tile;
    const grain = field(S, 128, 128, 2, rng);
    const cloud = field(S, 4, 4, 3, rng);
    const lay = masonry(S, px, 0.26, 0.065, 0.5);
    const H = new Float32Array(S * S), R = new Float32Array(S * S);
    const col = canvasFrom(S, (i, x, y, o) => {
      const m = lay(x, y);
      const mortar = smooth(3.2, 5.5, m.edge);
      const t = slabRand(m.id, 1), burnt = t > 0.92 ? 0.62 : 1;
      const g = grain[i] - 0.5;
      const br = [(154 + (t - 0.5) * 40) * burnt, (74 + (t - 0.5) * 18) * burnt, (54 + (t - 0.5) * 12) * burnt];
      const mo = [188, 178, 162];
      H[i] = mortar * (0.85 + g * 0.2) + 0.05;
      R[i] = 0.86 + g * 0.1;
      const k = 1 + g * 0.18 + (cloud[i] - 0.5) * 0.1;
      o[0] = (mo[0] + (br[0] - mo[0]) * mortar) * k; o[1] = (mo[1] + (br[1] - mo[1]) * mortar) * k; o[2] = (mo[2] + (br[2] - mo[2]) * mortar) * k;
    });
    return { tile, col, H, R, bump: 4, rough: [0, 1] };
  },
  // Peperino / basalt plinth: speckled grey, rusticated blocks
  base() {
    const rng = mulberry32(1936), S = SIZE, tile = 4.8, px = S / tile;
    const speck = field(S, 256, 256, 1, rng);
    const cloud = field(S, 6, 6, 4, rng);
    const lay = masonry(S, px, 1.6, 0.8, 0.5);
    const H = new Float32Array(S * S), R = new Float32Array(S * S);
    const col = canvasFrom(S, (i, x, y, o) => {
      const m = lay(x, y);
      const j = smooth(5, 1.5, m.edge);
      const ch = smooth(12, 5, m.edge);
      const s = speck[i];
      const dot = s > 0.8 ? -0.25 : s < 0.16 ? 0.16 : 0;
      const t = slabRand(m.id, 1) - 0.5;
      const l = 0.5 + t * 0.06 + (cloud[i] - 0.5) * 0.12 + dot - j * 0.3 - ch * 0.05;
      H[i] = 0.8 - ch * 0.25 - j * 0.55 + (cloud[i] - 0.5) * 0.1;
      R[i] = 0.9;
      o[0] = 236 * l; o[1] = 232 * l; o[2] = 224 * l;
    });
    return { tile, col, H, R, bump: 5, rough: [0, 1] };
  },
  // Piazza paving: 2 × 1 m stone slabs, running bond, worn and stained
  paving() {
    const rng = mulberry32(1937), S = SIZE, tile = 12, px = S / tile;
    const cloud = field(S, 8, 8, 4, rng);
    const stain = field(S, 5, 5, 3, rng);
    const lay = masonry(S, px, 2, 1, 0.5);
    const H = new Float32Array(S * S), R = new Float32Array(S * S);
    const col = canvasFrom(S, (i, x, y, o) => {
      const m = lay(x, y);
      const j = smooth(1.6, 0.4, m.edge);
      const t = slabRand(m.id, 1) - 0.5;
      const st = smooth(0.58, 0.8, stain[i]);
      const l = 0.8 + t * 0.09 + (cloud[i] - 0.5) * 0.1 - st * 0.12 - j * 0.4;
      H[i] = 0.8 - j * 0.6;
      R[i] = 0.82 + j * 0.15 - st * 0.1;
      o[0] = 222 * l; o[1] = 214 * l; o[2] = 200 * l;
    });
    return { tile, col, H, R, bump: 2, rough: [0, 1] };
  },
  roof() {
    const rng = mulberry32(1938), S = 256, tile = 2;
    const n = field(S, 64, 64, 2, rng), c = field(S, 4, 4, 2, rng);
    const H = new Float32Array(S * S), R = new Float32Array(S * S).fill(0.95);
    const col = canvasFrom(S, (i, x, y, o) => { const l = 0.5 + (n[i] - 0.5) * 0.35 + (c[i] - 0.5) * 0.1; H[i] = n[i]; o[0] = 150 * l; o[1] = 146 * l; o[2] = 138 * l; });
    return { tile, col, H, R, bump: 1.5, rough: [0, 1], size: S };
  },
  ground() {
    const rng = mulberry32(1939), S = 512, tile = 18;
    const a = field(S, 6, 6, 5, rng), g = field(S, 64, 64, 2, rng);
    const H = new Float32Array(S * S), R = new Float32Array(S * S).fill(1);
    const col = canvasFrom(S, (i, x, y, o) => {
      const grass = smooth(0.56, 0.78, a[i]) * 0.6;
      const l = 0.88 + (g[i] - 0.5) * 0.2 + (a[i] - 0.5) * 0.08;
      H[i] = g[i];
      o[0] = (172 - grass * 34) * l; o[1] = (163 - grass * 16) * l; o[2] = (136 - grass * 30) * l;
    });
    return { tile, col, H, R, bump: 1, rough: [0, 1], size: S };
  },
  sand() {
    const rng = mulberry32(1940), S = 512, tile = 6;
    const a = field(S, 4, 4, 3, rng), g = field(S, 128, 128, 1, rng);
    const H = new Float32Array(S * S), R = new Float32Array(S * S).fill(1);
    const col = canvasFrom(S, (i, x, y, o) => { const l = 0.92 + (a[i] - 0.5) * 0.08 + (g[i] - 0.5) * 0.1; H[i] = a[i] * 0.5 + g[i] * 0.5; o[0] = 224 * l; o[1] = 212 * l; o[2] = 186 * l; });
    return { tile, col, H, R, bump: 1, rough: [0, 1], size: S };
  },
};
function render(rgb, seed, blot) {
  const rng = mulberry32(seed), S = 512, tile = 3;
  const cloud = field(S, 3, 3, 4, rng), fine = field(S, 128, 128, 2, rng), trowel = field(S, 12, 6, 3, rng);
  const H = new Float32Array(S * S), R = new Float32Array(S * S);
  const col = canvasFrom(S, (i, x, y, o) => {
    const l = 1 + (cloud[i] - 0.5) * blot * 2 + (fine[i] - 0.5) * 0.06 + (trowel[i] - 0.5) * 0.03;
    H[i] = fine[i] * 0.6 + trowel[i] * 0.4;
    R[i] = 0.88 + (fine[i] - 0.5) * 0.1;
    o[0] = rgb[0] * l; o[1] = rgb[1] * l; o[2] = rgb[2] * l;
  });
  return { tile, col, H, R, bump: 1.2, rough: [0, 1], size: S };
}

// ---------------------------------------------------------------- weathering
export const WEATHER = { uPatina: { value: 0.5 }, uSeedW: { value: 0 } };
const WEATHER_GLSL = /* glsl */`
varying vec3 vWPos;
varying vec3 vWNrm;
uniform float uPatina;
uniform float uSeedW;
uniform float uWStrength;
float wHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float wNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(wHash(i), wHash(i + vec2(1.0, 0.0)), f.x), mix(wHash(i + vec2(0.0, 1.0)), wHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float wFbm(vec2 p) { return wNoise(p) * 0.5 + wNoise(p * 2.03 + 7.1) * 0.3 + wNoise(p * 4.07 + 3.3) * 0.2; }
`;
function weathered(mat, strength) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uPatina = WEATHER.uPatina;
    shader.uniforms.uSeedW = WEATHER.uSeedW;
    shader.uniforms.uWStrength = { value: strength };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNrm;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWNrm = normalize(mat3(modelMatrix) * objectNormal);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + WEATHER_GLSL)
      .replace('#include <map_fragment>', `#include <map_fragment>
      {
        vec3 wn = normalize(vWNrm);
        float vertical = 1.0 - abs(wn.y);
        float u = abs(wn.x) > abs(wn.z) ? vWPos.z : vWPos.x;
        float k = uPatina * uWStrength;
        float macro = wFbm(vec2(u, vWPos.y) * 0.07 + uSeedW) - 0.5;
        float s1 = wNoise(vec2(u * 1.15 + uSeedW * 3.0, vWPos.y * 0.03));
        float s2 = wNoise(vec2(u * 3.9 + uSeedW, vWPos.y * 0.11));
        float streak = smoothstep(0.56, 0.93, s1 * 0.62 + s2 * 0.38) * vertical;
        float soil = 1.0 - smoothstep(0.0, 2.2, vWPos.y);
        float ledge = smoothstep(0.55, 0.95, wn.y);
        vec3 dirt = diffuseColor.rgb * vec3(0.86, 0.84, 0.8);
        diffuseColor.rgb *= 1.0 + macro * 0.16 * k;
        diffuseColor.rgb = mix(diffuseColor.rgb, dirt, clamp(streak * 0.95 + soil * 0.8 + ledge * 0.55, 0.0, 1.0) * k);
      }`);
  };
  mat.customProgramCacheKey = () => 'weathered-v1';
  return mat;
}
export function setPatina(amount, seed) {
  WEATHER.uPatina.value = amount;
  WEATHER.uSeedW.value = (seed % 997) * 0.37;
}

// ---------------------------------------------------------------- library
const cache = new Map();
function stone(name, { color = '#ffffff', weather = 0, envMapIntensity = 1 } = {}) {
  const r = RECIPES[name]();
  const size = r.size || SIZE;
  const map = tex(r.col, r.tile, true);
  const normalMap = tex(normalCanvas(size, r.H, r.bump), r.tile, false);
  const roughnessMap = tex(greyCanvas(size, r.R, r.rough[0], r.rough[1]), r.tile, false);
  const m = new THREE.MeshStandardMaterial({ color, map, normalMap, roughnessMap, roughness: 1, metalness: 0, envMapIntensity });
  m.normalScale.set(0.8, 0.8);
  if (weather) weathered(m, weather);
  return m;
}
const FACTORY = {
  travertino: () => stone('travertino', { weather: 1 }),
  marmo: () => stone('marmo', { weather: 0.8, envMapIntensity: 1.3 }),
  intonaco: () => stone('intonaco', { weather: 1.1 }),
  ocra: () => stone('ocra', { weather: 1.1 }),
  mattone: () => stone('mattone', { weather: 0.7 }),
  base: () => stone('base', { weather: 0.6 }),
  paving: () => stone('paving'),
  roof: () => stone('roof'),
  ground: () => stone('ground'),
  sand: () => stone('sand'),
  glassblock: () => {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d'), n = 5, s = 256 / n;
    g.fillStyle = '#a7aeac'; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < n; i++) for (let k = 0; k < n; k++) {
      const gr = g.createRadialGradient(i * s + s / 2, k * s + s / 2, 2, i * s + s / 2, k * s + s / 2, s * 0.7);
      gr.addColorStop(0, '#eef2f0'); gr.addColorStop(1, '#98a3a1');
      g.fillStyle = gr; g.fillRect(i * s + 3, k * s + 3, s - 6, s - 6);
    }
    return new THREE.MeshStandardMaterial({ map: tex(c, 1, true), roughness: 0.25, metalness: 0, envMapIntensity: 1.2 });
  },
  // old float glass: dark, reflective; panes are tilted slightly in geo.js
  glass: () => new THREE.MeshStandardMaterial({ color: '#15191b', roughness: 0.04, metalness: 0.7, envMapIntensity: 2.1 }),
  // windows with drawn curtains or open shutters behind
  glass2: () => new THREE.MeshStandardMaterial({ color: '#5d5a52', roughness: 0.45, metalness: 0.15, envMapIntensity: 1 }),
  frame: () => new THREE.MeshStandardMaterial({ color: '#2c302d', roughness: 0.45, metalness: 0.35 }),
  dark: () => new THREE.MeshStandardMaterial({ color: '#2a2621', roughness: 0.55, metalness: 0.5 }), // bronze doors
  metal: () => new THREE.MeshStandardMaterial({ color: '#3a3934', roughness: 0.4, metalness: 0.75 }),
  foliage: () => new THREE.MeshStandardMaterial({ color: '#56664a', roughness: 0.95, flatShading: true }),
  cypress: () => new THREE.MeshStandardMaterial({ color: '#3a4731', roughness: 0.95, flatShading: true }),
  trunk: () => new THREE.MeshStandardMaterial({ color: '#5c4c3c', roughness: 0.95 }),
  coat: () => new THREE.MeshStandardMaterial({ color: '#2d2b28', roughness: 0.9 }),
  coat2: () => new THREE.MeshStandardMaterial({ color: '#8a8173', roughness: 0.9 }),
  skin: () => new THREE.MeshStandardMaterial({ color: '#b39279', roughness: 0.8 }),
  sea: () => new THREE.MeshStandardMaterial({ color: '#34494f', roughness: 0.12, metalness: 0.3, envMapIntensity: 1.1 }),
  clock: () => new THREE.MeshStandardMaterial({ color: '#f1ede4', roughness: 0.5 }),
};
const NAMES_EN = { travertino: 'Travertine', marmo: 'Marble', intonaco: 'Render_White', ocra: 'Render_Ochre', mattone: 'Brick', base: 'Peperino', paving: 'Paving', roof: 'Roof', ground: 'Ground', sand: 'Sand', glassblock: 'GlassBlock', glass: 'Glass', glass2: 'Glass_Curtained', frame: 'Frames', dark: 'Bronze', metal: 'Metal', foliage: 'Pine', cypress: 'Cypress', trunk: 'Bark', coat: 'Coat_Dark', coat2: 'Coat_Light', skin: 'Skin', sea: 'Sea', clock: 'ClockFace' };

export function getMaterial(name) {
  let m = cache.get(name);
  if (!m) {
    m = (FACTORY[name] || FACTORY.travertino)();
    m.name = NAMES_EN[name] || name;
    cache.set(name, m);
  }
  return m;
}

export const SCHEMES = {
  travertino: { wall: 'travertino', trim: 'travertino' },
  marmo: { wall: 'marmo', trim: 'marmo' },
  intonaco: { wall: 'intonaco', trim: 'travertino' },
  ocra: { wall: 'ocra', trim: 'travertino' },
  mattone: { wall: 'mattone', trim: 'travertino' },
};
