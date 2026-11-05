// Atelier d'enveloppe : parois sur mesure et protéines membranaires (transporteurs, pompes d'efflux, porines).
// Les créations sont ajoutées aux registres partagés (WALLS / MPROT) au chargement d'une conception.
import { WALL_DATA, WALLS, BUILTIN_WALLS, MPROT, BUILTIN_MPROT, MPROT_WORKSHOP, MET } from '../data/index.js';

export const WALL_MODS = Object.fromEntries(WALL_DATA.modifications.map((m) => [m.id, m]));
export const MECHANISMS = Object.fromEntries(MPROT_WORKSHOP.mechanisms.map((m) => [m.id, m]));
let idCounter = 0;
const newId = (p) => `${p}_${Date.now().toString(36)}${(++idCounter).toString(36)}`;

export function defaultWallType(type) { return WALL_DATA.default[type]; }

export function emptyWallSpec() { return { name: 'Ma paroi', base: 'peptidoglycane', modifications: [], color: '#e9d8a6' }; }

/** Construit une paroi personnalisée. Retourne { ok, def, errors[], warnings[] }. */
export function buildWall(spec, id = null) {
  const errors = [], warnings = [];
  const base = WALLS[spec.base] && !WALLS[spec.base].custom ? WALLS[spec.base] : WALLS.peptidoglycane;
  const mods = [...new Set(spec.modifications || [])].map((m) => WALL_MODS[m]).filter(Boolean);
  if (mods.length > 3) errors.push('Trois modifications au maximum.');
  let types = [...base.types];
  for (const m of mods) if (m.types) types = types.filter((t) => m.types.includes(t));
  if (!types.length) errors.push('Ces modifications sont incompatibles avec ce matériau (aucun type cellulaire possible).');
  const mul = (k) => mods.reduce((a, m) => a * (m[k] ?? 1), 1);
  const immune = mods.some((m) => m.lyticImmune);
  const def = {
    id: id || spec.id || newId('paroiperso'),
    name: spec.name || 'Paroi personnalisée', types, custom: true,
    predation: +Math.min(0.97, base.predation * mul('predationMul')).toFixed(3),
    osmo: +Math.min(1, base.osmo * mul('osmoMul')).toFixed(3),
    toxin: +Math.min(0.9, base.toxin * mul('toxinMul')).toFixed(3),
    exchangePenalty: +(base.exchangePenalty * mul('exchangeMul')).toFixed(3),
    mass: +(base.mass * mul('massMul')).toFixed(3),
    rosProtect: +mods.reduce((a, m) => a + (m.rosProtect || 0), 0).toFixed(2),
    lytic: immune ? null : base.lytic,
    color: spec.color || base.color,
    description: `${base.name}${mods.length ? ' + ' + mods.map((m) => m.name).join(', ') : ''}`,
    bricks: { base: base.id, modifications: mods.map((m) => m.id) },
  };
  if (immune && !base.lytic) warnings.push('La silice est déjà insensible aux enzymes lytiques : l\'O-acétylation ne sert à rien.');
  if (def.exchangePenalty > 1.8) warnings.push('Paroi très étanche : les nutriments entreront lentement.');
  return { ok: errors.length === 0, def, errors, warnings };
}

export function emptyProteinSpec() { return { name: 'Mon transporteur', mechanism: 'symport', met: 'glucose' }; }

/** Construit une protéine membranaire (transporteur ou pompe d'efflux). */
export function buildMembraneProtein(spec, id = null) {
  const errors = [], warnings = [];
  const mech = MECHANISMS[spec.mechanism] || MECHANISMS.symport;
  const m = MET[spec.met];
  const W = MPROT_WORKSHOP;
  if (!m) errors.push('Choisissez un métabolite.');
  else if (!m.env) errors.push(`« ${m.name} » n'existe pas hors de la cellule : rien à transporter.`);
  else if (m.transport === 'aucun') errors.push(`« ${m.name} » est un polymère trop gros pour traverser la membrane : dégradez-le d'abord avec une enzyme sécrétée.`);
  if (m && mech.kind === 'transporteur' && m.transport === 'passif' && mech.id !== 'uniport') warnings.push(`« ${m.name} » diffuse déjà librement : un transporteur actif ne fait qu'accélérer l'échange.`);
  if (m && mech.kind === 'efflux' && ['glucose', 'aa', 'nh4', 'phosphate', 'nucleotide'].includes(m.id)) warnings.push(`Expulser du ${m.name.toLowerCase()} revient à jeter de la nourriture…`);
  const def = {
    id: id || spec.id || newId('protperso'),
    name: spec.name || 'Protéine membranaire', kind: mech.kind, met: m?.id || 'glucose', custom: true,
    area: W.baseArea,
    cost: { synth: +(W.baseSynth * mech.costMul).toPrecision(3), upkeep: +(W.baseUpkeep * mech.costMul).toPrecision(3) },
    description: `${mech.name} · ${m?.name || '?'}`,
    bricks: { mechanism: mech.id, met: m?.id },
  };
  if (mech.kind === 'transporteur') def.permAdd = +(W.basePerm * mech.permMul).toFixed(3);
  else { def.rate = W.baseRate * mech.rateMul; def.atpPerUnit = 1; }
  return { ok: errors.length === 0, def, errors, warnings };
}

export function registerWall(def) {
  if (!def || BUILTIN_WALLS.has(def.id)) return;
  WALLS[def.id] = { ...def };
}
export function registerMembraneProtein(def) {
  if (!def || BUILTIN_MPROT.has(def.id)) return;
  MPROT[def.id] = { ...def };
}
