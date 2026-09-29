// Typologies of the rationalist repertoire, each as a probability space over
// the parameters. "Genera" draws a building from the chosen typology.
import { mulberry32, hashSeed } from './rng.js';

export const SCHEMA = {
  plan: { type: 'select', options: ['bar', 'L', 'T', 'U', 'corte', 'chiusa'] },
  bays: { type: 'range', min: 5, max: 41, step: 1 },
  depth: { type: 'range', min: 1, max: 8, step: 1 },
  wingLen: { type: 'range', min: 1, max: 14, step: 1 },
  wingW: { type: 'range', min: 1, max: 6, step: 1 },
  floors: { type: 'range', min: 1, max: 10, step: 1 },
  wingDelta: { type: 'range', min: -4, max: 0, step: 1 },
  bay: { type: 'range', min: 3, max: 6, step: 0.1, unit: 'm' },
  floorH: { type: 'range', min: 3.2, max: 6.5, step: 0.1, unit: 'm' },
  groundH: { type: 'range', min: 1, max: 2, step: 0.05, unit: '×' },
  facade: { type: 'select', options: ['punched', 'piers', 'ribbon', 'grid', 'colonnade', 'blank'] },
  sideFacade: { type: 'select', options: ['punched', 'piers', 'ribbon', 'grid', 'blank'] },
  winW: { type: 'range', min: 0.25, max: 0.8, step: 0.01 },
  winH: { type: 'range', min: 0.3, max: 0.9, step: 0.01 },
  reveal: { type: 'range', min: 0.15, max: 1.2, step: 0.05, unit: 'm' },
  surround: { type: 'toggle' },
  loggia: { type: 'toggle' },
  attic: { type: 'range', min: 0, max: 4, step: 0.1, unit: 'm' },
  cornice: { type: 'range', min: 0, max: 1.5, step: 0.05, unit: 'm' },
  plinth: { type: 'range', min: 0, max: 1.5, step: 0.05, unit: 'm' },
  portico: { type: 'select', options: ['none', 'pilotis', 'double'] },
  pronao: { type: 'range', min: 0, max: 9, step: 1 },
  pronaoPiers: { type: 'range', min: 2, max: 8, step: 1 },
  pronaoDepth: { type: 'range', min: 1, max: 6, step: 0.1, unit: 'm' },
  pronaoRise: { type: 'range', min: 0, max: 8, step: 0.1, unit: 'm' },
  tower: { type: 'select', options: ['none', 'left', 'right', 'back', 'center', 'free'] },
  towerStyle: { type: 'select', options: ['slit', 'belvedere', 'grid', 'cylinder', 'spiral'] },
  towerH: { type: 'range', min: 1.2, max: 4, step: 0.05, unit: '×' },
  towerW: { type: 'range', min: 1, max: 3, step: 0.05 },
  arengario: { type: 'toggle' },
  canopy: { type: 'range', min: 0, max: 12, step: 0.25, unit: 'm' },
  vault: { type: 'toggle' },
  podium: { type: 'range', min: 0, max: 4, step: 0.05, unit: 'm' },
  stairs: { type: 'select', options: ['none', 'center', 'full'] },
  material: { type: 'select', options: ['travertino', 'marmo', 'intonaco', 'ocra', 'mattone'] },
  env: { type: 'select', options: ['piazza', 'campagna', 'mare'] },
  trees: { type: 'range', min: 0, max: 60, step: 1 },
  figures: { type: 'range', min: 0, max: 40, step: 1 },
  lamps: { type: 'range', min: 0, max: 12, step: 1 },
  masts: { type: 'range', min: 0, max: 4, step: 1 },
  stele: { type: 'toggle' },
};

export const TYPOLOGIES = ['palazzo', 'poste', 'stazione', 'universita', 'colonia', 'telaio', 'congressi'];

const TOWNS = ['Valdora', 'Aureliana', 'Pontesilva', 'Marelia', 'Castelmare Nuovo', 'Fonteluce', 'Ardelia', 'Lucentia',
  'Borgo Solaria', 'Novalia', 'Cervaria', 'Albarena', 'Montenova', 'Serralba', 'Torre Lieta', 'Campolargo',
  'Vallerana', 'Porto Aurelio', 'Sabriana', 'Litoria Nuova', 'Rocca Bianca', 'Pianalta', 'Castrovento', 'Selvapiana'];

