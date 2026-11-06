// Point d'entrée : assemble monde, source fantôme, progression, vues et boucle de jeu.
import { PARAMS } from './data/index.js';
import { World } from './simulation/world.js';
import { serializeWorld, deserializeWorld } from './simulation/serialize.js';
import { GhostWorldSource } from './world/ghostSource.js';
import { RemoteWorld, LocalWorld } from './world/remoteWorld.js';
import { identity, isMine } from './game/identity.js';
import { Progression, newProfile, launchCost } from './game/progression.js';
import { loadProfile, saveProfile, saveWorldSnapshot, loadWorldSnapshot, clearAll } from './game/storage.js';
import { WorldView, LAYERS, layerLegend } from './ui/worldView.js';
import { renderCellSheet } from './ui/cellSheet.js';
import { renderMiniPops, renderPopulations, renderArchives, renderJournal, popSeries } from './ui/panels.js';
import { lineChart } from './ui/charts.js';
import { Editor } from './editor/editor.js';
import { Workshop } from './workshop/workshop.js';
import { OrganelleWorkshop } from './workshop/organelleWorkshop.js';
import { EnvelopeWorkshop } from './workshop/envelopeWorkshop.js';
import { h, $, $$, fmt, fmtTime, toast } from './ui/dom.js';
import { help, setLivretOpener } from './ui/help.js';
import { Livret } from './ui/livret.js';
import { EVENT_TYPES } from './simulation/events.js';
import { ChatPanel } from './ui/chat.js';
import { renderChallenges } from './ui/challengesView.js';
import { challengeStatus, newlyCompleted } from './game/challenges.js';
import { recordOf, topLists } from './game/leaderboard.js';

const W = PARAMS.world;
const app = { world: null, ghosts: null, speed: 1, tab: 'monde' };
window.petri = app; // accès console (curieux, tests)
/** Monde partagé sur un serveur (le monde solo dans un worker est aussi un « miroir », mais local). */
const isMP = () => !!app.world?.remote && !app.world.local;

// ------------------------------------------------------------------ progression
const progression = new Progression(loadProfile() || newProfile());
progression.onChange(() => { saveProfile(progression.p); updateHud(); });

// ------------------------------------------------------------------ monde
function wireWorld(world) {
  if (world.local) world.on('points', (d) => { if (d.ownerId === identity.id) progression.earn(d.gain); });
  else if (world.remote) world.on('points', (d) => progression.setServerPoints(d.points, d.totalEarned));
  else world.on('points', (pop, gain) => { if (isMine(pop)) progression.earn(gain); });
  world.on('extinction', (pop) => {
    if (isMine(pop)) { progression.archive(pop.summary()); toast(`☠️ Votre population « ${pop.name} » s'est éteinte. Voir les archives.`, 'warn'); }
  });
  world.on('event', () => { journalDirty = true; });
  if (world.remote && !world.local) {
    world.on('challenges', (list) => { app.challenges = list; if (app.tab === 'defis') renderChallenges($('#defis-root'), list); });
    world.on('challengeDone', (c) => toast(`🎯 Défi réussi : « ${c.title} » (+${c.reward} points) !`, 'ok'));
  }
  world.on('envEvent', (e) => { const T = EVENT_TYPES[e.type]; if (T) toast(`${T.icon} ${T.name} ! Voir le journal.`, 'warn'); });
}

function newWorld(seed = (Date.now() % 1e9) | 0) {
  const world = new World({ seed });
  const ghosts = new GhostWorldSource({ seed: seed ^ 0x5bd1e995 });
  wireWorld(world);
  world.attachSource(ghosts);
  return { world, ghosts };
}

/** Le jeu est-il servi par le serveur multijoueur ? */
async function detectServer() {
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 1500);
    const r = await fetch('api/info', { signal: ctl.signal }); clearTimeout(t);
    if (!r.ok) return null;
    const d = await r.json();
    return d.multiplayer ? d : null;
  } catch { return null; }
}

