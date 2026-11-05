// Chargeur des données biologiques (JSON) – fonctionne dans le navigateur (fetch) et sous Node (fs).
const FILES = ['metabolites', 'enzymes', 'organelles', 'envelope', 'params', 'bricks', 'archetypes', 'organelleBricks', 'walls', 'membraneProteins', 'livret'];

async function loadJSON(name) {
  const url = new URL(`./${name}.json`, import.meta.url);
  if (typeof window === 'undefined' || url.protocol === 'file:') {
    const { readFile } = await import('node:fs/promises');
    return JSON.parse(await readFile(url, 'utf8'));
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Impossible de charger ${name}.json`);
  return res.json();
}

const raw = Object.fromEntries(await Promise.all(FILES.map(async (f) => [f, await loadJSON(f)])));

export const METABOLITES = raw.metabolites.list;
export const MET = Object.fromEntries(METABOLITES.map((m, i) => [m.id, { ...m, index: i }]));
export const ENZYMES = raw.enzymes.list;
export const ORGANELLES = raw.organelles.list;
export const ORG = Object.fromEntries(ORGANELLES.map((o) => [o.id, o]));
export const ENVELOPE = raw.envelope;
export const PARAMS = raw.params;
export const BRICKS = raw.bricks;
export const ARCHETYPES = raw.archetypes.list;
export const ORG_BRICKS = raw.organelleBricks;
export const BUILTIN_ORGANELLES = new Set(ORGANELLES.map((o) => o.id));
export const WALL_DATA = raw.walls;
export const WALLS = Object.fromEntries(raw.walls.materials.map((w) => [w.id, w]));
export const BUILTIN_WALLS = new Set(Object.keys(WALLS));
export const MEMBRANE_PROTEINS = raw.membraneProteins.list;
export const MPROT = Object.fromEntries(MEMBRANE_PROTEINS.map((m) => [m.id, m]));
export const BUILTIN_MPROT = new Set(Object.keys(MPROT));
export const MPROT_WORKSHOP = raw.membraneProteins.workshop;
export const LIVRET = raw.livret.chapters;
