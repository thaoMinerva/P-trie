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

import { buildOrganelle } from '../src/simulation/organelleDesign.js';

test('atelier d\'organites : un organite respiratoire personnalisé remplace les mitochondries', () => {
  const bad = buildOrganelle({ name: 'x', membrane: 'coque', size: 0.03, modules: ['respiration'] });
  assert.equal(bad.ok, false, 'la respiration exige une double membrane');
  const r = buildOrganelle({ name: 'Mito géante', membrane: 'double', size: 0.06, modules: ['respiration'], max: 4 });
  assert.ok(r.ok, r.errors.join(', '));
  const w = new World({ seed: 11 });
  const base = { ...defaultDesign(), type: 'eucaryote', shape: { kind: 'coque', size: 3 },
    organelles: { noyau: 1, ribosomes: 2, vacuole_contractile: 1, [r.def.id]: 2 }, customOrganelles: [r.def] };
  const ph = computePhenotype(normalizeDesign(base), w.registry);
  assert.ok(Math.abs(ph.mitoFactor - 2 * r.def.effects.capacities.mitochondrie) < 1e-9);
  const pop = w.addPopulation(base, {});
  for (let i = 0; i < 100; i++) w.step();
  assert.ok(pop.count > 0);
  const w2 = deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(w))));
  assert.equal(w2.cells.length, w.cells.length);
});

test('atelier : la coopérativité (Hill) rend la réponse sigmoïde', () => {
  const base = { substrates: { pyruvate: 1, nadh: 1 }, products: { lactate: 1, nad: 1 } };
  const mm = buildEnzyme({ ...base, domains: ['nad'] }).def;
  const hill = buildEnzyme({ ...base, domains: ['nad', 'hill'] }).def;
  assert.equal(hill.hill, 2);
  const w = new World({ seed: 1 });
  w.registry.register(mm); w.registry.register(hill);
  const d = (id) => normalizeDesign({ ...defaultDesign(), enzymes: { [id]: 1 }, customEnzymes: [id === mm.id ? mm : hill] });
  const sub = (id) => computePhenotype(d(id), w.registry).enzymes[0].subs.find((s) => s.m === 'pyruvate');
  assert.equal(sub(mm.id).hill, 1);
  assert.equal(sub(hill.id).hill, 2);
});

import { buildWall, buildMembraneProtein } from '../src/simulation/envelopeDesign.js';
import { Progression, newProfile } from '../src/game/progression.js';

test('enzymes lytiques : le lysozyme fait éclater le peptidoglycane mais pas la couche S', () => {
  const uniform = { ...RICH };
  const run = (wallType) => {
    const w = new World({ seed: 12, env: { gw: 6, gh: 6, uniform } });
    const killer = { ...defaultDesign(), name: 'tueur', envelope: { ...defaultDesign().envelope, wallType: 'slayer' }, enzymes: { ...defaultDesign().enzymes, lysozyme: 3 } };
    const victim = { ...defaultDesign(), name: 'victime', envelope: { ...defaultDesign().envelope, wallType } };
    w.addPopulation(killer, { count: 15, x: 30, y: 30, ownerId: 'a' });
    const v = w.addPopulation(victim, { count: 15, x: 30, y: 30, ownerId: 'b' });
    for (let i = 0; i < 600; i++) w.step();
    return v;
  };
  const pepti = run('peptidoglycane'), slayer = run('slayer');
  assert.ok((pepti.deathCauses.lysis || 0) > 0, 'le peptidoglycane devrait être lysé');
  assert.equal(slayer.deathCauses.lysis || 0, 0, 'la couche S est insensible au lysozyme');
});

test('atelier d\'enveloppe : paroi et protéines cohérentes', () => {
  const a = buildWall({ base: 'peptidoglycane', modifications: ['acetylation', 'lps'] });
  assert.ok(a.ok); assert.equal(a.def.lytic, null); assert.ok(a.def.toxin > 0.5);
  assert.equal(buildWall({ base: 'cellulose', modifications: ['lps'] }).ok, false, 'membrane externe réservée aux procaryotes');
  assert.equal(buildMembraneProtein({ mechanism: 'symport', met: 'protein' }).ok, false, 'un polymère ne traverse pas');
  const pump = buildMembraneProtein({ mechanism: 'abc_out', met: 'toxin' });
  assert.ok(pump.ok && pump.def.kind === 'efflux');
  // une pompe d'efflux réduit la toxine interne
  const tox = { ...RICH, toxin: 20 };
  const internal = (mp) => {
    const w = new World({ seed: 3, env: { gw: 6, gh: 6, uniform: tox } });
    w.addPopulation({ ...defaultDesign(), membraneProteins: mp }, { count: 1, x: 30, y: 30 });
    for (let i = 0; i < 30; i++) w.step();
    return w.cells[0].pools[MI.toxin];
  };
  assert.ok(internal({ e_toxin: 3 }) < internal({}) * 0.8);
});

