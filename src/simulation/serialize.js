// Sauvegarde / restauration complète d'un monde (sans le rendu).
import { World } from './world.js';
import { Population } from './population.js';
import { computePhenotype } from './genome.js';
import { MET } from '../data/index.js';
import { NMET } from './metabolism.js';

function f64ToB64(arr) {
  const bytes = new Uint8Array(new Float32Array(arr).buffer);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return typeof btoa === 'function' ? btoa(s) : Buffer.from(s, 'binary').toString('base64');
}
function b64ToF64(b64) {
  const s = typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary');
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return Float64Array.from(new Float32Array(bytes.buffer));
}

export function serializeWorld(world) {
  const env = world.env;
  const fields = {};
  env.fields.forEach((f, i) => { if (f) fields[i] = f64ToB64(f); });
  const genomes = [], gIndex = new Map();
  const cells = world.cells.map((c) => {
    const key = JSON.stringify(c.genome);
    if (!gIndex.has(key)) { gIndex.set(key, genomes.length); genomes.push(c.genome); }
    return [c.id, c.popId, gIndex.get(key), +c.x.toFixed(2), +c.y.toFixed(2), +c.heading.toFixed(3), c.generation, +c.age.toFixed(1), +c.damage.toFixed(4), c.phase, +c.phaseTime.toFixed(2), c.host, c.hostOffset, c.parasites, c.partners, f64ToB64(c.pools)];
  });
  const pops = [...world.populations.values()].map((p) => ({ ...p.summary(), count: p.count, births: p.births, recentCauses: p.recentCauses, extinct: p.extinct, _lastGenBonus: p._lastGenBonus, prey: p.prey, symbiosis: p.symbiosis, parasitism: p.parasitism }));
  return {
    version: 1, seed: world.seed, rng: world.rng.state, envRng: null, time: world.time, tick: world.tick,
    nextCellId: world.nextCellId, nextPopId: world.nextPopId, scoreTimer: world._scoreTimer,
    customEnzymes: world.registry.all().filter((e) => e.custom),
    env: { fields, pHBase: f64ToB64(env.pHBase), temperature: f64ToB64(env.temperature), salinity: f64ToB64(env.salinity), patchTargets: Object.fromEntries(Object.entries(env.patchTargets).map(([k, v]) => [k, f64ToB64(v)])), landmarks: env.landmarks },
    genomes, cells, populations: pops, events: world.events.slice(-40),
  };
}

export function deserializeWorld(data) {
  const world = new World({ seed: data.seed });
  world.rng.state = data.rng;
  world.time = data.time; world.tick = data.tick;
  world.nextCellId = data.nextCellId; world.nextPopId = data.nextPopId; world._scoreTimer = data.scoreTimer || 0;
  for (const e of data.customEnzymes || []) world.registry.register(e);
  const env = world.env;
  for (const [i, b] of Object.entries(data.env.fields)) env.fields[i].set(b64ToF64(b));
  env.pHBase.set(b64ToF64(data.env.pHBase)); env.temperature.set(b64ToF64(data.env.temperature)); env.salinity.set(b64ToF64(data.env.salinity));
  for (const [k, v] of Object.entries(data.env.patchTargets)) env.patchTargets[k] = Float32Array.from(b64ToF64(v));
  env.landmarks = data.env.landmarks;
  env.updatePH();
  for (const s of data.populations) {
    const p = new Population({ id: s.id, ownerId: s.ownerId, ownerName: s.ownerName, name: s.name, color: s.color, design: s.design, launchedAt: s.launchedAt, profile: s.profile });
    Object.assign(p, { count: s.count, maxCount: s.maxCount, births: s.births, deaths: s.deaths, maxGeneration: s.maxGeneration, deathCauses: s.deathCauses, recentCauses: s.recentCauses || [], history: s.history, score: s.score, pointsEarned: s.pointsEarned, extinct: s.extinct, extinctAt: s.extinctAt, extinctionSummary: s.extinctionSummary, kills: s.kills || 0, resourcesUsed: s.resourcesUsed || [], _lastGenBonus: s._lastGenBonus || 0, prey: s.prey || 0, symbiosis: s.symbiosis || 0, parasitism: s.parasitism || 0 });
    world.populations.set(p.id, p);
  }
  const phCache = new Map();
  for (const r of data.cells) {
    const [id, popId, gi, x, y, heading, generation, age, damage, phase, phaseTime, host, hostOffset, parasites, partners, pools] = r;
    const genome = data.genomes[gi];
    if (!phCache.has(gi)) phCache.set(gi, computePhenotype(genome, world.registry));
    const pop = world.populations.get(popId);
    const saveNext = world.nextCellId;
    const c = world.createCell(pop, genome, x, y, generation, phCache.get(gi));
    world.cellById.delete(c.id);
    c.id = id; world.nextCellId = saveNext;
    world.cellById.set(id, c);
    Object.assign(c, { heading, age, damage, phase, phaseTime, host, hostOffset, parasites, partners });
    c.pools.set(b64ToF64(pools).subarray(0, NMET));
    world.cells.push(c);
  }
  world.events = data.events || [];
  return world;
}
export { MET };
