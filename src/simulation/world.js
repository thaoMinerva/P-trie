// Monde de simulation : indépendant du rendu, déterministe pour une graine donnée.
import { PARAMS, ENVELOPE, MET, METABOLITES } from '../data/index.js';
import { RNG } from './rng.js';
import { EnzymeRegistry } from './registry.js';
import { Environment, ENV_METS } from './environment.js';
import { SpatialHash } from './spatial.js';
import { normalizeDesign, computePhenotype, mutateDesign } from './genome.js';
import { metabolize, releaseContents, transferToEater, NMET, MI, CAUSES, newDamage } from './metabolism.js';
import { Population } from './population.js';

const P = PARAMS, Cp = P.cell, IP = P.interactions;
CAUSES.parasitism = 'parasitisme (ressources détournées)';
CAUSES.removed = 'retirée par son propriétaire';
const EXCHANGED = ['glucose', 'aa', 'nh4', 'o2', 'co2', 'lactate', 'acetate', 'ethanol', 'pyruvate'].map((id) => MI[id]);
const DRAINED = ['glucose', 'aa', 'pyruvate', 'lactate', 'reserve'].map((id) => MI[id]);
const SENSE_SCALE = { glucose: 3, lactate: 2, ethanol: 2, acetate: 2, aa: 2, nh4: 2, starch: 4, cellulose: 8, protein: 2, o2: 10, co2: 3, toxin: 1, n2: 10, phosphate: 1.5, pyruvate: 2 };

export class World {
  constructor({ seed = 1, env = {}, maxCells = P.world.maxCells } = {}) {
    this.seed = seed;
    this.rng = new RNG(seed);
    this.registry = new EnzymeRegistry();
    this.env = new Environment(this.rng.fork(), env);
    this.width = this.env.gw * this.env.cellSize;
    this.height = this.env.gh * this.env.cellSize;
    this.maxCells = maxCells;
    this.cells = [];
    this.cellById = new Map();
    this.populations = new Map();
    this.time = 0;
    this.tick = 0;
    this.nextCellId = 1;
    this.nextPopId = 1;
    this.hash = new SpatialHash(this.width, this.height, 16);
    this.events = [];
    this.sources = [];
    this.listeners = { extinction: [], points: [], event: [] };
    this.maxRadius = 1;
    this._scoreTimer = 0;
    this._sampleTimer = 0;
  }

