// Événements du milieu : canicule, vague de froid, pluie, apport de matière organique, antibiotique, phages.
// Déterministes (générateur propre au planificateur), sérialisables, et désactivés dans les bancs d'essai.
import { PARAMS, MET } from '../data/index.js';
import { RNG } from './rng.js';

const EV = PARAMS.events;

/** Catalogue : texte du journal, durée, rayon (µm), section du livret qui l'explique. */
export const EVENT_TYPES = {
  canicule: { icon: '🔥', name: 'Canicule', help: 'temperature_ph', duration: [150, 240], radius: [140, 240],
    text: 'Une canicule réchauffe une zone du monde (+{amp} °C) : les enzymes mal adaptées se dénaturent.' },
  froid: { icon: '❄️', name: 'Vague de froid', help: 'temperature_ph', duration: [150, 240], radius: [140, 240],
    text: 'Une vague de froid refroidit une zone (−{amp} °C) : le métabolisme y ralentit fortement.' },
  pluie: { icon: '🌧️', name: 'Averse', help: 'osmose', duration: [120, 200], radius: [180, 280],
    text: 'Une averse dilue le sel et apporte de l\'ammonium et du phosphate lessivés des berges : choc osmotique pour les cellules sans paroi !' },
  apport: { icon: '🍂', name: 'Chute de matière organique', help: 'decomposeurs', duration: [30, 30], radius: [50, 90],
    text: 'Des feuilles mortes et un insecte tombent dans l\'eau : glucose, protéines et cellulose pour les décomposeurs.' },
  antibiotique: { icon: '💊', name: 'Antibiotique', help: 'antibiotiques', duration: [120, 180], radius: [60, 110],
    text: 'Une moisissure libère un antibiotique β-lactame : les bactéries à paroi de peptidoglycane qui grandissent sont menacées.' },
  phages: { icon: '🦠', name: 'Invasion de phages', help: 'phages', duration: [40, 40], radius: [50, 90],
    text: 'Des bactériophages arrivent dans le monde : ils infectent les bactéries et les font éclater.' },
};

const gauss2 = (dx, dy, r) => Math.exp(-(dx * dx + dy * dy) / (2 * r * r));

export class EventScheduler {
  constructor(world) {
    this.world = world;
    this.rng = new RNG((world.seed ^ 0x9e3779b9) >>> 0);
    this.next = EV.firstDelay + this.rng.range(0, EV.maxGap - EV.minGap);
    this.active = [];
    this.count = 0;
  }

  serialize() { return { rng: this.rng.state, next: this.next, active: this.active, count: this.count }; }
  deserialize(d) { this.rng.state = d.rng; this.next = d.next; this.active = d.active || []; this.count = d.count || 0; }

  /** Appelé à chaque pas de temps du monde. */
  update(dt) {
    const w = this.world, t = w.time;
    if (t >= this.next) {
      this.start(this.pickType());
      this.next = t + this.rng.range(EV.minGap, EV.maxGap);
    }
    let physical = false;
    for (const e of this.active) {
      if (e.type === 'antibiotique') this.deposit(e, 'antibiotique', EV.antibioticRate * dt);
      if (e.type === 'canicule' || e.type === 'froid' || e.type === 'pluie') physical = true;
    }
    const before = this.active.length;
    this.active = this.active.filter((e) => t < e.end);
    if (before !== this.active.length) physical = true;
    if (physical && w.tick % 10 === 0) this.applyPhysical();
  }

  pickType() {
    const ws = Object.entries(EV.weights || {}), tot = ws.reduce((a, [, v]) => a + v, 0);
    let r = this.rng.range(0, tot);
    for (const [k, v] of ws) { r -= v; if (r <= 0) return k; }
    return ws[0][0];
  }

