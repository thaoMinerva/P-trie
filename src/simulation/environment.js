// Environnement 2D : grille de ressources (quantités par case), diffusion, régénération, conditions physico-chimiques.
import { PARAMS, METABOLITES, MET } from '../data/index.js';

const W = PARAMS.world, E = PARAMS.env;
export const ENV_METS = METABOLITES.filter((m) => m.env).map((m) => m.id);

function gaussian(dx, dy, r) { return Math.exp(-(dx * dx + dy * dy) / (2 * r * r)); }

export class Environment {
  constructor(rng, options = {}) {
    this.options = { sources: true, ...options };
    this.gw = options.gw || Math.round(W.width / W.cellSize);
    this.gh = options.gh || Math.round(W.height / W.cellSize);
    this.n = this.gw * this.gh;
    this.cellSize = W.cellSize;
    this.gridVolume = W.gridVolume;
    this.fields = new Array(METABOLITES.length).fill(null);
    for (const id of ENV_METS) this.fields[MET[id].index] = new Float64Array(this.n);
    this.temperature = new Float32Array(this.n);
    this.salinity = new Float32Array(this.n);
    this.pHBase = new Float32Array(this.n);
    this.pH = new Float32Array(this.n);
    this.secreted = new Float32Array(this.n); // activité des enzymes sécrétées (u/s, moyenne glissante) – non matériel
    this.lytic = { peptidoglycane: new Float32Array(this.n), slayer: new Float32Array(this.n), cellulose: new Float32Array(this.n), chitine: new Float32Array(this.n) };
    this.lightDepth = new Float32Array(this.gh);
    this.patchTargets = {};
    this.lightLevel = 1;
    this.scratch = new Float64Array(this.n);
    this.phageStrain = new Int32Array(this.n); // souche de phage dominante par case (0 = aucune)
    this.phageSeq = 1;
    this.phageHost = new Map(); // souche de phage → population hôte (les phages sont spécifiques d'une espèce)
    this.genePool = new Map(); // case → dernier génome bactérien libéré (ADN pour la transformation)
    if (options.uniform) this.setupUniform(options.uniform);
    else this.setupTerrain(rng);
  }

  idx(x, y) {
    const gx = Math.min(this.gw - 1, Math.max(0, Math.floor(x / this.cellSize)));
    const gy = Math.min(this.gh - 1, Math.max(0, Math.floor(y / this.cellSize)));
    return gy * this.gw + gx;
  }
  field(id) { return this.fields[MET[id].index]; }

  setupUniform(u) {
    for (const id of ENV_METS) this.field(id).fill((u[id] ?? 0) * this.gridVolume / 1000);
    this.temperature.fill(u.temperature ?? 28);
    this.salinity.fill(u.salinity ?? 0.15);
    this.pHBase.fill(u.pH ?? 7);
    this.pH.fill(u.pH ?? 7);
    this.lightDepth.fill(u.light ?? 0.8);
    this.uniform = u;
  }