  on(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  emit(type, ...args) { for (const fn of this.listeners[type]) fn(...args); }
  log(text, kind = 'info', popId = null) {
    const ev = { t: +this.time.toFixed(1), text, kind, popId };
    this.events.push(ev);
    if (this.events.length > 120) this.events.shift();
    this.emit('event', ev);
  }

  attachSource(src) { this.sources.push(src); src.attach?.(this); }

  // ------------------------------------------------------------------ populations
  /**
   * Lance une population. opts : { ownerId, ownerName, name, color, count, x, y, profile }.
   */
  addPopulation(design, opts = {}) {
    const d = normalizeDesign(design);
    for (const ce of d.customEnzymes || []) this.registry.register(ce);
    const id = opts.id || `pop${this.nextPopId++}`;
    const pop = new Population({
      id, ownerId: opts.ownerId || 'joueur', ownerName: opts.ownerName || 'Vous', name: opts.name || d.name,
      color: opts.color || d.color || '#4ea8de', design: d, launchedAt: this.time, profile: opts.profile || null,
    });
    this.populations.set(id, pop);
    const count = opts.count ?? P.game.founders;
    const ph0 = computePhenotype(d, this.registry);
    const spot = (opts.x !== undefined) ? { x: opts.x, y: opts.y } : this.pickSpawnPoint(ph0);
    for (let k = 0; k < count; k++) {
      const a = this.rng.range(0, Math.PI * 2), r = this.rng.range(0, 6 + ph0.radius * 3);
      const x = Math.min(this.width - 1, Math.max(1, spot.x + Math.cos(a) * r));
      const y = Math.min(this.height - 1, Math.max(1, spot.y + Math.sin(a) * r));
      const cell = this.createCell(pop, d, x, y, 0, ph0);
      const V = cell.ph.V, p = cell.pools;
      p[MI.biomass] = cell.ph.B0 * this.rng.range(1.0, 1.5);
      p[MI.atp] = Math.min(cell.ph.atpCap, Cp.founderAtpPerVolume * V);
      p[MI.reserve] = Cp.founderReservePerVolume * V;
      p[MI.aa] = Cp.founderAaPerVolume * V;
      p[MI.phosphate] = 0.02 * V;
      this.cells.push(cell);
    }
    pop.count = count;
    pop.maxCount = count;
    this.log(`${pop.ownerName} lance « ${pop.name} » (${count} individus).`, 'launch', id);
    for (const s of this.sources) s.onLaunch?.(this, pop);
    return pop;
  }

  /** Choisit un point de départ plausible selon le métabolisme (lumière pour les phototrophes, sucres sinon). */
  pickSpawnPoint(ph) {
    const env = this.env;
    const photo = ph.enzymes.some((e) => e.subs.some((s) => s.i < 0));
    let best = null, bestScore = -Infinity;
    for (let k = 0; k < 24; k++) {
      const x = this.rng.range(20, this.width - 20), y = this.rng.range(20, this.height - 20);
      const g = env.idx(x, y);
      let s = this.attractant(ph, g) + this.rng.range(0, 0.5);
      if (photo) s += env.lightDepth[Math.floor(g / env.gw)] * 3;
      const dT = Math.abs(env.temperature[g] - ph.tOpt); s -= dT * 0.05;
      if (env.salinity[g] > Cp.salinityHigh) s -= 2;
      let crowd = 0;
      this.hash.rebuild(this.cells);
      this.hash.query(x, y, 80, (j) => { crowd++; });
      s -= crowd * 0.15;
      if (s > bestScore) { bestScore = s; best = { x, y }; }
    }
    return best;
  }

  createCell(pop, genome, x, y, generation, ph = null) {
    ph = ph || computePhenotype(genome, this.registry);
    const pools = new Float64Array(NMET);
    pools[MI.nad] = ph.nadTotal * 0.8;
    pools[MI.nadh] = ph.nadTotal * 0.2;
    const cell = {
      id: this.nextCellId++, popId: pop.id, genome, ph, pools, x, y,
      heading: this.rng.range(0, Math.PI * 2), angle: this.rng.range(0, Math.PI * 2),
      age: 0, generation, damage: 0, dmg: newDamage(), phase: 'G1', phaseTime: 0, starving: 0, growth: 0,
      lastSense: 0, senseOffset: this.rng.int(0, 29), target: null,
      host: null, hostOffset: null, parasites: 0, partners: [], alive: true, deathCause: null,
      sense: this.senseWeights(ph),
    };
    this.cellById.set(cell.id, cell);
    if (ph.radius > this.maxRadius) this.maxRadius = ph.radius;
    return cell;
  }

  senseWeights(ph) {
    const w = [];
    const seen = new Set();
    for (const e of ph.enzymes) for (const s of e.subs) {
      if (s.i < 0) { if (!seen.has('light')) { w.push({ i: -1, w: 2 }); seen.add('light'); } continue; }
      const m = MET[s.m];
      if (!m.env || m.cofactor || seen.has(s.m) || s.m === 'o2' || s.m === 'co2' || s.m === 'n2') continue;
      seen.add(s.m);
      w.push({ i: s.i, w: 1 / (SENSE_SCALE[s.m] || 2) });
    }
    if (!ph.enzymes.some((e) => e.id === 'detoxifiase')) w.push({ i: MI.toxin, w: -5 });
    return w;
  }

  attractant(ph, g, sense = null) {
    sense = sense || this.senseWeights(ph);
    const env = this.env;
    let a = 0;
    for (const s of sense) a += s.i < 0 ? s.w * env.lightAt(g) : s.w * env.fields[s.i][g] / (env.gridVolume / 1000);
    return a;
  }

  // ------------------------------------------------------------------ pas de temps
  step(dt = P.world.dt) {
    for (const s of this.sources) s.update?.(this, dt);
    this.env.step(dt, this.tick, this.time);
    const cells = this.cells;
    this.hash.rebuild(cells);
    const newborns = [];
    let capacity = this.maxCells - cells.length;

    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      if (!c.alive) continue;
      c.age += dt;
      const pop = this.populations.get(c.popId);
      if (c.host !== null) this.parasiteDrain(c, pop, dt);
      if (metabolize(c, this.env, dt, pop)) { this.kill(c, c.deathCause); continue; }
      // Cycle cellulaire
      const ph = c.ph, p = c.pools;
      const ready = p[MI.biomass] >= 2 * ph.B0 && p[MI.atp] >= Cp.divisionAtpPerVolume * ph.V;
      if (c.phase === 'G1') { if (ready && capacity > 0 && this.hash.count[this.hash.key(c.x, c.y)] < IP.crowdLimit) { c.phase = ph.euk ? 'S' : 'D'; c.phaseTime = 0; } }
      else {
        c.phaseTime += dt;
        const cy = Cp.cycle;
        if (c.phase === 'S' && c.phaseTime >= cy.S) { c.phase = 'G2'; c.phaseTime = 0; }
        else if (c.phase === 'G2' && c.phaseTime >= cy.G2) { c.phase = 'M'; c.phaseTime = 0; }
        else if ((c.phase === 'M' && c.phaseTime >= cy.M) || (c.phase === 'D' && c.phaseTime >= Cp.prokDivisionTime)) {
          if (capacity > 0 && p[MI.atp] >= Cp.divisionAtpPerVolume * ph.V * 0.5) { newborns.push(this.divide(c, pop)); capacity--; }
          else { c.phase = 'G1'; }
        }
      }
    }

    this.moveAndInteract(dt);

    // Nettoyage
    let w = 0;
    for (let i = 0; i < cells.length; i++) if (cells[i].alive) cells[w++] = cells[i];
    cells.length = w;
    for (const nb of newborns) if (nb.alive) cells.push(nb);

    // Statistiques
    for (const pop of this.populations.values()) pop.count = 0;
    for (const c of cells) this.populations.get(c.popId).count++;
    this._sampleTimer += dt;
    this._scoreTimer += dt;
    const sampling = this._sampleTimer >= 2;
    if (sampling) this._sampleTimer = 0;
    const scoring = this._scoreTimer >= P.score.interval;
    for (const pop of this.populations.values()) {
      if (pop.extinct) continue;
      if (pop.count > pop.maxCount) pop.maxCount = pop.count;
      if (sampling) pop.sample(this.time);
      if (scoring) {
        const gain = pop.updateScore(this._scoreTimer);
        pop.pointsEarned += gain;
        if (gain > 0) this.emit('points', pop, gain);
      }
      if (pop.count === 0) {
        pop.sample(this.time);
        pop.markExtinct(this.time);
        this.log(`« ${pop.name} » (${pop.ownerName}) s'est éteinte.`, 'extinction', pop.id);
        this.emit('extinction', pop);
        for (const s of this.sources) s.onExtinction?.(this, pop);
      }
    }
    if (scoring) this._scoreTimer = 0;
    this.time += dt;
    this.tick++;
  }