async function bootMultiplayer(info) {
  let name = progression.p.mpName;
  if (!name) {
    name = (prompt('Monde partagé détecté ! Choisissez votre pseudo :', '') || '').trim() || `Joueur${Math.floor(Math.random() * 1000)}`;
    progression.p.mpName = name; saveProfile(progression.p);
  }
  const world = new RemoteWorld('');
  if (info.needPassword) {
    // le mot de passe est vérifié avant d'ouvrir le flux ; on le garde pour les prochaines visites
    let key = progression.p.mpKey || '';
    for (let tries = 0; ; tries++) {
      const r = key ? await fetch(`api/auth?key=${encodeURIComponent(key)}`).then((x) => x.ok).catch(() => false) : false;
      if (r) break;
      if (tries >= 3) throw new Error('Mot de passe refusé');
      key = (prompt(tries || key ? 'Mot de passe incorrect. Réessayez :' : '🔒 Ce monde partagé est protégé. Mot de passe :', '') || '').trim();
      if (!key) throw new Error('Mot de passe non saisi');
    }
    progression.p.mpKey = key; saveProfile(progression.p);
    world.key = key;
  }
  const init = await world.connect(progression.p.mpId, name);
  progression.p.mpId = init.playerId; saveProfile(progression.p);
  Object.assign(identity, { id: init.playerId, name: init.name, multiplayer: true });
  progression.setServerPoints(init.points, init.totalEarned);
  wireWorld(world);
  world.on('status', (ok) => { const el = $('#hud-mp'); if (el) el.classList.toggle('off', !ok); });
  Object.assign(app, { world, ghosts: world });
  toast(`🌐 Connecté au monde partagé en tant que « ${init.name} ».`, 'ok');
}

async function boot() {
  const info = await detectServer();
  if (info) {
    try { await bootMultiplayer(info); setup(); return; }
    catch (e) { console.warn(e); toast(/Mot de passe/.test(e.message) ? `${e.message} : passage en solo.` : 'Serveur multijoueur injoignable : passage en solo.', 'warn'); }
  }
  const snap = await loadWorldSnapshot();
  // Solo : la simulation tourne dans un worker (autre cœur du processeur) ; repli sur le mode direct sinon.
  if (typeof Worker !== 'undefined') {
    try {
      const world = new LocalWorld();
      const init = await Promise.race([
        world.start(snap?.world ? { snapshot: snap } : { size: progression.p.worldSize || 'petit' }),
        new Promise((_, no) => { world.on('workerError', () => no(new Error('worker'))); setTimeout(() => no(new Error('délai')), 15000); }),
      ]);
      wireWorld(world);
      Object.assign(app, { world, ghosts: world });
      if (snap?.world) toast('Monde restauré depuis la sauvegarde locale.', 'ok');
      void init;
      setup();
      return;
    } catch (e) { console.warn('Worker indisponible, simulation dans la page :', e); }
  }
  if (snap?.world) {
    try {
      const world = deserializeWorld(snap.world);
      const ghosts = new GhostWorldSource({ seed: world.seed });
      ghosts.deserialize(snap.ghosts);
      wireWorld(world);
      world.attachSource(ghosts);
      Object.assign(app, { world, ghosts });
      toast('Monde restauré depuis la sauvegarde locale.', 'ok');
    } catch (e) { console.warn('Sauvegarde illisible, nouveau monde', e); Object.assign(app, newWorld()); }
  } else Object.assign(app, newWorld());
  setup();
}

async function saveAll(quiet = true) {
  saveProfile(progression.p);
  if (isMP()) { if (!quiet) toast('Profil sauvegardé (le monde partagé est sauvegardé par le serveur).', 'ok'); return; }
  const snap = app.world.local ? await app.world.snapshot() : { world: serializeWorld(app.world), ghosts: app.ghosts.serialize(), savedAt: Date.now() };
  const ok = await saveWorldSnapshot(snap);
  if (!quiet) toast(ok ? 'Partie sauvegardée.' : 'Échec de la sauvegarde.', ok ? 'ok' : 'warn');
}

// ------------------------------------------------------------------ interface
let view, editor, workshop, orgWorkshop, envWorkshop, livret, journalDirty = true, selected = null;

