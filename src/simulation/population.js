// Population : une lignée lancée par un utilisateur (joueur ou fantôme), avec ses statistiques.
import { PARAMS, METABOLITES } from '../data/index.js';
import { NMET, CAUSES } from './metabolism.js';

const RES_LABELS = { glucose: 'glucose', lactate: 'lactate', ethanol: 'éthanol', acetate: 'acétate', aa: 'acides aminés', nh4: 'ammonium', n2: 'diazote', phosphate: 'phosphate', o2: 'oxygène', co2: 'CO₂', toxin: 'toxines', starch: 'amidon', cellulose: 'cellulose', protein: 'protéines mortes', pyruvate: 'pyruvate' };

export class Population {
  constructor({ id, ownerId, ownerName, name, color, design, launchedAt, profile = null }) {
    Object.assign(this, { id, ownerId, ownerName, name, color, design, launchedAt, profile });
    this.count = 0;
    this.maxCount = 0;
    this.births = 0;
    this.deaths = 0;
    this.maxGeneration = 0;
    this.deathCauses = {};
    this.recentCauses = [];
    this.history = [];
    this.score = 0;
    this.pointsEarned = 0;
    this.extinct = false;
    this.extinctAt = null;
    this.extinctionSummary = null;
    this.use = new Float64Array(NMET);
    this.light = 0;
    this.prey = 0;
    this.parasitism = 0;
    this.symbiosis = 0;
    this.kills = 0;
    this.resourcesUsed = [];
    this._lastGenBonus = 0;
  }

  recordDeath(cause) {
    this.deaths++;
    this.deathCauses[cause] = (this.deathCauses[cause] || 0) + 1;
    this.recentCauses.push(cause);
    if (this.recentCauses.length > 30) this.recentCauses.shift();
  }

  /** Mise à jour périodique du score (appelée par le monde toutes les `score.interval` secondes). */
  updateScore(dt) {
    const S = PARAMS.score;
    const used = [];
    for (let i = 0; i < NMET; i++) if (this.use[i] > 0.05 * Math.max(1, this.count) && RES_LABELS[METABOLITES[i].id]) used.push(METABOLITES[i].id);
    if (this.light > 0.05 * Math.max(1, this.count)) used.push('light');
    this.resourcesUsed = used;
    this.use.fill(0); this.light = 0;
    if (this.count <= 0) return 0;
    let gain = S.sizeWeight * Math.sqrt(this.count) * (1 + S.diversityWeight * used.length) * (dt / 10);
    const genSteps = Math.floor(this.maxGeneration / 5);
    if (genSteps > this._lastGenBonus) { gain += (genSteps - this._lastGenBonus) * S.generationBonus; this._lastGenBonus = genSteps; }
    gain *= S.pointsFactor;
    this.score += gain;
    return gain;
  }

  sample(time) {
    this.history.push([+time.toFixed(1), this.count]);
    if (this.history.length > 400) {
      // compression : on garde un point sur deux de la première moitié
      const half = this.history.length >> 1;
      this.history = this.history.filter((_, i) => i >= half || i % 2 === 0);
    }
  }

  markExtinct(time) {
    this.extinct = true;
    this.extinctAt = time;
    const counts = {};
    for (const c of this.recentCauses) counts[c] = (counts[c] || 0) + 1;
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const main = sorted[0]?.[0];
    const life = (time - this.launchedAt).toFixed(0);
    let summary = `Population éteinte après ${life} s (max ${this.maxCount} individus, ${this.maxGeneration} générations). `;
    if (main) {
      summary += `Cause principale des dernières morts : ${CAUSES[main] || main}`;
      if (sorted[1]) summary += `, puis ${CAUSES[sorted[1][0]] || sorted[1][0]}`;
      summary += '.';
      const hints = {
        starvation: " Le métabolisme ne produisait pas assez d'ATP pour couvrir l'entretien (vérifiez la réoxydation du NADH et les sources de carbone).",
        famine: ' Les cellules ont consommé leur propre biomasse faute de nutriments.',
        toxin: ' Un voisin toxinogène était présent : une détoxifiase ou une paroi épaisse aurait aidé.',
        predation: ' Les prédateurs les ont phagocytées : une paroi ou une capsule protège.',
        osmo_hypo: " En eau douce, une paroi ou une vacuole contractile est nécessaire.",
        ros: ' Ajoutez de la catalase pour une vie aérobie ou photosynthétique.',
        heat: ' Les enzymes étaient inadaptées à la température locale.',
        cold: ' Les enzymes étaient inadaptées à la température locale.',
        ph: " Le milieu s'est trop acidifié (fermentations voisines ?).",
      };
      summary += hints[main] || '';
    }
    this.extinctionSummary = summary;
  }

  summary() {
    return {
      id: this.id, ownerId: this.ownerId, ownerName: this.ownerName, name: this.name, color: this.color, profile: this.profile,
      launchedAt: this.launchedAt, extinctAt: this.extinctAt, maxCount: this.maxCount, births: this.births, deaths: this.deaths,
      maxGeneration: this.maxGeneration, deathCauses: this.deathCauses, score: +this.score.toFixed(2), pointsEarned: +this.pointsEarned.toFixed(2),
      kills: this.kills, resourcesUsed: this.resourcesUsed, extinctionSummary: this.extinctionSummary,
      history: this.history, design: this.design,
    };
  }
}

export { RES_LABELS };
