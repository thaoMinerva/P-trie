// Métabolisme d'une cellule pour un pas de temps : transport, réactions enzymatiques (Michaelis-Menten
// pondérée par T et pH), synthèse protéique, digestion, entretien, dommages.
import { PARAMS, METABOLITES, MET } from '../data/index.js';

const C = PARAMS.cell;
const I = Object.fromEntries(METABOLITES.map((m, i) => [m.id, i]));
export const NMET = METABOLITES.length;
export const MI = I;
const TRANSPORTED = METABOLITES.filter((m) => m.env && m.transport !== 'aucun').map((m) => ({ ...m, i: I[m.id] }));
const ENV_IDX = METABOLITES.map((m) => m.env);

export const CAUSES = {
  starvation: "épuisement de l'ATP",
  famine: 'famine (biomasse dégradée)',
  toxin: 'toxines',
  ros: 'stress oxydatif',
  ethanol: "intoxication à l'éthanol",
  osmo_hypo: 'choc osmotique (eau douce)',
  osmo_hyper: 'choc osmotique (milieu salé)',
  heat: 'température trop élevée',
  cold: 'température trop basse',
  ph: 'pH extrême',
  predation: 'prédation (phagocytose)',
  age: 'sénescence',
};

export const DMG_KEYS = ['starvation', 'toxin', 'ros', 'ethanol', 'osmo_hypo', 'osmo_hyper', 'heat', 'cold', 'ph'];
const D = Object.fromEntries(DMG_KEYS.map((k, i) => [k, i]));
export function newDamage() { return new Float64Array(DMG_KEYS.length); }
function addDamage(cell, cause, amount) {
  if (amount <= 0) return;
  cell.damage += amount;
  cell.dmg[D[cause]] += amount;
}

/**
 * Un pas de métabolisme. Retourne true si la cellule doit mourir (cell.deathCause renseigné).
 * stats : accumulateur d'usage des ressources de la population (Float64Array NMET + lumière + proies).
 */
