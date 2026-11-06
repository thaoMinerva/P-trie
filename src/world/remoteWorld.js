// Monde distant (multijoueur) : miroir local du monde simulé par le serveur.
// Expose la même interface que World pour la vue, les fiches et les panneaux (cells, populations, env…),
// mais ne simule rien : il reçoit l'état par Server-Sent Events et envoie les actions par POST.
import { METABOLITES, MET } from '../data/index.js';
import { computeGeometry } from '../simulation/geometry.js';
import { normalizeDesign, computePhenotype } from '../simulation/genome.js';
import { EnzymeRegistry } from '../simulation/registry.js';
import { NMET, MI } from '../simulation/metabolism.js';

export const b64ToF32 = (s) => { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new Float32Array(u.buffer); };

/** Environnement en miroir : champs statiques reçus à la connexion, champs dynamiques à la demande (calque affiché). */
class RemoteEnv {
  constructor(w, raw = null) {
    Object.assign(this, { gw: w.gw, gh: w.gh, n: w.gw * w.gh, cellSize: w.cellSize, gridVolume: w.gridVolume });
    this.temperature = raw ? Float32Array.from(raw.temperature) : b64ToF32(w.temperature);
    this.salinity = raw ? Float32Array.from(raw.salinity) : b64ToF32(w.salinity);
    this.lightDepth = raw ? Float32Array.from(raw.lightDepth) : b64ToF32(w.lightDepth);
    this.pH = new Float32Array(this.n).fill(7);
    this.secreted = new Float32Array(this.n);
    this.fields = METABOLITES.map((m) => (m.env ? new Float32Array(this.n) : null));
    this.lightLevel = 1;
  }
  idx(x, y) {
    const gx = Math.min(this.gw - 1, Math.max(0, Math.floor(x / this.cellSize)));
    const gy = Math.min(this.gh - 1, Math.max(0, Math.floor(y / this.cellSize)));
    return gy * this.gw + gx;
  }
  lightAt(i) { return this.lightDepth[Math.floor(i / this.gw)] * this.lightLevel; }
}

class RemotePop {
  constructor(data) { this.update(data); }
  update(d) {
    const designChanged = !this.design || JSON.stringify(d.design) !== this._designKey;
    Object.assign(this, d);
    if (!this.history) this.history = [];
    if (designChanged) {
      this._designKey = JSON.stringify(d.design);
      this.design = normalizeDesign(d.design);
      this.geo = computeGeometry({ ...this.design.shape, size: 1 });
    }
  }
  summary() { const { geo, _designKey, ...rest } = this; return { ...rest }; }
}

export class RemoteWorld {
  constructor(base = '') {
    this.base = base;
    this.remote = true;
    this.cells = [];
    this.cellById = new Map();
    this.populations = new Map();
    this.popOrder = [];
    this.events = [];
    this.time = 0;
    this.listeners = { extinction: [], points: [], event: [], init: [], status: [], chat: [] };
    this.chat = [];
    this.registry = new EnzymeRegistry();
    this.usersList = [];
    this.connected = false;
    this.lastState = 0;
    this.interval = 250; // ms entre deux états (interpolation)
    this.key = '';
  }

