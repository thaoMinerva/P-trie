// Format des messages entre un monde simulé (serveur multijoueur ou worker du navigateur) et son miroir d'affichage.
import { MET } from '../data/index.js';
import { MI, DMG_KEYS } from '../simulation/metabolism.js';

export const CELL_STRIDE = 11;

export function popPayload(p, withHistory) {
  return {
    id: p.id, ownerId: p.ownerId, ownerName: p.ownerName, name: p.name, color: p.color, profile: p.profile, design: p.design,
    launchedAt: p.launchedAt, count: p.count, maxCount: p.maxCount, births: p.births, deaths: p.deaths, maxGeneration: p.maxGeneration,
    deathCauses: p.deathCauses, score: p.score, pointsEarned: p.pointsEarned, kills: p.kills, symbiosis: p.symbiosis, parasitism: p.parasitism,
    resourcesUsed: p.resourcesUsed, extinct: p.extinct, extinctAt: p.extinctAt, extinctionSummary: p.extinctionSummary,
    history: withHistory ? p.history : undefined,
    hgt: p.hgt, immunized: p.immunized, infections: p.infections, phageDeaths: p.phageDeaths, strains: p.strains.map(({ ref, ...st }) => st),
  };
}

/**
 * État compact : 11 nombres par cellule [id, popIdx, x, y, angle, rayon, biomasse/B0, teinte, drapeaux, hôte, partenaire].
 * drapeaux : 1 = en division, 2 = collée en biofilm, 4 = infectée par un phage.
 * typed = true : Float64Array (transfert sans copie vers un worker) ; sinon tableau JSON arrondi (réseau).
 */
export function statePayload(world, typed = false) {
  const popIndex = new Map(), pops = [];
  for (const p of world.populations.values()) if (!p.extinct || world.time - p.extinctAt < 300) { popIndex.set(p.id, pops.length); pops.push(p.id); }
  const n = world.cells.length;
  const cells = typed ? new Float64Array(n * CELL_STRIDE) : new Array(n * CELL_STRIDE);
  const r1 = typed ? (v) => v : (v) => Math.round(v * 10) / 10, r2 = typed ? (v) => v : (v) => Math.round(v * 100) / 100;
  let k = 0;
  for (const c of world.cells) {
    cells[k++] = c.id; cells[k++] = popIndex.get(c.popId) ?? -1;
    cells[k++] = r1(c.x); cells[k++] = r1(c.y);
    cells[k++] = r2(c.angle); cells[k++] = r2(c.ph.radius);
    cells[k++] = r2(c.pools[MI.biomass] / c.ph.B0); cells[k++] = Math.round(c.genome.hue || 0);
    cells[k++] = (c.phase === 'G1' ? 0 : 1) | (c.bfN > 0 ? 2 : 0) | (c.infected ? 4 : 0); cells[k++] = c.host || 0; cells[k++] = c.partners[0] || 0;
  }
  return { t: world.time, light: world.env.lightLevel, pops, cells, evs: world.scheduler?.summary() || [] };
}

/** Description statique du monde (envoyée une fois). */
export function worldInfo(world, b64) {
  const env = world.env;
  return { width: world.width, height: world.height, gw: env.gw, gh: env.gh, cellSize: env.cellSize, gridVolume: env.gridVolume,
    temperature: b64(env.temperature), salinity: b64(env.salinity), lightDepth: b64(env.lightDepth) };
}

/** Fiche complète d'une cellule, ou null si elle est morte. */
export function cellPayload(world, id) {
  const c = world.cellById.get(id);
  if (!c || !c.alive) return null;
  const env = world.env, g = env.idx(c.x, c.y);
  return {
    ok: true, id: c.id, popId: c.popId, genome: c.genome, pools: Array.from(c.pools), dmg: Array.from(c.dmg), dmgKeys: DMG_KEYS,
    damage: c.damage, age: c.age, generation: c.generation, phase: c.phase, x: c.x, y: c.y, angle: c.angle,
    host: c.host, parasites: c.parasites, partners: c.partners,
    strainId: c.strainId, shield: c.shield, bfN: c.bfN, infected: c.infected, immune: c.immune, hgt: c.hgt,
    local: { T: env.temperature[g], pH: env.pH[g], light: env.lightAt(g), salinity: env.salinity[g],
      o2: env.fields[MET.o2.index][g], glucose: env.fields[MET.glucose.index][g], nh4: env.fields[MET.nh4.index][g], protein: env.fields[MET.protein.index][g] },
  };
}

/** Champ demandé pour un calque (température et salinité changent pendant les événements). */
export function layerArray(world, name) {
  const env = world.env;
  if (name === 'pH') return env.pH;
  if (name === 'secreted') return env.secreted;
  if (name === 'temperature') return env.temperature;
  if (name === 'salinity') return env.salinity;
  if (MET[name]?.env) return env.fields[MET[name].index];
  return null;
}