export function metabolize(cell, env, dt, stats) {
  const ph = cell.ph, p = cell.pools, V = ph.V, SA = ph.SA;
  const g = env.idx(cell.x, cell.y);
  const gv = env.gridVolume;
  const fields = env.fields;
  const T = env.temperature[g], pH = env.pH[g];

  // ---------- 1. Transport membranaire ----------
  const ex = ph.exchange;
  for (let k = 0; k < TRANSPORTED.length; k++) {
    const m = TRANSPORTED[k], f = fields[m.i];
    const cEnv = f[g] / gv, cInt = p[m.i] / V;
    let flux;
    if (m.transport === 'actif') {
      flux = m.perm * SA * ex * (cell.host === null ? ph.activeUptake : 1) * (cEnv / (m.kt + cEnv)) * Math.max(0, 1 - cInt / C.maxInternalConc) * dt;
      flux = Math.min(flux, f[g] * 0.3);
      const cost = flux * C.activeTransportCost;
      if (cost > p[I.atp]) flux = p[I.atp] / C.activeTransportCost;
      p[I.atp] -= flux * C.activeTransportCost;
    } else {
      let perm = m.perm;
      if (m.i === I.toxin) perm *= (1 - ph.toxinProtect);
      // flux passif borné à une demi-équilibration par pas (stabilité numérique)
      const kEq = V * gv / (V + gv);
      flux = (cEnv - cInt) * Math.min(perm * SA * ex * dt, 0.5 * kEq);
      if (flux > 0) flux = Math.min(flux, f[g] * 0.3);
      else flux = Math.max(flux, -p[m.i] * 0.5);
    }
    f[g] -= flux; p[m.i] += flux;
  }

  // ---------- 2. Réactions enzymatiques ----------
  const atpCap = ph.atpCap;
  const light = env.lightAt(g);
  for (let k = 0; k < ph.enzymes.length; k++) {
    const e = ph.enzymes[k];
    const dTp = (T - e.tOpt) / e.tWidth, dpH = (pH - e.pHOpt) / e.pHWidth;
    let v = e.vmax * Math.exp(-dTp * dTp - dpH * dpH) * dt;
    if (v <= 0) continue;
    // saturation (Michaelis-Menten multi-substrats)
    for (let s = 0; s < e.subs.length; s++) {
      const sub = e.subs[s];
      let conc;
      if (sub.i < 0) conc = light;
      else if (sub.env) conc = fields[sub.i][g] / gv;
      else conc = p[sub.i] / V;
      if (sub.hill === 1) v *= conc / (sub.km + conc);
      else { const ch = Math.pow(conc, sub.hill); v *= ch / (Math.pow(sub.km, sub.hill) + ch); } // coopérativité (Hill)
    }
    for (let s = 0; s < e.inhib.length; s++) { const inh = e.inhib[s]; v /= 1 + (p[inh.i] / V) / inh.ki; }
    if (e.feedback) v /= 1 + (p[e.feedback.i] / V) / 0.3;
    const atpFrac = p[I.atp] / atpCap;
    if (e.makesAtp) v *= Math.max(0, 1 - atpFrac);
    if (e.regulation === 'atpHigh') v *= Math.max(0, (atpFrac - 0.5) * 2);
    else if (e.regulation === 'atpLow') v *= Math.max(0, (0.6 - atpFrac) / 0.6);
    if (e.prods.length && e.prods[0].i === I.reserve && p[I.reserve] > ph.storageCap) v = 0;
    // limitation par la disponibilité des substrats
    for (let s = 0; s < e.subs.length; s++) {
      const sub = e.subs[s];
      if (sub.i < 0) continue;
      const avail = sub.env ? fields[sub.i][g] : p[sub.i];
      if (v * sub.n > avail * 0.9) v = (avail * 0.9) / sub.n;
    }
    if (v <= 1e-12) continue;
    for (let s = 0; s < e.subs.length; s++) {
      const sub = e.subs[s];
      if (sub.i < 0) { stats.light += v * sub.n; continue; }
      if (sub.env) fields[sub.i][g] -= v * sub.n; else p[sub.i] -= v * sub.n;
      stats.use[sub.i] += v * sub.n;
    }
    for (let s = 0; s < e.prods.length; s++) {
      const pr = e.prods[s];
      if (pr.env) fields[pr.i][g] += v * pr.n; else p[pr.i] += v * pr.n;
    }
    if (e.loc === 'secrete') env.secreted[g] += v / dt;
    if (cell.flux) cell.flux[k] = v / dt;
  }

  // ---------- 3. Digestion (lysosomes) et autophagie ----------
  if (p[I.phagosome] > 0) {
    const d = Math.min(p[I.phagosome], (ph.digestion * V + 0.02 * p[I.phagosome]) * dt);
    p[I.phagosome] -= d; p[I.aa] += d; p[I.phosphate] += d * C.pPerBiomass;
    stats.use[I.phagosome] += d;
  }
  const atpFrac = p[I.atp] / atpCap;
  if (atpFrac < 0.1 && p[I.biomass] > 0) {
    const a = Math.min(p[I.biomass], C.autophagyRate * ph.autophagy * ph.B0 * dt);
    p[I.biomass] -= a; p[I.aa] += a; p[I.phosphate] += a * C.pPerBiomass;
  }

  // ---------- 4. Synthèse protéique (ribosomes → biomasse) ----------
  if (p[I.biomass] < ph.B0 * 2.05) {
    const aaC = p[I.aa] / V, atpC = p[I.atp] / V, pC = p[I.phosphate] / V;
    let v = C.ribosomeRate * ph.ribosomes * ph.proteinBoost * V
      * (aaC / (C.riboKmAa + aaC)) * (atpC / (C.riboKmAtp + atpC)) * (pC / (C.riboKmP + pC)) * dt;
    v = Math.min(v, p[I.aa] * 0.9, p[I.atp] * 0.9 / C.atpPerBiomass, p[I.phosphate] * 0.9 / C.pPerBiomass);
    if (v > 0) {
      p[I.aa] -= v; p[I.atp] -= v * C.atpPerBiomass; p[I.phosphate] -= v * C.pPerBiomass; p[I.biomass] += v;
      cell.growth = v / dt;
    } else cell.growth = 0;
  } else cell.growth = 0;

  // ---------- 5. Entretien ----------
  let cost = ph.upkeep * dt;
  if (cell.phase === 'S') cost += C.cycle.atpPerVolumeS * V / C.cycle.S * dt;
  if (p[I.atp] >= cost) { p[I.atp] -= cost; cell.starving = 0; }
  else {
    const deficit = 1 - p[I.atp] / cost;
    p[I.atp] = 0;
    cell.starving += dt;
    addDamage(cell, 'starvation', C.starvationDamage * deficit * dt);
  }
  if (p[I.atp] > atpCap) p[I.atp] = atpCap;

  // ---------- 6. Stress et dommages ----------
  // ROS
  p[I.ros] -= p[I.ros] * (C.rosDecay + ph.rosDetox) * dt;
  const ros = p[I.ros] / V;
  if (ros > C.rosThreshold) addDamage(cell, 'ros', (ros - C.rosThreshold) * C.rosDamage * dt);
  const tox = p[I.toxin] / V;
  if (tox > C.toxinThreshold) addDamage(cell, 'toxin', (tox - C.toxinThreshold) * C.toxinDamage * 100 * dt);
  const eth = p[I.ethanol] / V;
  if (eth > C.ethanolThreshold) addDamage(cell, 'ethanol', (eth - C.ethanolThreshold) * C.ethanolDamage * 10 * dt);
  // Osmose
  const sal = env.salinity[g];
  if (sal < C.salinityRef) {
    const hypo = ((C.salinityRef - sal) / C.salinityRef) * Math.min(2, ph.sv / 3) * (1 - ph.osmoProtect) - ph.osmoregulation;
    if (hypo > 0) addDamage(cell, 'osmo_hypo', hypo * C.osmoHypoDamage * dt);
  } else if (sal > C.salinityHigh) {
    const hyper = ((sal - C.salinityHigh) / (1 - C.salinityHigh)) * (1 - ph.hyperProtect) * (1 - 0.3 * ph.osmoProtect);
    addDamage(cell, 'osmo_hyper', hyper * C.osmoHyperDamage * dt);
  }
  // Température / pH
  if (T > ph.tOpt + C.tempTolHigh) addDamage(cell, 'heat', (T - ph.tOpt - C.tempTolHigh) * C.tempDamage * dt);
  else if (T < ph.tOpt - C.tempTolLow) addDamage(cell, 'cold', (ph.tOpt - C.tempTolLow - T) * C.tempDamage * 0.5 * dt);
  const dpHc = Math.abs(pH - ph.pHOpt) - C.pHTol;
  if (dpHc > 0) addDamage(cell, 'ph', dpHc * C.pHDamage * dt);
  // Réparation
  if (cell.damage > 0) {
    const r = Math.min(cell.damage, C.repairRate * dt);
    const rc = r * C.repairCost * V;
    if (p[I.atp] > rc) {
      p[I.atp] -= rc; cell.damage -= r;
      const f = Math.max(0, 1 - r / Math.max(1e-9, cell.damage + r)), dm = cell.dmg;
      for (let k = 0; k < dm.length; k++) dm[k] *= f;
    }
  }

  // ---------- 7. Mort ? ----------
  if (cell.damage >= 1) {
    let best = 0;
    for (let k = 1; k < cell.dmg.length; k++) if (cell.dmg[k] > cell.dmg[best]) best = k;
    cell.deathCause = DMG_KEYS[best];
    return true;
  }
  if (p[I.biomass] < ph.B0 * C.minBiomassFraction) { cell.deathCause = 'famine'; return true; }
  if (cell.age > C.maxAge * (ph.euk ? 1.5 : 1)) { cell.deathCause = 'age'; return true; }
  return false;
}

/** Libère le contenu d'une cellule morte dans le milieu (lyse) : la matière est conservée. */
export function releaseContents(cell, env) {
  const g = env.idx(cell.x, cell.y), p = cell.pools, f = env.fields;
  for (let i = 0; i < NMET; i++) {
    const v = p[i];
    if (v <= 0) continue;
    if (ENV_IDX[i]) f[i][g] += v;
    else if (i === I.biomass || i === I.phagosome) { f[I.protein][g] += v; f[I.phosphate][g] += v * C.pPerBiomass; }
    else if (i === I.reserve) f[I.starch][g] += v;
    p[i] = 0;
  }
}

/** Matière totale d'une cellule (C, N, P) – utilisé par les tests de conservation. */
export function cellElements(cell) {
  const t = { C: 0, N: 0, P: 0 };
  for (let i = 0; i < NMET; i++) {
    const el = METABOLITES[i].elements, v = cell.pools[i];
    if (!v) continue;
    t.C += (el.C || 0) * v; t.N += (el.N || 0) * v; t.P += (el.P || 0) * v;
  }
  return t;
}
export { MET };