  divide(c, pop) {
    const g1 = mutateDesign(c.genome, this.rng), g2 = mutateDesign(c.genome, this.rng);
    const a = this.rng.range(0, Math.PI * 2);
    const off = c.ph.radius * 1.05;
    const x2 = Math.min(this.width - 1, Math.max(1, c.x + Math.cos(a) * off));
    const y2 = Math.min(this.height - 1, Math.max(1, c.y + Math.sin(a) * off));
    const d = this.createCell(pop, g2, x2, y2, c.generation + 1);
    const p = c.pools, q = d.pools;
    // cycle d'un parasite : il se détache de son hôte pour se diviser (les filles doivent trouver un nouvel hôte)
    if (c.host !== null) { const hst = this.cellById.get(c.host); if (hst) hst.parasites--; c.host = null; }
    p[MI.atp] -= Cp.divisionAtpPerVolume * c.ph.V * 0.5;
    const nadRatio = p[MI.nadh] / Math.max(1e-9, p[MI.nad] + p[MI.nadh]);
    for (let i = 0; i < NMET; i++) { const h = p[i] / 2; p[i] = h; q[i] = h; }
    c.x = Math.min(this.width - 1, Math.max(1, c.x - Math.cos(a) * off * 0.5));
    c.y = Math.min(this.height - 1, Math.max(1, c.y - Math.sin(a) * off * 0.5));
    c.genome = g1;
    c.ph = computePhenotype(g1, this.registry);
    c.sense = this.senseWeights(c.ph);
    c.generation++;
    c.phase = 'G1'; c.phaseTime = 0; c.age = 0;
    c.dmg.fill(0); d.damage = c.damage = c.damage * 0.5;
    for (const cell of [c, d]) {
      cell.pools[MI.nadh] = cell.ph.nadTotal * nadRatio;
      cell.pools[MI.nad] = cell.ph.nadTotal * (1 - nadRatio);
      if (cell.ph.radius > this.maxRadius) this.maxRadius = cell.ph.radius;
    }
    pop.births++;
    if (d.generation > pop.maxGeneration) pop.maxGeneration = d.generation;
    return d;
  }

