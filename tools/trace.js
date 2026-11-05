// Trace détaillée d'une cellule : node tools/trace.js [archetype|player] [secondes]
import { World } from '../src/simulation/world.js';
import { ARCHETYPES, METABOLITES } from '../src/data/index.js';
import { defaultDesign } from '../src/simulation/genome.js';
const id = process.argv[2] || 'player', secs = +(process.argv[3] || 60);
const uniform = { glucose: 4, nh4: 3, phosphate: 2, o2: 10, co2: 3, n2: 10, starch: 4, cellulose: 10, protein: 3, light: 0.8, temperature: 28, pH: 7, salinity: 0.15 };
const world = new World({ seed: 3, env: { gw: 8, gh: 8, uniform } });
const design = id === 'player' ? defaultDesign() : ARCHETYPES.find((a) => a.id === id).design;
const pop = world.addPopulation(design, { count: 1, x: 40, y: 40 });
const c = world.cells[0];
console.log('B0', c.ph.B0.toFixed(2), 'V', c.ph.V.toFixed(2), 'SA', c.ph.SA.toFixed(2), 'upkeep', c.ph.upkeep.toFixed(4), 'atpCap', c.ph.atpCap.toFixed(2), 'vol', c.ph.volUsed.toFixed(2));
console.log('enz', c.ph.enzymes.map((e) => `${e.id}:${e.conc}×cap${e.cap.toFixed(2)}`).join(' '));
c.flux = new Float64Array(c.ph.enzymes.length);
const show = ['glucose', 'pyruvate', 'lactate', 'aa', 'nh4', 'phosphate', 'o2', 'nad', 'nadh', 'atp', 'biomass', 'reserve', 'ros', 'phagosome'];
for (let s = 0; s <= secs * 10; s++) {
  world.step();
  const cell = world.cells.find((x) => x.id === c.id) || world.cells[0];
  if (!cell) { console.log('mort', c.deathCause, c.dmg); break; }
  if (s % 50 === 0) {
    const p = cell.pools;
    console.log(`t=${world.time.toFixed(0)} n=${world.cells.length} ph=${cell.phase} dmg=${cell.damage.toFixed(2)} ` + show.map((m) => `${m}=${(p[METABOLITES.findIndex((x) => x.id === m)] / cell.ph.V).toFixed(3)}`).join(' '));
    if (cell.flux) console.log('   flux', cell.ph.enzymes.map((e, k) => `${e.id}=${(cell.flux[k] / cell.ph.V).toFixed(4)}`).join(' '), 'growth', (cell.growth / cell.ph.V).toFixed(4));
  }
}
console.log('pop', pop.count, pop.deathCauses);