test('progression : les points ne descendent jamais sous le plancher', () => {
  const pr = new Progression({ ...newProfile(), points: 60 });
  assert.ok(pr.spend(defaultDesign()));
  assert.equal(pr.points, 50);
  assert.ok(pr.canLaunch(defaultDesign()), 'une conception simple reste toujours lançable');
  assert.equal(new Progression({ ...newProfile(), points: 3 }).points, 50);
});

import { sanitizeDesign } from '../src/simulation/sanitize.js';

test('multijoueur : une enzyme trafiquée est reconstruite à partir de ses briques', () => {
  const ok = buildEnzyme({ name: 'LDH', substrates: { pyruvate: 1, nadh: 1 }, products: { lactate: 1, nad: 1 }, domains: ['nad'] }).def;
  const cheat = { ...ok, kcat: 1000, cost: { synth: 0, upkeep: 0, volume: 0 } };
  const d = sanitizeDesign({ ...defaultDesign(), enzymes: { [ok.id]: 1 }, customEnzymes: [cheat] }, 'j_test01');
  const e = d.customEnzymes[0];
  assert.equal(e.kcat, ok.kcat, 'le kcat trafiqué est ignoré');
  assert.ok(e.cost.synth > 0);
  assert.ok(e.id.startsWith('j_test01:') && d.enzymes[e.id] === 1, 'identifiant préfixé par le joueur');
  assert.throws(() => sanitizeDesign({ ...defaultDesign(), enzymes: { x: 1 }, customEnzymes: [{ id: 'x', name: 'magique', substrates: { co2: 1 }, products: { glucose: 1 }, bricks: {} }] }, 'j_test01'));
});

import { computeGeometry } from '../src/simulation/geometry.js';
import { LIVRET } from '../src/data/index.js';

test('géométrie : volumes 3D exacts et dépendants de la forme', () => {
  const near = (a, b, tol = 0.02) => assert.ok(Math.abs(a - b) / b < tol, `${a} ≉ ${b}`);
  near(computeGeometry({ kind: 'coque', size: 2 }).volume, (4 / 3) * Math.PI * 8);
  // bacille de rayon 1 et d'allongement 3 : cylindre de longueur 4 + deux demi-sphères
  near(computeGeometry({ kind: 'bacille', size: 1, aspect: 3 }).volume, Math.PI * 4 + (4 / 3) * Math.PI);
  // ellipsoïde allongé a = 2, b = 1
  near(computeGeometry({ kind: 'ovale', size: 1, aspect: 2 }).volume, (4 / 3) * Math.PI * 2);
  // allonger une cellule augmente son volume et sa surface
  const v = [1, 2, 4].map((aspect) => computeGeometry({ kind: 'bacille', size: 1, aspect }));
  assert.ok(v[0].volume < v[1].volume && v[1].volume < v[2].volume);
  assert.ok(v[0].surface < v[1].surface && v[1].surface < v[2].surface);
  assert.ok(computeGeometry({ kind: 'spirille', size: 0.6, aspect: 4 }).sv > computeGeometry({ kind: 'coque', size: 0.6 }).sv);
});

test('encombrement : plus de limite dure à 85 %, mais les enzymes ralentissent', () => {
  const reg = new World({ seed: 1 }).registry;
  const d = { ...defaultDesign(), enzymes: { ...defaultDesign().enzymes } };
  let a = analyzeDesign(d, reg);
  while (a.ph.volUsed < 0.88) { for (const k of Object.keys(d.enzymes)) d.enzymes[k] *= 1.05; a = analyzeDesign(d, reg); }
  assert.ok(a.ph.volUsed > 0.85 && a.ph.volUsed < 1, `volUsed=${a.ph.volUsed}`);
  assert.ok(!a.errors.some((e) => e.includes('volume')));
  assert.ok(a.ph.crowding < 1);
});

