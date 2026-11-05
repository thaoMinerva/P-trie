// Serveur multijoueur Petri (aucune dépendance) : node server/server.js [port]
//
// - Fait tourner UN monde partagé (même moteur que le client) en temps réel, avec les populations fantômes.
// - Sert les fichiers du jeu (le navigateur détecte /api/info et passe en mode multijoueur).
// - Diffuse l'état aux navigateurs par Server-Sent Events (GET /api/stream) ; les actions passent par POST.
// - Autorité : le serveur valide les conceptions (sanitizeDesign), gère les points et sauvegarde le monde.
import http from 'node:http';
import { readFile, writeFile, mkdir, stat, rename } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { PARAMS, MET } from '../src/data/index.js';
import { World } from '../src/simulation/world.js';
import { GhostWorldSource } from '../src/world/ghostSource.js';
import { serializeWorld, deserializeWorld } from '../src/simulation/serialize.js';
import { sanitizeDesign } from '../src/simulation/sanitize.js';
import { analyzeDesign } from '../src/simulation/analysis.js';
import { launchCost } from '../src/game/progression.js';
import { MI, DMG_KEYS } from '../src/simulation/metabolism.js';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const port = Number(process.argv[2] || process.env.PORT || 5173);
const SAVE = join(root, 'server', 'data', 'monde.json');
const G = PARAMS.game, W = PARAMS.world;
const SPEED = Number(process.env.PETRI_SPEED || 1); // vitesse du monde partagé (×1 par défaut)

// ------------------------------------------------------------------ état
let world, ghosts;
const players = new Map(); // id → { id, name, points, totalEarned, lastSeen }
const clients = new Set(); // { res, playerId, sentAt }
let chat = []; // derniers messages { id, playerId, name, text, at, system? }
let chatSeq = 0;

function wire() {
  world.on('points', (pop, gain) => {
    const pl = players.get(pop.ownerId);
    if (!pl) return;
    pl.points += gain; pl.totalEarned += gain;
    sendTo(pl.id, 'points', { points: pl.points, totalEarned: pl.totalEarned, gain, popId: pop.id });
  });
  world.on('extinction', (pop) => broadcast('extinction', pop.summary()));
  world.on('event', (ev) => broadcast('log', ev));
}

async function load() {
  try {
    const data = JSON.parse(await readFile(SAVE, 'utf8'));
    world = deserializeWorld(data.world);
    ghosts = new GhostWorldSource({ seed: world.seed });
    ghosts.deserialize(data.ghosts);
    for (const p of data.players || []) players.set(p.id, p);
    chat = (data.chat || []).slice(-100); chatSeq = chat.reduce((m, c) => Math.max(m, c.id || 0), 0);
    console.log(`Monde restauré (${world.cells.length} cellules, t = ${Math.round(world.time)} s, ${players.size} joueurs connus).`);
  } catch {
    world = new World({ seed: (Date.now() % 1e9) | 0 });
    ghosts = new GhostWorldSource({ seed: world.seed ^ 0x5bd1e995 });
    console.log('Nouveau monde créé.');
  }
  wire();
  world.attachSource(ghosts);
}

async function save() {
  await mkdir(join(root, 'server', 'data'), { recursive: true });
  const tmp = SAVE + '.tmp';
  await writeFile(tmp, JSON.stringify({ world: serializeWorld(world), ghosts: ghosts.serialize(), players: [...players.values()].map(({ chatTimes, ...p }) => p), chat, savedAt: Date.now() }));
  await rename(tmp, SAVE);
}

// ------------------------------------------------------------------ boucle de simulation
let acc = 0, last = performance.now();
function tick() {
  const now = performance.now();
  acc += ((now - last) / 1000) * W.ticksPerSecond * SPEED;
  last = now;
  const t0 = performance.now();
  while (acc >= 1) {
    world.step(W.dt); acc -= 1;
    if (performance.now() - t0 > 40) { acc = Math.min(acc, 3); break; }
  }
  // moins de fantômes quand de vrais joueurs sont en ligne
  const online = [...players.values()].filter((p) => clientsOf(p.id).length).length;
  ghosts.target = Math.max(2, G.ghostTarget - online);
}

