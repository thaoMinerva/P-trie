// Simulation en ligne de commande (sans rendu) : node tools/headless.js [secondes] [graine] [archetypes...]
import { World } from '../src/simulation/world.js';
import { ARCHETYPES } from '../src/data/index.js';
import { defaultDesign } from '../src/simulation/genome.js';

const seconds = Number(process.argv[2] || 300);
const seed = Number(process.argv[3] || 42);
const which = process.argv.slice(4);
const world = new World({ seed });
const list = which.length ? which : ['player', ...ARCHETYPES.map((a) => a.id)];
for (const id of list) {
  if (id === 'player') world.addPopulation(defaultDesign(), { name: 'Joueur (défaut)' });
  else { const a = ARCHETYPES.find((x) => x.id === id); world.addPopulation(a.design, { name: a.names[0], ownerId: 'fantome', ownerName: a.profile }); }
}
const t0 = Date.now();
const steps = Math.round(seconds / 0.1);
for (let s = 0; s < steps; s++) {
  world.step();
  if (s % 300 === 0 || s === steps - 1) {
    const line = [...world.populations.values()].map((p) => `${p.name.slice(0, 10)}:${p.count}${p.extinct ? '†' : ''}`).join(' ');
    console.log(`t=${world.time.toFixed(0).padStart(4)} n=${String(world.cells.length).padStart(4)} | ${line}`);
  }
}
console.log(`\n${steps} pas en ${((Date.now() - t0) / 1000).toFixed(1)} s (${(steps / ((Date.now() - t0) / 1000)).toFixed(0)} pas/s)`);
for (const p of world.populations.values()) {
  console.log(`- ${p.name} [${p.profile || 'joueur'}] max=${p.maxCount} gen=${p.maxGeneration} morts=${JSON.stringify(p.deathCauses)} score=${p.score.toFixed(1)} res=${p.resourcesUsed.join(',')}`);
  if (p.extinct) console.log('   ', p.extinctionSummary);
}
