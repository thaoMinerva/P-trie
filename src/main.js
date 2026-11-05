// Point d'entrée : assemble monde, source fantôme, progression, vues et boucle de jeu.
import { PARAMS } from './data/index.js';
import { World } from './simulation/world.js';
import { serializeWorld, deserializeWorld } from './simulation/serialize.js';
import { GhostWorldSource } from './world/ghostSource.js';
import { RemoteWorld } from './world/remoteWorld.js';
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

const W = PARAMS.world;
const app = { world: null, ghosts: null, speed: 1, tab: 'monde' };

// ------------------------------------------------------------------ progression
const progression = new Progression(loadProfile() || newProfile());
progression.onChange(() => { saveProfile(progression.p); updateHud(); });

// ------------------------------------------------------------------ monde
function wireWorld(world) {
  if (world.remote) world.on('points', (d) => progression.setServerPoints(d.points, d.totalEarned));
  else world.on('points', (pop, gain) => { if (isMine(pop)) progression.earn(gain); });
  world.on('extinction', (pop) => {
    if (isMine(pop)) { progression.archive(pop.summary()); toast(`☠️ Votre population « ${pop.name} » s'est éteinte. Voir les archives.`, 'warn'); }
  });
  world.on('event', () => { journalDirty = true; });
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

async function bootMultiplayer() {
  let name = progression.p.mpName;
  if (!name) {
    name = (prompt('Monde partagé détecté ! Choisissez votre pseudo :', '') || '').trim() || `Joueur${Math.floor(Math.random() * 1000)}`;
    progression.p.mpName = name; saveProfile(progression.p);
  }
  const world = new RemoteWorld('');
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
  if (await detectServer()) {
    try { await bootMultiplayer(); setup(); return; }
    catch (e) { console.warn(e); toast('Serveur multijoueur injoignable : passage en solo.', 'warn'); }
  }
  const snap = await loadWorldSnapshot();
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
  if (app.world.remote) { if (!quiet) toast('Profil sauvegardé (le monde partagé est sauvegardé par le serveur).', 'ok'); return; }
  const ok = await saveWorldSnapshot({ world: serializeWorld(app.world), ghosts: app.ghosts.serialize(), savedAt: Date.now() });
  if (!quiet) toast(ok ? 'Partie sauvegardée.' : 'Échec de la sauvegarde.', ok ? 'ok' : 'warn');
}

// ------------------------------------------------------------------ interface
let view, editor, workshop, orgWorkshop, envWorkshop, journalDirty = true, selected = null;

function setup() {
  const canvas = $('#world-canvas');
  view = new WorldView(canvas, () => app.world);
  view.fit();
  new ResizeObserver(() => view.resize()).observe(canvas);
  view.onSelect = (c) => { selected = c; refreshSheet(); };

  const layerSel = $('#layer-select');
  for (const [k, l] of Object.entries(LAYERS)) layerSel.append(h('option', { value: k, selected: k === view.layer }, l.name));
  layerSel.addEventListener('change', () => { view.layer = layerSel.value; view.frame = 0; updateLegend(); refreshRemoteLayer(); });
  updateLegend();

  $$('.tab').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
  $$('.speed').forEach((b) => b.addEventListener('click', () => setSpeed(+b.dataset.speed)));
  $('#btn-fit').addEventListener('click', () => view.fit());
  $('#btn-save').addEventListener('click', () => saveAll(false));
  if (app.world.remote) {
    $('#btn-new-world').style.display = 'none';
    $$('.speed').forEach((b) => { b.disabled = true; b.title = 'Le monde partagé avance au rythme du serveur'; });
    $('.speeds').after(h('span', { class: 'pill mp', id: 'hud-mp', title: 'Connecté au serveur multijoueur' }, '🌐 ', h('b', {}, identity.name), ' · ', h('span', { id: 'hud-players' }, '')));
  }
  $('#btn-new-world').addEventListener('click', () => {
    if (!confirm('Créer un nouveau monde ? Les populations actuelles disparaîtront (vos points, conceptions et enzymes sont conservés).')) return;
    for (const p of app.world.livingPopulations()) if (isMine(p)) { p.markExtinct(app.world.time); p.extinctionSummary = 'Monde réinitialisé par le joueur.'; progression.archive(p.summary()); }
    Object.assign(app, newWorld()); selected = null; view.fit(); toast('Nouveau monde créé.', 'ok');
  });
  $('#btn-reset').addEventListener('click', async () => {
    if (!confirm('Tout effacer (points, conceptions, enzymes, archives, monde) ?')) return;
    await clearAll(); progression.p = newProfile(); saveProfile(progression.p); Object.assign(app, newWorld()); location.reload();
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
  if (tab === 'populations') renderPopulations($('#populations-root'), app.world, progression, app.ghosts, popActions);
  if (tab === 'archives') renderArchives($('#archives-root'), app.world, progression);
  if (tab === 'editeur') { editor.renderViability(); editor.drawPreview(); }
  if (tab === 'atelier') workshop.renderRight();
  if (tab === 'organites') orgWorkshop.renderRight();
  if (tab === 'enveloppe') envWorkshop.render();
}

function setSpeed(s) { app.speed = s; $$('.speed').forEach((b) => b.classList.toggle('on', +b.dataset.speed === s)); }

const popActions = {
  focus: (p) => focusPop(p),
  abandon: (p) => {
    if (!confirm(`Abandonner « ${p.name} » ? Ses cellules seront retirées du monde.`)) return;
    Promise.resolve(app.world.removePopulation(p.id)).then(() => setTimeout(() => renderPopulations($('#populations-root'), app.world, progression, app.ghosts, popActions), 400));
    renderPopulations($('#populations-root'), app.world, progression, app.ghosts, popActions);
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
const LAYER_SOURCE = { ph: 'pH', secreted: 'secreted' };
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
    if (pl && app.world.remote) pl.textContent = `${app.world.users().filter((u) => u.human && u.online).length} joueur(s) en ligne`;
  }
}

// ------------------------------------------------------------------ boucle
let last = performance.now(), acc = 0, panelTimer = 0, chartTimer = 0, realTps = 0, tpsCount = 0, tpsTimer = 0;
function loop(now) {
  const dtReal = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (app.world.remote) { app.world.update(); tpsCount += dtReal * W.ticksPerSecond * (app.world.speed || 1); }
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
  if (chartTimer > 2 && app.tab === 'monde') refreshRemoteLayer();
  if (chartTimer > 2) {
    chartTimer = 0;
    if (app.tab === 'monde') lineChart($('#world-chart'), popSeries(app.world, (p) => !p.extinct || app.world.time - p.extinctAt < 120), { log: true, xFmt: (v) => `${Math.round(v)} s` });
    if (app.tab === 'populations') renderPopulations($('#populations-root'), app.world, progression, app.ghosts, popActions);
  }
  requestAnimationFrame(loop);
}

boot();