  setupTerrain(rng) {
    const { gw, gh } = this;
    // Conditions physiques statiques
    const vent = { x: gw * rng.range(0.7, 0.9), y: gh * rng.range(0.7, 0.9) };
    const pond = { x: gw * rng.range(0.08, 0.3), y: gh * rng.range(0.65, 0.9) };
    const peat = { x: gw * rng.range(0.1, 0.4), y: gh * rng.range(0.3, 0.6) };
    const chalk = { x: gw * rng.range(0.6, 0.9), y: gh * rng.range(0.2, 0.5) };
    for (let y = 0; y < gh; y++) {
      this.lightDepth[y] = Math.exp(-(y * this.cellSize) / W.lightDepth);
      for (let x = 0; x < gw; x++) {
        const i = y * gw + x;
        this.temperature[i] = W.tempLeft + (W.tempRight - W.tempLeft) * (x / (gw - 1)) - 3 * (y / gh) + 16 * gaussian(x - vent.x, y - vent.y, 6);
        this.salinity[i] = 0.12 + 0.75 * gaussian(x - pond.x, y - pond.y, 7);
        this.pHBase[i] = E.pHBase - 1.8 * gaussian(x - peat.x, y - peat.y, 9) + 1.6 * gaussian(x - chalk.x, y - chalk.y, 8);
      }
    }
    this.landmarks = { vent, pond, peat, chalk };
    // Gisements de ressources (cibles de régénération)
    for (const [id, cfg] of Object.entries(E.regen)) {
      const t = new Float32Array(this.n).fill(cfg.background);
      const nPatches = Math.round(cfg.patches * Math.max(1, this.n / 4800)); // plus de gisements dans un grand monde
      for (let p = 0; p < nPatches; p++) {
        const px = rng.range(0.05, 0.95) * gw;
        const py = cfg.bias === 'bottom' ? rng.range(0.55, 0.97) * gh : rng.range(0.05, 0.95) * gh;
        const r = cfg.radius * rng.range(0.7, 1.3);
        for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
          t[y * gw + x] += cfg.cap * gaussian(x - px, y - py, r / 2);
        }
      }
      this.patchTargets[id] = t;
    }
    // État initial
    for (const id of ENV_METS) {
      const f = this.field(id), init = E.initial[id] ?? 0, tgt = this.patchTargets[id];
      for (let i = 0; i < this.n; i++) f[i] = tgt ? Math.min(tgt[i], init + tgt[i] * 0.5) : init;
    }
    // O2 / N2 : gradient de profondeur initial
    const o2 = this.field('o2');
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) o2[y * gw + x] = E.initial.o2 * Math.exp(-y / (gh * 0.6));
    this.updatePH();
  }

  lightAt(i) { return this.lightDepth[Math.floor(i / this.gw)] * this.lightLevel; }

  updatePH() {
    if (!this._acidBase) this._acidBase = METABOLITES.map((m, i) => ({ i, w: (m.acid || 0) - (m.base || 0) })).filter((m) => m.w !== 0);
    const ab = this._acidBase;
    for (let i = 0; i < this.n; i++) {
      // acides (lactate, acétate, CO₂) − bases (ammoniac) : le pH baisse ou monte autour de sa valeur de base
      let a = 0;
      for (let k = 0; k < ab.length; k++) a += ab[k].w * this.fields[ab[k].i][i];
      a /= this.gridVolume;
      const d = E.acidStrength * Math.log10(1 + Math.abs(a) / E.acidRef);
      this.pH[i] = Math.max(2, Math.min(11, this.pHBase[i] + (a > 0 ? -d : d)));
    }
  }

  diffuse(f, D) {
    const { gw, gh } = this, s = this.scratch;
    let any = false;
    for (let i = 0; i < f.length; i++) if (f[i] !== 0) { any = true; break; }
    if (!any) return; // champ vide : rien à diffuser
    s.set(f);
    const k = D * 0.25;
    for (let y = 0; y < gh; y++) {
      const row = y * gw;
      for (let x = 0; x < gw; x++) {
        const i = row + x, v = s[i];
        let d = 0;
        if (x > 0) d += s[i - 1] - v;
        if (x < gw - 1) d += s[i + 1] - v;
        if (y > 0) d += s[i - gw] - v;
        if (y < gh - 1) d += s[i + gw] - v;
        f[i] = v + k * d;
      }
    }
  }

  step(dt, tick, time) {
    const { gw, gh, n } = this;
    // Cycle jour/nuit
    if (this.uniform) this.lightLevel = 1;
    else {
      const phase = (time % W.dayLength) / W.dayLength;
      this.lightLevel = W.nightLight + (1 - W.nightLight) * Math.max(0, Math.sin(phase * Math.PI * 2)) ** 0.7;
    }
    if (this.options.sources) {
      if (this.uniform) {
        // banc d'essai : milieu maintenu constant
        for (const id of ENV_METS) {
          const f = this.field(id), target = (this.uniform[id] ?? 0) * this.gridVolume / 1000;
          for (let i = 0; i < n; i++) f[i] += (target - f[i]) * 0.2;
        }
      } else {
        for (const [id, cfg] of Object.entries(E.regen)) {
          const f = this.field(id), t = this.patchTargets[id], r = cfg.rate * dt;
          for (let i = 0; i < n; i++) if (f[i] < t[i]) f[i] += (t[i] - f[i]) * r;
        }
        // Échanges avec l'atmosphère (surface) et l'air du sol (décroissant avec la profondeur)
        const gases = [['o2', E.o2Sat, E.o2Exchange], ['n2', E.n2Sat, E.n2Exchange], ['co2', E.co2Atm, E.co2Exchange]];
        for (const [id, sat, ex] of gases) {
          const f = this.field(id), target = sat * this.gridVolume;
          for (let y = 0; y < gh; y++) {
            const k = (y < E.surfaceRows ? 0.3 : ex * Math.exp(-y / (gh * 0.25))) * dt;
            for (let x = 0; x < gw; x++) { const i = y * gw + x; f[i] += (target - f[i]) * k; }
          }
        }
      }
    }
    // Dégradations spontanées (conservent la matière)
    const tox = this.field('toxin'), co2 = this.field('co2'), prot = this.field('protein'), aa = this.field('aa'), st = this.field('starch'), glc = this.field('glucose');
    const sig = this.field('signal'), phg = this.field('phage'), abx = this.field('antibiotique'), pho = this.field('phosphate'), pyr = this.field('pyruvate'), nh4 = this.field('nh4');
    for (let i = 0; i < n; i++) {
      const dT = tox[i] * E.toxinDecay * dt; tox[i] -= dT; co2[i] += 3 * dT;
      const dP = prot[i] * E.proteinDecay * dt; prot[i] -= dP; aa[i] += dP;
      const dS = st[i] * E.starchDecay * dt; st[i] -= dS; glc[i] += dS;
      // signal de quorum instable (lactonase spontanée) → acides aminés
      if (sig[i] > 0) { const d = sig[i] * E.signalDecay * dt; sig[i] -= d; aa[i] += d; }
      // virions inactivés → protéines + phosphate (C3N1P0,1 = protéine C3N1 + 0,1 phosphate)
      if (phg[i] > 0) { const d = phg[i] * E.phageDecay * dt; phg[i] -= d; prot[i] += d; pho[i] += 0.1 * d; }
      // hydrolyse spontanée de l'antibiotique → pyruvate + NH₄⁺
      if (abx[i] > 0) { const d = abx[i] * E.antibioticDecay * dt; abx[i] -= d; pyr[i] += d; nh4[i] += d; }
    }
    const sec = this.secreted;
    for (let i = 0; i < n; i++) sec[i] *= 0.97;
    for (const k in this.lytic) { const L = this.lytic[k]; for (let i = 0; i < n; i++) L[i] *= 0.97; }
    if (tick % W.diffusionEvery === 0) {
      for (const id of ENV_METS) {
        const D = MET[id].diffusion * W.diffusionEvery;
        if (D > 0) this.diffuse(this.field(id), Math.min(0.9, D));
      }
    }
    if (tick % 10 === 0) { this.updatePH(); this.spreadPhageStrains(); }
  }

  /** Les virions qui diffusent emportent leur souche : une case adopte la souche d'une voisine bien plus chargée. */
  spreadPhageStrains() {
    const F = this.fields[MET.phage.index], S = this.phageStrain, { gw, gh } = this;
    for (let i = 0; i < this.n; i++) {
      if (F[i] < 1e-6) { S[i] = 0; continue; }
      const x = i % gw, y = (i / gw) | 0;
      let best = S[i] ? F[i] * 2 : 0, bs = S[i];
      if (x > 0 && S[i - 1] && F[i - 1] > best) { best = F[i - 1]; bs = S[i - 1]; }
      if (x < gw - 1 && S[i + 1] && F[i + 1] > best) { best = F[i + 1]; bs = S[i + 1]; }
      if (y > 0 && S[i - gw] && F[i - gw] > best) { best = F[i - gw]; bs = S[i - gw]; }
      if (y < gh - 1 && S[i + gw] && F[i + gw] > best) { best = F[i + gw]; bs = S[i + gw]; }
      S[i] = bs || 1;
    }
  }

  totals() {
    const t = {};
    for (const id of ENV_METS) { let s = 0; const f = this.field(id); for (let i = 0; i < this.n; i++) s += f[i]; t[id] = s; }
    return t;
  }
}