// ------------------------------------------------------------------ diffusion (SSE)
function sse(res, event, data) { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); }
function broadcast(event, data) { for (const c of clients) sse(c.res, event, data); }
function clientsOf(id) { return [...clients].filter((c) => c.playerId === id); }
function sendTo(id, event, data) { for (const c of clientsOf(id)) sse(c.res, event, data); }

const b64 = (arr) => Buffer.from(new Float32Array(arr).buffer).toString('base64');

function pushChat(m) {
  m = { id: ++chatSeq, at: Date.now(), ...m };
  chat.push(m); if (chat.length > 100) chat.shift();
  broadcast('chat', m);
  return m;
}

function popPayload(p, withHistory) {
  return {
    id: p.id, ownerId: p.ownerId, ownerName: p.ownerName, name: p.name, color: p.color, profile: p.profile, design: p.design,
    launchedAt: p.launchedAt, count: p.count, maxCount: p.maxCount, births: p.births, deaths: p.deaths, maxGeneration: p.maxGeneration,
    deathCauses: p.deathCauses, score: p.score, pointsEarned: p.pointsEarned, kills: p.kills, symbiosis: p.symbiosis, parasitism: p.parasitism,
    resourcesUsed: p.resourcesUsed, extinct: p.extinct, extinctAt: p.extinctAt, extinctionSummary: p.extinctionSummary,
    history: withHistory ? p.history : undefined,
  };
}

function statePayload() {
  const popIndex = new Map();
  const pops = [];
  for (const p of world.populations.values()) if (!p.extinct || world.time - p.extinctAt < 300) { popIndex.set(p.id, pops.length); pops.push(p.id); }
  const cells = new Array(world.cells.length * 11);
  let k = 0;
  for (const c of world.cells) {
    cells[k++] = c.id; cells[k++] = popIndex.get(c.popId) ?? -1;
    cells[k++] = Math.round(c.x * 10) / 10; cells[k++] = Math.round(c.y * 10) / 10;
    cells[k++] = Math.round(c.angle * 100) / 100; cells[k++] = Math.round(c.ph.radius * 100) / 100;
    cells[k++] = Math.round((c.pools[MI.biomass] / c.ph.B0) * 100) / 100; cells[k++] = Math.round(c.genome.hue || 0);
    cells[k++] = c.phase === 'G1' ? 0 : 1; cells[k++] = c.host || 0; cells[k++] = c.partners[0] || 0;
  }
  return { t: world.time, light: world.env.lightLevel, pops, cells };
}

function usersPayload() {
  const real = [...players.values()].map((p) => ({ id: p.id, name: p.name, profile: 'Joueur', online: clientsOf(p.id).length > 0, human: true }));
  return [...real, ...ghosts.users().map((u) => ({ ...u, profile: `${u.profile} (fantôme)` }))];
}

setInterval(() => { if (clients.size) broadcast('state', statePayload()); }, 250);
setInterval(() => {
  if (!clients.size) return;
  broadcast('pops', { pops: [...world.populations.values()].filter((p) => !p.extinct || world.time - p.extinctAt < 600).map((p) => popPayload(p, true)), users: usersPayload() });
}, 2000);
setInterval(() => { for (const c of clients) c.res.write(': ping\n\n'); }, 15000);

// ------------------------------------------------------------------ API
async function body(req) {
  let s = '';
  for await (const chunk of req) { s += chunk; if (s.length > 2e6) throw new Error('Requête trop volumineuse'); }
  return s ? JSON.parse(s) : {};
}
function json(res, code, data) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' }); res.end(JSON.stringify(data)); }

