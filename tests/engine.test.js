import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/simulation/world.js';
import { ENZYMES, ARCHETYPES } from '../src/data/index.js';
import { analyzeReaction } from '../src/simulation/chem.js';
import { defaultDesign, normalizeDesign, computePhenotype, mutateDesign } from '../src/simulation/genome.js';
import { MI } from '../src/simulation/metabolism.js';
import { buildEnzyme } from '../src/simulation/enzymeDesign.js';
import { serializeWorld, deserializeWorld } from '../src/simulation/serialize.js';
import { analyzeDesign } from '../src/simulation/analysis.js';
import { RNG } from '../src/simulation/rng.js';

const RICH = { glucose: 4, nh4: 3, phosphate: 2, o2: 10, co2: 3, n2: 10, starch: 3, cellulose: 8, protein: 2, light: 0.8, temperature: 28, pH: 7, salinity: 0.15 };

test('bibliothèque : chaque enzyme conserve C, N, P, NAD et est exergonique (pas d\'enzyme magique)', () => {
  for (const e of ENZYMES) {
    const a = analyzeReaction(e.substrates, e.products);
    assert.ok(a.balanced, `${e.id} non équilibrée : ${a.errors.join(', ')}`);
    assert.ok(a.exergonic, `${e.id} endergonique (ΔG=${a.deltaG})`);
  }
});

test('archétypes fantômes : conceptions valides', () => {
  const w = new World({ seed: 1 });
  for (const a of ARCHETYPES) {
    const r = analyzeDesign(a.design, w.registry);
    assert.deepEqual(r.errors, [], `${a.id} : ${r.errors.join(' | ')}`);
  }
});

test('conservation de la matière (C, N, P) sans sources externes', () => {
  const w = new World({ seed: 5, env: { sources: false } });
  w.addPopulation(defaultDesign(), { count: 30 });
  for (const a of ARCHETYPES) w.addPopulation(a.design, { count: 15, ownerId: 'test' });
  const before = w.totalElements();
  for (let i = 0; i < 1500; i++) w.step();
  const after = w.totalElements();
  for (const el of ['C', 'N', 'P']) {
    const rel = Math.abs(after[el] - before[el]) / before[el];
    assert.ok(rel < 1e-6, `${el} : ${before[el]} → ${after[el]} (écart relatif ${rel})`);
  }
  assert.ok(w.cells.length > 0);
});

test('bilan ATP : une cellule sans nourriture épuise son ATP au rythme de son entretien', () => {
  const uniform = { ...RICH, glucose: 0, nh4: 0, phosphate: 0, starch: 0, cellulose: 0, protein: 0, aa: 0 };
  const w = new World({ seed: 2, env: { gw: 6, gh: 6, uniform } });
  const d = defaultDesign();
  w.addPopulation(d, { count: 1, x: 30, y: 30 });
  const c = w.cells[0];
  c.pools[MI.reserve] = 0; c.pools[MI.aa] = 0; c.pools[MI.glucose] = 0;
  c.pools[MI.nad] += c.pools[MI.nadh]; c.pools[MI.nadh] = 0; // aucun pouvoir réducteur à réoxyder
  const atp0 = c.pools[MI.atp];
  w.step();
  const spent = atp0 - c.pools[MI.atp];
  // pas de production possible : la dépense est l'entretien (± transport actif nul)
  assert.ok(Math.abs(spent - c.ph.upkeep * 0.1) < 1e-6 * Math.max(1, atp0), `dépense ${spent} ≠ entretien ${c.ph.upkeep * 0.1}`);
});

test('bilan ATP : la respiration aérobie rapporte plus que la fermentation', () => {
  const run = (enzymes) => {
    const w = new World({ seed: 3, env: { gw: 6, gh: 6, uniform: RICH } });
    const d = { ...defaultDesign(), enzymes };
    w.addPopulation(d, { count: 1, x: 30, y: 30 });
    const c = w.cells[0];
    c.flux = new Float64Array(c.ph.enzymes.length);
    for (let i = 0; i < 200; i++) w.step();
    return w.cells[0];
  };
  const aero = run({ glycolyse: 2, krebs: 1.5, chaine_respiratoire: 1.5, synthese_aa: 1.5 });
  const ferm = run({ glycolyse: 2, fermentation_lactique: 1.5, synthese_aa: 1.5 });
  assert.ok(aero.pools[MI.biomass] > ferm.pools[MI.biomass], 'la croissance aérobie devrait être plus rapide');
});

