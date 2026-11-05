// Atelier d'organites : assemble une enveloppe, une taille et des modules en un organite utilisable par le moteur.
// Les organites personnalisés sont ajoutés au registre partagé (ORG / ORGANELLES) au chargement d'une conception.
import { ORG, ORGANELLES, ORG_BRICKS, BUILTIN_ORGANELLES } from '../data/index.js';

const B = ORG_BRICKS.base;
export const MEMBRANE = Object.fromEntries(ORG_BRICKS.membranes.map((m) => [m.id, m]));
export const MODULE = Object.fromEntries(ORG_BRICKS.modules.map((m) => [m.id, m]));

let idCounter = 0;
export function emptyOrganelleSpec() {
  return { name: 'Nouvel organite', color: '#f4a261', membrane: 'double', size: 0.03, modules: ['respiration'], max: 6 };
}

/** Construit un organite. Retourne { ok, def, errors[], warnings[] }. */
export function buildOrganelle(spec, id = null) {
  const errors = [], warnings = [];
  const mem = MEMBRANE[spec.membrane] || MEMBRANE.simple;
  const mods = [...new Set(spec.modules || [])].map((m) => MODULE[m]).filter(Boolean);
  const size = Math.max(B.minSize, Math.min(B.maxSize, +spec.size || B.minSize));
  if (!mods.length) errors.push('Ajoutez au moins un module fonctionnel.');
  if (mods.length > B.maxModules) errors.push(`Trop de modules (${mods.length} > ${B.maxModules}).`);
  for (const m of mods) {
    if (!m.membranes.includes(mem.id)) errors.push(`« ${m.name} » nécessite : ${m.membranes.map((x) => MEMBRANE[x].name).join(' ou ')}.`);
    for (const ex of m.exclusive || []) if (mods.some((o) => o.id === ex)) errors.push(`« ${m.name} » et « ${MODULE[ex].name} » sont incompatibles dans un même organite.`);
  }
  const eff = mods.length > 1 ? B.multiModuleEfficiency : 1;
  const effects = {};
  for (const m of mods) {
    const v = +(m.coef * size * eff).toPrecision(3);
    if (m.effect.startsWith('capacities.')) { effects.capacities = effects.capacities || {}; effects.capacities[m.effect.split('.')[1]] = v; }
    else effects[m.effect] = +((effects[m.effect] || 0) + v).toPrecision(3);
    for (const [k, c] of Object.entries(m.extra || {})) effects[k] = +((effects[k] || 0) + (k === 'cheapVolume' ? size : c * size)).toPrecision(3);
    for (const f of m.flags || []) effects[f] = true;
  }
  if (size > 0.1) warnings.push('Organite volumineux : il laisse peu de place aux enzymes du cytoplasme.');
  if (mods.length > 1) warnings.push(`Plusieurs modules partagent l'espace : efficacité ×${eff}.`);
  const max = Math.max(1, Math.min(B.maxCount, Math.round(spec.max || 4)));
  const def = {
    id: id || spec.id || `orgperso_${Date.now().toString(36)}${(++idCounter).toString(36)}`,
    name: spec.name || 'Organite personnalisé',
    types: mem.types, max,
    volume: +size.toPrecision(3),
    mass: +(size * (B.massPerVolume + B.massPerModule * mods.length) * mem.massMul).toPrecision(3),
    upkeep: +(size * B.upkeepPerVolume * (1 + B.upkeepPerModule * mods.length) * mem.upkeepMul).toPrecision(3),
    radius: +Math.min(0.32, 0.55 * Math.sqrt(size)).toFixed(3),
    description: `${mem.name} · ${mods.map((m) => m.name).join(', ') || 'aucun module'}`,
    effects, color: spec.color || '#f4a261', custom: true,
    bricks: { membrane: mem.id, size, modules: mods.map((m) => m.id) },
  };
  return { ok: errors.length === 0, def, errors, warnings };
}

/** Ajoute un organite personnalisé au registre partagé (sans écraser un organite de base). */
export function registerOrganelle(def) {
  if (!def || BUILTIN_ORGANELLES.has(def.id)) return;
  if (ORG[def.id]) { Object.assign(ORG[def.id], def); return; }
  ORG[def.id] = { ...def };
  ORGANELLES.push(ORG[def.id]);
}