  /** Déclenche un événement (aussi utilisable à la main pour les tests ou un futur menu). */
  start(type, opts = {}) {
    const w = this.world, T = EVENT_TYPES[type], r = this.rng;
    const e = {
      id: ++this.count, type, start: w.time,
      end: w.time + (opts.duration ?? r.range(...T.duration)),
      x: opts.x ?? r.range(0.15, 0.85) * w.width, y: opts.y ?? r.range(0.15, 0.85) * w.height,
      r: opts.r ?? r.range(...T.radius), amp: Math.round(opts.amp ?? r.range(7, 12)),
    };
    if (type === 'pluie') { e.y = opts.y ?? r.range(0.05, 0.35) * w.height; this.deposit(e, 'nh4', 1.5); this.deposit(e, 'phosphate', 0.6); }
    if (type === 'apport') { this.deposit(e, 'glucose', 6); this.deposit(e, 'protein', 4); this.deposit(e, 'cellulose', 10); }
    if (type === 'phages') {
      e.strain = ++w.env.phageSeq;
      w.hash.rebuild(w.cells);
      const host = w.dominantBacteria(e.x, e.y, e.r) || w.dominantBacteria(w.width / 2, w.height / 2, Math.max(w.width, w.height));
      if (host) { w.env.phageHost.set(e.strain, host.id); e.host = host.name; }
      this.deposit(e, 'phage', 0.06, (i) => { w.env.phageStrain[i] = e.strain; });
    }
    this.active.push(e);
    w.log(`${T.icon} ${T.text.replace('{amp}', e.amp)}${e.host ? ` Ces phages s'attaquent à « ${e.host} », l'espèce bactérienne la plus abondante de la zone.` : ''}`, 'env');
    w.emit('envEvent', e);
    return e;
  }

  /** Ajoute une quantité (u par case au centre, profil gaussien) d'un métabolite. */
  deposit(e, met, amount, onCell) {
    const env = this.world.env, f = env.fields[MET[met].index], cs = env.cellSize, rr = e.r / cs / 2;
    const cx = e.x / cs, cy = e.y / cs, R = Math.ceil(rr * 3);
    for (let gy = Math.max(0, Math.floor(cy - R)); gy <= Math.min(env.gh - 1, Math.ceil(cy + R)); gy++) {
      for (let gx = Math.max(0, Math.floor(cx - R)); gx <= Math.min(env.gw - 1, Math.ceil(cx + R)); gx++) {
        const k = gauss2(gx - cx, gy - cy, rr);
        if (k < 0.02) continue;
        const i = gy * env.gw + gx;
        f[i] += amount * k * (env.gridVolume / 1000);
        onCell?.(i);
      }
    }
  }

  /** Température et salinité = valeurs de base + effet des événements en cours (montée puis retour en douceur). */
  applyPhysical() {
    const w = this.world, env = w.env, cs = env.cellSize;
    if (!env.temperatureBase) env.temperatureBase = Float32Array.from(env.temperature);
    if (!env.salinityBase) env.salinityBase = Float32Array.from(env.salinity);
    env.temperature.set(env.temperatureBase); env.salinity.set(env.salinityBase);
    for (const e of this.active) {
      if (e.type !== 'canicule' && e.type !== 'froid' && e.type !== 'pluie') continue;
      const f = Math.sin(Math.PI * Math.min(1, Math.max(0, (w.time - e.start) / (e.end - e.start))));
      const rr = e.r / cs / 2, cx = e.x / cs, cy = e.y / cs, R = Math.ceil(rr * 3);
      for (let gy = Math.max(0, Math.floor(cy - R)); gy <= Math.min(env.gh - 1, Math.ceil(cy + R)); gy++) {
        for (let gx = Math.max(0, Math.floor(cx - R)); gx <= Math.min(env.gw - 1, Math.ceil(cx + R)); gx++) {
          const k = gauss2(gx - cx, gy - cy, rr) * f, i = gy * env.gw + gx;
          if (e.type === 'canicule') env.temperature[i] += e.amp * k;
          else if (e.type === 'froid') env.temperature[i] -= e.amp * k;
          else env.salinity[i] *= 1 - 0.75 * k;
        }
      }
    }
  }

  /** Version légère pour l'affichage (et le réseau). */
  summary() {
    const t = this.world.time;
    return this.active.map((e) => ({ id: e.id, type: e.type, x: Math.round(e.x), y: Math.round(e.y), r: Math.round(e.r), left: Math.max(0, Math.round(e.end - t)) }));
  }
}