  on(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  emit(type, ...a) { for (const fn of this.listeners[type] || []) fn(...a); }

  /** Ouvre le flux ; résout quand l'état initial est reçu. */
  connect(playerId, name) {
    return new Promise((resolve, reject) => {
      const url = `${this.base}/api/stream?player=${encodeURIComponent(playerId || '')}&name=${encodeURIComponent(name || '')}&key=${encodeURIComponent(this.key)}`;
      const es = (this.es = new EventSource(url));
      let first = true;
      es.addEventListener('init', (e) => {
        const d = JSON.parse(e.data);
        this.playerId = d.playerId; this.playerName = d.name; this.speed = d.speed;
        this.width = d.world.width; this.height = d.world.height;
        this.env = new RemoteEnv(d.world);
        this.events = d.events || [];
        if (first) this.chat = d.chat || [];
        this.connected = true;
        this.emit('status', true);
        this.emit('init', d);
        if (first) { first = false; resolve(d); }
      });
      es.addEventListener('state', (e) => this.applyState(JSON.parse(e.data)));
      es.addEventListener('pops', (e) => this.applyPops(JSON.parse(e.data)));
      es.addEventListener('points', (e) => this.emit('points', JSON.parse(e.data)));
      es.addEventListener('extinction', (e) => {
        const s = JSON.parse(e.data);
        const p = this.populations.get(s.id);
        if (p) p.update(s); else this.populations.set(s.id, new RemotePop(s));
        this.emit('extinction', this.populations.get(s.id));
      });
      es.addEventListener('challenges', (e) => this.emit('challenges', JSON.parse(e.data)));
      es.addEventListener('challengeDone', (e) => this.emit('challengeDone', JSON.parse(e.data)));
      es.addEventListener('chat', (e) => {
        const m = JSON.parse(e.data);
        this.chat.push(m); if (this.chat.length > 150) this.chat.shift();
        this.emit('chat', m);
      });
      es.addEventListener('log', (e) => {
        const ev = JSON.parse(e.data);
        this.events.push(ev); if (this.events.length > 120) this.events.shift();
        this.emit('event', ev);
        if (ev.kind === 'env') { const m = /^(\S+)/.exec(ev.text); const type = Object.entries({ '🔥': 'canicule', '❄️': 'froid', '🌧️': 'pluie', '🍂': 'apport', '💊': 'antibiotique', '🦠': 'phages' }).find(([k]) => m && m[1] === k)?.[1]; if (type && !/mutante/.test(ev.text)) this.emit('envEvent', { type }); }
      });
      es.onerror = () => {
        if (first) { es.close(); reject(new Error('Connexion au serveur impossible')); return; }
        this.connected = false; this.emit('status', false); // EventSource se reconnecte tout seul
      };
    });
  }

  applyPops({ pops, users }) {
    for (const d of pops) {
      const p = this.populations.get(d.id);
      if (p) p.update(d); else this.populations.set(d.id, new RemotePop(d));
      for (const e of d.design.customEnzymes || []) if (!this.registry.has(e.id)) { try { this.registry.register(e); } catch { /* */ } }
    }
    if (users) this.usersList = users;
  }

  applyState(s) {
    this.time = s.t;
    this.envEvents = s.evs || [];
    if (this.env) this.env.lightLevel = s.light;
    this.popOrder = s.pops;
    const seen = new Map();
    const a = s.cells, now = performance.now();
    const out = [];
    for (let k = 0; k < a.length; k += 11) {
      const id = a[k], pop = this.populations.get(this.popOrder[a[k + 1]]);
      if (!pop) continue;
      let c = this.cellById.get(id);
      if (!c) {
        c = { id, popId: pop.id, x: a[k + 2], y: a[k + 3], angle: a[k + 4], alive: true, pools: new Float64Array(NMET), dmg: [], partners: [], host: null };
      }
      c.fx = c.x; c.fy = c.y; c.tx = a[k + 2]; c.ty = a[k + 3]; c.fa = c.angle; c.ta = a[k + 4];
      if (c.genome !== pop.design) { c.genome = pop.design; c._org = null; }
      c.ph = c.ph && c.ph.radius === a[k + 5] && c.ph.geo === pop.geo ? c.ph : { radius: a[k + 5], geo: pop.geo, wall: pop.design.envelope.wall, B0: 1, V: 1 };
      c.pools[MI.biomass] = a[k + 6];
      c.hue = a[k + 7];
      const fl = a[k + 8];
      c.phase = fl & 1 ? 'S' : 'G1'; c.bfN = fl & 2 ? 1 : 0; c.infected = fl & 4 ? { t: 0, strain: 0 } : null;
      c.host = a[k + 9] || null;
      c.partners = a[k + 10] ? [a[k + 10]] : [];
      seen.set(id, c);
      out.push(c);
    }
    for (const [id, c] of this.cellById) if (!seen.has(id)) c.alive = false;
    this.cellById = seen;
    this.cells = out;
    for (const p of this.populations.values()) p.count = 0;
    for (const c of out) { const p = this.populations.get(c.popId); if (p) p.count++; }
    this.lastState = now;
  }

  /** Interpolation des positions entre deux états (appelée à chaque image). */
  update() {
    const t = Math.min(1, (performance.now() - this.lastState) / this.interval);
    for (const c of this.cells) {
      if (c.tx === undefined) continue;
      c.x = c.fx + (c.tx - c.fx) * t; c.y = c.fy + (c.ty - c.fy) * t;
      const da = ((c.ta - c.fa + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      c.angle = c.fa + da * t;
    }
  }

  step() { /* le serveur simule */ }
  livingPopulations() { return [...this.populations.values()].filter((p) => !p.extinct); }
  users() { return this.usersList; }

  async post(path, data) {
    const r = await fetch(`${this.base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Petri-Key': this.key }, body: JSON.stringify({ player: this.playerId, ...data }) });
    return r.json();
  }
  launch(design, x, y) { return this.post('/api/launch', { design, x, y }); }
  removePopulation(popId) { return this.post('/api/abandon', { popId }); }
  sendChat(text) { return this.post('/api/chat', { text }); }

  /** Charge un champ du serveur pour le calque affiché. */
  async fetchLayer(name) {
    const r = await fetch(`${this.base}/api/layer?name=${encodeURIComponent(name)}`, { headers: { 'X-Petri-Key': this.key } });
    if (!r.ok) return;
    const d = await r.json();
    this.setLayer(name, b64ToF32(d.data));
  }

  setLayer(name, arr) {
    if (name === 'pH') this.env.pH.set(arr);
    else if (name === 'secreted') this.env.secreted.set(arr);
    else if (name === 'temperature') this.env.temperature.set(arr);
    else if (name === 'salinity') this.env.salinity.set(arr);
    else if (MET[name]) this.env.fields[MET[name].index].set(arr);
  }

  /** Fiche complète d'une cellule (phénotype recalculé localement à partir du génome). */
  async fetchCell(id) {
    const r = await fetch(`${this.base}/api/cell?id=${id}`, { headers: { 'X-Petri-Key': this.key } });
    if (!r.ok) return null;
    return this.cellFrom(await r.json());
  }

  cellFrom(d) {
    if (!d || !d.ok) return null;
    for (const e of d.genome.customEnzymes || []) if (!this.registry.has(e.id)) { try { this.registry.register(e); } catch { /* */ } }
    const genome = normalizeDesign(d.genome);
    return {
      ...d, genome, alive: true, ph: computePhenotype(genome, this.registry),
      pools: Float64Array.from(d.pools), dmg: Float64Array.from(d.dmg),
    };
  }
}

/**
 * Monde solo simulé dans un worker : même miroir que le multijoueur, mais la « connexion » est un Worker.
 * Le calcul tourne sur un autre cœur, l'affichage reste fluide même avec beaucoup de cellules.
 */
export class LocalWorld extends RemoteWorld {
  constructor() {
    super('');
    this.local = true;
    this.interval = 50;
    this.pending = new Map();
    this.seq = 0;
    this.worker = new Worker(new URL('./simWorker.js', import.meta.url), { type: 'module' });
    this.ready = new Promise((resolve) => { this._workerReady = resolve; });
    this.worker.onmessage = (e) => this.onMessage(e.data);
    this.worker.onerror = (e) => { console.error('Worker :', e.message); this.emit('workerError', e); };
  }

  async call(cmd, args = {}) {
    await this.ready;
    const id = ++this.seq;
    // « rid » : numéro de requête (distinct d'un éventuel argument « id », par ex. l'identifiant d'une cellule)
    return new Promise((resolve) => { this.pending.set(id, resolve); this.worker.postMessage({ ...args, rid: id, cmd }); });
  }

  onMessage(m) {
    if (m.type === 'ready') { this._workerReady(); return; }
    if (m.type === 'reply') { const r = this.pending.get(m.rid); this.pending.delete(m.rid); r?.(m.data); return; }
    const d = m.data;
    switch (m.name) {
      case 'init':
        this.width = d.world.width; this.height = d.world.height; this.maxCells = d.world.maxCells;
        this.env = new RemoteEnv({ ...d.world, temperature: null, salinity: null, lightDepth: null }, d.world);
        this.events = d.events || [];
        this.cells = []; this.cellById = new Map(); this.populations = new Map();
        this.connected = true;
        this.emit('init', d);
        this._ready?.(d); this._ready = null;
        break;
      case 'state': this.tps = d.tps; this.applyState(d); break;
      case 'pops': this.applyPops(d); break;
      case 'points': this.emit('points', d); break;
      case 'extinction': { const p = this.populations.get(d.id); if (p) p.update(d); else this.populations.set(d.id, new RemotePop(d)); this.emit('extinction', this.populations.get(d.id)); break; }
      case 'log': this.events.push(d); if (this.events.length > 120) this.events.shift(); this.emit('event', d); break;
      case 'envEvent': this.emit('envEvent', d); break;
      default: break;
    }
  }

  /** Démarre le monde (depuis une sauvegarde ou neuf) ; résout quand l'état initial est reçu. */
  async start(opts) { await this.ready; return new Promise((resolve) => { this._ready = resolve; this.worker.postMessage({ cmd: 'init', ...opts }); }); }
  async newWorld(opts) { await this.ready; return new Promise((resolve) => { this._ready = resolve; this.worker.postMessage({ cmd: 'newWorld', ...opts }); }); }
  setSpeed(s) { return this.call('speed', { speed: s }); }
  launch(design, x, y, owner) { return this.call('launch', { design, x, y, ...owner }); }
  removePopulation(popId) { return this.call('abandon', { popId }); }
  abandonAll(ownerId, summary) { return this.call('abandonAll', { ownerId, summary }); }
  snapshot() { return this.call('snapshot'); }
  challenges(ownerId, done) { return this.call('challenges', { ownerId, done }); }
  startEvent(type) { return this.call('event', { type }); }
  async fetchLayer(name) { const r = await this.call('layer', { name }); if (r.ok) this.setLayer(name, r.data); }
  async fetchCell(id) { const d = await this.call('cell', { id }); for (const e of d?.genome?.customEnzymes || []) if (!this.registry.has(e.id)) { try { this.registry.register(e); } catch { /* */ } } return this.cellFrom(d); }
}
