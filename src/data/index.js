// Chargeur des données biologiques (JSON) – fonctionne dans le navigateur (fetch) et sous Node (fs).
const FILES = ['metabolites', 'enzymes', 'organelles', 'envelope', 'params', 'bricks', 'archetypes'];

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
