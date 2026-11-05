// Génome (= conception d'un organisme) : normalisation, phénotype dérivé, mutations.
import { PARAMS, ORG, ORGANELLES, ENVELOPE, MET } from '../data/index.js';
import { computeGeometry } from './geometry.js';
import { registerOrganelle } from './organelleDesign.js';

const C = PARAMS.cell;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function defaultDesign() {
  return {
    name: 'Ma bactérie',
    type: 'procaryote',
    color: '#4ea8de',
    shape: { kind: 'coque', size: 1.0, aspect: 1, points: null },
    envelope: { wall: 0.2, capsule: false, motility: 'aucune', motilityUnits: 0, parasite: false, adhesins: false },
    organelles: { nucleoide: 1, ribosomes: 2 },
    organellePositions: {},
    enzymes: { glycolyse: 2, krebs: 1, chaine_respiratoire: 1.2, fermentation_lactique: 0.5, synthese_aa: 1.5 },
    customEnzymes: [],
    hue: 0,
  };
}

/** Copie profonde + bornes + organites obligatoires. Ne lève pas d'erreur. */
export function normalizeDesign(d) {
  const g = JSON.parse(JSON.stringify(d));
  g.type = g.type === 'eucaryote' ? 'eucaryote' : 'procaryote';
  g.shape = g.shape || { kind: 'coque', size: 1 };
  const [smin, smax] = g.type === 'eucaryote' ? [C.eukSizeMin, C.eukSizeMax] : [C.prokSizeMin, C.prokSizeMax];
  g.shape.size = clamp(+g.shape.size || smin, smin, smax);
  g.shape.aspect = clamp(+g.shape.aspect || 1, 1, 8);
  if (g.shape.kind !== 'libre') g.shape.points = null;
  const e = (g.envelope = Object.assign({ wall: 0, capsule: false, motility: 'aucune', motilityUnits: 0, parasite: false, adhesins: false }, g.envelope));
  e.wall = clamp(+e.wall || 0, 0, ENVELOPE.wall.maxThickness);
  const mot = ENVELOPE.motility[e.motility];
  if (!mot || !mot.types.includes(g.type)) e.motility = 'aucune';
  e.motilityUnits = e.motility === 'aucune' ? 0 : clamp(Math.round(e.motilityUnits || 1), 1, ENVELOPE.motility[e.motility].maxUnits);
  for (const co of g.customOrganelles || []) registerOrganelle(co);
  const orgs = {};
  for (const o of ORGANELLES) {
    let n = Math.round(g.organelles?.[o.id] || 0);
    if (!o.types.includes(g.type)) n = 0;
    if (o.required && o.required.includes(g.type)) n = Math.max(1, n);
    n = clamp(n, 0, o.max);
    if (n > 0) orgs[o.id] = n;
  }
  g.organelles = orgs;
  g.organellePositions = g.organellePositions || {};
  const enz = {};
  for (const [id, c] of Object.entries(g.enzymes || {})) { const v = clamp(+c || 0, 0, 10); if (v > 0.01) enz[id] = +v.toFixed(3); }
  g.enzymes = enz;
  g.customEnzymes = (g.customEnzymes || []).filter((ce) => enz[ce.id] !== undefined);
  g.customOrganelles = (g.customOrganelles || []).filter((co) => orgs[co.id] !== undefined);
  g.hue = g.hue || 0;
  return g;
}

/**
 * Phénotype : toutes les grandeurs dérivées du génome utilisées par le moteur.
 * registry : Map id → définition d'enzyme.
 */
