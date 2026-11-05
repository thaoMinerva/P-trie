// Monde distant (multijoueur) : miroir local du monde simulé par le serveur.
// Expose la même interface que World pour la vue, les fiches et les panneaux (cells, populations, env…),
// mais ne simule rien : il reçoit l'état par Server-Sent Events et envoie les actions par POST.
import { METABOLITES, MET } from '../data/index.js';
import { computeGeometry } from '../simulation/geometry.js';
import { normalizeDesign, computePhenotype } from '../simulation/genome.js';
import { EnzymeRegistry } from '../simulation/registry.js';
import { NMET, MI } from '../simulation/metabolism.js';

const b64ToF32 = (s) => { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new Float32Array(u.buffer); };

/** Environnement en miroir : champs statiques reçus à la connexion, champs dynamiques à la demande (calque affiché). */
class RemoteEnv {
  constructor(w) {
    Object.assign(this, { gw: w.gw, gh: w.gh, n: w.gw * w.gh, cellSize: w.cellSize, gridVolume: w.gridVolume });
    this.temperature = b64ToF32(w.temperature);
    this.salinity = b64ToF32(w.salinity);
    this.lightDepth = b64ToF32(w.lightDepth);
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
    this.listeners = { extinction: [], points: [], event: [], init: [], status: [] };
    this.registry = new EnzymeRegistry();
    this.usersList = [];
    this.connected = false;
    this.lastState = 0;
  }

  on(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  emit(type, ...a) { for (const fn of this.listeners[type] || []) fn(...a); }

  /** Ouvre le flux ; résout quand l'état initial est reçu. */
  connect(playerId, name) {
    return new Promise((resolve, reject) => {
      const url = `${this.base}/api/stream?player=${encodeURIComponent(playerId || '')}&name=${encodeURIComponent(name || '')}`;
      const es = (this.es = new EventSource(url));
      let first = true;
      es.addEventListener('init', (e) => {
        const d = JSON.parse(e.data);
        this.playerId = d.playerId; this.playerName = d.name; this.speed = d.speed;
        this.width = d.world.width; this.height = d.world.height;
        this.env = new RemoteEnv(d.world);
        this.events = d.events || [];
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
      es.addEventListener('log', (e) => {
        const ev = JSON.parse(e.data);
        this.events.push(ev); if (this.events.length > 120) this.events.shift();
        this.emit('event', ev);
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
      c.phase = a[k + 8] ? 'S' : 'G1';
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
    const t = Math.min(1, (performance.now() - this.lastState) / 250);
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
    const r = await fetch(`${this.base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ player: this.playerId, ...data }) });
    return r.json();
  }
  launch(design, x, y) { return this.post('/api/launch', { design, x, y }); }
  removePopulation(popId) { return this.post('/api/abandon', { popId }); }

  /** Charge un champ du serveur pour le calque affiché. */
  async fetchLayer(name) {
    const r = await fetch(`${this.base}/api/layer?name=${encodeURIComponent(name)}`);
    if (!r.ok) return;
    const d = await r.json();
    const arr = b64ToF32(d.data);
    if (name === 'pH') this.env.pH.set(arr);
    else if (name === 'secreted') this.env.secreted.set(arr);
    else if (MET[name]) this.env.fields[MET[name].index].set(arr);
  }

  /** Fiche complète d'une cellule (phénotype recalculé localement à partir du génome). */
  async fetchCell(id) {
    const r = await fetch(`${this.base}/api/cell?id=${id}`);
    if (!r.ok) return null;
    const d = await r.json();
    if (!d.ok) return null;
    for (const e of d.genome.customEnzymes || []) if (!this.registry.has(e.id)) { try { this.registry.register(e); } catch { /* */ } }
    const genome = normalizeDesign(d.genome);
    return {
      ...d, genome, alive: true, ph: computePhenotype(genome, this.registry),
      pools: Float64Array.from(d.pools), dmg: Float64Array.from(d.dmg),
    };
  }
}