function playerFor(id, name) {
  let p = id && players.get(id);
  if (!p) {
    id = id && /^[a-z0-9_-]{6,40}$/i.test(id) ? id : `j_${randomBytes(6).toString('hex')}`;
    p = { id, name: 'Joueur', points: G.startPoints, totalEarned: 0, lastSeen: Date.now() };
    players.set(id, p);
  }
  if (name) p.name = String(name).replace(/[<>]/g, '').slice(0, 24) || p.name;
  p.lastSeen = Date.now();
  return p;
}

const api = {
  'GET /api/info': (req, res) => json(res, 200, { multiplayer: true, players: usersPayload().filter((u) => u.human && u.online).length, time: world.time, speed: SPEED }),

  'GET /api/stream': (req, res, url) => {
    const pl = playerFor(url.searchParams.get('player'), url.searchParams.get('name'));
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    const env = world.env;
    sse(res, 'init', {
      playerId: pl.id, name: pl.name, points: pl.points, totalEarned: pl.totalEarned,
      world: { width: world.width, height: world.height, gw: env.gw, gh: env.gh, cellSize: env.cellSize, gridVolume: env.gridVolume,
        temperature: b64(env.temperature), salinity: b64(env.salinity), lightDepth: b64(env.lightDepth) },
      events: world.events.slice(-40), speed: SPEED, chat,
    });
    sse(res, 'pops', { pops: [...world.populations.values()].map((p) => popPayload(p, true)), users: usersPayload() });
    sse(res, 'state', statePayload());
    const c = { res, playerId: pl.id };
    const already = clientsOf(pl.id).length > 0;
    clients.add(c);
    if (!already) { world.log(`${pl.name} a rejoint le monde partagé.`, 'ghost'); pushChat({ system: true, text: `${pl.name} a rejoint le monde.` }); }
    req.on('close', () => {
      clients.delete(c);
      if (!clientsOf(pl.id).length) { world.log(`${pl.name} s'est déconnecté(e).`, 'ghost'); pushChat({ system: true, text: `${pl.name} est parti(e).` }); }
    });
  },

  'POST /api/launch': async (req, res) => {
    const b = await body(req);
    const pl = players.get(b.player);
    if (!pl) return json(res, 403, { ok: false, error: 'Joueur inconnu : rechargez la page.' });
    let design;
    try { design = sanitizeDesign(b.design, pl.id); } catch (e) { return json(res, 400, { ok: false, error: e.message }); }
    const a = analyzeDesign(design, world.registry);
    if (a.errors.length) return json(res, 400, { ok: false, error: a.errors[0] });
    const cost = launchCost(design);
    if (pl.points < cost) return json(res, 400, { ok: false, error: `Points insuffisants (${Math.floor(pl.points)} / ${cost}).` });
    const mine = world.livingPopulations().filter((p) => p.ownerId === pl.id).length;
    if (mine >= 6) return json(res, 400, { ok: false, error: 'Six populations vivantes au maximum par joueur.' });
    pl.points = Math.max(G.pointsFloor, pl.points - cost);
    const opts = { ownerId: pl.id, ownerName: pl.name, name: design.name, color: design.color };
    if (Number.isFinite(b.x) && Number.isFinite(b.y)) { opts.x = Math.max(1, Math.min(world.width - 1, b.x)); opts.y = Math.max(1, Math.min(world.height - 1, b.y)); }
    const pop = world.addPopulation(design, opts);
    sendTo(pl.id, 'points', { points: pl.points, totalEarned: pl.totalEarned, gain: -cost });
    broadcast('pops', { pops: [popPayload(pop, true)], users: usersPayload(), partial: true });
    json(res, 200, { ok: true, popId: pop.id, points: pl.points, cost });
  },

  'POST /api/chat': async (req, res) => {
    const b = await body(req);
    const pl = players.get(b.player);
    if (!pl || !clientsOf(pl.id).length) return json(res, 403, { ok: false, error: 'Joueur inconnu ou déconnecté : rechargez la page.' });
    // eslint-disable-next-line no-control-regex
    const text = String(b.text || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 300);
    if (!text) return json(res, 400, { ok: false, error: 'Message vide.' });
    const now = Date.now();
    pl.chatTimes = (pl.chatTimes || []).filter((t) => now - t < 10000);
    if (pl.chatTimes.length >= 5) return json(res, 429, { ok: false, error: 'Doucement : 5 messages par 10 secondes au maximum.' });
    pl.chatTimes.push(now);
    pushChat({ playerId: pl.id, name: pl.name, text });
    json(res, 200, { ok: true });
  },

  'POST /api/abandon': async (req, res) => {
    const b = await body(req);
    const pop = world.populations.get(b.popId);
    if (!pop || pop.ownerId !== b.player) return json(res, 403, { ok: false, error: 'Cette population ne vous appartient pas.' });
    world.removePopulation(pop.id);
    json(res, 200, { ok: true });
  },

  'GET /api/cell': (req, res, url) => {
    const c = world.cellById.get(Number(url.searchParams.get('id')));
    if (!c || !c.alive) return json(res, 404, { ok: false });
    const env = world.env, g = env.idx(c.x, c.y);
    json(res, 200, {
      ok: true, id: c.id, popId: c.popId, genome: c.genome, pools: Array.from(c.pools), dmg: Array.from(c.dmg), dmgKeys: DMG_KEYS,
      damage: c.damage, age: c.age, generation: c.generation, phase: c.phase, x: c.x, y: c.y, angle: c.angle,
      host: c.host, parasites: c.parasites, partners: c.partners,
      local: { T: env.temperature[g], pH: env.pH[g], light: env.lightAt(g), salinity: env.salinity[g],
        o2: env.fields[MET.o2.index][g], glucose: env.fields[MET.glucose.index][g], nh4: env.fields[MET.nh4.index][g], protein: env.fields[MET.protein.index][g] },
    });
  },

  'GET /api/layer': (req, res, url) => {
    const name = url.searchParams.get('name') || '';
    const env = world.env;
    let arr = null;
    if (name === 'pH') arr = env.pH;
    else if (name === 'secreted') arr = env.secreted;
    else if (MET[name]?.env) arr = env.fields[MET[name].index];
    if (!arr) return json(res, 404, { ok: false });
    json(res, 200, { ok: true, name, data: b64(arr) });
  },
};