test('livret : identifiants uniques et liens internes valides', () => {
  const ids = LIVRET.flatMap((c) => c.sections.map((s) => s.id));
  assert.equal(new Set(ids).size, ids.length);
  for (const c of LIVRET) for (const s of c.sections) for (const p of [s.short, ...s.body]) {
    for (const m of p.matchAll(/\[\[([a-z0-9_]+)\|/g)) assert.ok(ids.includes(m[1]), `lien inconnu ${m[1]} dans ${s.id}`);
  }
});

import { challengeStatus } from '../src/game/challenges.js';
import { strainDistance, compactGenome } from '../src/simulation/lineage.js';

test('nouvelles enzymes : bilans exacts (uréase, synthase de signal, β-lactamase)', () => {
  for (const id of ['urease', 'synthase_signal', 'beta_lactamase']) {
    const e = ENZYMES.find((x) => x.id === id);
    const a = analyzeReaction(e.substrates, e.products);
    assert.ok(a.balanced && a.exergonic, `${id} : ${a.errors.join(', ')}`);
  }
});

test('pH : l\'ammoniac rend le milieu basique, les acides l\'acidifient', () => {
  const w = new World({ seed: 21, env: { gw: 4, gh: 4, uniform: { nh4: 0 } } });
  const env = w.env;
  env.field('nh4').fill(20); env.updatePH();
  assert.ok(env.pH[0] > 7.5, `pH ${env.pH[0]}`);
  env.field('nh4').fill(0); env.field('lactate').fill(20); env.updatePH();
  assert.ok(env.pH[0] < 6.5, `pH ${env.pH[0]}`);
});

test('quorum sensing : une enzyme « quorum » est inactive sans signal', () => {
  // milieu non régénéré (le banc uniforme remettrait le signal à sa valeur de départ)
  const run = (signal) => {
    const w = new World({ seed: 22, env: { gw: 6, gh: 6, sources: false } });
    const d = { ...defaultDesign(), enzymes: { ...defaultDesign().enzymes, toxine_synthase: 2, detoxifiase: 0 }, quorum: { toxine_synthase: true } };
    w.addPopulation(d, { count: 3, x: 30, y: 30 });
    let tox = 0;
    for (let i = 0; i < 40; i++) {
      w.env.field('signal').fill(signal);
      w.step();
    }
    for (const c of w.cells) tox += c.pools[MI.toxin];
    return tox + w.env.field('toxin').reduce((a, v) => a + v, 0);
  };
  const off = run(0), on = run(1);
  assert.ok(on > off * 5 + 1e-6, `toxine sans signal ${off}, avec ${on}`);
});

test('phages : spécifiques de leur hôte, CRISPR immunise et la mémoire est héritée', () => {
  const w = new World({ seed: 23, events: false, env: { gw: 6, gh: 6, sources: false } });
  const a = w.addPopulation({ ...defaultDesign(), name: 'A', organelles: { nucleoide: 1, ribosomes: 2, crispr: 2 } }, { count: 6, x: 30, y: 30 });
  const b = w.addPopulation({ ...defaultDesign(), name: 'B' }, { count: 6, x: 30, y: 30 });
  w.env.phageHost.set(7, a.id);
  w.env.phageStrain.fill(7); w.env.field('phage').fill(3);
  for (let i = 0; i < 300; i++) { w.env.phageStrain.fill(7); if (i % 50 === 0) w.env.field('phage').fill(3); w.step(); }
  assert.equal(b.infections, 0, 'B n\'est pas l\'hôte de cette souche');
  assert.ok(a.infections + a.immunized > 0, 'A a été touchée');
  if (a.immunized) {
    const imm = w.cells.find((c) => c.popId === a.id && c.immune);
    if (imm) { const d = w.divide(imm, a); assert.deepEqual(d.immune, imm.immune); }
  }
});

test('biofilm : les cellules sœurs collées sont protégées', () => {
  const w = new World({ seed: 24, events: false, env: { gw: 6, gh: 6, uniform: RICH } });
  w.addPopulation({ ...defaultDesign(), envelope: { ...defaultDesign().envelope, biofilm: true } }, { count: 12, x: 30, y: 30 });
  for (let i = 0; i < 50; i++) w.step();
  assert.ok(w.cells.some((c) => c.shield > 0.2), 'aucun bouclier');
});

test('événements : déterministes et sauvegardés', () => {
  const mk = () => { const w = new World({ seed: 25 }); for (let i = 0; i < 6000; i++) w.step(); return w; };
  const w1 = mk(), w2 = mk();
  assert.deepEqual(w1.scheduler.summary(), w2.scheduler.summary());
  assert.equal(w1.scheduler.count, w2.scheduler.count);
  assert.ok(w1.scheduler.count >= 1, 'au moins un événement en 600 s');
  const r = deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(w1))));
  assert.equal(r.scheduler.count, w1.scheduler.count);
  assert.equal(r.scheduler.next, w1.scheduler.next);
});

test('lignées : la souche fondatrice existe et la sauvegarde garde l\'arbre', () => {
  const w = new World({ seed: 26, events: false });
  const p = w.addPopulation(defaultDesign(), { count: 10 });
  for (let i = 0; i < 3000; i++) w.step();
  assert.ok(p.strains.length >= 1 && p.strains[0].parent === null);
  assert.ok(w.cells.filter((c) => c.popId === p.id).every((c) => p.strainMap.has(c.strainId)));
  const r = deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(w))));
  assert.equal(r.populations.get(p.id).strains.length, p.strains.length);
  assert.equal(strainDistance(compactGenome(defaultDesign()), compactGenome(defaultDesign())), 0);
});

test('défis : évaluation sans erreur et progression cohérente', () => {
  const w = new World({ seed: 27, events: false });
  w.addPopulation(defaultDesign(), { count: 10, ownerId: 'moi' });
  for (let i = 0; i < 50; i++) w.step();
  const st = challengeStatus(w, 'moi', {});
  assert.ok(st.length >= 10);
  const first = st.find((c) => c.id === 'premiers_pas');
  assert.ok(first.progress[0] >= 10 && first.progress[1] === 50);
});
