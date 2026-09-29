// Seeded random helpers. Same seed → same building, on every machine.

export function mulberry32(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const r = {
    next,
    float: (min = 0, max = 1) => min + (max - min) * next(),
    int: (min, max) => Math.floor(min + (max - min + 1) * next()), // inclusive
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    chance: (p) => next() < p,
    // weighted pick: [[value, weight], ...]
    weighted: (pairs) => {
      const total = pairs.reduce((s, p) => s + p[1], 0);
      let x = next() * total;
      for (const [v, w] of pairs) { if ((x -= w) <= 0) return v; }
      return pairs[pairs.length - 1][0];
    },
    odd: (min, max) => { let v = Math.floor(min + (max - min + 1) * next()); return v % 2 ? v : Math.min(max, v + 1) | 1; },
  };
  return r;
}

export function randomSeed() {
  return Math.floor(Math.random() * 999999) + 1;
}

// Deterministic hash of a string/number into a 32-bit seed
export function hashSeed(x) {
  const s = String(x);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
