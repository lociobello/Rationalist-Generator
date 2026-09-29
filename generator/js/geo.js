// Geometry accumulator: collects boxes and arbitrary geometries per material
// key into flat typed buffers, with world-space UVs (1 unit = 1 metre), then
// emits one merged mesh per material. Fast enough to rebuild on every slider move.
import * as THREE from 'three';

class Buf {
  constructor() { this.p = []; this.n = []; this.uv = []; this.idx = []; this.count = 0; }
}

export class GeoBuilder {
  constructor() { this.bufs = new Map(); }

  buf(key) {
    let b = this.bufs.get(key);
    if (!b) { b = new Buf(); this.bufs.set(key, b); }
    return b;
  }

  // One quad (4 verts). Corners given counter-clockwise seen from outside.
  quad(key, a, b, c, d, nx, ny, nz) {
    const B = this.buf(key);
    const base = B.count;
    for (const v of [a, b, c, d]) {
      B.p.push(v[0], v[1], v[2]);
      B.n.push(nx, ny, nz);
      B.uv.push(...worldUV(v[0], v[1], v[2], nx, ny, nz));
    }
    B.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    B.count += 4;
  }

  // Axis-aligned box. `keys` may be a string or {top, sides, bottom}.
  box(keys, x0, y0, z0, x1, y1, z1) {
    if (x1 < x0) [x0, x1] = [x1, x0];
    if (y1 < y0) [y0, y1] = [y1, y0];
    if (z1 < z0) [z0, z1] = [z1, z0];
    if (x1 - x0 < 1e-4 || y1 - y0 < 1e-4 || z1 - z0 < 1e-4) return;
    const k = typeof keys === 'string' ? { top: keys, sides: keys, bottom: keys } : keys;
    const S = k.sides, T = k.top || S, Bo = k.bottom || S;
    // +x
    this.quad(S, [x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], 1, 0, 0);
    // -x
    this.quad(S, [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], -1, 0, 0);
    // +z
    this.quad(S, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], 0, 0, 1);
    // -z
    this.quad(S, [x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], 0, 0, -1);
    // +y
    this.quad(T, [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], 0, 1, 0);
    // -y
    this.quad(Bo, [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], 0, -1, 0);
  }

  // Append a (transformed) BufferGeometry; UVs recomputed in world space.
  geom(key, g, matrix) {
    let geo = g.index ? g : g;
    if (matrix) geo = geo.clone().applyMatrix4(matrix);
    if (!geo.attributes.normal) geo.computeVertexNormals();
    const B = this.buf(key);
    const P = geo.attributes.position, N = geo.attributes.normal;
    const base = B.count;
    for (let i = 0; i < P.count; i++) {
      const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
      const nx = N.getX(i), ny = N.getY(i), nz = N.getZ(i);
      B.p.push(x, y, z); B.n.push(nx, ny, nz);
      B.uv.push(...worldUV(x, y, z, nx, ny, nz));
    }
    if (geo.index) { const I = geo.index.array; for (let i = 0; i < I.length; i++) B.idx.push(base + I[i]); }
    else for (let i = 0; i < P.count; i++) B.idx.push(base + i);
    B.count += P.count;
    if (matrix) geo.dispose();
  }

  // Build meshes. `materialFor(key)` returns a THREE.Material.
  meshes(materialFor, { castShadow = true, receiveShadow = true } = {}) {
    const out = [];
    for (const [key, B] of this.bufs) {
      if (!B.count) continue;
      if (key === 'glass' || key === 'glass2') jitterPanes(B);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(B.p, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(B.n, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(B.uv, 2));
      g.setIndex(B.count > 65535 ? new THREE.Uint32BufferAttribute(B.idx, 1) : new THREE.Uint16BufferAttribute(B.idx, 1));
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, materialFor(key));
      m.name = key;
      m.userData.key = key;
      m.castShadow = castShadow; m.receiveShadow = receiveShadow;
      out.push(m);
    }
    return out;
  }

  stats() {
    let v = 0, t = 0;
    for (const B of this.bufs.values()) { v += B.count; t += B.idx.length / 3; }
    return { vertices: v, triangles: t };
  }
}

// Old glass is never perfectly flush: tilt each vertical pane's normal by a
// degree or two so the sky reflection changes from window to window.
function jitterPanes(B) {
  const p = B.p, n = B.n;
  for (let v = 0; v + 3 < B.count; v += 4) {
    const i = v * 3;
    const nx = n[i], ny = n[i + 1], nz = n[i + 2];
    if (Math.abs(ny) > 0.01 || n[i + 3] !== nx || n[i + 11] !== nz) continue;
    const h = Math.abs(Math.sin(p[i] * 3.17 + p[i + 1] * 7.31 + p[i + 2] * 5.13) * 43758.55);
    const a = ((h % 1) - 0.5) * 0.07, b = (((h * 7.1) % 1) - 0.5) * 0.05;
    // rotate about the vertical axis (a) and tip forward/back (b)
    let tx = nx * Math.cos(a) - nz * Math.sin(a), tz = nx * Math.sin(a) + nz * Math.cos(a);
    const ty = Math.sin(b);
    const l = Math.hypot(tx, ty, tz);
    tx /= l; tz /= l;
    for (let k = 0; k < 4; k++) { n[i + k * 3] = tx; n[i + k * 3 + 1] = ty / l; n[i + k * 3 + 2] = tz; }
  }
}

// Planar projection chosen by the dominant normal axis, oriented so the
// texture reads upright on walls. Metres in, metres out.
function worldUV(x, y, z, nx, ny, nz) {
  const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
  if (ay >= ax && ay >= az) return [x, ny > 0 ? -z : z];
  if (ax >= az) return [nx > 0 ? -z : z, y];
  return [nz > 0 ? x : -x, y];
}

// A local frame on a vertical face: origin O (on the core surface), tangent t
// (along the face, left→right seen from outside), outward normal n, base y.
export function frame(ox, oz, tx, tz, nx, nz, y) { return { ox, oz, tx, tz, nx, nz, y }; }

// Box given in face-local coords (u along t, v up, w out along n).
export function fbox(G, key, F, u0, u1, v0, v1, w0, w1) {
  const xa = F.ox + F.tx * u0 + F.nx * w0, za = F.oz + F.tz * u0 + F.nz * w0;
  const xb = F.ox + F.tx * u1 + F.nx * w1, zb = F.oz + F.tz * u1 + F.nz * w1;
  G.box(key, xa, F.y + v0, za, xb, F.y + v1, zb);
}

// Matrix that maps face-local (u,v,w) → world, for extruded shapes drawn in
// the (u,v) plane and extruded along +w.
export function frameMatrix(F, u = 0, v = 0, w = 0) {
  const m = new THREE.Matrix4();
  m.makeBasis(new THREE.Vector3(F.tx, 0, F.tz), new THREE.Vector3(0, 1, 0), new THREE.Vector3(F.nx, 0, F.nz));
  m.setPosition(F.ox + F.tx * u + F.nx * w, F.y + v, F.oz + F.tz * u + F.nz * w);
  return m;
}
