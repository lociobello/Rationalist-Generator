// Site furniture: umbrella pines and cypresses, scale figures in long coats,
// street lamps, flag masts and a stele. All seeded, so they stay put while
// the building is edited.
import * as THREE from 'three';
import { mulberry32, hashSeed } from './rng.js';

export function buildSite(G, P, info, seed) {
  const rng = mulberry32(hashSeed(seed + ':site'));
  const B = info.bounds;
  const W = B.x1 - B.x0;
  const front = info.front;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const place = (geom, key, x, y, z, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) => {
    q.setFromEuler(e.set(rx, ry, rz));
    m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sx, sy, sz));
    G.geom(key, geom, m);
  };

  const blob = new THREE.IcosahedronGeometry(1, 1);
  const trunk = new THREE.CylinderGeometry(0.16, 0.26, 1, 7);
  trunk.translate(0, 0.5, 0);

  // ---------- trees ----------
  const trees = [];
  const inside = (x, z, pad) => x > B.x0 - pad && x < B.x1 + pad && z > B.z0 - pad && z < B.z1 + pad;
  const frontZone = (x, z) => z > B.z0 && Math.abs(x) < W / 2 + 12 && z < front + 60;
  let guard = 0;
  while (trees.length < P.trees && guard++ < P.trees * 60) {
    const side = rng.next();
    let x, z;
    if (side < 0.45) { // flanks
      x = (rng.chance(0.5) ? -1 : 1) * (W / 2 + rng.float(8, 45));
      z = rng.float(B.z0 - 30, front - 2);
    } else if (side < 0.85) { // behind
      x = rng.float(-W / 2 - 50, W / 2 + 50);
      z = B.z0 - rng.float(8, 70);
    } else { // right flank, forward
      x = W / 2 + rng.float(12, 40);
      z = front + rng.float(-5, 25);
    }
    if (inside(x, z, 6) || frontZone(x, z)) continue;
    if (info.tower && Math.abs(x - info.tower.cx) < info.tower.w + 5 && Math.abs(z - info.tower.cz) < info.tower.w + 5) continue;
    if (trees.some((t) => (t.x - x) ** 2 + (t.z - z) ** 2 < 49)) continue;
    trees.push({ x, z, kind: rng.chance(P.env === 'mare' ? 0.8 : 0.68) ? 'pine' : 'cypress' });
  }
  for (const t of trees) {
    if (t.kind === 'pine') {
      const h = rng.float(8, 13), lean = rng.float(-0.12, 0.12), ry = rng.float(0, 6.28);
      const tx = t.x + Math.sin(lean) * h * Math.cos(ry), tz = t.z + Math.sin(lean) * h * Math.sin(ry);
      place(trunk, 'trunk', t.x, 0, t.z, 1.4, h + 0.5, 1.4, Math.cos(ry) * lean, 0, -Math.sin(ry) * lean);
      const R = rng.float(3.4, 5.2);
      const n = rng.int(5, 8);
      for (let k = 0; k < n; k++) {
        const a = rng.float(0, 6.28), d = k === 0 ? 0 : rng.float(R * 0.3, R * 0.75);
        const s = k === 0 ? 1 : rng.float(0.45, 0.7);
        place(blob, 'foliage', tx + Math.cos(a) * d, h + rng.float(-0.2, 1.0) + (k === 0 ? 0.3 : 0), tz + Math.sin(a) * d,
          R * s * rng.float(0.8, 1), R * s * rng.float(0.32, 0.45), R * s * rng.float(0.8, 1), 0, rng.float(0, 6), 0);
      }
      // two branches reaching into the crown
      for (let k = 0; k < 2; k++) {
        const a = rng.float(0, 6.28);
        place(trunk, 'trunk', tx, h * 0.72, tz, 0.55, h * 0.3, 0.55, Math.cos(a) * 0.6, 0, Math.sin(a) * 0.6);
      }
    } else {
      const h = rng.float(9, 15);
      place(trunk, 'trunk', t.x, 0, t.z, 1, 1.5, 1);
      place(blob, 'cypress', t.x, 1.2 + h * 0.46, t.z, rng.float(0.9, 1.3), h * 0.52, rng.float(0.9, 1.3), 0, rng.float(0, 6), 0);
    }
  }

  // ---------- figures ----------
  const podiumY = (x, z) => (info.podium && x > info.podium.x0 && x < info.podium.x1 && z > info.podium.z0 && z < info.podium.z1) ? P.podium : 0;
  const coat = new THREE.CylinderGeometry(0.19, 0.3, 1.22, 9); coat.translate(0, 0.61, 0);
  const leg = new THREE.BoxGeometry(0.12, 0.42, 0.14); leg.translate(0, 0.21, 0);
  const head = new THREE.SphereGeometry(0.11, 10, 8);
  const brim = new THREE.CylinderGeometry(0.17, 0.17, 0.02, 12);
  const crown = new THREE.CylinderGeometry(0.1, 0.11, 0.1, 10);
  let placed = 0;
  const groupsN = Math.max(1, Math.round(P.figures / 3));
  for (let gI = 0; gI < groupsN && placed < P.figures; gI++) {
    const gx = rng.float(-W * 0.38, W * 0.38);
    const gz = (info.podium ? info.podium.z1 - rng.float(1, 6) : front) + rng.float(-2, 18);
    const n = Math.min(P.figures - placed, rng.int(1, 4));
    for (let k = 0; k < n; k++) {
      const x = gx + rng.float(-1.6, 1.6), z = gz + rng.float(-1.2, 1.2);
      const y = podiumY(x, z);
      const ry = rng.float(0, 6.28);
      const s = rng.float(0.94, 1.06);
      const key = rng.chance(0.72) ? 'coat' : 'coat2';
      place(leg, 'coat', x + Math.cos(ry) * 0.08, y, z - Math.sin(ry) * 0.08, s, s, s, 0, ry, 0);
      place(leg, 'coat', x - Math.cos(ry) * 0.08, y, z + Math.sin(ry) * 0.08, s, s, s, 0, ry, 0);
      place(coat, key, x, y + 0.4 * s, z, s, s, s, 0, ry, 0);
      place(head, 'skin', x, y + 1.72 * s, z, s, s, s);
      if (rng.chance(0.7)) {
        place(brim, 'coat', x, y + 1.8 * s, z, s, s, s);
        place(crown, 'coat', x, y + 1.86 * s, z, s, s, s);
      }
      placed++;
    }
  }

  // ---------- lamps ----------
  if (P.lamps > 0) {
    const pole = new THREE.CylinderGeometry(0.06, 0.1, 1, 8); pole.translate(0, 0.5, 0);
    const globe = new THREE.SphereGeometry(0.28, 14, 10);
    const zL = front + 9;
    for (let k = 0; k < P.lamps; k++) {
      const x = P.lamps === 1 ? 0 : -W / 2 + 4 + (W - 8) * k / (P.lamps - 1);
      place(pole, 'metal', x, 0, zL, 1, 6.2, 1);
      place(globe, 'clock', x, 6.45, zL);
    }
    pole.dispose(); globe.dispose();
  }

  // ---------- masts ----------
  if (P.masts > 0) {
    const mast = new THREE.CylinderGeometry(0.07, 0.16, 1, 8); mast.translate(0, 0.5, 0);
    const base = new THREE.BoxGeometry(1.2, 0.8, 1.2); base.translate(0, 0.4, 0);
    const zM = (info.podium ? info.podium.z1 - 1.5 : front + 4);
    const spread = Math.min(W * 0.4, 30);
    for (let k = 0; k < P.masts; k++) {
      const x = P.masts === 1 ? -spread * 0.6 : -spread + (2 * spread) * k / (P.masts - 1);
      const y = podiumY(x, zM);
      place(base, 'trim', x, y, zM);
      place(mast, 'metal', x, y + 0.8, zM, 1, 18, 1);
    }
    mast.dispose(); base.dispose();
  }

  // ---------- stele ----------
  if (P.stele) {
    const zS = front + 26;
    const shaft = new THREE.CylinderGeometry(0.62, 1.0, 18, 4, 1); shaft.rotateY(Math.PI / 4); shaft.translate(0, 9, 0);
    const tip = new THREE.ConeGeometry(0.62 * 1.414 / 1.414, 1.4, 4); tip.rotateY(Math.PI / 4); tip.translate(0, 18.7, 0);
    G.box('base', -2.2, 0, zS - 2.2, 2.2, 0.5, zS + 2.2);
    G.box('trim', -1.4, 0.5, zS - 1.4, 1.4, 1.6, zS + 1.4);
    place(shaft, 'trim', 0, 1.6, zS);
    place(tip, 'trim', 0, 1.6, zS);
    shaft.dispose(); tip.dispose();
  }

  blob.dispose(); trunk.dispose(); coat.dispose(); leg.dispose(); head.dispose(); brim.dispose(); crown.dispose();
  return { trees: trees.length, figures: placed, piazza: { x0: B.x0 - 140, x1: B.x1 + 140, z0: B.z0 - 12, z1: front + 280 } };
}