export function computePhenotype(design, registry) {
  const g = design;
  const geo = computeGeometry(g.shape);
  const V = geo.volume, SA = geo.surface, sv = geo.sv;
  const euk = g.type === 'eucaryote';
  const env = g.envelope;
  const orgCount = (id) => g.organelles[id] || 0;

  let volUsed = 0, massPerV = 0, upkeepPerV = 0;
  const fx = { storage: 0, proteinSynthesis: 0, secretion: 0, digestion: 0, osmoregulation: 0, rosDetox: 0, hyperProtect: 0, cheapVolume: 0, membraneBoost: 0, ribosomes: 0 };
  let phagocytosis = false, autophagy = false;
  const capacities = { mitochondrie: 0, chloroplaste: 0 };
  for (const co of g.customOrganelles || []) registerOrganelle(co);
  for (const [id, n] of Object.entries(g.organelles)) {
    const o = ORG[id]; if (!o) continue;
    volUsed += o.volume * n; massPerV += o.mass * n; upkeepPerV += o.upkeep * n;
    if (o.effects.compartment) capacities[o.effects.compartment] += (o.effects.capacity || 0) * n;
    for (const [c, v] of Object.entries(o.effects.capacities || {})) capacities[c] = (capacities[c] || 0) + v * n;
    for (const [k, v] of Object.entries(o.effects)) {
      if (typeof v === 'number' && k in fx) fx[k] += v * n;
      if (k === 'phagocytosis') phagocytosis = true;
      if (k === 'autophagy') autophagy = true;
    }
  }
  fx.cheapVolume = Math.min(0.5, fx.cheapVolume);
  fx.hyperProtect = Math.min(0.9, fx.hyperProtect);

  // Capacités des compartiments
  const membraneFactor = Math.min(1.25, C.membraneCapacity * sv * (1 + fx.membraneBoost));
  const mitoFactor = Math.min(1.6, capacities.mitochondrie);
  const chloroFactor = Math.min(1.6, capacities.chloroplaste);
  const secretionFactor = Math.min(1.3, 0.5 + fx.secretion);

  const enzymes = [];
  const warnings = [];
  let tSum = 0, pHSum = 0, wSum = 0;
  for (const [id, conc] of Object.entries(g.enzymes)) {
    const def = registry.get(id);
    if (!def) { warnings.push(`Enzyme inconnue : ${id}`); continue; }
    let loc = def.location, cap = 1;
    if (loc === 'mitochondrie') {
      if (!euk) { loc = 'membrane'; cap = membraneFactor; }
      else cap = Math.max(mitoFactor, membraneFactor * 0.5);
    } else if (loc === 'chloroplaste') {
      if (!euk) { loc = 'membrane'; cap = membraneFactor * (def.substrates.light ? 1 : 1.4); }
      else cap = chloroFactor;
    } else if (loc === 'membrane') cap = membraneFactor;
    else if (loc === 'secrete') cap = euk ? secretionFactor : 0.6;
    volUsed += def.cost.volume * conc;
    massPerV += def.cost.synth * conc;
    upkeepPerV += def.cost.upkeep * conc;
    const subs = Object.entries(def.substrates).map(([m, n]) => ({ m, i: m === 'light' ? -1 : MET[m].index, n, km: def.km?.[m] ?? def.km?._ ?? C.kmCofactor, env: def.location === 'secrete' && MET[m]?.env,
      hill: (def.hill > 1 && m !== 'light' && !MET[m].cofactor) ? def.hill : 1 }));
    const prods = Object.entries(def.products).map(([m, n]) => ({ m, i: MET[m].index, n, env: def.location === 'secrete' && MET[m]?.env }));
    const inhib = Object.entries(def.inhibitors || {}).map(([m, ki]) => ({ i: MET[m].index, ki }));
    const mainProduct = prods.find((p) => !MET[p.m].cofactor) || null;
    enzymes.push({
      id, def, conc, cap, loc, subs, prods, inhib, vmax: conc * def.kcat * cap * V,
      kcat: def.kcat, tOpt: def.tOpt, tWidth: def.tWidth, pHOpt: def.pHOpt, pHWidth: def.pHWidth,
      makesAtp: (def.products.atp || 0) > 0, regulation: def.regulation || null,
      feedback: def.feedback ? mainProduct : null,
    });
    tSum += def.tOpt * conc; pHSum += def.pHOpt * conc; wSum += conc;
  }

  // Enveloppe
  const W = ENVELOPE.wall, CAP = ENVELOPE.capsule;
  const wall = env.wall;
  const exchange = 1 / (1 + wall * W.exchangePenalty) / (env.capsule ? 1 + CAP.exchangePenalty : 1);
  const wallMass = wall * W.massPerThickness * SA;
  const capsuleMass = env.capsule ? CAP.mass * SA : 0;
  const predationProtect = 1 - (1 - Math.min(1, wall / W.maxThickness) * W.predationProtect) * (1 - (env.capsule ? CAP.predationProtect : 0));
  const toxinProtect = 1 - (1 - Math.min(1, wall) * W.toxinProtect) * (1 - (env.capsule ? CAP.toxinProtect : 0));
  const osmoProtect = Math.min(1, wall / 0.15) * W.osmoProtect;
  const mot = ENVELOPE.motility[env.motility];
  const speed = (mot.speedPerUnit || 0) * env.motilityUnits / (1 + 0.1 * Math.max(0, geo.radius - 1));
  const motilityCost = (mot.costPerSpeed || 0) * speed * Math.pow(V, 0.67);
  massPerV += (mot.mass || 0) * env.motilityUnits;
  if (env.parasite) massPerV += ENVELOPE.parasite.mass;
  if (env.adhesins) massPerV += ENVELOPE.adhesins.mass;

  const structural = V * C.biomassDensity * (1 - fx.cheapVolume);
  const B0 = structural + massPerV * V + wallMass + capsuleMass;
  const upkeep = C.maintenance * V * (1 - fx.cheapVolume * 0.8) + upkeepPerV * V + motilityCost;

  return {
    geo, V, SA, sv, euk, radius: geo.radius,
    B0, upkeep, volUsed, enzymes, warnings,
    atpCap: C.atpCapPerVolume * V,
    nadTotal: C.nadPerVolume * V,
    storageCap: (C.storageBase + fx.storage) * V,
    ribosomes: fx.ribosomes, proteinBoost: 1 + fx.proteinSynthesis,
    digestion: fx.digestion, osmoregulation: fx.osmoregulation, rosDetox: fx.rosDetox, hyperProtect: fx.hyperProtect,
    exchange, activeUptake: env.parasite ? 0.03 : 1, predationProtect, toxinProtect, osmoProtect, wall,
    speed, motilityCost, motile: speed > 0,
    phagocyte: euk && phagocytosis && wall < W.phagocytosisBlock,
    autophagy: autophagy ? 2 : 1,
    parasite: !!env.parasite, adhesins: !!env.adhesins,
    tOpt: wSum ? tSum / wSum : 30, pHOpt: wSum ? pHSum / wSum : 7,
    membraneFactor, mitoFactor, chloroFactor,
  };
}