// ------------------------------------------------------------------ fichiers statiques
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
async function serveStatic(req, res, url) {
  let p = decodeURIComponent(url.pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = normalize(join(root, p));
  if ((file !== root && !file.startsWith(root + sep)) || file.includes(`${sep}server${sep}data`)) { res.writeHead(403).end(); return; }
  try {
    const s = await stat(file);
    if (!s.isFile()) throw new Error();
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end(`404 – fichier introuvable : ${url.pathname}`);
  }
}

// ------------------------------------------------------------------ démarrage
await load();
setInterval(tick, 1000 / 60);
setInterval(() => save().catch((e) => console.warn('Sauvegarde impossible :', e.message)), 60000);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { console.log('\nSauvegarde du monde…'); await save().catch(() => {}); process.exit(0); });

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const handler = api[`${req.method} ${url.pathname}`];
  try {
    if (handler) await handler(req, res, url);
    else if (url.pathname.startsWith('/api/')) json(res, 404, { ok: false, error: 'API inconnue' });
    else await serveStatic(req, res, url);
  } catch (e) {
    if (!res.headersSent) json(res, 500, { ok: false, error: e.message });
  }
}).listen(port, () => {
  console.log(`Petri multijoueur : http://localhost:${port}/`);
  console.log('Les autres joueurs de votre réseau peuvent se connecter avec l\'adresse IP de cette machine (ex. http://192.168.1.20:' + port + '/).');
});
