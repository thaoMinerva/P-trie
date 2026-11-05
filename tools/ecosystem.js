// Simulation longue avec populations fantômes : node tools/ecosystem.js [secondes] [graine]
import { World } from '../src/simulation/world.js';
import { GhostWorldSource } from '../src/world/ghostSource.js';
import { defaultDesign } from '../src/simulation/genome.js';
const secs = +(process.argv[2] || 1200), seed = +(process.argv[3] || 1);
const w = new World({ seed });
w.attachSource(new GhostWorldSource({ seed: seed * 7 }));
w.addPopulation(defaultDesign(), { name: 'Joueur' });
const t0 = Date.now();
for (let s = 0; s < secs * 10; s++) {
  w.step();
  if (s % 1000 === 0) console.log(`t=${w.time.toFixed(0)} n=${w.cells.length} | ` + w.livingPopulations().map((p) => `${p.name.slice(0, 12)}[${(p.profile || 'J').slice(0, 5)}]:${p.count}`).join(' '));
}
console.log(`${((Date.now() - t0) / 1000).toFixed(1)} s réel`);
for (const p of w.populations.values()) console.log(`${p.extinct ? '†' : ' '} ${p.name} [${p.profile || 'joueur'}] max=${p.maxCount} gen=${p.maxGeneration} vie=${((p.extinctAt ?? w.time) - p.launchedAt).toFixed(0)}s morts=${JSON.stringify(p.deathCauses)}`);
