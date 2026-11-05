// Populations fantômes : des « utilisateurs » simulés qui lancent des organismes conçus avec le même
// système de gènes et d'enzymes que le joueur, puis les abandonnent ou en relancent au fil du temps.
import { ARCHETYPES, PARAMS } from '../data/index.js';
import { RNG } from '../simulation/rng.js';
import { WorldSource } from './worldSource.js';
import { normalizeDesign } from '../simulation/genome.js';
import { analyzeDesign } from '../simulation/analysis.js';

const PSEUDOS = ['Mélanie_42', 'bio_theo', 'Kofi.lab', 'Inès-microbio', 'xX_Amibe_Xx', 'DrPasteur', 'Yuki_cell', 'Lucas.petri', 'Sofia_enzyme', 'Noah_flagelle', 'Aïcha_bio', 'Pierre_Krebs', 'Léa.cyano', 'Hugo_lyso', 'Zoé_ribo', 'Malik_ATP'];
const COLORS = ['#e63946', '#f4a261', '#2a9d8f', '#e9c46a', '#8338ec', '#ff006e', '#06d6a0', '#118ab2', '#fb5607', '#8ac926', '#ff99c8', '#c77dff', '#80ffdb', '#ffbe0b'];

export class GhostWorldSource extends WorldSource {
  constructor({ seed = 99, target = PARAMS.game.ghostTarget, spawnInterval = PARAMS.game.ghostSpawnInterval } = {}) {
    super();
    this.rng = new RNG(seed);
    this.target = target;
    this.spawnInterval = spawnInterval;
    this.timer = spawnInterval * 0.6;
    this.ghosts = [];
    this.colorIndex = 0;
  }

  attach(world) {
    this.world = world;
    if (!this.ghosts.length) {
      const n = Math.min(this.target, 4);
      for (let i = 0; i < n; i++) this.spawnGhost(world, i);
    }
  }

  users() {
    return this.ghosts.map((g) => ({ id: g.id, name: g.name, profile: g.profile, online: g.online, populations: g.pops }));
  }

  makeDesign(arch) {
    const r = this.rng;
    const d = JSON.parse(JSON.stringify(arch.design));
    d.shape.size *= Math.exp(r.gauss() * 0.08);
    for (const k of Object.keys(d.enzymes)) d.enzymes[k] = +(d.enzymes[k] * Math.exp(r.gauss() * 0.15)).toFixed(3);
    if (d.envelope.wall > 0) d.envelope.wall = Math.max(0.05, d.envelope.wall * Math.exp(r.gauss() * 0.2));
    d.name = `${r.pick(arch.names)} ${String.fromCharCode(65 + r.int(0, 25))}${r.int(1, 99)}`;
    return normalizeDesign(d);
  }

  spawnGhost(world, i = null) {
    const r = this.rng;
    // diversité de profils : on privilégie les archétypes absents
    const present = new Set(world.livingPopulations().map((p) => p.profile));
    const pool = ARCHETYPES.filter((a) => !present.has(a.profile));
    const arch = r.pick(pool.length ? pool : ARCHETYPES);
    const usedNames = new Set(this.ghosts.map((g) => g.name));
    const name = r.pick(PSEUDOS.filter((p) => !usedNames.has(p))) || `fantôme_${r.int(100, 999)}`;
    const ghost = { id: `ghost_${name}`, name, profile: arch.profile, arch: arch.id, online: true, pops: [] };
    this.ghosts.push(ghost);
    this.launchFor(world, ghost, arch);
    return ghost;
  }

  launchFor(world, ghost, arch) {
    let design = this.makeDesign(arch);
    if (analyzeDesign(design, world.registry).errors.length) design = normalizeDesign(arch.design);
    const color = COLORS[this.colorIndex++ % COLORS.length];
    const pop = world.addPopulation(design, { ownerId: ghost.id, ownerName: ghost.name, name: design.name, color, profile: arch.profile, count: PARAMS.game.founders });
    ghost.pops.push(pop.id);
    ghost.online = true;
    return pop;
  }

  update(world, dt) {
    this.timer += dt;
    // Abandon aléatoire (l'utilisateur se déconnecte : sa population est retirée du monde partagé)
    if (this.rng.chance(PARAMS.game.ghostRetireProb * dt)) {
      const alive = world.livingPopulations().filter((p) => p.ownerId.startsWith('ghost_') && world.time - p.launchedAt > 400);
      if (alive.length) {
        const p = this.rng.pick(alive);
        world.log(`${p.ownerName} retire « ${p.name} » du monde partagé.`, 'ghost', p.id);
        world.removePopulation(p.id);
      }
    }
    if (this.timer < this.spawnInterval) return;
    this.timer = 0;
    const living = world.livingPopulations().filter((p) => p.ownerId.startsWith('ghost_'));
    if (living.length >= this.target) return;
    // Un fantôme hors-ligne revient ou un nouveau arrive
    const idle = this.ghosts.filter((g) => !g.pops.some((id) => !world.populations.get(id)?.extinct));
    if (idle.length && this.rng.chance(0.6)) {
      const g = this.rng.pick(idle);
      const arch = this.rng.chance(0.7) ? ARCHETYPES.find((a) => a.id === g.arch) : this.rng.pick(ARCHETYPES);
      g.arch = arch.id; g.profile = arch.profile;
      this.launchFor(world, g, arch);
    } else this.spawnGhost(world);
  }

  onExtinction(world, pop) {
    const g = this.ghosts.find((x) => x.id === pop.ownerId);
    if (g && !g.pops.some((id) => !world.populations.get(id)?.extinct)) g.online = false;
  }

  serialize() { return { rng: this.rng.state, timer: this.timer, ghosts: this.ghosts, colorIndex: this.colorIndex }; }
  deserialize(o) { if (!o) return; this.rng.state = o.rng; this.timer = o.timer; this.ghosts = o.ghosts || []; this.colorIndex = o.colorIndex || 0; }
}