const NAMES = {
  palazzo: { it: ['Palazzo del Governo', 'Palazzo degli Uffici', 'Palazzo Comunale', 'Palazzo di Giustizia', 'Palazzo della Provincia'],
    en: ['Government Palace', 'Palace of Offices', 'Town Hall', 'Palace of Justice', 'Provincial Palace'] },
  poste: { it: ['Palazzo delle Poste'], en: ['Post Office'] },
  stazione: { it: ['Stazione ferroviaria', 'Stazione centrale'], en: ['Railway Station', 'Central Station'] },
  universita: { it: ['Città universitaria', 'Istituto di Fisica', 'Facoltà di Lettere', 'Rettorato', 'Scuola di Architettura'],
    en: ['University City', 'Institute of Physics', 'Faculty of Letters', 'Rectorate', 'School of Architecture'] },
  colonia: { it: ['Colonia marina', 'Colonia elioterapica'], en: ['Seaside Colony', 'Heliotherapy Colony'] },
  telaio: { it: ['Casa del Popolo', 'Sede civica', 'Casa dello Studente'], en: ['House of the People', 'Civic Center', 'Student House'] },
  congressi: { it: ['Palazzo dei Congressi', 'Palazzo dei Ricevimenti', 'Teatro'], en: ['Congress Palace', 'Reception Palace', 'Theater'] },
};

const nameIndex = (typology, seed) => hashSeed(seed + ':name:' + typology) % (NAMES[typology] || NAMES.palazzo).it.length;

export function caption(P, seed, lang) {
  const r = mulberry32(hashSeed(seed + ':caption'));
  const list = NAMES[P.typology] || NAMES.palazzo;
  const idx = nameIndex(P.typology, seed);
  return {
    name: (lang === 'en' ? list.en : list.it)[idx],
    town: TOWNS[Math.floor(r.next() * TOWNS.length)],
    year: 1928 + Math.floor(r.next() * 15),
    number: String(seed % 10000).padStart(4, '0'),
  };
}

