// The rationalist grammar. A building is a height-map on a grid of bays
// (campate). Every exposed bay face on every floor receives a facade module;
// then the set pieces are added: pronao, portico, loggia, tower, arengario,
// canopy, vaulted hall, podium and stairs.
import * as THREE from 'three';
import { mulberry32, hashSeed } from './rng.js';
import { fbox, frame, frameMatrix } from './geo.js';

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const DIRS = [
  { key: 'front', di: 0, dk: -1 }, // +z (toward the piazza)
  { key: 'back', di: 0, dk: 1 },   // -z
  { key: 'right', di: 1, dk: 0 },  // +x
  { key: 'left', di: -1, dk: 0 },  // -x
];

export function buildBuilding(G, P, seed) {
  const rng = mulberry32(hashSeed(seed + ':detail'));
  const b = P.bay;
  const r = P.reveal;
  const fh = P.floorH;
  const gh = P.floorH * P.groundH;
  const y0 = P.podium;
  const yAt = (f) => y0 + (f <= 0 ? 0 : gh + (f - 1) * fh);
  const hAt = (f) => (f === 0 ? gh : fh);

  // ---------- plan ----------
  const nx = P.bays;
  const fd = P.depth;
  const wl = P.wingLen;
  const ww = Math.min(P.wingW, Math.floor((nx - 1) / 2));
  const F = P.floors;
  const Fw = Math.max(1, F + P.wingDelta);
  let NZ = fd, kM = 0;
  if (P.plan === 'L' || P.plan === 'T' || P.plan === 'U') NZ = fd + wl;
  if (P.plan === 'corte') { NZ = wl + fd; kM = wl; }
  if (P.plan === 'chiusa') NZ = fd * 2 + wl;

  const cells = [];
  for (let i = 0; i < nx; i++) {
    cells.push([]);
    for (let k = 0; k < NZ; k++) cells[i].push({ h: 0, open: new Set(), region: '' });
  }
  const set = (i, k, h, region) => { if (i >= 0 && i < nx && k >= 0 && k < NZ) { cells[i][k].h = h; cells[i][k].region = region; } };
  for (let i = 0; i < nx; i++) for (let k = kM; k < kM + fd; k++) set(i, k, F, 'main');
  if (P.plan === 'L') for (let i = 0; i < ww; i++) for (let k = fd; k < NZ; k++) set(i, k, Fw, 'wingL');
  if (P.plan === 'T') { const c0 = Math.floor((nx - ww) / 2); for (let i = c0; i < c0 + ww; i++) for (let k = fd; k < NZ; k++) set(i, k, Fw, 'wingC'); }
  if (P.plan === 'U') for (let k = fd; k < NZ; k++) { for (let i = 0; i < ww; i++) set(i, k, Fw, 'wingL'); for (let i = nx - ww; i < nx; i++) set(i, k, Fw, 'wingR'); }
  if (P.plan === 'corte') for (let k = 0; k < wl; k++) { for (let i = 0; i < ww; i++) set(i, k, Fw, 'wingL'); for (let i = nx - ww; i < nx; i++) set(i, k, Fw, 'wingR'); }
  if (P.plan === 'chiusa') {
    for (let k = fd; k < NZ; k++) { for (let i = 0; i < ww; i++) set(i, k, Fw, 'wingL'); for (let i = nx - ww; i < nx; i++) set(i, k, Fw, 'wingR'); }
    for (let i = 0; i < nx; i++) for (let k = NZ - fd; k < NZ; k++) set(i, k, Fw, 'back');
  }

  const xMin = -nx * b / 2, xMax = nx * b / 2;
  const zFront = NZ * b / 2;
  const zMain = zFront - kM * b;
  const zBack = zFront - NZ * b;
  const cx = (i) => xMin + i * b;
  const cz = (k) => zFront - k * b; // front edge z of row k

  // ---------- pronao / colonnade range ----------
  let pr = null;
  if (P.facade === 'colonnade') {
    pr = { i0: 0, i1: nx, colonnade: true };
  } else if (P.pronao > 0) {
    const pw = Math.min(P.pronao, nx - 2);
    const i0 = Math.floor((nx - pw) / 2);
    pr = { i0, i1: i0 + pw, colonnade: false };
  }
  const inPronao = (i) => pr && i >= pr.i0 && i < pr.i1;

  // ---------- portico and loggia: open floors in the main front row ----------
  const porticoFloors = P.portico === 'double' ? 2 : P.portico === 'none' ? 0 : 1;
  const canPortico = fd >= 2 && porticoFloors > 0 && F > porticoFloors + 1;
  for (let i = 0; i < nx; i++) {
    const c = cells[i][kM];
    if (inPronao(i)) continue;
    if (kM > 0 && cells[i][kM - 1].h) continue; // front covered by a wing
    if (canPortico) for (let f = 0; f < porticoFloors; f++) c.open.add(f);
    if (P.loggia && fd >= 2 && F >= 3) c.open.add(F - 1);
  }

  const filled = (i, k, f) => {
    if (i < 0 || i >= nx || k < 0 || k >= NZ) return false;
    const c = cells[i][k];
    return f >= 0 && f < c.h && !c.open.has(f);
  };
  const heightOf = (i, k) => (i < 0 || i >= nx || k < 0 || k >= NZ ? 0 : cells[i][k].h);

  // ---------- cores (interior volumes; their tops are the roofs) ----------
  for (let i = 0; i < nx; i++) for (let k = 0; k < NZ; k++) {
    const c = cells[i][k];
    if (!c.h) continue;
    let f = 0;
    while (f < c.h) {
      if (c.open.has(f)) { f++; continue; }
      let g = f;
      while (g < c.h && !c.open.has(g)) g++;
      G.box({ top: 'roof', sides: 'wall', bottom: 'wall' }, cx(i), yAt(f), cz(k + 1), cx(i + 1), yAt(g), cz(k));
      f = g;
    }
    // slab over an open top floor (loggia): roof above, soffit below
    if (c.open.has(c.h - 1)) G.box({ top: 'roof', sides: 'wall', bottom: 'wall' }, cx(i), yAt(c.h) - 0.45, cz(k + 1), cx(i + 1), yAt(c.h), cz(k) + r);
  }

  // ---------- facade modules ----------
  const M = modules(G, P, rng);
  const aH = Math.max(P.attic, 1.0);
  const plinth = P.plinth;

  // region bounds for centring slit windows on side faces
  const regionBox = {};
  for (let i = 0; i < nx; i++) for (let k = 0; k < NZ; k++) {
    const reg = cells[i][k].region; if (!reg) continue;
    const bb = regionBox[reg] || (regionBox[reg] = { i0: 1e9, i1: -1e9, k0: 1e9, k1: -1e9 });
    bb.i0 = Math.min(bb.i0, i); bb.i1 = Math.max(bb.i1, i); bb.k0 = Math.min(bb.k0, k); bb.k1 = Math.max(bb.k1, k);
  }
  const entranceI = Math.floor(nx / 2);

  for (let i = 0; i < nx; i++) for (let k = 0; k < NZ; k++) {
    const c = cells[i][k];
    if (!c.h) continue;
    for (const d of DIRS) {
      const ni = i + d.di, nk = k + d.dk;
      // face frame
      let Fr;
      if (d.key === 'front') Fr = (y) => frame(cx(i), cz(k), 1, 0, 0, 1, y);
      else if (d.key === 'back') Fr = (y) => frame(cx(i + 1), cz(k + 1), -1, 0, 0, -1, y);
      else if (d.key === 'right') Fr = (y) => frame(cx(i + 1), cz(k), 0, -1, 1, 0, y);
      else Fr = (y) => frame(cx(i), cz(k + 1), 0, 1, -1, 0, y);
      // tangent neighbours (for convex corners)
      const ti = d.key === 'front' ? 1 : d.key === 'back' ? -1 : 0;
      const tk = d.key === 'right' ? 1 : d.key === 'left' ? -1 : 0;
      const isZ = d.key === 'front' || d.key === 'back';
      const isMain = d.key === 'front' && k === kM && c.region === 'main';
      const reg = regionBox[c.region];

      for (let f = 0; f < c.h; f++) {
        if (!filled(i, k, f) || filled(ni, nk, f)) continue;
        const y = yAt(f), h = hAt(f);
        const Fm = Fr(y);
        // class & style
        let style = isMain ? P.facade : P.sideFacade;
        const nb = (ni >= 0 && ni < nx && nk >= 0 && nk < NZ) ? cells[ni][nk] : null;
        const underOpen = nb && nb.h > f && nb.open.has(f); // behind a portico / loggia
        const o = { f, h, ground: f === 0, top: f === c.h - 1, plinth: f === 0 ? plinth : 0, id: hashSeed(`${i},${k},${f},${d.key}`) };
        if (isMain && inPronao(i)) style = 'curtain';
        else if (underOpen) style = f === 0 ? 'shop' : 'glazed';
        else if (style === 'colonnade') style = 'punched';
        if (isMain && f === 0 && !pr && i === entranceI && !canPortico) style = 'door';
        if (style === 'blank' && reg && f > 0 && f < c.h - 1) {
          const mid = isZ ? Math.floor((reg.i0 + reg.i1) / 2) : Math.floor((reg.k0 + reg.k1) / 2);
          if ((isZ ? i : k) === mid) o.slit = true;
        }
        M.module(style, Fm, b, h, o);
        // plinth band (zoccolo) on the ground floor
        if (f === 0 && plinth > 0 && style !== 'curtain' && style !== 'door' && style !== 'shop') {
          fbox(G, 'base', Fm, 0, b, 0, plinth, 0, r + 0.05);
        }
        // convex corner posts (only z-faces add them, to avoid duplicates)
        if (isZ) {
          const leftConvex = !filled(i - ti, k - tk, f);
          const rightConvex = !filled(i + ti, k + tk, f);
          if (leftConvex) fbox(G, 'wall', Fm, -r, 0, 0, h, 0, r);
          if (rightConvex) fbox(G, 'wall', Fm, b, b + r, 0, h, 0, r);
          if (f === 0 && plinth > 0) {
            if (leftConvex) fbox(G, 'base', Fm, -r - 0.05, 0, 0, plinth, 0, r + 0.05);
            if (rightConvex) fbox(G, 'base', Fm, b, b + r + 0.05, 0, plinth, 0, r + 0.05);
          }
        }
      }
      // attic band + cornice where this cell is taller than the neighbour
      if (heightOf(ni, nk) < c.h) {
        const yt = yAt(c.h);
        const Fm = Fr(yt);
        const leftConvex = heightOf(i - ti, k - tk) < c.h;
        const rightConvex = heightOf(i + ti, k + tk) < c.h;
        fbox(G, 'wall', Fm, 0, b, 0, aH, 0, r);
        if (isZ) {
          if (leftConvex) fbox(G, 'wall', Fm, -r, 0, 0, aH, 0, r);
          if (rightConvex) fbox(G, 'wall', Fm, b, b + r, 0, aH, 0, r);
        }
        const co = P.cornice, ct = co > 0 ? 0.22 + co * 0.25 : 0.12;
        const ext = r + co;
        const u0 = isZ && leftConvex ? -ext : 0, u1 = isZ && rightConvex ? b + ext : b;
        fbox(G, 'trim', Fm, u0, u1, aH, aH + ct, -0.25, r + co);
      }
    }
  }

  // ---------- open floors: portico columns / arcades and loggia piers ----------
  const colW = clamp(b * 0.16, 0.45, 0.85);
  const topMain = yAt(F);
  if (canPortico || (P.loggia && fd >= 2 && F >= 3)) {
    const runs = [];
    if (canPortico) runs.push([0, porticoFloors]);
    if (P.loggia && fd >= 2 && F >= 3) runs.push([F - 1, F]);
    for (const [fa, fb] of runs) {
      const ya = yAt(fa), yb = yAt(fb);
      const isLoggia = fa === F - 1;
      const Fm = frame(0, zMain, 1, 0, 0, 1, ya);
      // contiguous segments of open bays (split by the pronao)
      let i = 0;
      while (i < nx) {
        if (!cells[i][kM].open.has(fa)) { i++; continue; }
        let j = i;
        while (j < nx && cells[j][kM].open.has(fa)) j++;
        const endL = i === 0, endR = j === nx;
        if (P.portico === 'arcade' && !isLoggia) {
          for (let q = i; q < j; q++) M.archPanel(frame(cx(q), zMain, 1, 0, 0, 1, ya), b, yb - ya, r, 0.62);
          if (endL) fbox(G, 'wall', Fm, cx(i) - r, cx(i), 0, yb - ya, 0, r);
          if (endR) fbox(G, 'wall', Fm, cx(j), cx(j) + r, 0, yb - ya, 0, r);
        } else {
          const w = isLoggia ? Math.max(colW * 0.8, b * (1 - P.winW) * 0.55) : colW;
          for (let q = i; q <= j; q++) {
            let u = cx(q);
            let ua = u - w / 2, ub = u + w / 2;
            if (q === i && endL) { ua = u - r; ub = u - r + w; }
            if (q === j && endR) { ub = u + r; ua = u + r - w; }
            fbox(G, 'trim', Fm, ua, ub, 0, yb - ya - (isLoggia ? 0 : 0), r - w, r);
          }
          // beam over the columns
          fbox(G, 'wall', Fm, cx(i) - (endL ? r : 0), cx(j) + (endR ? r : 0), yb - ya - 0.55, yb - ya, 0, r);
          if (isLoggia) fbox(G, 'trim', Fm, cx(i), cx(j), 0, 1.0, r - 0.2, r - 0.05); // parapet
        }
        // side walls of the portico at the building ends are left open
        i = j;
      }
    }
  }

  // ---------- pronao or giant colonnade ----------
  if (pr) {
    const x0 = cx(pr.i0) - (pr.colonnade ? r : 0), x1 = cx(pr.i1) + (pr.colonnade ? r : 0);
    const depth = Math.max(P.pronaoDepth, r + 0.8);
    const rise = pr.colonnade ? 0 : P.pronaoRise;
    const top = topMain + aH + rise;
    const zf = zMain + depth;
    const archH = pr.colonnade ? Math.max(aH, 1.6) : clamp(aH + rise * 0.6, 1.8, 5);
    const W = x1 - x0;
    const finT = pr.colonnade ? 0 : clamp(W * 0.1, 0.9, 2.2);
    // fins (side walls)
    if (finT > 0) {
      G.box('trim', x0 - finT, y0, zMain, x0, top, zf);
      G.box('trim', x1, y0, zMain, x1 + finT, top, zf);
    }
    // piers
    const n = pr.colonnade ? (pr.i1 - pr.i0 + 1) : Math.max(2, P.pronaoPiers);
    const pw = pr.colonnade ? clamp(b * 0.17, 0.6, 1.0) : clamp((W / (n + 1)) * 0.38, 0.8, 1.8);
    const pd = pr.colonnade ? pw : clamp(pw * 1.1, 0.8, depth - 0.2);
    for (let q = 0; q < n; q++) {
      let x;
      if (pr.colonnade) x = cx(pr.i0 + q) + (q === 0 ? -r + pw / 2 : q === n - 1 ? r - pw / 2 : 0);
      else x = x0 + (W * (q + 1)) / (n + 1);
      G.box('trim', x - pw / 2, y0, zf - pd, x + pw / 2, top - archH, zf);
    }
    // architrave + thin crowning slab
    G.box('trim', x0 - finT, top - archH, zMain, x1 + finT, top, zf);
    G.box('trim', x0 - finT - 0.2, top, zMain - 0.2, x1 + finT + 0.2, top + 0.22, zf + 0.25);
    // pronao floor (a raised landing)
    G.box('trim', x0 - finT, y0, zMain, x1 + finT, y0 + 0.02, zf);
    // arengario between the central piers
    if (P.arengario && !pr.colonnade) {
      const yb = yAt(1) + 0.2;
      const aw = Math.min(W / (n + 1) - pw - 0.3, 4.5);
      if (aw > 1.2) {
        G.box('trim', -aw / 2, yb, zMain + r, aw / 2, yb + 0.28, zf - 0.1);
        G.box('trim', -aw / 2, yb + 0.28, zf - 0.28, aw / 2, yb + 1.28, zf - 0.1);
      }
    }
  }

  // ---------- tower ----------
  let towerInfo = null;
  if (P.tower !== 'none') towerInfo = buildTower(G, P, M, rng, { xMin, xMax, zFront, zMain, zBack, y0, topMain, aH, fd, b, r, kM });

  // ---------- arengario on the facade (no pronao) ----------
  if (P.arengario && !pr && F >= 2) {
    const yb = yAt(1) + 0.15, aw = Math.min(b * 2 - 0.6, 6), dz = 1.5;
    const z0 = zMain + r;
    G.box('trim', -aw / 2, yb, z0, aw / 2, yb + 0.3, z0 + dz);
    G.box('trim', -aw / 2, yb + 0.3, z0 + dz - 0.18, aw / 2, yb + 1.3, z0 + dz);
    G.box('trim', -aw / 2, yb + 0.3, z0, -aw / 2 + 0.18, yb + 1.3, z0 + dz);
    G.box('trim', aw / 2 - 0.18, yb + 0.3, z0, aw / 2, yb + 1.3, z0 + dz);
    // corbel
    G.box('trim', -aw / 2 + 0.4, yb - 0.5, z0, aw / 2 - 0.4, yb, z0 + 0.6);
  }

  // ---------- canopy (pensilina) ----------
  if (P.canopy > 0 && !(pr && !pr.colonnade && P.typology !== 'stazione')) {
    const cd = P.canopy;
    const full = P.typology === 'stazione' || P.canopy > 5;
    const cw = full ? (xMax - xMin) - b * 2 : Math.min(3, nx) * b;
    const zc = pr ? zMain + Math.max(P.pronaoDepth, 1) : zMain + r;
    const yc = y0 + gh * 0.82;
    G.box('trim', -cw / 2, yc, zc, cw / 2, yc + 0.22, zc + cd);
    G.box('trim', -cw / 2, yc - 0.25, zc + cd - 0.12, cw / 2, yc + 0.34, zc + cd); // fascia
    if (cd > 5.5) {
      const nCol = Math.max(2, Math.round(cw / (b * 2)));
      const cg = new THREE.CylinderGeometry(0.16, 0.16, yc - y0, 12);
      for (let q = 0; q <= nCol; q++) {
        const x = -cw / 2 + 0.6 + (cw - 1.2) * q / nCol;
        G.geom('trim', cg, new THREE.Matrix4().makeTranslation(x, y0 + (yc - y0) / 2, zc + cd - 0.6));
      }
      cg.dispose();
    }
  }

  // ---------- vaulted hall ----------
  if (P.vault) {
    const hw = clamp(Math.floor(nx * 0.45), 3, nx - 2) * b;
    const zA = zMain - fd * b + b * 0.6, zB = zMain - b * 0.6;
    const hh = Math.max(4.5, (topMain - y0) * 0.45);
    const yb = topMain;
    G.box({ top: 'roof', sides: 'wall' }, -hw / 2, yb, zA, hw / 2, yb + hh, zB);
    // thin cornice
    G.box('trim', -hw / 2 - 0.3, yb + hh, zA - 0.3, hw / 2 + 0.3, yb + hh + 0.25, zB + 0.3);
    const s = hw * 0.2, R = (hw * hw / 4 + s * s) / (2 * s);
    const span = 2 * Math.asin((hw / 2) / R);
    const vg = new THREE.CylinderGeometry(R, R, zB - zA + 0.4, 48, 1, false, Math.PI - span / 2, span);
    const m = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    m.setPosition(0, yb + hh + 0.25 + s - R, (zA + zB) / 2);
    G.geom('trim', vg, m);
    vg.dispose();
  }

  // ---------- podium and stairs ----------
  let front = zMain + r;
  if (pr) front = Math.max(front, zMain + Math.max(P.pronaoDepth, r + 0.8));
  if (P.canopy > 0) front = Math.max(front, zMain + r + P.canopy);
  const margin = 2.5 + b * 0.3;
  const pod = {
    x0: xMin - r - margin, x1: xMax + r + margin,
    z0: zBack - r - margin, z1: Math.max(zFront + r, front) + margin + (P.podium > 0.3 ? 2 : 0),
  };
  if (towerInfo && towerInfo.onPodium) {
    pod.x0 = Math.min(pod.x0, towerInfo.x0 - margin); pod.x1 = Math.max(pod.x1, towerInfo.x1 + margin);
    pod.z1 = Math.max(pod.z1, towerInfo.z1 + margin);
  }
  let stairsInfo = null;
  if (P.podium > 0.05) {
    G.box({ top: 'paving', sides: 'base' }, pod.x0, 0, pod.z0, pod.x1, P.podium, pod.z1);
    // coping on the podium edge
    G.box('trim', pod.x0 - 0.1, P.podium - 0.12, pod.z1 - 0.5, pod.x1 + 0.1, P.podium + 0.02, pod.z1 + 0.1);
    if (P.stairs !== 'none') {
      const rise = 0.16, tread = 0.42;
      const N = Math.max(1, Math.round(P.podium / rise));
      const rr = P.podium / N;
      let sw;
      if (P.stairs === 'full') sw = (pod.x1 - pod.x0) - 2.0;
      else sw = pr ? Math.min((cx(pr.i1) - cx(pr.i0)) + 4, pod.x1 - pod.x0 - 2) : Math.min(b * 3.2, pod.x1 - pod.x0 - 2);
      for (let s = 0; s < N; s++) {
        G.box({ top: 'trim', sides: 'trim' }, -sw / 2, s * rr, pod.z1, sw / 2, (s + 1) * rr, pod.z1 + (N - s) * tread);
      }
      // cheek walls
      if (P.stairs === 'center' && N > 3) {
        const L = N * tread;
        G.box('base', -sw / 2 - 1.0, 0, pod.z1, -sw / 2, P.podium, pod.z1 + L);
        G.box('base', sw / 2, 0, pod.z1, sw / 2 + 1.0, P.podium, pod.z1 + L);
      }
      stairsInfo = { z0: pod.z1, z1: pod.z1 + N * tread, w: sw };
    }
  }

  return {
    xMin, xMax, zFront, zMain, zBack, y0,
    top: topMain + aH, H: topMain + aH - y0,
    towerTop: towerInfo ? towerInfo.top : 0,
    tower: towerInfo,
    podium: P.podium > 0.05 ? pod : null,
    stairs: stairsInfo,
    front: stairsInfo ? stairsInfo.z1 : (P.podium > 0.05 ? pod.z1 : front),
    mass: {
      x0: Math.min(xMin - r, towerInfo ? towerInfo.x0 : 1e9), x1: Math.max(xMax + r, towerInfo ? towerInfo.x1 : -1e9),
      z0: Math.min(zBack - r, towerInfo ? towerInfo.z0 : 1e9), z1: Math.max(zFront + r, front, towerInfo ? towerInfo.z1 : -1e9),
      y0: y0, y1: Math.max(topMain + aH, towerInfo ? towerInfo.top - 5 : 0),
    },
    bounds: {
      x0: Math.min(xMin - r, towerInfo ? towerInfo.x0 : 1e9, pod.x0) - 1,
      x1: Math.max(xMax + r, towerInfo ? towerInfo.x1 : -1e9, pod.x1) + 1,
      z0: Math.min(zBack - r, towerInfo ? towerInfo.z0 : 1e9, pod.z0) - 1,
      z1: Math.max(pod.z1, stairsInfo ? stairsInfo.z1 : -1e9, front) + 1,
      y1: Math.max(topMain + aH, towerInfo ? towerInfo.top : 0),
    },
  };
}

