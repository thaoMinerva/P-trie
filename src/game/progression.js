// Progression du joueur : points, coût de lancement, conceptions et enzymes enregistrées, archives.
import { PARAMS, ORG } from '../data/index.js';
import { normalizeDesign } from '../simulation/genome.js';
import { registerOrganelle } from '../simulation/organelleDesign.js';
import { registerWall, registerMembraneProtein } from '../simulation/envelopeDesign.js';

const G = PARAMS.game;

export function launchCost(design) {
  const d = normalizeDesign(design);
  let cost = G.launchBase;
  cost += Object.keys(d.enzymes).length * G.costPerEnzyme;
  for (const [id, n] of Object.entries(d.organelles)) {
    const o = ORG[id];
    const free = o.required?.includes(d.type) ? 1 : 0;
    cost += Math.max(0, n - free) * G.costPerOrganelle;
  }
  if (d.type === 'eucaryote') cost += G.costEukaryote;
  cost += (d.customEnzymes || []).length * G.costCustomEnzyme;
  cost += (d.customOrganelles || []).length * G.costCustomEnzyme;
  cost += ((d.customWalls || []).length + (d.customMembraneProteins || []).length) * G.costCustomEnzyme;
  cost += Object.keys(d.membraneProteins || {}).length * G.costPerEnzyme;
  if (d.envelope.motility !== 'aucune') cost += 2 * d.envelope.motilityUnits;
  return Math.round(cost);
}

export function newProfile() {
  return { version: 1, points: G.startPoints, totalEarned: 0, designs: [], customEnzymes: [], customOrganelles: [], customWalls: [], customProteins: [], archives: [], launched: 0, playerName: 'Vous' };
}

export class Progression {
  constructor(profile = newProfile()) {
    this.p = profile; this.listeners = [];
    this.p.customOrganelles = this.p.customOrganelles || [];
    this.p.customWalls = this.p.customWalls || [];
    this.p.customProteins = this.p.customProteins || [];
    for (const w of this.p.customWalls) registerWall(w.def);
    for (const m of this.p.customProteins) registerMembraneProtein(m.def);
    this.p.points = Math.max(G.pointsFloor, this.p.points); // plancher : on peut toujours relancer
    for (const o of this.p.customOrganelles) registerOrganelle(o.def);
  }
  onChange(fn) { this.listeners.push(fn); }
  changed() { for (const fn of this.listeners) fn(this.p); }
  get points() { return this.serverPoints ?? this.p.points; }
  get totalEarned() { return this.serverTotal ?? this.p.totalEarned; }
  /** Multijoueur : les points sont tenus par le serveur. */
  setServerPoints(points, total) { this.serverPoints = points; this.serverTotal = total; this.changed(); }

  canLaunch(design) { return this.p.points >= launchCost(design); }
  spend(design) {
    const c = launchCost(design);
    if (this.p.points < c) return false;
    this.p.points = Math.max(G.pointsFloor, this.p.points - c); this.p.launched++; // plancher de points
    this.changed();
    return true;
  }
  earn(amount) { this.p.points += amount; this.p.totalEarned += amount; this.changed(); }

  saveDesign(design) {
    const d = normalizeDesign(design);
    const existing = this.p.designs.findIndex((x) => x.name === d.name);
    const entry = { id: existing >= 0 ? this.p.designs[existing].id : `d${Date.now().toString(36)}`, name: d.name, design: d, savedAt: Date.now() };
    if (existing >= 0) this.p.designs[existing] = entry; else this.p.designs.push(entry);
    this.changed();
    return entry;
  }
  deleteDesign(id) { this.p.designs = this.p.designs.filter((d) => d.id !== id); this.changed(); }

  saveEnzyme(def, spec) {
    const i = this.p.customEnzymes.findIndex((e) => e.def.id === def.id);
    const entry = { def, spec };
    if (i >= 0) this.p.customEnzymes[i] = entry; else this.p.customEnzymes.push(entry);
    this.changed();
  }
  saveOrganelle(def, spec) {
    registerOrganelle(def);
    const i = this.p.customOrganelles.findIndex((e) => e.def.id === def.id);
    const entry = { def, spec };
    if (i >= 0) this.p.customOrganelles[i] = entry; else this.p.customOrganelles.push(entry);
    this.changed();
  }
  saveWall(def, spec) { registerWall(def); this.p.customWalls = this.p.customWalls.filter((e) => e.def.id !== def.id); this.p.customWalls.push({ def, spec }); this.changed(); }
  deleteWall(id) { this.p.customWalls = this.p.customWalls.filter((e) => e.def.id !== id); this.changed(); }
  saveProtein(def, spec) { registerMembraneProtein(def); this.p.customProteins = this.p.customProteins.filter((e) => e.def.id !== def.id); this.p.customProteins.push({ def, spec }); this.changed(); }
  deleteProtein(id) { this.p.customProteins = this.p.customProteins.filter((e) => e.def.id !== id); this.changed(); }
  deleteOrganelle(id) { this.p.customOrganelles = this.p.customOrganelles.filter((e) => e.def.id !== id); this.changed(); }
  deleteEnzyme(id) { this.p.customEnzymes = this.p.customEnzymes.filter((e) => e.def.id !== id); this.changed(); }

  archive(summary) {
    if (this.p.archives.some((a) => a.id === summary.id && a.launchedAt === summary.launchedAt)) return;
    this.p.archives.unshift(summary);
    if (this.p.archives.length > 60) this.p.archives.length = 60;
    this.changed();
  }
}