// Draw a full parameter set from a typology
export function generate(typology, seed) {
  const r = mulberry32(hashSeed(seed + ':' + typology));
  const w = r.weighted;
  const P = {
    typology, plan: 'bar', bays: 15, depth: 3, wingLen: 4, wingW: 3, floors: 5, wingDelta: 0,
    bay: 4, floorH: 4, groundH: 1.3, facade: 'punched', sideFacade: 'punched', winW: 0.42, winH: 0.55,
    reveal: 0.4, surround: false, loggia: false, attic: 2, cornice: 0.3, plinth: 0.6,
    portico: 'none', pronao: 0, pronaoPiers: 4, pronaoDepth: 2.5, pronaoRise: 1.5,
    tower: 'none', towerStyle: 'slit', towerH: 2, towerW: 1.6, arengario: false, canopy: 0, vault: false,
    podium: 1, stairs: 'center', material: 'travertino', env: 'piazza',
    trees: r.int(8, 22), figures: r.int(4, 14), lamps: r.chance(0.4) ? r.int(2, 6) : 0, masts: r.chance(0.35) ? r.int(1, 3) : 0, stele: false,
  };

  switch (typology) {
    case 'palazzo':
      Object.assign(P, {
        plan: w([['bar', 3], ['U', 2], ['corte', 2], ['chiusa', 1.5], ['L', 1]]),
        bays: r.odd(13, 25), depth: r.int(3, 4), wingLen: r.int(3, 7), wingW: 3, floors: r.int(4, 6), wingDelta: r.int(-1, 0),
        bay: r.float(3.8, 4.4), floorH: r.float(3.9, 4.3), groundH: r.float(1.2, 1.4),
        facade: w([['punched', 4.5], ['piers', 3.5], ['grid', 1], ['ribbon', 1]]),
        winW: r.float(0.34, 0.5), winH: r.float(0.5, 0.62), reveal: r.float(0.35, 0.5), surround: r.chance(0.5),
        attic: r.float(1.6, 3), cornice: r.chance(0.5) ? r.float(0.2, 0.7) : 0, loggia: r.chance(0.3),
        podium: r.float(0.6, 1.8), material: w([['travertino', 4.5], ['marmo', 2], ['intonaco', 2], ['mattone', 1.5]]),
        tower: w([['none', 4.5], ['left', 2], ['right', 2], ['back', 1.5]]), towerStyle: w([['slit', 5], ['belvedere', 2.5], ['grid', 2.5]]),
        towerH: r.float(1.6, 2.4), towerW: r.float(1.4, 2), arengario: r.chance(0.5),
      });
      P.sideFacade = r.chance(0.6) ? (P.facade === 'grid' ? 'punched' : P.facade) : 'punched';
      if (r.chance(0.6)) Object.assign(P, { pronao: r.odd(3, 5), pronaoPiers: r.int(2, 4), pronaoDepth: r.float(2, 3.5), pronaoRise: r.float(1, 3) });
      else P.portico = w([['none', 5], ['pilotis', 3], ['double', 2]]);
      P.stairs = P.pronao ? 'center' : w([['full', 1], ['center', 1]]);
      if (!P.pronao && r.chance(0.3)) P.canopy = r.float(3, 4);
      break;
    case 'poste':
      Object.assign(P, {
        plan: w([['bar', 5], ['L', 3], ['T', 2]]), bays: r.odd(11, 19), depth: 3, wingLen: r.int(3, 6), floors: r.int(3, 4),
        bay: r.float(3.8, 4.4), floorH: r.float(3.9, 4.4), groundH: r.float(1.3, 1.5),
        facade: w([['ribbon', 4], ['piers', 3], ['punched', 3]]), sideFacade: w([['punched', 2], ['ribbon', 1], ['blank', 1]]),
        winW: r.float(0.38, 0.55), winH: r.float(0.5, 0.65), reveal: r.float(0.3, 0.45),
        attic: r.float(1.2, 2.4), cornice: r.chance(0.4) ? r.float(0.2, 0.6) : 0,
        podium: r.float(0.3, 0.8), stairs: 'full', material: w([['marmo', 4], ['travertino', 3], ['intonaco', 3]]),
        tower: w([['none', 6], ['left', 2], ['right', 2]]), towerStyle: w([['slit', 3], ['grid', 1]]), towerH: r.float(1.6, 2.3),
        canopy: r.chance(0.6) ? r.float(3, 5) : 0,
      });
      if (r.chance(0.3)) Object.assign(P, { pronao: 3, pronaoPiers: r.int(2, 3), pronaoDepth: r.float(1.6, 2.6), pronaoRise: r.float(0.5, 2) });
      break;
    case 'stazione':
      Object.assign(P, {
        plan: 'bar', bays: r.odd(21, 33), depth: 3, floors: r.int(2, 3), bay: r.float(4.2, 5), floorH: r.float(4.2, 4.8), groundH: r.float(1.5, 1.8),
        facade: w([['colonnade', 3.5], ['ribbon', 3.5], ['piers', 3]]), sideFacade: 'punched',
        winW: r.float(0.45, 0.6), winH: r.float(0.55, 0.7), reveal: r.float(0.3, 0.45), attic: r.float(1.8, 3), cornice: r.float(0, 0.4),
        pronaoDepth: r.float(2.6, 4), podium: r.float(0, 0.4), stairs: 'full', material: w([['travertino', 5], ['marmo', 3], ['intonaco', 2]]),
        tower: w([['left', 3.5], ['right', 3.5], ['none', 3]]), towerStyle: 'slit', towerH: r.float(2.2, 3.2), towerW: r.float(1.3, 1.7),
        canopy: r.chance(0.8) ? r.float(6, 10) : 0, lamps: r.int(4, 8), figures: r.int(10, 24),
      });
      if (P.facade !== 'colonnade' && r.chance(0.4)) Object.assign(P, { pronao: r.odd(5, 7), pronaoPiers: r.int(4, 6), pronaoDepth: r.float(2, 3), pronaoRise: r.float(0, 2) });
      break;
    case 'universita':
      Object.assign(P, {
        plan: w([['corte', 3.5], ['U', 2.5], ['chiusa', 2], ['bar', 2]]), bays: r.odd(15, 25), depth: r.int(3, 4), wingLen: r.int(4, 8), wingW: 3,
        floors: r.int(4, 5), wingDelta: r.int(-1, 0), bay: r.float(3.8, 4.3), floorH: r.float(4, 4.4), groundH: r.float(1.2, 1.4),
        facade: w([['piers', 5], ['punched', 5]]), winW: r.float(0.34, 0.48), winH: r.float(0.52, 0.64), reveal: r.float(0.35, 0.5),
        attic: r.float(2, 3.2), cornice: r.chance(0.5) ? r.float(0.2, 0.5) : 0, surround: r.chance(0.4),
        pronao: r.chance(0.85) ? r.odd(3, 5) : 0, pronaoPiers: r.int(3, 5), pronaoDepth: r.float(2.5, 4), pronaoRise: r.float(2, 5),
        podium: r.float(1, 2.2), stairs: 'center', material: w([['travertino', 6], ['marmo', 2], ['mattone', 2]]),
        tower: w([['none', 8], ['back', 2]]), towerStyle: 'belvedere', towerH: r.float(1.5, 2),
      });
      P.sideFacade = P.facade;
      break;
    case 'colonia':
      Object.assign(P, {
        plan: w([['bar', 6], ['L', 4]]), bays: r.odd(13, 21), depth: r.int(2, 3), wingLen: r.int(3, 6), wingW: 2, floors: r.int(3, 4), wingDelta: -1,
        bay: r.float(3.6, 4.2), floorH: r.float(3.4, 3.8), groundH: 1,
        facade: w([['ribbon', 7], ['grid', 3]]), sideFacade: w([['ribbon', 1], ['blank', 1]]),
        winW: 0.5, winH: r.float(0.5, 0.65), reveal: r.float(0.25, 0.4), attic: r.float(1, 1.2), cornice: r.chance(0.5) ? r.float(0.2, 0.5) : 0,
        plinth: 0, portico: r.chance(0.7) ? 'pilotis' : 'none', loggia: r.chance(0.3), podium: 0, stairs: 'none',
        material: 'intonaco', env: 'mare', tower: w([['left', 3], ['right', 3], ['free', 2], ['none', 1]]),
        towerStyle: w([['spiral', 5], ['cylinder', 3], ['slit', 2]]), towerH: r.float(1.8, 2.8), towerW: r.float(1.6, 2.2), trees: r.int(4, 12), lamps: 0,
      });
      break;
    case 'telaio': {
      const n = r.int(7, 9);
      Object.assign(P, {
        plan: w([['chiusa', 1], ['bar', 1]]), bays: n, depth: r.chance(0.5) ? 2 : n, wingLen: Math.max(1, n - 4), wingW: 2, floors: 4, wingDelta: 0,
        bay: r.float(3.9, 4.3), floorH: r.float(3.6, 4), groundH: r.float(1.1, 1.25),
        facade: 'grid', sideFacade: w([['blank', 1], ['grid', 1]]), reveal: r.float(0.9, 1.2), winW: 0.5, winH: 0.6,
        attic: r.float(1, 1.4), cornice: 0, plinth: 0, portico: r.chance(0.3) ? 'pilotis' : 'none',
        podium: r.float(0.4, 0.8), stairs: 'full', material: w([['marmo', 1], ['intonaco', 1]]),
        tower: r.chance(0.15) ? 'right' : 'none', towerStyle: 'slit',
      });
      if (P.plan === 'bar') P.depth = Math.min(n, 5);
      break;
    }
    case 'congressi':
      Object.assign(P, {
        plan: 'bar', bays: r.odd(11, 17), depth: r.int(5, 7), floors: r.int(2, 3), bay: r.float(4.2, 4.8), floorH: r.float(5, 6), groundH: 1,
        facade: 'colonnade', sideFacade: w([['blank', 1], ['punched', 1]]), winW: 0.4, winH: 0.6, reveal: 0.4,
        attic: r.float(2, 3.2), cornice: r.float(0, 0.4), pronaoDepth: r.float(3, 4.5), vault: r.chance(0.8),
        podium: r.float(1, 2), stairs: 'full', material: w([['travertino', 6], ['marmo', 4]]), stele: r.chance(0.25),
      });
      break;
  }
  P.bay = round(P.bay, 1); P.floorH = round(P.floorH, 1); P.groundH = round(P.groundH, 2);
  for (const k of ['winW', 'winH', 'reveal', 'attic', 'cornice', 'plinth', 'pronaoDepth', 'pronaoRise', 'towerH', 'towerW', 'canopy', 'podium']) P[k] = round(P[k], 2);
  return P;
}

const round = (x, d) => Math.round(x * 10 ** d) / 10 ** d;

// Clamp/repair a parameter object (from a pasted code or an old version)
export function sanitize(P, fallback) {
  const out = { ...fallback };
  for (const [k, s] of Object.entries(SCHEMA)) {
    if (!(k in P)) continue;
    const v = P[k];
    if (s.type === 'range' && typeof v === 'number' && isFinite(v)) out[k] = Math.max(s.min, Math.min(s.max, v));
    else if (s.type === 'select' && s.options.includes(v)) out[k] = v;
    else if (s.type === 'toggle') out[k] = !!v;
      }
  if (TYPOLOGIES.includes(P.typology)) out.typology = P.typology;
  return out;
}
