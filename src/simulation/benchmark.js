// Banc d'essai : fait vivre une petite population dans un milieu uniforme contrôlé (même moteur que le jeu).
import { World } from './world.js';
import { MI } from './metabolism.js';

export const SCENARIOS = {
  aerobie: { name: 'Mare éclairée aérobie', glucose: 4, nh4: 3, phosphate: 2, o2: 10, co2: 3, n2: 10, starch: 3, cellulose: 8, protein: 2, light: 0.8, temperature: 26, pH: 7, salinity: 0.15 },
  anoxique: { name: 'Sédiment sombre anoxique', glucose: 4, nh4: 3, phosphate: 2, o2: 0.05, co2: 3, n2: 10, starch: 6, cellulose: 20, protein: 3, light: 0.02, temperature: 22, pH: 6.8, salinity: 0.15 },
  pauvre: { name: 'Eau pauvre en nutriments', glucose: 0.6, nh4: 0.4, phosphate: 0.6, o2: 10, co2: 3, n2: 10, starch: 0.5, cellulose: 2, protein: 0.5, light: 0.9, temperature: 24, pH: 7.2, salinity: 0.12 },
  matiere: { name: 'Litière riche en matière morte', glucose: 0.8, nh4: 1, phosphate: 2, o2: 6, co2: 4, n2: 10, starch: 8, cellulose: 25, protein: 6, light: 0.1, temperature: 24, pH: 6.5, salinity: 0.15 },
};

/**
 * Lance un banc d'essai et renvoie un rapport (taux de croissance, bilan d'ATP, causes de mort).
 * prey : conception d'une proie ajoutée pour tester les prédateurs/parasites.
 */
export function runBenchmark(design, { scenario = 'aerobie', seconds = 120, founders = 4, seed = 7, prey = null } = {}) {
  const uniform = SCENARIOS[scenario] || SCENARIOS.aerobie;
  const world = new World({ seed, env: { gw: 10, gh: 10, uniform }, maxCells: 400 });
  if (prey) world.addPopulation(prey, { count: 30, x: 50, y: 50, ownerId: 'banc', name: 'Proies' });
  const pop = world.addPopulation(design, { count: founders, x: 50, y: 50 });
  const steps = Math.round(seconds / 0.1);
  let atpProd = 0, samples = 0, firstDivision = null;
  const trace = [];
  for (let s = 0; s < steps; s++) {
    world.step();
    if (firstDivision === null && pop.births > 0) firstDivision = world.time;
    if (s % 20 === 0) {
      const mine = world.cells.filter((c) => c.popId === pop.id);
      let atp = 0, bio = 0, b0 = 0, dmg = 0;
      for (const c of mine) { atp += c.pools[MI.atp] / c.ph.atpCap; bio += c.pools[MI.biomass]; b0 += c.ph.B0; dmg += c.damage; }
      const n = mine.length || 1;
      trace.push({ t: +world.time.toFixed(1), n: mine.length, atp: atp / n, biomass: bio / Math.max(1e-9, b0), damage: dmg / n });
      atpProd += atp / n; samples++;
    }
    if (pop.count === 0) break;
  }
  const n = pop.count;
  const growthRate = n > 0 ? Math.log(n / founders) / world.time : -Infinity;
  return {
    scenario: uniform.name, seconds: +world.time.toFixed(0), finalCount: n, births: pop.births, deaths: pop.deaths,
    deathCauses: pop.deathCauses, survived: n > 0, firstDivision,
    doublingTime: growthRate > 0 ? Math.LN2 / growthRate : null,
    meanAtpFill: atpProd / Math.max(1, samples), trace, resourcesUsed: pop.resourcesUsed,
  };
}
