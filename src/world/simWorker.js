// Worker de simulation (mode solo) : le monde tourne sur un autre cœur du processeur que l'affichage.
// Il parle le même « protocole » que le serveur multijoueur (voir protocol.js) ; le navigateur n'en garde qu'un miroir.
import { PARAMS } from '../data/index.js';
import { World } from '../simulation/world.js';
import { GhostWorldSource } from './ghostSource.js';
import { serializeWorld, deserializeWorld } from '../simulation/serialize.js';
import { challengeStatus } from '../game/challenges.js';
import { popPayload, statePayload, worldInfo, cellPayload, layerArray } from './protocol.js';

const W = PARAMS.world;
let world = null, ghosts = null, speed = 1, acc = 0, last = performance.now(), ticks = 0, tps = 0, tpsT = performance.now();

const emit = (name, data, transfer) => postMessage({ type: 'event', name, data }, transfer || []);
const f32 = (a) => new Float32Array(a);

function sizeOf(name) { return PARAMS.worldSizes[name] || PARAMS.worldSizes.petit; }

function create({ snapshot, seed, size }) {
  if (snapshot?.world) {
    world = deserializeWorld(snapshot.world);
    ghosts = new GhostWorldSource({ seed: world.seed });
    ghosts.deserialize(snapshot.ghosts);
  } else {
    const S = sizeOf(size);
    seed = seed ?? ((Date.now() % 1e9) | 0);
    world = new World({ seed, env: { gw: Math.round(S.width / W.cellSize), gh: Math.round(S.height / W.cellSize) }, maxCells: S.maxCells });
    ghosts = new GhostWorldSource({ seed: seed ^ 0x5bd1e995, target: Math.round(PARAMS.game.ghostTarget * S.ghostFactor) });
  }
  world.on('points', (pop, gain) => emit('points', { ownerId: pop.ownerId, gain, popId: pop.id }));
  world.on('extinction', (pop) => emit('extinction', popPayload(pop, true)));
  world.on('event', (ev) => emit('log', ev));
  world.on('envEvent', (e) => emit('envEvent', { type: e.type }));
  world.attachSource(ghosts);
  emit('init', { playerId: 'joueur', name: 'Vous', points: 0, totalEarned: 0, speed, local: true,
    world: { ...worldInfo(world, f32), maxCells: world.maxCells }, events: world.events.slice(-40) });
  sendPops(); sendState();
}

function sendPops() {
  emit('pops', { pops: [...world.populations.values()].filter((p) => !p.extinct || world.time - p.extinctAt < 600).map((p) => popPayload(p, true)), users: ghosts.users() });
}
function sendState() {
  const s = statePayload(world, true);
  s.tps = tps; s.speed = speed;
  emit('state', s, [s.cells.buffer]);
}

// Boucle : autant de pas que la vitesse demandée, dans un budget de temps par tranche de 16 ms.
setInterval(() => {
  if (!world) return;
  const now = performance.now();
  acc += Math.min(0.25, (now - last) / 1000) * W.ticksPerSecond * speed;
  last = now;
  const t0 = performance.now();
  while (acc >= 1) {
    world.step(W.dt); acc -= 1; ticks++;
    if (performance.now() - t0 > 14) { acc = Math.min(acc, 3); break; }
  }
  if (now - tpsT > 1000) { tps = ticks / ((now - tpsT) / 1000); ticks = 0; tpsT = now; }
}, 16);
setInterval(() => { if (world) sendState(); }, 50);
setInterval(() => { if (world) sendPops(); }, 1000);

const handlers = {
  init: (m) => { create(m); return { ok: true }; },
  newWorld: (m) => { create({ seed: m.seed, size: m.size }); return { ok: true }; },
  speed: (m) => { speed = Math.max(0, Math.min(10, +m.speed || 0)); return { ok: true }; },
  launch: ({ design, x, y, ownerId, ownerName }) => {
    const opts = { ownerId, ownerName, name: design.name, color: design.color };
    if (Number.isFinite(x) && Number.isFinite(y)) { opts.x = x; opts.y = y; }
    const pop = world.addPopulation(design, opts);
    sendPops();
    return { ok: true, popId: pop.id };
  },
  abandon: ({ popId }) => { world.removePopulation(popId); return { ok: true }; },
  abandonAll: ({ ownerId, summary }) => {
    for (const p of world.livingPopulations()) if (p.ownerId === ownerId) { p.markExtinct(world.time); p.extinctionSummary = summary; }
    return { ok: true };
  },
  cell: ({ id }) => cellPayload(world, id),
  layer: ({ name }) => { const a = layerArray(world, name); return a ? { ok: true, data: Float32Array.from(a) } : { ok: false }; },
  snapshot: () => ({ world: serializeWorld(world), ghosts: ghosts.serialize(), savedAt: Date.now() }),
  challenges: ({ ownerId, done }) => challengeStatus(world, ownerId, done).map(({ id, icon, title, goal, hint, help, reward, done: d, progress }) => ({ id, icon, title, goal, hint, help, reward, done: d, progress })),
  event: ({ type }) => { world.scheduler?.start(type); return { ok: true }; },
};

onmessage = (e) => {
  const { rid, cmd, ...args } = e.data;
  let data;
  try { data = handlers[cmd] ? handlers[cmd](args) : { ok: false, error: `commande inconnue : ${cmd}` }; }
  catch (err) { data = { ok: false, error: err.message }; console.error(err); }
  if (rid !== undefined) postMessage({ type: 'reply', rid, data });
};

// le module (et ses données JSON) est chargé : le navigateur peut envoyer ses commandes
postMessage({ type: 'ready' });