  kill(c, cause, eater = null) {
    if (!c.alive) return;
    c.alive = false;
    if ((cause === 'starvation' || cause === 'famine') && c.parasites > 0) cause = 'parasitism';
    c.deathCause = cause;
    const pop = this.populations.get(c.popId);
    pop.recordDeath(cause);
    if (eater) {
      transferToEater(c, eater);
      const ep = this.populations.get(eater.popId);
      ep.prey++; ep.kills++;
    } else releaseContents(c, this.env);
    for (const pid of c.partners) { const o = this.cellById.get(pid); if (o) o.partners = o.partners.filter((x) => x !== c.id); }
    c.partners = [];
    if (c.host !== null) { const h = this.cellById.get(c.host); if (h) h.parasites--; c.host = null; }
    this.cellById.delete(c.id);
  }

  /** Retire une population (son propriétaire l'abandonne). */
  removePopulation(popId) {
    for (const c of this.cells) if (c.popId === popId && c.alive) this.kill(c, 'removed');
  }

  parasiteDrain(c, pop, dt) {
    const h = this.cellById.get(c.host);
    if (!h || !h.alive) { c.host = null; return; }
    const k = ENVELOPE.parasite.drainRate * c.ph.SA * (1 - h.ph.wall * 0.5) * dt;
    let total = 0;
    for (const i of DRAINED) {
      const amt = Math.min(h.pools[i] * 0.2, k * h.pools[i] / h.ph.V);
      if (amt > 0) { h.pools[i] -= amt; c.pools[i] += amt; total += amt; }
    }
    pop.parasitism += total;
  }