// Calque affiché → section du livret qui l'explique
const LAYER_HELP = { glucose: 'glycolyse', o2: 'respiration', co2: 'photosynthese', nh4: 'azote', light: 'lumiere', temperature: 'temperature_ph', ph: 'ph', salinity: 'osmose',
  phosphate: 'adn_arn', protein: 'decomposeurs', aa: 'azote', starch: 'reserves', cellulose: 'decomposeurs', lactate: 'fermentation', ethanol: 'fermentation', acetate: 'fermentation', toxin: 'toxines', secreted: 'enzymes_secretees', uree: 'ph', signal: 'quorum', phage: 'phages', antibiotique: 'antibiotiques' };

function setup() {
  const canvas = $('#world-canvas');
  view = new WorldView(canvas, () => app.world);
  view.fit();
  new ResizeObserver(() => view.resize()).observe(canvas);
  view.onSelect = (c) => { selected = c; refreshSheet(); };

  const layerSel = $('#layer-select');
  for (const [k, l] of Object.entries(LAYERS)) layerSel.append(h('option', { value: k, selected: k === view.layer }, l.name));
  const layerHelp = () => $('#layer-help').replaceChildren(help(LAYER_HELP[view.layer] || 'milieu'));
  layerSel.addEventListener('change', () => { view.layer = layerSel.value; view.frame = 0; updateLegend(); refreshRemoteLayer(); layerHelp(); });
  updateLegend(); layerHelp();
  $$('[data-help]').forEach((el) => el.replaceWith(help(el.dataset.help)));

  livret = new Livret($('#livret-root'));
  setLivretOpener((id) => { showTab('livret'); livret.open(id); });
  const chat = new ChatPanel($('#chat'), { world: app.world, me: identity, multiplayer: isMP() });
  chat.onToggle = () => requestAnimationFrame(() => view.resize());

  $$('.tab').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
  $$('.speed').forEach((b) => b.addEventListener('click', () => setSpeed(+b.dataset.speed)));
  $('#btn-fit').addEventListener('click', () => view.fit());
  $('#btn-save').addEventListener('click', () => saveAll(false));
  const sizeSel = $('#world-size');
  for (const [k, sz] of Object.entries(PARAMS.worldSizes)) sizeSel.append(h('option', { value: k, selected: k === (progression.p.worldSize || 'petit') }, sz.name));
  if (isMP()) {
    $('#btn-new-world').style.display = 'none'; sizeSel.parentElement.style.display = 'none';
    $$('.speed').forEach((b) => { b.disabled = true; b.title = 'Le monde partagé avance au rythme du serveur'; });
    $('.speeds').after(h('span', { class: 'pill mp', id: 'hud-mp', title: 'Connecté au serveur multijoueur' }, '🌐 ', h('b', {}, identity.name), ' · ', h('span', { id: 'hud-players' }, '')));
  }
  $('#btn-new-world').addEventListener('click', () => {
    if (!confirm('Créer un nouveau monde ? Les populations actuelles disparaîtront (vos points, conceptions et enzymes sont conservés).')) return;
    const size = sizeSel.value;
    progression.p.worldSize = size; saveProfile(progression.p);
    if (app.world.local) {
      for (const p of app.world.livingPopulations()) if (isMine(p)) progression.archive({ ...p.summary(), extinct: true, extinctAt: app.world.time, extinctionSummary: 'Monde réinitialisé par le joueur.' });
      app.world.newWorld({ size }).then(() => { selected = null; view.selectedId = null; view.fit(); toast(`Nouveau monde créé (${PARAMS.worldSizes[size].name}).`, 'ok'); });
      return;
    }
    for (const p of app.world.livingPopulations()) if (isMine(p)) { p.markExtinct(app.world.time); p.extinctionSummary = 'Monde réinitialisé par le joueur.'; progression.archive(p.summary()); }
    Object.assign(app, newWorld()); selected = null; view.fit(); toast('Nouveau monde créé.', 'ok');
  });
  $('#btn-reset').addEventListener('click', async () => {
    if (!confirm('Tout effacer (points, conceptions, enzymes, archives, monde) ?')) return;
    await clearAll(); progression.p = newProfile(); saveProfile(progression.p); location.reload();
  });

  editor = new Editor($('#editor-root'), { progression, onLaunch: launch });
  workshop = new Workshop($('#workshop-root'), { progression, onSaved: () => editor.renderControls() });
  orgWorkshop = new OrganelleWorkshop($('#organelle-root'), { progression, onSaved: () => editor.renderControls() });
  envWorkshop = new EnvelopeWorkshop($('#envelope-root'), { progression, onSaved: () => editor.renderControls() });

  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, select, textarea')) return;
    if (e.key === ' ') { e.preventDefault(); setSpeed(app.speed ? 0 : 1); }
    if (e.key === '1') setSpeed(1); if (e.key === '2') setSpeed(2); if (e.key === '5') setSpeed(5);
  });
  window.addEventListener('beforeunload', () => saveProfile(progression.p));
  setInterval(() => saveAll(true), 30000);
  setSpeed(1);
  updateHud();
  requestAnimationFrame(loop);
}