/** Mutations légères à la division (génome fils). */
export function mutateDesign(design, rng) {
  const M = PARAMS.mutation;
  const g = JSON.parse(JSON.stringify(design));
  for (const id of Object.keys(g.enzymes)) {
    g.enzymes[id] = +(g.enzymes[id] * Math.exp(rng.gauss() * M.concSigma)).toFixed(4);
    if (rng.chance(M.lossProb) || g.enzymes[id] < 0.05) delete g.enzymes[id];
    else if (g.enzymes[id] > 10) g.enzymes[id] = 10;
  }
  g.shape = { ...g.shape, size: g.shape.size * Math.exp(rng.gauss() * M.sizeSigma) };
  if (g.envelope.wall > 0) g.envelope.wall = Math.max(0, g.envelope.wall * Math.exp(rng.gauss() * M.sizeSigma));
  if (rng.chance(M.organelleProb)) {
    const ids = Object.keys(g.organelles).filter((id) => ORG[id].max > 1 && id !== 'ribosomes');
    if (ids.length) { const id = rng.pick(ids); g.organelles[id] = Math.max(1, g.organelles[id] + (rng.chance(0.5) ? 1 : -1)); }
  }
  if (rng.chance(M.ribosomeProb)) g.organelles.ribosomes = (g.organelles.ribosomes || 1) + (rng.chance(0.5) ? 1 : -1);
  g.hue = (g.hue || 0) + rng.gauss() * M.colorDrift;
  return normalizeDesign(g);
}

/** Distance génétique simple (pour la diversité intra-population). */
export function geneticDistance(a, b) {
  let d = 0;
  const ids = new Set([...Object.keys(a.enzymes), ...Object.keys(b.enzymes)]);
  for (const id of ids) d += Math.abs(Math.log((a.enzymes[id] || 0.05) / (b.enzymes[id] || 0.05)));
  d += Math.abs(Math.log(a.shape.size / b.shape.size)) * 3;
  return d;
}
