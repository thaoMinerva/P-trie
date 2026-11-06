// Défis guidés : conditions de réussite évaluées sur un monde simulé (client en solo, serveur en multijoueur).
import { CHALLENGES, PARAMS } from '../data/index.js';
import { MI } from '../simulation/metabolism.js';

const IP = PARAMS.interactions, C = PARAMS.cell;

/** Meilleur score parmi les populations du joueur : renvoie [valeur, cible]. */
const best = (pops, f, target) => [Math.max(0, ...pops.map(f)), target];

function countCells(world, pop, pred) {
  let n = 0;
  for (const c of world.cells) if (c.popId === pop.id && pred(c)) n++;
  return n;
}

const quorumActivity = (world, c) => {
  const s = world.env.fields[MI.signal][world.env.idx(c.x, c.y)] / world.env.gridVolume;
  const s3 = s * s * s, k3 = IP.quorumK ** 3;
  return s3 / (k3 + s3);
};

/** id → (ctx) => [progression, cible]. ctx = { world, pops (vivantes du joueur) }. */
const CHECKS = {
  premiers_pas: ({ pops }) => best(pops, (p) => p.count, 50),
  generations: ({ pops }) => best(pops, (p) => p.maxGeneration, 20),
  eau_douce: ({ world, pops }) => best(pops, (p) => (p.design.envelope.wall > 0 ? 0
    : countCells(world, p, (c) => world.env.salinity[world.env.idx(c.x, c.y)] < C.salinityRef)), 10),
  nuit: ({ world, pops }) => best(pops, (p) => (world.env.lightLevel < 0.35 && Object.keys(p.design.enzymes).includes('photosystemes') ? p.count : 0), 20),
  commensalisme: ({ pops }) => {
    const ferm = Math.max(0, ...pops.filter((p) => p.design.enzymes.fermentation_lactique).map((p) => p.count));
    const cons = Math.max(0, ...pops.filter((p) => p.design.enzymes.lactate_oxydase && !p.design.enzymes.fermentation_lactique).map((p) => p.count));
    return [Math.min(ferm, cons), 15];
  },
  generaliste: ({ pops }) => best(pops, (p) => p.resourcesUsed.length, 5),
  eucaryote: ({ pops }) => best(pops, (p) => (p.design.type === 'eucaryote' ? p.count : 0), 30),
  chasseur: ({ allMine }) => [allMine.reduce((a, p) => a + (p.kills || 0), 0), 20],
  alcalin: ({ world, pops }) => best(pops, (p) => countCells(world, p, (c) => world.env.pH[world.env.idx(c.x, c.y)] >= 7.8), 10),
  quorum: ({ world, pops }) => best(pops, (p) => (Object.keys(p.design.quorum || {}).length ? countCells(world, p, (c) => quorumActivity(world, c) > 0.5) : 0), 20),
  biofilm: ({ world, pops }) => best(pops, (p) => countCells(world, p, (c) => c.bfN > 0), 25),
  crispr: ({ world, pops }) => best(pops, (p) => countCells(world, p, (c) => c.immune?.length > 0), 10),
  transfert: ({ allMine }) => [Math.min(1, allMine.reduce((a, p) => a + (p.hgt || 0), 0)), 1],
  antibio: ({ world, pops }) => best(pops, (p) => countCells(world, p, (c) => c.ph.wallMaterial === 'peptidoglycane' && c.ph.wall > 0.02
    && world.env.fields[MI.antibiotique][world.env.idx(c.x, c.y)] / world.env.gridVolume > IP.antibioticThreshold), 15),
  diversite: ({ pops }) => best(pops, (p) => p.strains.filter((s) => s.count > 0).length, 8),
  survivant: ({ world, pops }) => best(pops, (p) => (p.count >= 10 ? Math.floor(world.time - p.launchedAt) : 0), 1200),
};

/** État de chaque défi pour un joueur (sans rien modifier). */
export function challengeStatus(world, ownerId, done = {}) {
  const allMine = [...world.populations.values()].filter((p) => p.ownerId === ownerId);
  const ctx = { world, allMine, pops: allMine.filter((p) => !p.extinct) };
  return CHALLENGES.map((ch) => {
    if (done[ch.id]) return { ...ch, done: true, at: done[ch.id], progress: null };
    let progress = [0, 1];
    try { progress = CHECKS[ch.id]?.(ctx) || progress; } catch { /* monde incomplet (miroir) */ }
    return { ...ch, done: false, progress };
  });
}

/** Défis nouvellement réussis (à récompenser). */
export function newlyCompleted(world, ownerId, done = {}) {
  return challengeStatus(world, ownerId, done).filter((s) => !s.done && s.progress && s.progress[0] >= s.progress[1]);
}