// ---------------------------------------------------------------------------
// Facade modules. Each fills one bay (width b, height h) of a face frame.
function modules(G, P, rng) {
  const r = P.reveal;
  const box = (key, F, u0, u1, v0, v1, w0, w1) => fbox(G, key, F, u0, u1, v0, v1, w0, w1);

  function windowUnit(F, u0, u1, v0, v1, opts = {}) {
    const w = u1 - u0, h = v1 - v0;
    const hv = Math.abs(Math.sin(F.ox * 12.9898 + F.oz * 78.233 + (F.y + v0) * 37.719 + u0 * 4.581) * 43758.5453) % 1;
    box(hv < 0.2 ? 'glass2' : 'glass', F, u0, u1, v0, v1, 0.02, 0.05);
    const t = 0.06, d0 = 0.03, d1 = opts.deep ? 0.18 : 0.11;
    box('frame', F, u0, u0 + t, v0, v1, d0, d1);
    box('frame', F, u1 - t, u1, v0, v1, d0, d1);
    box('frame', F, u0, u1, v1 - t, v1, d0, d1);
    box('frame', F, u0, u1, v0, v0 + t, d0, d1);
    if (w > 1.05) { const m = (u0 + u1) / 2; box('frame', F, m - t / 2, m + t / 2, v0, v1, d0, d1); }
    if (w > 2.4) { const m = u0 + w / 4, m2 = u0 + (3 * w) / 4; box('frame', F, m - t / 2, m + t / 2, v0, v1, d0, d1); box('frame', F, m2 - t / 2, m2 + t / 2, v0, v1, d0, d1); }
    if (h > 1.7) { const m = v0 + h * 0.74; box('frame', F, u0, u1, m - t / 2, m + t / 2, d0, d1); }
  }
  function surround(F, u0, u1, v0, v1) {
    const s = 0.14, d = r + 0.07;
    box('trim', F, u0 - s, u0, v0 - s, v1 + s, 0, d);
    box('trim', F, u1, u1 + s, v0 - s, v1 + s, 0, d);
    box('trim', F, u0, u1, v1, v1 + s, 0, d);
    box('trim', F, u0 - s - 0.06, u1 + s + 0.06, v0 - s - 0.02, v0, 0, d + 0.05); // sill
  }

  function punched(F, b, h, o) {
    const ww = clamp(b * P.winW, 0.6, b - 0.5);
    let wh = clamp(h * P.winH, 0.9, h - 0.7);
    let sill = (h - wh) * 0.42;
    if (o.plinth) { sill = Math.max(sill, o.plinth + 0.3); wh = Math.min(wh, h - sill - 0.6); }
    const p2 = (b - ww) / 2;
    box('wall', F, 0, p2, 0, h, 0, r);
    box('wall', F, b - p2, b, 0, h, 0, r);
    box('wall', F, p2, b - p2, 0, sill, 0, r);
    box('wall', F, p2, b - p2, sill + wh, h, 0, r);
    windowUnit(F, p2, b - p2, sill, sill + wh);
    if (P.surround) surround(F, p2, b - p2, sill, sill + wh);
  }

  function piers(F, b, h, o) {
    const pw = clamp(b * (1 - P.winW) * 0.8, 0.45, b - 0.9);
    const ww = b - pw;
    let wh = clamp(h * Math.max(P.winH, 0.55), 1.2, h - 0.6);
    let sill = (h - wh) * 0.45;
    if (o.plinth) { sill = Math.max(sill, o.plinth + 0.3); wh = Math.min(wh, h - sill - 0.5); }
    const rs = r * 0.3;
    box('wall', F, 0, pw / 2, 0, h, 0, r);
    box('wall', F, b - pw / 2, b, 0, h, 0, r);
    box('wall', F, pw / 2, b - pw / 2, 0, sill, 0, rs);
    box('wall', F, pw / 2, b - pw / 2, sill + wh, h, 0, rs);
    const inset = Math.min(0.25, ww * 0.1);
    windowUnit(F, pw / 2 + inset, b - pw / 2 - inset, sill, sill + wh);
    if (inset > 0) { box('wall', F, pw / 2, pw / 2 + inset, sill, sill + wh, 0, rs); box('wall', F, b - pw / 2 - inset, b - pw / 2, sill, sill + wh, 0, rs); }
  }

  function ribbon(F, b, h, o) {
    let wh = clamp(h * P.winH * 0.7, 1.1, Math.min(2.1, h - 1.2));
    let sill = Math.max((h - wh) * 0.5, o.plinth ? o.plinth + 0.3 : 0.9);
    wh = Math.min(wh, h - sill - 0.5);
    box('wall', F, 0, b, 0, sill, 0, r);
    box('wall', F, 0, b, sill + wh, h, 0, r);
    box('glass', F, 0, b, sill, sill + wh, 0.02, 0.05);
    const t = 0.07, d0 = 0.03, d1 = 0.12;
    box('frame', F, 0, t / 2, sill, sill + wh, d0, d1);
    box('frame', F, b - t / 2, b, sill, sill + wh, d0, d1);
    box('frame', F, b / 2 - t / 2, b / 2 + t / 2, sill, sill + wh, d0, d1);
    box('frame', F, 0, b, sill, sill + t, d0, d1);
    box('frame', F, 0, b, sill + wh - t, sill + wh, d0, d1);
  }

  function grid(F, b, h, o) {
    const t = clamp(b * 0.11, 0.3, 0.55);
    box('wall', F, 0, t / 2, 0, h, 0, r);
    box('wall', F, b - t / 2, b, 0, h, 0, r);
    const beam = o.plinth ? Math.max(t, o.plinth) : t;
    box('wall', F, t / 2, b - t / 2, 0, beam, 0, r);
    const kind = (o.id % 100) / 100;
    if (kind < 0.12 && !o.ground) {
      box('wall', F, t / 2, b - t / 2, beam, h, 0, r * 0.25); // blind infill
    } else {
      const par = o.ground ? 0 : 0.95;
      if (par) box('wall', F, t / 2, b - t / 2, beam, beam + par, 0, 0.12); // parapet behind the grid
      windowUnit(F, t / 2 + 0.08, b - t / 2 - 0.08, beam + par, h - 0.05, { deep: true });
    }
  }

  function archPanel(F, b, h, depth, ratio = P.winW * 1.15, hb = h * 0.06) {
    const aw = clamp(b * ratio, 0.8, b - 0.55);
    const topY = h * 0.93;
    const springY = Math.max(hb + 0.6, topY - aw / 2);
    const shape = new THREE.Shape();
    shape.moveTo(0, 0); shape.lineTo(b, 0); shape.lineTo(b, h); shape.lineTo(0, h); shape.lineTo(0, 0);
    const hole = new THREE.Path();
    const u0 = (b - aw) / 2, u1 = (b + aw) / 2;
    hole.moveTo(u0, hb); hole.lineTo(u0, springY);
    hole.absarc(b / 2, springY, aw / 2, Math.PI, 0, true);
    hole.lineTo(u1, hb); hole.lineTo(u0, hb);
    shape.holes.push(hole);
    const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 12 });
    G.geom('wall', g, frameMatrix(F));
    g.dispose();
    return { u0, u1, hb, springY, aw };
  }

  function arcade(F, b, h, o) {
    const hb = o.plinth ? o.plinth + 0.05 : Math.max(0.2, h * 0.05);
    const a = archPanel(F, b, h, r, P.winW * 1.15, hb);
    // glazed door/window at the back of the loggia
    const dw = a.aw * 0.62, u0 = b / 2 - dw / 2;
    const dh = Math.min(a.springY - hb + a.aw * 0.25, h * 0.7);
    windowUnit(F, u0, u0 + dw, hb, hb + dh);
  }

  function curtain(F, b, h) {
    box('wall', F, 0, b, 0, 0.5, 0, 0.14);
    box('glass', F, 0, b, 0.5, h, 0.02, 0.05);
    const t = 0.1, d0 = 0.02, d1 = 0.2;
    box('frame', F, 0, t / 2, 0.5, h, d0, d1);
    box('frame', F, b - t / 2, b, 0.5, h, d0, d1);
    box('frame', F, b / 2 - t / 2, b / 2 + t / 2, 0.5, h, d0, d1);
    box('frame', F, 0, b, h * 0.62 - t / 2, h * 0.62 + t / 2, d0, d1);
  }

  function shop(F, b, h) {
    const hh = Math.min(h - 0.6, 3.6);
    box('wall', F, 0, b, hh, h, 0, 0.12);
    box('wall', F, 0, 0.12, 0, hh, 0, 0.12);
    box('wall', F, b - 0.12, b, 0, hh, 0, 0.12);
    windowUnit(F, 0.12, b - 0.12, 0, hh);
  }

  function glazed(F, b, h) {
    box('wall', F, 0, b, 0, 0.9, 0, 0.1);
    box('wall', F, 0, b, h - 0.5, h, 0, 0.1);
    windowUnit(F, 0.15, b - 0.15, 0.9, h - 0.5);
  }

  function door(F, b, h, o) {
    const dw = clamp(b - 1.2, 1.6, 2.8);
    const dh = Math.min(h - 0.8, 3.8);
    const p2 = (b - dw) / 2;
    box('wall', F, 0, p2, 0, h, 0, r);
    box('wall', F, b - p2, b, 0, h, 0, r);
    box('wall', F, p2, b - p2, dh, h, 0, r);
    box('dark', F, p2, b - p2, 0, dh, 0.0, 0.02);
    box('frame', F, p2 + 0.08, b / 2 - 0.02, 0.02, dh - 0.08, 0.02, 0.07);
    box('frame', F, b / 2 + 0.02, b - p2 - 0.08, 0.02, dh - 0.08, 0.02, 0.07);
    box('trim', F, p2 - 0.22, b - p2 + 0.22, dh, dh + 0.25, 0, r + 0.1);
    box('trim', F, p2 - 0.22, p2, 0, dh, 0, r + 0.1);
    box('trim', F, b - p2, b - p2 + 0.22, 0, dh, 0, r + 0.1);
  }

  function blank(F, b, h, o) {
    if (o.slit) {
      const sw = Math.min(1.0, b * 0.26);
      box('wall', F, 0, b / 2 - sw / 2, 0, h, 0, r);
      box('wall', F, b / 2 + sw / 2, b, 0, h, 0, r);
      box('glassblock', F, b / 2 - sw / 2, b / 2 + sw / 2, 0, h, 0.02, 0.06);
      return;
    }
    box('wall', F, 0, b, 0, h, 0, r);
  }

  const table = { punched, piers, ribbon, grid, arcade, curtain, shop, glazed, door, blank };
  return {
    module(style, F, b, h, o) { (table[style] || punched)(F, b, h, o); },
    archPanel: (F, b, h, depth, ratio) => archPanel(F, b, h, depth, ratio, 0.05),
    punched, windowUnit,
  };
}