  // ------------------------------------------------------------------ mouvement et interactions
  moveAndInteract(dt) {
    const cells = this.cells, rng = this.rng, W = this.width, H = this.height;
    const senseTick = this.tick % 30;
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      if (!c.alive) continue;
      const ph = c.ph;
      if (c.host !== null) {
        const h = this.cellById.get(c.host);
        if (h && h.alive) { c.x = h.x + c.hostOffset[0]; c.y = h.y + c.hostOffset[1]; continue; }
        c.host = null;
      }
      if (ph.motile) {
        if (c.senseOffset === senseTick) {
          const g = this.env.idx(c.x, c.y);
          const a = this.attractant(ph, g, c.sense);
          let targeted = false;
          if ((ph.phagocyte && c.pools[MI.phagosome] < ph.B0 * 0.06) || (ph.parasite && c.host === null)) {
            const t = this.findTarget(c);
            if (t) { c.heading = Math.atan2(t.y - c.y, t.x - c.x) + rng.gauss() * 0.2; targeted = true; }
          }
          if (!targeted) {
            if (a < c.lastSense * 0.98 || rng.chance(Cp.tumbleProb)) c.heading = rng.range(0, Math.PI * 2);
            else c.heading += rng.gauss() * 0.3;
          }
          c.lastSense = a;
        }
        const sp = ph.speed * (c.pools[MI.atp] > 0 ? 1 : 0.1);
        c.x += Math.cos(c.heading) * sp * dt;
        c.y += Math.sin(c.heading) * sp * dt;
        c.angle += (((c.heading - c.angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * 0.2;
      } else {
        c.angle += rng.gauss() * 0.02;
      }
      const br = Cp.brownian / Math.sqrt(ph.radius) * Math.sqrt(dt);
      c.x += rng.gauss() * br; c.y += rng.gauss() * br;
      if (c.x < 1) { c.x = 1; c.heading = Math.PI - c.heading; } else if (c.x > W - 1) { c.x = W - 1; c.heading = Math.PI - c.heading; }
      if (c.y < 1) { c.y = 1; c.heading = -c.heading; } else if (c.y > H - 1) { c.y = H - 1; c.heading = -c.heading; }
    }

    // Contacts (grille spatiale)
    const maxR = this.maxRadius;
    for (let i = 0; i < cells.length; i++) {
      const a = cells[i];
      if (!a.alive || a.host !== null) continue;
      const ra = a.ph.radius;
      this.hash.query(a.x, a.y, ra + maxR, (j) => {
        if (j <= i) return;
        const b = cells[j];
        if (!b.alive || b.host !== null || !a.alive) return;
        const dx = b.x - a.x, dy = b.y - a.y, rb = b.ph.radius;
        const d2 = dx * dx + dy * dy, rr = ra + rb;
        if (d2 >= rr * rr) return;
        const d = Math.sqrt(d2) || 0.001;
        if (a.popId !== b.popId && this.contact(a, b, dt)) return;
        // répulsion
        const overlap = (rr - d) * 0.5;
        const ma = a.ph.V, mb = b.ph.V, wa = mb / (ma + mb), wb = ma / (ma + mb);
        const nx = dx / d, ny = dy / d;
        a.x -= nx * overlap * wa; a.y -= ny * overlap * wa;
        b.x += nx * overlap * wb; b.y += ny * overlap * wb;
      });
    }

    // Symbiose : échanges et liens élastiques
    for (const c of cells) {
      if (!c.alive || !c.partners.length) continue;
      for (const pid of c.partners) {
        if (pid < c.id) continue;
        const o = this.cellById.get(pid);
        if (!o || !o.alive) continue;
        const dx = o.x - c.x, dy = o.y - c.y, d = Math.hypot(dx, dy) || 0.001, rr = c.ph.radius + o.ph.radius;
        if (d > rr * IP.bondBreakDistance * 3) { this.unbond(c, o); continue; }
        if (d > rr * 1.02) {
          const pull = (d - rr) * 0.3, nx = dx / d, ny = dy / d;
          c.x += nx * pull * 0.5; c.y += ny * pull * 0.5; o.x -= nx * pull * 0.5; o.y -= ny * pull * 0.5;
        }
        const k = ENVELOPE.adhesins.exchangeRate * Math.min(c.ph.SA, o.ph.SA) * dt;
        let total = 0;
        for (const m of EXCHANGED) {
          const ca = c.pools[m] / c.ph.V, cb = o.pools[m] / o.ph.V;
          let f = k * (ca - cb);
          if (f > 0) f = Math.min(f, c.pools[m] * 0.25); else f = Math.max(f, -o.pools[m] * 0.25);
          c.pools[m] -= f; o.pools[m] += f; total += Math.abs(f);
        }
        this.populations.get(c.popId).symbiosis += total;
        this.populations.get(o.popId).symbiosis += total;
      }
    }
  }

  unbond(a, b) {
    a.partners = a.partners.filter((x) => x !== b.id);
    b.partners = b.partners.filter((x) => x !== a.id);
  }

  findTarget(c) {
    const ph = c.ph, R = Cp.senseRadius;
    let best = null, bd = R * R;
    this.hash.query(c.x, c.y, R, (j) => {
      const o = this.cells[j];
      if (!o.alive || o.popId === c.popId) return;
      const ok = ph.phagocyte ? ph.radius >= o.ph.radius * IP.phagoSizeRatio
        : (o.ph.radius >= ph.radius * IP.parasiteSizeRatio && o.parasites < IP.maxParasitesPerHost && o.host === null);
      if (!ok) return;
      const d2 = (o.x - c.x) ** 2 + (o.y - c.y) ** 2;
      if (d2 < bd) { bd = d2; best = o; }
    });
    return best;
  }

  /** Interaction au contact entre deux cellules d'espèces différentes. Retourne true si l'une a disparu ou s'est fixée. */
  contact(a, b, dt) {
    for (const [x, y] of [[a, b], [b, a]]) {
      const px = x.ph, py = y.ph;
      // Phagocytose
      if (px.phagocyte && px.radius >= py.radius * IP.phagoSizeRatio && x.pools[MI.phagosome] < px.B0 * 0.06) {
        const p = 1 - Math.exp(-IP.phagoBaseProb * 10 * (1 - py.predationProtect) * dt);
        if (this.rng.chance(p)) {
          x.pools[MI.atp] = Math.max(0, x.pools[MI.atp] - IP.phagoCost * py.V);
          this.kill(y, 'predation', x);
          return true;
        }
      }
      // Parasitisme : fixation
      if (px.parasite && x.host === null && py.radius >= px.radius * IP.parasiteSizeRatio && y.parasites < IP.maxParasitesPerHost && y.host === null
        && this.rng.chance(1 - Math.exp(-2 * (1 - py.predationProtect) * dt))) {
        x.host = y.id; y.parasites++;
        const ang = Math.atan2(x.y - y.y, x.x - y.x);
        x.hostOffset = [Math.cos(ang) * (py.radius + px.radius * 0.6), Math.sin(ang) * (py.radius + px.radius * 0.6)];
        return true;
      }
    }
    // Symbiose : adhésion
    if (a.ph.adhesins && b.ph.adhesins && !a.partners.includes(b.id)
      && a.partners.length < IP.symbiosisMaxPartners && b.partners.length < IP.symbiosisMaxPartners) {
      a.partners.push(b.id); b.partners.push(a.id);
    }
    return false;
  }

  // ------------------------------------------------------------------ utilitaires
  totalElements() {
    const t = { C: 0, N: 0, P: 0 };
    const tot = this.env.totals();
    for (const [id, v] of Object.entries(tot)) {
      const el = MET[id].elements;
      t.C += (el.C || 0) * v; t.N += (el.N || 0) * v; t.P += (el.P || 0) * v;
    }
    for (const c of this.cells) {
      for (let i = 0; i < NMET; i++) {
        const v = c.pools[i]; if (!v) continue;
        const el = METABOLITES[i].elements;
        t.C += (el.C || 0) * v; t.N += (el.N || 0) * v; t.P += (el.P || 0) * v;
      }
    }
    return t;
  }

  livingPopulations() { return [...this.populations.values()].filter((p) => !p.extinct); }
}
