// Atelier d'enzymes : assemble des briques (site actif, domaines, peptide signal) en une définition d'enzyme
// utilisable par le moteur. Garde-fous : conservation de la matière, ΔG ≤ 0, cofacteurs requis, compromis.
import { BRICKS, MET } from '../data/index.js';
import { analyzeReaction } from './chem.js';

const B = BRICKS.base;
export const SITE = Object.fromEntries(BRICKS.activeSites.map((s) => [s.id, s]));
export const DOMAIN = Object.fromEntries(BRICKS.domains.map((d) => [d.id, d]));
export const SIGNAL = Object.fromEntries(BRICKS.signals.map((s) => [s.id, s]));

export function emptySpec() {
  return { name: 'Nouvelle enzyme', substrates: { glucose: 1 }, products: {}, activeSite: 'standard', domains: [], signal: 'cytosol', tradeoff: 0 };
}

/**
 * Construit une enzyme à partir d'une spécification de briques.
 * Retourne { ok, def, errors[], warnings[], analysis }.
 */
export function buildEnzyme(spec, id = null) {
  const errors = [], warnings = [];
  const subs = clean(spec.substrates), prods = clean(spec.products);
  const analysis = analyzeReaction(subs, prods);
  errors.push(...analysis.errors);
  const site = SITE[spec.activeSite] || SITE.standard;
  const domains = [...new Set(spec.domains || [])].map((d) => DOMAIN[d]).filter(Boolean);
  const signal = SIGNAL[spec.signal] || SIGNAL.cytosol;
  if (domains.length > B.maxDomains) errors.push(`Trop de domaines (${domains.length} > ${B.maxDomains}) : la protéine ne se replierait pas.`);
  const provides = new Set(domains.map((d) => d.provides).filter(Boolean));
  const all = { ...subs, ...prods };
  const usesNad = 'nad' in all || 'nadh' in all, usesAtp = 'atp' in all, usesLight = 'light' in subs;
  if ('light' in prods) errors.push('La lumière ne peut pas être produite.');
  if (usesNad && !provides.has('NAD')) errors.push('Réaction d\'oxydoréduction : ajoutez un domaine de Rossmann (liaison NAD).');
  if (usesAtp && !provides.has('ATP/Mg')) errors.push("Réaction utilisant l'ATP : ajoutez un domaine de liaison ATP/Mg²⁺.");
  if (usesLight && !provides.has('light')) errors.push('Utiliser la lumière nécessite une antenne pigmentaire.');
  if (usesLight && !['chloroplaste', 'membrane'].includes(signal.location)) errors.push('Une enzyme photochimique doit être membranaire ou chloroplastique.');
  const secreted = signal.location === 'secrete';
  if (secreted) {
    for (const m of Object.keys(all)) if (!MET[m]?.env) errors.push(`Enzyme sécrétée : « ${MET[m]?.name || m} » n'existe pas dans le milieu (pas de cofacteurs hors de la cellule).`);
  }
  for (const m of Object.keys(all)) if (['biomass', 'phagosome'].includes(m)) errors.push('La biomasse est produite par les ribosomes, pas par une enzyme.');
  const regs = domains.map((d) => d.regulation).filter(Boolean);
  if (regs.length > 1) errors.push('Un seul senseur énergétique par enzyme.');
  if (domains.some((d) => d.id === 'thermo') && domains.some((d) => d.id === 'psychro')) errors.push('Domaines thermostable et psychrophile incompatibles.');
  if (domains.some((d) => d.id === 'acido') && domains.some((d) => d.id === 'alcali')) errors.push('Surfaces acidophile et alcalophile incompatibles.');

  // Paramètres cinétiques (compromis)
  const t = Math.max(-1, Math.min(1, +spec.tradeoff || 0));
  const stoichSum = Object.entries(subs).filter(([m]) => m !== 'light').reduce((a, [, n]) => a + n, 0);
  const driving = -analysis.deltaG;
  const dfFactor = Math.max(0.05, Math.min(1, (driving + 0.3) / B.drivingForceRef));
  let kcatMul = site.kcatMul, tShift = 0, tWMul = 1, pHShift = 0, pHWMul = 1, costAdd = signal.costAdd, volAdd = 0;
  for (const d of domains) {
    kcatMul *= d.kcatMul ?? 1; tShift += d.tOptShift ?? 0; tWMul *= d.tWidthMul ?? 1;
    pHShift += d.pHShift ?? 0; pHWMul *= d.pHWidthMul ?? 1; costAdd += d.costAdd ?? 0; volAdd += d.volumeAdd ?? 0;
  }
  const kcat = B.kcat * kcatMul * Math.pow(10, -B.tradeoffKcat * t) * dfFactor / (1 + B.stoichPenalty * Math.max(0, stoichSum - 1));
  const km0 = (secreted ? B.kmSecreted : B.kmInternal) * site.kmMul * Math.pow(10, -B.tradeoffKm * t);
  const km = { _: +km0.toPrecision(3) };
  if ('light' in subs) km.light = 0.35;
  // Inhibiteurs automatiques plausibles
  const inhibitors = {};
  const main = Object.keys(prods).find((m) => !MET[m]?.cofactor && MET[m]);
  if (main && !secreted) inhibitors[main] = domains.some((d) => d.feedback) ? 0.3 : 1.5;
  if ('n2' in subs) inhibitors.o2 = 0.0015;
  if (secreted && main) delete inhibitors[main];
  const costMul = site.costMul * (1 + costAdd) * (1 + 0.08 * stoichSum);
  const def = {
    id: id || spec.id || `perso_${Date.now().toString(36)}`,
    name: spec.name || 'Enzyme personnalisée',
    category: 'Enzymes personnalisées',
    description: describe(subs, prods),
    substrates: subs, products: prods,
    location: signal.location,
    km, kcat: +kcat.toPrecision(3),
    tOpt: B.tOpt + tShift, tWidth: +(B.tWidth * tWMul).toFixed(2), pHOpt: B.pHOpt + pHShift, pHWidth: +(B.pHWidth * pHWMul).toFixed(2),
    cofactors: [...provides].filter((p) => p !== 'light'),
    inhibitors,
    regulation: regs[0] || null,
    feedback: domains.some((d) => d.feedback),
    cost: { synth: +(B.synth * costMul).toPrecision(3), upkeep: +(B.upkeep * costMul).toPrecision(3), volume: +(B.volume + volAdd).toPrecision(3) },
    custom: true,
    bricks: { activeSite: site.id, domains: domains.map((d) => d.id), signal: signal.id, tradeoff: t },
  };
  if (dfFactor < 0.5 && analysis.exergonic) warnings.push(`Réaction proche de l'équilibre (ΔG = ${analysis.deltaG.toFixed(2)} ATP-éq.) : elle sera lente.`);
  if (analysis.exergonic && driving > 4 && !usesAtp && !usesNad) warnings.push(`${driving.toFixed(1)} ATP-éq. sont dissipés en chaleur : couplez la réaction à de l'ATP ou du NADH pour les récupérer.`);
  return { ok: errors.length === 0, def, errors, warnings, analysis };
}

function clean(side) {
  const out = {};
  for (const [m, n] of Object.entries(side || {})) { const v = +n; if (v > 0) out[m] = v; }
  return out;
}

export function describe(subs, prods) {
  const f = (side) => Object.entries(side).map(([m, n]) => `${n !== 1 ? n + ' ' : ''}${MET[m]?.name || m}`).join(' + ') || '∅';
  return `${f(subs)} → ${f(prods)}`;
}