function showTab(tab) {
  app.tab = tab;
  $$('.tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  $$('.view').forEach((v) => v.classList.toggle('on', v.id === `view-${tab}`));
  if (tab === 'monde') requestAnimationFrame(() => view.resize());
  if (tab === 'populations') renderPopulations($('#populations-root'), app.world, progression, app.ghosts, popActions, leaderboard());
  if (tab === 'archives') renderArchives($('#archives-root'), app.world, progression);
  if (tab === 'editeur') { editor.renderViability(); editor.drawPreview(); }
  if (tab === 'atelier') workshop.renderRight();
  if (tab === 'organites') orgWorkshop.renderRight();
  if (tab === 'enveloppe') envWorkshop.render();
  if (tab === 'defis') renderChallenges($('#defis-root'), currentChallenges());
}

// Défis : évalués là où tourne la simulation (worker, page ou serveur).
function currentChallenges() {
  if (app.world.remote) return app.challenges || challengeStatus({ populations: new Map(), cells: [] }, '__aucun__', {});
  return challengeStatus(app.world, identity.id, progression.p.challenges || {});
}
function award(c) {
  progression.p.challenges[c.id] = Math.round(app.world.time);
  progression.earn(c.reward);
  toast(`🎯 Défi réussi : « ${c.title} » (+${c.reward} points) !`, 'ok');
}
async function checkChallenges() {
  if (isMP()) return;
  progression.p.challenges = progression.p.challenges || {};
  if (app.world.local) {
    const list = await app.world.challenges(identity.id, progression.p.challenges);
    for (const c of list) if (!c.done && c.progress && c.progress[0] >= c.progress[1]) { award(c); c.done = true; }
    app.challenges = list;
    return;
  }
  for (const c of newlyCompleted(app.world, identity.id, progression.p.challenges)) {
    award(c);
  }
}

function setSpeed(s) {
  if (isMP()) return;
  if (app.world.local) app.world.setSpeed(s);
  app.speed = s; $$('.speed').forEach((b) => b.classList.toggle('on', +b.dataset.speed === s)); }

// Classements : demandés au serveur en multijoueur, calculés sur place en solo.
let lbCache = null, lbAt = 0;
function leaderboard() {
  if (isMP()) {
    if (performance.now() - lbAt > 10000) {
      lbAt = performance.now();
      fetch('api/leaderboard', { headers: { 'X-Petri-Key': app.world.key || '' } }).then((r) => r.json()).then((d) => { lbCache = d; }).catch(() => {});
    }
    return lbCache;
  }
  const entries = [...app.world.populations.values()].map((p) => recordOf(p, app.world.time));
  for (const a of progression.p.archives) entries.push(recordOf({ ...a, extinct: true, ownerId: identity.id, ownerName: 'Vous' }, app.world.time));
  return { players: null, boards: topLists(entries) };
}

const popActions = {
  focus: (p) => focusPop(p),
  abandon: (p) => {
    if (!confirm(`Abandonner « ${p.name} » ? Ses cellules seront retirées du monde.`)) return;
    Promise.resolve(app.world.removePopulation(p.id)).then(() => setTimeout(() => renderPopulations($('#populations-root'), app.world, progression, app.ghosts, popActions, leaderboard()), 400));
    renderPopulations($('#populations-root'), app.world, progression, app.ghosts, popActions, leaderboard());
  },
};

function focusPop(p) {
  const cells = app.world.cells.filter((c) => c.popId === p.id);
  showTab('monde');
  if (!cells.length) return;
  let x = 0, y = 0; for (const c of cells) { x += c.x; y += c.y; }
  view.centerOn(x / cells.length, y / cells.length, Math.max(view.cam.zoom, 10));
  view.selectedId = cells[0].id; selected = cells[0]; refreshSheet();
}

function launch(design, manual) {
  const doLaunch = async (x, y) => {
    if (app.world.local) {
      if (!progression.spend(design)) { toast('Points insuffisants.', 'warn'); return; }
      const r = await app.world.launch(design, x, y, { ownerId: identity.id, ownerName: 'Vous' });
      if (!r.ok) { toast(`Lancement impossible : ${r.error}`, 'warn'); return; }
      toast(`🚀 « ${design.name} » lancée (−${launchCost(design)} points).`, 'ok');
      setTimeout(() => { const pop = app.world.populations.get(r.popId); if (pop) focusPop(pop); editor.renderViability(); }, 150);
      return;
    }
    if (app.world.remote) {
      const r = await app.world.launch(design, x, y).catch((e) => ({ ok: false, error: e.message }));
      if (!r.ok) { toast(`Lancement refusé : ${r.error}`, 'warn'); return; }
      progression.p.launched++; progression.setServerPoints(r.points, progression.totalEarned);
      toast(`🚀 « ${design.name} » lancée dans le monde partagé (−${r.cost} points).`, 'ok');
      setTimeout(() => { const pop = app.world.populations.get(r.popId); if (pop) focusPop(pop); editor.renderViability(); }, 600);
      return;
    }
    if (!progression.spend(design)) { toast('Points insuffisants.', 'warn'); return; }
    const opts = { ownerId: identity.id, ownerName: 'Vous', name: design.name, color: design.color };
    if (x !== undefined) { opts.x = x; opts.y = y; }
    const pop = app.world.addPopulation(design, opts);
    toast(`🚀 « ${pop.name} » lancée (−${launchCost(design)} points).`, 'ok');
    focusPop(pop);
    editor.renderViability();
  };
  if (!manual) { doLaunch(); return; }
  showTab('monde');
  view.onMapClick = (x, y) => doLaunch(x, y);
}

let sheetBusy = false;
function refreshSheet() {
  const root = $('#cell-sheet');
  if (app.world.remote) {
    // multijoueur : la fiche complète est demandée au serveur
    const id = view.selectedId;
    if (!id || sheetBusy) return;
    sheetBusy = true;
    app.world.fetchCell(id).then((full) => {
      sheetBusy = false;
      if (view.selectedId !== id) return;
      if (!full) { root.replaceChildren(h('div', { class: 'muted' }, 'Cette cellule est morte.')); return; }
      root.replaceChildren(renderCellSheet(full, app.world, sheetActions));
    }).catch(() => { sheetBusy = false; });
    return;
  }
  const c = selected && selected.alive ? selected : (view.selectedId ? app.world.cellById.get(view.selectedId) : null);
  if (selected && !selected.alive && !c) { root.replaceChildren(h('div', { class: 'muted' }, `Cette cellule est morte (${selected.deathCause ? (selected.deathCause) : '?'}).`)); return; }
  root.replaceChildren(renderCellSheet(c, app.world, sheetActions));
}
const sheetActions = {
  follow: () => { view.follow = true; },
  copy: (cell) => { editor.setDesign({ ...cell.genome, name: `${cell.genome.name || 'Copie'} (copie)`, organellePositions: {} }); showTab('editeur'); toast('Génome copié dans l\'éditeur.', 'ok'); },
};

// Multijoueur : télécharge le champ du calque affiché (le monde est simulé par le serveur).
const LAYER_SOURCE = { ph: 'pH', secreted: 'secreted', temperature: 'temperature', salinity: 'salinity' };
function refreshRemoteLayer() {
  if (!app.world.remote) return;
  const L = LAYERS[view.layer];
  const src = L?.field || LAYER_SOURCE[view.layer];
  if (src) app.world.fetchLayer(src).then(() => { view.frame = 0; }).catch(() => {});
}

// Légende du calque actif : dégradé, bornes, unité et valeur sous la souris.
let legendKey = '';
function updateLegend() {
  const box = $('#map-scale');
  const lg = layerLegend(view.layer, view.autoMax);
  if (!lg) { box.style.display = 'none'; legendKey = ''; return; }
  box.style.display = '';
  const key = view.layer + lg.max;
  if (key !== legendKey) {
    legendKey = key;
    box.replaceChildren(
      h('div', { class: 'scale-title' }, h('b', {}, LAYERS[view.layer].name), h('span', { class: 'muted' }, ` · ${lg.unit}`)),
      h('div', { class: 'scale-bar', style: { background: lg.gradient } }),
      h('div', { class: 'scale-ticks' }, h('span', {}, `${lg.min} (${lg.low})`), h('span', {}, `${lg.max} (${lg.high})`)),
      h('div', { class: 'scale-here', id: 'scale-here' }));
  }
  const hv = view.hoverValue();
  const here = $('#scale-here');
  if (here) here.textContent = hv ? `Sous la souris : ${fmt(hv.v, hv.v >= 100 ? 0 : hv.v >= 10 ? 1 : 2)}` : 'Survolez la carte pour lire la valeur';
}

function updateHud() {
  $('#hud-points').textContent = fmt(progression.points, 1);
  if (app.world) {
    $('#hud-time').textContent = fmtTime(app.world.time);
    $('#hud-cells').textContent = app.world.cells.length;
    const l = app.world.env.lightLevel;
    $('#hud-day').textContent = l > 0.7 ? '☀️ jour' : l > 0.35 ? '🌤️ crépuscule' : '🌙 nuit';
    const pl = $('#hud-players');
    if (pl && isMP()) pl.textContent = `${app.world.users().filter((u) => u.human && u.online).length} joueur(s) en ligne`;
  }
}

// ------------------------------------------------------------------ boucle
let last = performance.now(), acc = 0, panelTimer = 0, chartTimer = 0, realTps = 0, tpsCount = 0, tpsTimer = 0;
function loop(now) {
  const dtReal = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (app.world.local) { app.world.update(); tpsCount += dtReal * (app.world.tps || 0); }
  else if (app.world.remote) { app.world.update(); tpsCount += dtReal * W.ticksPerSecond * (app.world.speed || 1); }
  else if (app.speed > 0) {
    acc += dtReal * W.ticksPerSecond * app.speed;
    const t0 = performance.now();
    while (acc >= 1) {
      app.world.step(W.dt);
      acc -= 1; tpsCount++;
      if (performance.now() - t0 > 22) { acc = Math.min(acc, 2); break; } // budget de calcul par image
    }
  }
  tpsTimer += dtReal;
  if (tpsTimer >= 1) { realTps = tpsCount / tpsTimer; tpsCount = 0; tpsTimer = 0; $('#hud-tps').textContent = `${(realTps / W.ticksPerSecond).toFixed(1)}×`; }
  if (app.tab === 'monde') view.render(now / 1000);
  if (app.tab === 'editeur') editor.tick(dtReal);
  panelTimer += dtReal; chartTimer += dtReal;
  if (panelTimer > 0.5) {
    panelTimer = 0;
    updateHud();
    if (app.tab === 'monde') {
      updateLegend();
      renderMiniPops($('#mini-pops'), app.world, { onHover: (id) => { view.hoverPop = id; }, onFocus: focusPop });
      if (selected || view.selectedId) refreshSheet();
      if (journalDirty) { renderJournal($('#journal'), app.world); journalDirty = false; }
    }
  }
  if (app.tab === 'monde' && (chartTimer > 2 || (app.world.local && panelTimer === 0))) refreshRemoteLayer();
  if (chartTimer > 2) {
    chartTimer = 0;
    checkChallenges().catch(() => {});
    if (app.tab === 'defis') renderChallenges($('#defis-root'), currentChallenges());
    if (app.tab === 'monde') lineChart($('#world-chart'), popSeries(app.world, (p) => !p.extinct || app.world.time - p.extinctAt < 120), { log: true, xFmt: (v) => `${Math.round(v)} s` });
    if (app.tab === 'populations') renderPopulations($('#populations-root'), app.world, progression, app.ghosts, popActions, leaderboard());
  }
  requestAnimationFrame(loop);
}

boot();