// ---------------------------------------------------------------------------
function buildTower(G, P, M, rng, K) {
  const { xMin, xMax, zFront, zMain, zBack, y0, topMain, aH, b, r } = K;
  const tw = clamp(P.towerW * b, 4.5, 14);
  const TH = Math.max((topMain + aH - y0) * P.towerH, 14);
  let x0, z1;
  const pos = P.tower;
  if (pos === 'left') { x0 = xMin - r - tw * 0.22; z1 = zFront + r + tw * 0.25; }
  else if (pos === 'right') { x0 = xMax + r + tw * 0.22 - tw; z1 = zFront + r + tw * 0.25; }
  else if (pos === 'back') { x0 = -tw / 2; z1 = zMain - K.fd * b + tw * 0.4; }
  else if (pos === 'center') { x0 = -tw / 2; z1 = zMain - b; }
  else { x0 = xMin - r - tw - 7; z1 = zFront - b; } // free-standing
  const x1 = x0 + tw, z0 = z1 - tw;
  const onPodium = pos !== 'free' || P.podium < 0.05;
  const yb = pos === 'free' ? 0 : y0;
  const top = yb + TH;
  const cxT = (x0 + x1) / 2, czT = (z0 + z1) / 2;
  const style = P.towerStyle;
  const rt = 0.35;

  // square tower faces (frames on an inset core)
  const faces = (y) => [
    frame(x0 + rt, z1 - rt, 1, 0, 0, 1, y),
    frame(x1 - rt, z0 + rt, -1, 0, 0, -1, y),
    frame(x1 - rt, z1 - rt, 0, -1, 1, 0, y),
    frame(x0 + rt, z0 + rt, 0, 1, -1, 0, y),
  ];
  const inner = tw - 2 * rt;
  const box = (key, F, ...a) => fbox(G, key, F, ...a);

  if (style === 'cylinder' || style === 'spiral') {
    const R = tw / 2 * (style === 'spiral' ? 0.72 : 0.62);
    const cyl = new THREE.CylinderGeometry(R, R, TH, 56);
    G.geom('wall', cyl, new THREE.Matrix4().makeTranslation(cxT, yb + TH / 2, czT));
    cyl.dispose();
    if (style === 'spiral') {
      const fl = 3.4, n = Math.floor((TH - 2) / fl);
      for (let j = 1; j <= n; j++) {
        const y = yb + j * fl;
        const a0 = -Math.PI * 0.2 + j * 0.62, span = Math.PI * 1.15;
        ring(G, 'wall', cxT, czT, R - 0.05, R + 2.4, a0, span, y - 0.3, 0.3);
        ring(G, 'wall', cxT, czT, R + 2.25, R + 2.4, a0, span, y, 1.05);
        // glass band under each balcony
        const gb = new THREE.CylinderGeometry(R + 0.02, R + 0.02, 1.5, 56, 1, true, a0 + Math.PI / 2 - 0.3, span + 0.6);
        G.geom('glass', gb, new THREE.Matrix4().makeTranslation(cxT, y - 1.35, czT));
        gb.dispose();
      }
      ring(G, 'wall', cxT, czT, 0, R + 0.4, 0, Math.PI * 2, top, 0.35);
    } else {
      // lighthouse: small windows up the front, gallery, lantern
      for (let y = yb + 4; y < top - 4; y += 3.6) {
        const wg = new THREE.BoxGeometry(0.6, 1.1, 0.3);
        G.geom('dark', wg, new THREE.Matrix4().makeTranslation(cxT, y, czT + R - 0.05));
        wg.dispose();
      }
      ring(G, 'trim', cxT, czT, 0, R + 1.1, 0, Math.PI * 2, top, 0.35);
      ring(G, 'metal', cxT, czT, R + 1.0, R + 1.06, 0, Math.PI * 2, top + 0.35, 1.0);
      const lan = new THREE.CylinderGeometry(R * 0.55, R * 0.55, 2.6, 24);
      G.geom('glass', lan, new THREE.Matrix4().makeTranslation(cxT, top + 0.35 + 1.3, czT));
      const cap = new THREE.ConeGeometry(R * 0.7, 1.2, 24);
      G.geom('metal', cap, new THREE.Matrix4().makeTranslation(cxT, top + 0.35 + 2.6 + 0.6, czT));
      lan.dispose(); cap.dispose();
    }
    return { x0, x1, z0, z1, top: top + 3, onPodium, cx: cxT, cz: czT, w: tw };
  }

  // square towers: inset core + walls per floor band
  const fl = 3.6;
  const belH = style === 'belvedere' ? clamp(tw * 1.05, 5, 9) : 0;
  const shaftTop = top - belH;
  G.box({ top: 'roof', sides: 'wall' }, x0 + rt, yb, z0 + rt, x1 - rt, shaftTop, z1 - rt);
  const nFl = Math.max(1, Math.floor((shaftTop - yb) / fl));
  const flH = (shaftTop - yb) / nFl;
  faces(0).forEach((F0, fi) => {
    for (let q = 0; q < nFl; q++) {
      const F = { ...F0, y: yb + q * flH };
      const mid = q > 0 && q < nFl - 1;
      if (style === 'slit' && mid && fi !== 1) {
        const sw = Math.min(1.1, inner * 0.2);
        box('wall', F, -rt, inner / 2 - sw / 2, 0, flH, 0, rt);
        box('wall', F, inner / 2 + sw / 2, inner + rt, 0, flH, 0, rt);
        box('glassblock', F, inner / 2 - sw / 2, inner / 2 + sw / 2, 0, flH, 0.02, 0.06);
      } else if ((style === 'grid' || style === 'belvedere') && q > 0) {
        const ww = Math.min(1.0, inner * 0.24), wh = Math.min(1.5, flH * 0.45);
        const u0 = inner / 2 - ww / 2, u1 = inner / 2 + ww / 2, v0 = flH * 0.35, v1 = v0 + wh;
        box('wall', F, -rt, u0, 0, flH, 0, rt);
        box('wall', F, u1, inner + rt, 0, flH, 0, rt);
        box('wall', F, u0, u1, 0, v0, 0, rt);
        box('wall', F, u0, u1, v1, flH, 0, rt);
        M.windowUnit(F, u0, u1, v0, v1);
      } else {
        box('wall', F, -rt, inner + rt, 0, flH, 0, rt);
      }
    }
  });
  // door at the foot of the front face
  { const F = faces(yb)[0]; const dw = Math.min(2.2, inner * 0.35); box('dark', F, inner / 2 - dw / 2, inner / 2 + dw / 2, 0, 3.4, rt, rt + 0.02); }

  if (belH > 0) {
    // open belvedere: corner piers, arched openings, crowning slab
    const cp = clamp(tw * 0.17, 0.8, 1.8);
    faces(shaftTop).forEach((F) => {
      const Fo = { ...F };
      const shape = new THREE.Shape();
      const W = inner + 2 * rt, H = belH;
      shape.moveTo(0, 0); shape.lineTo(W, 0); shape.lineTo(W, H); shape.lineTo(0, H); shape.lineTo(0, 0);
      const aw = W - 2 * cp, spring = H * 0.9 - aw / 2;
      const hole = new THREE.Path();
      hole.moveTo(cp, 1.1); hole.lineTo(cp, Math.max(1.4, spring)); hole.absarc(W / 2, Math.max(1.4, spring), aw / 2, Math.PI, 0, true); hole.lineTo(W - cp, 1.1); hole.lineTo(cp, 1.1);
      shape.holes.push(hole);
      const g = new THREE.ExtrudeGeometry(shape, { depth: cp, bevelEnabled: false, curveSegments: 14 });
      G.geom('wall', g, frameMatrix(Fo, -rt, 0, -cp + rt));
      g.dispose();
    });
    G.box('trim', x0 - 0.35, top, z0 - 0.35, x1 + 0.35, top + 0.3, z1 + 0.35);
    G.box('roof', x0 + cp, shaftTop, z0 + cp, x1 - cp, shaftTop + 0.05, z1 - cp);
  } else {
    G.box('trim', x0 - 0.25, top, z0 - 0.25, x1 + 0.25, top + 0.25, z1 + 0.25);
  }

  // clock on the front face
  if (style === 'slit' || (style === 'grid' && rng.chance(0.5))) {
    const cr = Math.min(1.5, tw * 0.2);
    const cyc = top - cr - 1.4 - belH;
    const disc = new THREE.CylinderGeometry(cr, cr, 0.12, 40);
    const m = new THREE.Matrix4().makeRotationX(Math.PI / 2); m.setPosition(cxT, cyc, z1 + 0.06);
    G.geom('clock', disc, m); disc.dispose();
    const ring2 = new THREE.TorusGeometry(cr, 0.08, 6, 40);
    const m2 = new THREE.Matrix4().makeTranslation(cxT, cyc, z1 + 0.12);
    G.geom('trim', ring2, m2); ring2.dispose();
    const hand = (len, ang) => {
      const hg = new THREE.BoxGeometry(0.1, len, 0.05);
      hg.translate(0, len / 2, 0);
      const mm = new THREE.Matrix4().makeRotationZ(ang); mm.setPosition(cxT, cyc, z1 + 0.16);
      G.geom('frame', hg, mm); hg.dispose();
    };
    hand(cr * 0.8, -rng.float(0, Math.PI * 2));
    hand(cr * 0.55, -rng.float(0, Math.PI * 2));
    for (let q = 0; q < 12; q++) {
      const a = q / 12 * Math.PI * 2;
      G.box('frame', cxT + Math.sin(a) * cr * 0.86 - 0.05, cyc + Math.cos(a) * cr * 0.86 - 0.05, z1 + 0.12, cxT + Math.sin(a) * cr * 0.86 + 0.05, cyc + Math.cos(a) * cr * 0.86 + 0.05, z1 + 0.15);
    }
  }
  // arengario on the tower
  if (P.arengario && (pos === 'left' || pos === 'right' || pos === 'free') && P.pronao === 0) {
    const yA = yb + Math.max(P.floorH * P.groundH, 4.5) + 0.2, aw = tw * 0.55;
    G.box('trim', cxT - aw / 2, yA, z1, cxT + aw / 2, yA + 0.3, z1 + 1.4);
    G.box('trim', cxT - aw / 2, yA + 0.3, z1 + 1.22, cxT + aw / 2, yA + 1.3, z1 + 1.4);
    G.box('trim', cxT - aw / 2, yA + 0.3, z1, cxT - aw / 2 + 0.18, yA + 1.3, z1 + 1.4);
    G.box('trim', cxT + aw / 2 - 0.18, yA + 0.3, z1, cxT + aw / 2, yA + 1.3, z1 + 1.4);
  }
  // mast
  const mast = new THREE.CylinderGeometry(0.07, 0.1, 7, 8);
  G.geom('metal', mast, new THREE.Matrix4().makeTranslation(cxT, top + 3.8, czT));
  mast.dispose();
  return { x0, x1, z0, z1, top: top + 7, onPodium, cx: cxT, cz: czT, w: tw };
}

// Annular sector extruded vertically (balconies, parapets, discs)
function ring(G, key, cx, cz, r0, r1, a0, span, y, h) {
  const s = new THREE.Shape();
  const seg = Math.max(8, Math.ceil(span / (Math.PI * 2) * 64));
  for (let q = 0; q <= seg; q++) { const a = a0 + span * q / seg; const x = Math.cos(a) * r1, z = Math.sin(a) * r1; q ? s.lineTo(x, z) : s.moveTo(x, z); }
  if (r0 > 0.01) for (let q = seg; q >= 0; q--) { const a = a0 + span * q / seg; s.lineTo(Math.cos(a) * r0, Math.sin(a) * r0); }
  else s.lineTo(0, 0);
  const g = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false, curveSegments: 1 });
  // shape is in XY; rotate so extrusion goes up (+y): x→x, y→-z, z→y
  const m = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
  m.setPosition(cx, y, cz);
  G.geom(key, g, m);
  g.dispose();
}