test('mitose : une cellule bien nourrie se divise, la matière est partagée et le génome mute légèrement', () => {
  const w = new World({ seed: 4, env: { gw: 8, gh: 8, uniform: RICH } });
  const pop = w.addPopulation(defaultDesign(), { count: 1, x: 40, y: 40 });
  const c = w.cells[0];
  c.pools[MI.biomass] = c.ph.B0 * 2.1;
  c.pools[MI.atp] = c.ph.atpCap;
  const massBefore = c.pools[MI.biomass];
  let steps = 0;
  while (w.cells.length < 2 && steps++ < 50) w.step();
  assert.equal(w.cells.length, 2, 'la cellule aurait dû se diviser');
  const [a, b] = w.cells;
  const total = a.pools[MI.biomass] + b.pools[MI.biomass];
  assert.ok(Math.abs(total - massBefore) / massBefore < 0.1, 'biomasse conservée à la croissance près');
  assert.equal(pop.births, 1);
  assert.equal(b.generation, 1);
  assert.notDeepEqual(a.genome.enzymes, b.genome.enzymes, 'les filles portent des mutations différentes');
  for (const id of Object.keys(a.genome.enzymes)) {
    const ratio = a.genome.enzymes[id] / defaultDesign().enzymes[id];
    assert.ok(ratio > 0.5 && ratio < 2, 'mutation légère');
  }
});

test('extinction : une population sans ressource s\'éteint et reçoit un résumé', () => {
  const uniform = { ...RICH, glucose: 0, nh4: 0, phosphate: 0, starch: 0, cellulose: 0, protein: 0, aa: 0, light: 0 };
  const w = new World({ seed: 6, env: { gw: 6, gh: 6, uniform } });
  const pop = w.addPopulation(defaultDesign(), { count: 5, x: 30, y: 30 });
  let extinct = null;
  w.on('extinction', (p) => { extinct = p; });
  for (let i = 0; i < 6000 && !pop.extinct; i++) w.step();
  assert.ok(pop.extinct, 'la population aurait dû s\'éteindre');
  assert.equal(extinct, pop);
  assert.match(pop.extinctionSummary, /éteinte/);
  assert.ok(pop.deathCauses.starvation || pop.deathCauses.famine);
});

test('déterminisme : même graine → même monde', () => {
  const run = () => {
    const w = new World({ seed: 77 });
    w.addPopulation(defaultDesign(), {});
    w.addPopulation(ARCHETYPES[2].design, { ownerId: 'x' });
    for (let i = 0; i < 400; i++) w.step();
    return w.cells.map((c) => `${c.id}:${c.x.toFixed(6)}:${c.pools[MI.atp].toFixed(9)}`).join('|');
  };
  assert.equal(run(), run());
});

test('sauvegarde / restauration du monde', () => {
  const w = new World({ seed: 8 });
  w.addPopulation(defaultDesign(), {});
  for (let i = 0; i < 100; i++) w.step();
  const data = JSON.parse(JSON.stringify(serializeWorld(w)));
  const w2 = deserializeWorld(data);
  assert.equal(w2.cells.length, w.cells.length);
  assert.equal(w2.populations.size, w.populations.size);
  for (let i = 0; i < 50; i++) w2.step();
  assert.ok(w2.time > w.time);
});

test('atelier : une enzyme magique est refusée, une enzyme cohérente est acceptée', () => {
  const magic = buildEnzyme({ name: 'Magique', substrates: { co2: 1 }, products: { glucose: 1 }, domains: [], signal: 'cytosol' });
  assert.equal(magic.ok, false);
  const free = buildEnzyme({ name: 'ATP gratuit', substrates: { glucose: 1 }, products: { glucose: 1, atp: 5 }, domains: ['atp'], signal: 'cytosol' });
  assert.equal(free.ok, false, 'créer de l\'ATP sans dégrader de substrat est interdit');
  const noDomain = buildEnzyme({ name: 'LDH maison', substrates: { pyruvate: 1, nadh: 1 }, products: { lactate: 1, nad: 1 }, domains: [], signal: 'cytosol' });
  assert.equal(noDomain.ok, false, 'domaine NAD requis');
  const ok = buildEnzyme({ name: 'LDH maison', substrates: { pyruvate: 1, nadh: 1 }, products: { lactate: 1, nad: 1 }, domains: ['nad'], signal: 'cytosol' });
  assert.equal(ok.ok, true, ok.errors.join(', '));
  const fast = buildEnzyme({ name: 'x', substrates: { pyruvate: 1, nadh: 1 }, products: { lactate: 1, nad: 1 }, domains: ['nad'], activeSite: 'rapide' });
  const tight = buildEnzyme({ name: 'x', substrates: { pyruvate: 1, nadh: 1 }, products: { lactate: 1, nad: 1 }, domains: ['nad'], activeSite: 'affinite' });
  assert.ok(fast.def.kcat > tight.def.kcat && fast.def.km._ > tight.def.km._, 'compromis affinité / vitesse');
  // utilisable dans une cellule
  const w = new World({ seed: 9 });
  const d = { ...defaultDesign(), enzymes: { ...defaultDesign().enzymes, [ok.def.id]: 1 }, customEnzymes: [ok.def] };
  w.addPopulation(d, {});
  for (let i = 0; i < 50; i++) w.step();
  assert.ok(w.cells.length > 0);
});

test('mutations bornées et normalisées', () => {
  const rng = new RNG(3);
  let d = normalizeDesign(defaultDesign());
  for (let i = 0; i < 300; i++) d = mutateDesign(d, rng);
  assert.ok(d.shape.size >= 0.4 && d.shape.size <= 2.5);
  const ph = computePhenotype(d, new World({ seed: 1 }).registry);
  assert.ok(ph.B0 > 0 && Number.isFinite(ph.upkeep));
});
