// Éditeur de cellule en étapes guidées : base → forme → enveloppe → organites → enzymes → test et lancement.
// L'aperçu et le résumé de viabilité restent visibles dans une colonne latérale.
import { ORGANELLES, ENVELOPE, ENZYMES, ARCHETYPES, PARAMS } from '../data/index.js';
import { SHAPES, computeGeometry } from '../simulation/geometry.js';
import { normalizeDesign, defaultDesign } from '../simulation/genome.js';
import { EnzymeRegistry } from '../simulation/registry.js';
import { analyzeDesign } from '../simulation/analysis.js';
import { runBenchmark, SCENARIOS } from '../simulation/benchmark.js';
import { launchCost } from '../game/progression.js';
import { drawCellDetailed, layoutOrganelles } from '../ui/cellDraw.js';
import { lineChart } from '../ui/charts.js';
import { h, clear, fmt, toast } from '../ui/dom.js';

const C = PARAMS.cell;

const STEPS = [
  { id: 'base', icon: '🧬', name: 'Type' },
  { id: 'forme', icon: '⬭', name: 'Forme' },
  { id: 'enveloppe', icon: '🛡️', name: 'Enveloppe' },
  { id: 'organites', icon: '🫧', name: 'Organites' },
  { id: 'enzymes', icon: '⚗️', name: 'Enzymes' },
  { id: 'test', icon: '🚀', name: 'Tester et lancer' },
];

const KITS = [
  { name: 'Respiration aérobie', desc: 'Oxyde complètement le glucose avec l\'O₂ (~32 ATP/glucose).', enzymes: { glycolyse: 2, krebs: 1.2, chaine_respiratoire: 1.5, catalase: 0.8 } },
  { name: 'Fermentation lactique', desc: 'Sans O₂ : 2 ATP/glucose, rejette du lactate.', enzymes: { glycolyse: 2.5, fermentation_lactique: 2 } },
  { name: 'Fermentation alcoolique', desc: 'Sans O₂ : 2 ATP/glucose, rejette éthanol + CO₂.', enzymes: { glycolyse: 2.5, fermentation_alcoolique: 2 } },
  { name: 'Photosynthèse', desc: 'Lumière + CO₂ → glucose. Eucaryote : ajoutez des chloroplastes.', enzymes: { photosystemes: 3, calvin: 4, catalase: 1 } },
  { name: 'Assimilation de l\'azote', desc: 'Fabrique les acides aminés à partir de NH₄⁺ (indispensable à la croissance).', enzymes: { synthese_aa: 1.5 } },
  { name: 'Fixation du N₂', desc: 'Fabrique son propre ammonium à partir de l\'air (très coûteux).', enzymes: { nitrogenase: 1.5, synthese_aa: 1 } },
  { name: 'Décomposeur', desc: 'Digère protéines et amidon du milieu.', enzymes: { protease: 1.5, amylase: 1, desamination: 1.5 } },
  { name: 'Réserves', desc: 'Stocke le glucose en excès, le ressort en disette ou la nuit.', enzymes: { glycogene_synthase: 0.8, phosphorylase: 0.8 } },
  { name: 'Recyclage des déchets', desc: 'Se nourrit du lactate, de l\'éthanol et de l\'acétate des voisins.', enzymes: { lactate_oxydase: 1, ethanol_oxydation: 1, acetate_krebs: 1 } },
  { name: 'Guerre chimique', desc: 'Sécrète une toxine… et s\'en protège.', enzymes: { toxine_synthase: 0.8, detoxifiase: 2 } },
];

export class Editor {
  constructor(root, ctx) {
    this.root = root;
    this.ctx = ctx; // { progression, onLaunch(design, manual) }
    this.design = normalizeDesign(defaultDesign());
    this.step = 'base';
    this.bench = null;
    this.drag = null;
    this.time = 0;
    this.enzFilter = '';
    this.build();
  }

  registry() {
    const r = new EnzymeRegistry();
    for (const e of this.ctx.progression.p.customEnzymes) { try { r.register(e.def); } catch { /* ignorée */ } }
    return r;
  }

  analyze() { this.analysis = analyzeDesign(this.design, this.registry()); return this.analysis; }

  setDesign(d) { this.design = normalizeDesign(d); this.bench = null; this.analyze(); this.renderStep(); this.renderSide(); this.drawPreview(); }

  /** Appelé après chaque modification. structural : re-dessiner l'étape courante. */
  change(structural = false) {
    this.design = normalizeDesign(this.design);
    this.bench = null;
    this.analyze();
    if (structural) this.renderStep();
    this.renderSide();
    this.drawPreview();
  }

  build() {
    clear(this.root);
    this.stepper = h('nav', { class: 'stepper' });
    this.main = h('div', { class: 'ed-main' });
    this.canvas = h('canvas', { class: 'ed-canvas' });
    this.previewInfo = h('div', { class: 'small muted center' });
    this.sideInfo = h('div', {});
    this.root.append(h('div', { class: 'editor-layout' },
      h('div', { class: 'ed-left' }, this.stepper, this.main),
      h('aside', { class: 'ed-side' },
        h('section', { class: 'card' },
          h('div', { class: 'side-title' }, h('h3', {}, 'Aperçu'), h('span', { class: 'small muted' }, 'glissez les organites')),
          this.canvas, this.previewInfo),
        this.sideInfo)));
    this.bindCanvas();
    this.analyze();
    this.renderStep();
    this.renderSide();
    requestAnimationFrame(() => this.drawPreview());
  }

  goto(step) { this.step = step; this.renderStep(); this.main.scrollIntoView?.({ block: 'start' }); }

  renderStepper() {
    const a = this.analysis;
    clear(this.stepper).append(...STEPS.map((s, i) => h('button', { class: `step ${this.step === s.id ? 'on' : ''}`, onclick: () => this.goto(s.id) },
      h('span', { class: 'step-n' }, i + 1), h('span', {}, `${s.icon} ${s.name}`),
      s.id === 'test' && a?.errors.length ? h('span', { class: 'badge err' }, a.errors.length) : null)));
  }

  // ------------------------------------------------------------------ étapes
  renderStep() {
    this.renderStepper();
    const root = clear(this.main);
    const d = this.design;
    const idx = STEPS.findIndex((s) => s.id === this.step);
    const nav = h('div', { class: 'step-nav' },
      idx > 0 ? h('button', { class: 'btn', onclick: () => this.goto(STEPS[idx - 1].id) }, `← ${STEPS[idx - 1].name}`) : h('span'),
      idx < STEPS.length - 1 ? h('button', { class: 'btn primary', onclick: () => this.goto(STEPS[idx + 1].id) }, `${STEPS[idx + 1].name} →`) : h('span'));
    const body = this[`step_${this.step}`](d);
    root.append(body, nav);
  }

  step_base(d) {
    const templates = [
      { label: 'Bactérie aérobie simple (par défaut)', design: defaultDesign() },
      ...ARCHETYPES.map((a) => ({ label: `${a.names[0]} — ${a.profile}`, design: { ...a.design, name: a.names[0], color: '#4ea8de' } })),
      ...this.ctx.progression.p.designs.map((s) => ({ label: `Ma conception : ${s.name}`, design: s.design })),
    ];
    return card('Identité et type cellulaire',
      intro('Donnez un nom à votre organisme, ou partez d\'un modèle déjà viable pour gagner du temps.'),
      row('Nom', h('input', { type: 'text', value: d.name, maxlength: 40, oninput: (e) => { d.name = e.target.value; this.change(); } })),
      row('Couleur', h('input', { type: 'color', value: d.color, oninput: (e) => { d.color = e.target.value; this.change(); } })),
      row('Partir d\'un modèle', h('select', { onchange: (e) => { const t = templates[+e.target.value]; if (t) { this.setDesign(t.design); toast(`Modèle « ${t.label} » chargé.`, 'ok'); } } },
        h('option', { value: '' }, '— choisir —'), templates.map((t, i) => h('option', { value: i }, t.label)))),
      h('h4', {}, 'Type cellulaire'),
      h('div', { class: 'choice-grid two' }, [
        { id: 'procaryote', title: 'Procaryote (bactérie)', text: 'Petite (0,4–2,5 µm), échanges rapides, divisions fréquentes. Pas d\'organites membranaires : la respiration et la photosynthèse se font sur la membrane.' },
        { id: 'eucaryote', title: 'Eucaryote (protiste)', text: 'Grande (2,5–10 µm), noyau, mitochondries, chloroplastes, phagocytose possible. Plus coûteuse et plus lente à se diviser.' },
      ].map((t) => choice(d.type === t.id, t.title, t.text, () => {
        if (d.type === t.id) return;
        d.type = t.id;
        d.shape.size = t.id === 'eucaryote' ? Math.max(3, d.shape.size * 3) : Math.min(1.2, d.shape.size / 3);
        d.organelles = t.id === 'eucaryote' ? { noyau: 1, ribosomes: 2, mitochondrie: 4, reticulum: 1, vacuole_contractile: 1 } : { nucleoide: 1, ribosomes: 2 };
        if (t.id === 'eucaryote') d.envelope.motility = d.envelope.motility === 'aucune' ? 'aucune' : d.envelope.motility;
        d.organellePositions = {};
        this.change(true);
      }))));
  }

  step_forme(d) {
    const [smin, smax] = d.type === 'eucaryote' ? [C.eukSizeMin, C.eukSizeMax] : [C.prokSizeMin, C.prokSizeMax];
    const shapeText = { coque: 'Compacte : rapport surface/volume le plus faible.', bacille: 'Bâtonnet : bon compromis, facile à allonger.', spirille: 'Hélice fine : énorme surface d\'échange, mais fragile.', ovale: 'Ellipse : intermédiaire entre coque et bacille.', libre: 'Dessinez votre contour (points de contrôle dans l\'aperçu).' };
    const ph = this.analysis?.ph;
    return card('Forme et taille',
      intro('La taille fixe le volume (ce qu\'il faut construire) ; la forme fixe la surface (vitesse d\'échange avec le milieu). Un grand rapport surface/volume = nutriments captés plus vite.'),
      h('div', { class: 'choice-grid' }, Object.entries(SHAPES).map(([k, v]) => choice(d.shape.kind === k, v, shapeText[k], () => {
        d.shape.kind = k;
        if (k === 'libre' && !d.shape.points) d.shape.points = [[1, 0], [0.6, 0.7], [-0.2, 0.9], [-0.9, 0.3], [-0.8, -0.5], [0.1, -0.8], [0.7, -0.6]];
        d.organellePositions = {};
        this.change(true);
      }))),
      slider('Taille (rayon équivalent)', d.shape.size, smin, smax, 0.05, (v) => { d.shape.size = v; this.change(); }, (v) => `${fmt(v, 2)} µm`),
      ['bacille', 'spirille', 'ovale'].includes(d.shape.kind) ? slider('Allongement', d.shape.aspect, 1, 6, 0.1, (v) => { d.shape.aspect = v; d.organellePositions = {}; this.change(); }, (v) => `×${fmt(v, 1)}`) : null,
      d.shape.kind === 'libre' ? h('div', { class: 'msg info' }, 'ℹ️ Dans l\'aperçu : glissez les points blancs, double-cliquez pour en ajouter, clic droit pour en retirer.') : null,
      ph ? h('div', { class: 'kv' }, kv('Volume', `${fmt(ph.V, 2)} µm³`), kv('Surface', `${fmt(ph.SA, 1)} µm²`), kv('Rapport S/V', `${fmt(ph.sv, 2)} µm⁻¹`)) : null);
  }

  step_enveloppe(d) {
    const motOpts = Object.entries(ENVELOPE.motility).filter(([, m]) => m.types.includes(d.type));
    return card('Enveloppe et mobilité',
      intro('L\'enveloppe protège (prédateurs, osmose, toxines) mais ralentit les échanges et coûte de la biomasse. La mobilité permet de remonter les gradients de nourriture, au prix d\'ATP.'),
      slider('Épaisseur de paroi', d.envelope.wall, 0, 1, 0.01, (v) => { d.envelope.wall = v; this.change(); }, (v) => v ? fmt(v, 2) : 'aucune'),
      h('p', { class: 'small muted' }, ENVELOPE.wall.description + (d.type === 'eucaryote' ? ' Au-delà de 0,08, la phagocytose devient impossible.' : '')),
      h('div', { class: 'choice-grid' },
        toggleCard(d.envelope.capsule, 'Capsule', ENVELOPE.capsule.description, (v) => { d.envelope.capsule = v; this.change(true); }),
        toggleCard(d.envelope.parasite, 'Suçoir (parasitisme)', ENVELOPE.parasite.description, (v) => { d.envelope.parasite = v; this.change(true); }),
        toggleCard(d.envelope.adhesins, 'Adhésines symbiotiques', ENVELOPE.adhesins.description, (v) => { d.envelope.adhesins = v; this.change(true); })),
      h('h4', {}, 'Mobilité'),
      h('div', { class: 'choice-grid' }, motOpts.map(([k, m]) => choice(d.envelope.motility === k, m.name, m.description || 'Se laisse porter par l\'agitation moléculaire. Gratuit.', () => { d.envelope.motility = k; d.envelope.motilityUnits = 1; this.change(true); }))),
      d.envelope.motility !== 'aucune' ? slider('Nombre / densité', d.envelope.motilityUnits, 1, ENVELOPE.motility[d.envelope.motility].maxUnits, 1, (v) => { d.envelope.motilityUnits = v; this.change(); }, (v) => `${v}`) : null);
  }

  organelleList() {
    const libIds = new Set(this.ctx.progression.p.customOrganelles.map((e) => e.def.id));
    const used = new Set(Object.keys(this.design.organelles));
    return ORGANELLES.filter((o) => o.types.includes(this.design.type) && (!o.custom || libIds.has(o.id) || used.has(o.id)));
  }

  step_organites(d) {
    const list = this.organelleList();
    return card('Organites',
      intro('Chaque organite occupe du volume, coûte de la biomasse et de l\'ATP d\'entretien, et apporte une fonction. Les organites personnalisés se créent dans l\'Atelier d\'organites.'),
      h('div', { class: 'org-grid' }, list.map((o) => {
        const n = d.organelles[o.id] || 0, req = o.required?.includes(d.type);
        return h('div', { class: `org-card ${n ? 'on' : ''}` },
          h('div', { class: 'org-head' }, h('span', { class: 'swatch', style: { background: o.color } }), h('b', {}, o.name), o.custom ? h('small', { class: 'tag custom' }, 'perso') : null, req ? h('small', { class: 'tag' }, 'obligatoire') : null),
          h('div', { class: 'small muted' }, o.description),
          h('div', { class: 'org-foot' },
            h('span', { class: 'small muted' }, `${fmt(o.volume * 100, 1)} % vol · ${fmt(o.upkeep * 1000, 1)} mATP/s/µm³`),
            h('span', { class: 'counter' },
              h('button', { class: 'btn tiny', disabled: n <= (req ? 1 : 0), onclick: () => { d.organelles[o.id] = n - 1; this.dropPositions(o.id); this.change(true); } }, '−'),
              h('b', {}, n),
              h('button', { class: 'btn tiny', disabled: n >= o.max, onclick: () => {
                d.organelles[o.id] = n + 1;
                if (o.custom && !(d.customOrganelles || []).some((x) => x.id === o.id)) d.customOrganelles = [...(d.customOrganelles || []), JSON.parse(JSON.stringify(this.ctx.progression.p.customOrganelles.find((e) => e.def.id === o.id)?.def || o))];
                this.change(true);
              } }, '+'))));
      })));
  }

  dropPositions(id) { if (this.design.organellePositions[id]) this.design.organellePositions[id].length = Math.min(this.design.organellePositions[id].length, this.design.organelles[id] || 0); }

  step_enzymes(d) {
    const custom = this.ctx.progression.p.customEnzymes.map((e) => e.def);
    const all = [...ENZYMES, ...custom];
    const f = this.enzFilter.toLowerCase();
    const cats = new Map();
    for (const e of all) {
      if (f && !(`${e.name} ${e.description} ${e.category}`.toLowerCase().includes(f))) continue;
      if (!cats.has(e.category)) cats.set(e.category, []);
      cats.get(e.category).push(e);
    }
    const chosen = Object.keys(d.enzymes);
    const listBox = h('div', {});
    for (const [cat, list] of cats) {
      listBox.append(h('div', { class: 'enz-cat' }, cat));
      for (const e of list) listBox.append(this.enzymeRow(e));
    }
    const search = h('input', { type: 'search', placeholder: 'Rechercher une enzyme (glucose, azote, lumière…)', value: this.enzFilter, class: 'search', oninput: (ev) => { this.enzFilter = ev.target.value; const pos = ev.target.selectionStart; this.renderStep(); const s = this.main.querySelector('.search'); s.focus(); s.setSelectionRange(pos, pos); } });
    return h('div', { class: 'stack' },
      card('Kits métaboliques',
        intro('Un clic ajoute un ensemble d\'enzymes qui fonctionnent ensemble. Vous pourrez ensuite ajuster chaque concentration ci-dessous.'),
        h('div', { class: 'kit-grid' }, KITS.map((k) => {
          const has = Object.keys(k.enzymes).every((id) => d.enzymes[id] !== undefined);
          return h('button', { class: `kit ${has ? 'on' : ''}`, title: Object.keys(k.enzymes).join(', '), onclick: () => {
            if (has) for (const id of Object.keys(k.enzymes)) delete d.enzymes[id];
            else for (const [id, c] of Object.entries(k.enzymes)) d.enzymes[id] = Math.max(d.enzymes[id] || 0, c);
            this.change(true);
          } }, h('b', {}, (has ? '✓ ' : '+ ') + k.name), h('span', { class: 'small muted' }, k.desc));
        })),
        h('div', { class: 'btn-row' }, h('span', { class: 'small muted' }, `${chosen.length} enzyme(s) choisie(s)`), chosen.length ? h('button', { class: 'btn small danger', onclick: () => { d.enzymes = {}; this.change(true); } }, 'Tout retirer') : null)),
      card('Enzymes une par une',
        intro('Plus une enzyme est concentrée, plus sa voie est rapide, mais plus elle coûte en volume, en biomasse à synthétiser et en ATP d\'entretien. Survolez une enzyme pour voir ses paramètres.'),
        search, listBox));
  }

  enzymeRow(e) {
    const d = this.design;
    const on = d.enzymes[e.id] !== undefined;
    const r = h('div', { class: `enz-row ${on ? 'on' : ''}`, title: `Km ${JSON.stringify(e.km)} · kcat ${e.kcat} · T° opt ${e.tOpt} °C · pH opt ${e.pHOpt}${e.location !== 'cytosol' ? ' · ' + e.location : ''}` },
      h('label', { class: 'enz-label' }, h('input', { type: 'checkbox', checked: on, onchange: (ev) => {
        if (ev.target.checked) { d.enzymes[e.id] = 1; if (e.custom) d.customEnzymes = [...(d.customEnzymes || []).filter((x) => x.id !== e.id), e]; }
        else delete d.enzymes[e.id];
        this.change(true);
      } }), h('span', {}, h('b', {}, e.name), e.location === 'secrete' ? h('small', { class: 'tag' }, 'sécrétée') : null, e.custom ? h('small', { class: 'tag custom' }, 'perso') : null,
        h('div', { class: 'small muted' }, e.description))));
    if (on) {
      const val = h('span', { class: 'val' }, fmt(d.enzymes[e.id], 2));
      r.append(h('div', { class: 'enz-slider' }, h('span', { class: 'small muted' }, 'concentration'), h('input', { type: 'range', min: 0.1, max: 5, step: 0.05, value: d.enzymes[e.id], oninput: (ev) => { d.enzymes[e.id] = +ev.target.value; val.textContent = fmt(+ev.target.value, 2); this.change(); } }), val));
    }
    return r;
  }

  step_test() {
    const a = this.analysis, ph = a.ph;
    return h('div', { class: 'stack' },
      card('Bilan de viabilité',
        h('div', { class: 'grid2' },
          h('div', { class: 'kv' },
            kv('Volume · surface', `${fmt(ph.V, 2)} µm³ · ${fmt(ph.SA, 1)} µm²`),
            kv('Rapport S/V', `${fmt(ph.sv, 2)} µm⁻¹ ${ph.sv > 2 ? '(échanges rapides)' : ph.sv < 0.8 ? '(échanges lents)' : ''}`),
            kv('Biomasse à construire (B₀)', `${fmt(ph.B0, 2)} u`),
            kv('Entretien', `${fmt(ph.upkeep, 3)} ATP/s`)),
          h('div', { class: 'kv' },
            kv('ATP de départ', `${fmt(a.founderAtp, 1)} → ${fmt(a.autonomy, 0)} s d'autonomie`),
            kv('Vitesse', ph.speed ? `${fmt(ph.speed, 0)} µm/s` : 'immobile'),
            kv('Protection prédation', `${Math.round(ph.predationProtect * 100)} %`),
            kv('Tolérance', `${fmt(ph.tOpt - C.tempTolLow, 0)}–${fmt(ph.tOpt + C.tempTolHigh, 0)} °C · pH ${fmt(ph.pHOpt - C.pHTol, 1)}–${fmt(ph.pHOpt + C.pHTol, 1)}`))),
        this.messages(a, true)),
      this.benchCard(),
      card('Lancement', this.launchBlock(true), this.savedList()));
  }

  messages(a, full) {
    const lim = full ? Infinity : 3;
    const out = [
      ...a.errors.slice(0, lim).map((e) => h('div', { class: 'msg error' }, '⛔ ', e)),
      ...a.warnings.slice(0, full ? Infinity : Math.max(0, lim - a.errors.length)).map((e) => h('div', { class: 'msg warn' }, '⚠️ ', e)),
    ];
    if (full) out.push(...a.info.map((e) => h('div', { class: 'msg info' }, 'ℹ️ ', e)));
    const hidden = a.errors.length + a.warnings.length - out.filter((x) => !x.classList.contains('info')).length;
    if (!full && hidden > 0) out.push(h('button', { class: 'btn small', onclick: () => this.goto('test') }, `+ ${hidden} autre(s) — voir le bilan`));
    if (!a.errors.length && !a.warnings.length) out.push(h('div', { class: 'msg ok' }, '✅ Aucune incohérence détectée.'));
    return out;
  }

  launchBlock(full) {
    const a = this.analysis;
    const cost = launchCost(this.design);
    const pts = this.ctx.progression.points;
    const canLaunch = !a.errors.length && pts >= cost;
    return h('div', {},
      h('div', { class: 'kv' }, kv('Coût du lancement', `${cost} pts (vous avez ${fmt(pts, 1)})`), full ? kv('Fondateurs', `${PARAMS.game.founders} individus`) : null),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn primary', disabled: !canLaunch, onclick: () => this.ctx.onLaunch(this.design, false) }, `🚀 Lancer`),
        h('button', { class: 'btn', disabled: !canLaunch, onclick: () => this.ctx.onLaunch(this.design, true) }, '📍 Choisir le lieu'),
        h('button', { class: 'btn', onclick: () => { this.ctx.progression.saveDesign(this.design); toast(`Conception « ${this.design.name} » enregistrée.`, 'ok'); if (this.step === 'test' || this.step === 'base') this.renderStep(); } }, '💾')),
      a.errors.length ? h('div', { class: 'small muted' }, 'Corrigez les erreurs pour pouvoir lancer.') : !canLaunch ? h('div', { class: 'small muted' }, 'Points insuffisants : laissez vos populations prospérer pour en gagner.') : null);
  }

  // ------------------------------------------------------------------ colonne latérale
  renderSide() {
    const a = this.analysis || this.analyze();
    const ph = a.ph;
    const volFrac = ph.volUsed / 0.85;
    clear(this.sideInfo).append(
      h('section', { class: 'card' },
        h('h3', {}, 'Viabilité'),
        h('div', { class: 'bar' }, h('span', { class: 'bar-label' }, 'Volume'), h('span', { class: 'bar-track' }, h('span', { class: 'bar-fill', style: { width: `${Math.min(1, volFrac) * 100}%`, background: volFrac > 1 ? '#e63946' : volFrac > 0.82 ? '#f8961e' : '#43aa8b' } })), h('span', { class: 'bar-val' }, `${Math.round(ph.volUsed * 100)} / 85 %`)),
        h('div', { class: 'kv' },
          kv('Biomasse à construire', `${fmt(ph.B0, 2)} u`),
          kv('Entretien', `${fmt(ph.upkeep, 3)} ATP/s`),
          kv('Autonomie au départ', `${fmt(a.autonomy, 0)} s`)),
        this.messages(a, false)),
      h('section', { class: 'card' }, h('h3', {}, 'Lancement'), this.launchBlock(false)));
    this.renderStepper();
  }

  savedList() {
    const list = this.ctx.progression.p.designs;
    if (!list.length) return null;
    return h('div', { class: 'saved' }, h('div', { class: 'small muted' }, 'Conceptions enregistrées :'),
      list.map((s) => h('div', { class: 'saved-row' },
        h('span', { class: 'swatch', style: { background: s.design.color } }), h('span', {}, s.name),
        h('button', { class: 'btn tiny', onclick: () => this.setDesign(s.design) }, 'Ouvrir'),
        h('button', { class: 'btn tiny danger', onclick: () => { this.ctx.progression.deleteDesign(s.id); this.renderStep(); } }, '✕'))));
  }

  benchCard() {
    const sel = h('select', {}, Object.entries(SCENARIOS).map(([k, s]) => h('option', { value: k, selected: this.bench?.key === k }, s.name)));
    const preySel = h('label', { class: 'small' }, h('input', { type: 'checkbox', checked: this.bench?.withPrey }), ' ajouter des proies (bactéries)');
    const out = h('div', {});
    const chart = h('canvas', { class: 'chart small' });
    const c = card('Banc d\'essai',
      intro('Fait vivre 4 fondateurs pendant 2 minutes simulées dans un milieu constant, avec le vrai moteur.'),
      h('div', { class: 'btn-row' }, sel, h('button', { class: 'btn primary', disabled: this.analysis.errors.length > 0, onclick: () => {
        out.textContent = 'Simulation en cours…';
        setTimeout(() => {
          const withPrey = preySel.querySelector('input').checked;
          const r = runBenchmark(this.design, { scenario: sel.value, prey: withPrey ? defaultDesign() : null });
          this.bench = { key: sel.value, withPrey, r };
          this.renderStep();
        }, 20);
      } }, '▶ Tester')), preySel, out, chart);
    if (this.bench) {
      const r = this.bench.r;
      out.append(h('div', { class: 'kv' },
        kv('Résultat', r.survived ? `✅ ${r.finalCount} cellules après ${r.seconds} s` : `☠️ éteinte à ${r.seconds} s`),
        kv('Temps de doublement', r.doublingTime ? `${fmt(r.doublingTime, 0)} s` : '—'),
        kv('Première division', r.firstDivision ? `${fmt(r.firstDivision, 0)} s` : 'aucune'),
        kv('Remplissage ATP moyen', `${Math.round(r.meanAtpFill * 100)} %`),
        kv('Morts', Object.entries(r.deathCauses).map(([k, v]) => `${k} ${v}`).join(', ') || 'aucune')));
      requestAnimationFrame(() => lineChart(chart, [
        { color: '#90be6d', points: r.trace.map((t) => [t.t, t.n]) },
        { color: '#f9c74f', points: r.trace.map((t) => [t.t, t.atp * 4]), dashed: true },
      ], { xFmt: (v) => `${Math.round(v)} s`, yLabel: 'effectif (vert) · ATP (jaune)' }));
    }
    return c;
  }

  // ------------------------------------------------------------------ aperçu
  previewTransform() {
    const geo = computeGeometry(this.design.shape);
    const W = this.canvas.width / (window.devicePixelRatio || 1), H = this.canvas.height / (window.devicePixelRatio || 1);
    let ex = 0, ey = 0;
    for (const [x, y] of geo.outline) { ex = Math.max(ex, Math.abs(x)); ey = Math.max(ey, Math.abs(y)); }
    const fl = this.design.envelope.motility === 'flagelle';
    const scale = Math.min((W / 2 - 12) / (ex + (fl ? 2.4 : 1.3)), (H / 2 - 12) / (ey + 1.3));
    return { geo, W, H, scale, cx: W / 2 + (fl ? scale * 0.8 : 0), cy: H / 2 };
  }

  drawPreview() {
    const cv = this.canvas;
    const rect = cv.getBoundingClientRect();
    if (!rect.width) return;
    const dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(rect.width * dpr) || cv.height !== Math.round(rect.height * dpr)) { cv.width = Math.round(rect.width * dpr); cv.height = Math.round(rect.height * dpr); }
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const t = this.previewTransform();
    const g = ctx.createRadialGradient(t.W / 2, t.H / 2, 10, t.W / 2, t.H / 2, t.W / 1.4);
    g.addColorStop(0, '#1d4a5e'); g.addColorStop(1, '#0c1d27');
    ctx.fillStyle = g; ctx.fillRect(0, 0, t.W, t.H);
    ctx.save(); ctx.translate(t.cx, t.cy);
    this.layout = layoutOrganelles(this.design, t.geo.outline);
    drawCellDetailed(ctx, { outline: t.geo.outline, design: this.design, scale: t.scale, color: this.design.color + 'cc', wall: this.design.envelope.wall, capsule: this.design.envelope.capsule, time: this.time, organelles: this.layout, highlight: this.drag?.org ? `${this.drag.org.id}:${this.drag.org.k}` : null });
    if (this.design.shape.kind === 'libre') {
      const [cx0, cy0] = t.geo.center, k = t.geo.k;
      for (const [x, y] of this.design.shape.points) {
        ctx.beginPath(); ctx.arc((x - cx0) * k * t.scale, (y - cy0) * k * t.scale, 5, 0, Math.PI * 2);
        ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = '#000'; ctx.stroke();
      }
    }
    ctx.restore();
    ctx.fillStyle = '#ddd'; ctx.fillRect(10, t.H - 14, t.scale, 3);
    ctx.font = '11px system-ui'; ctx.fillText(`${fmt(this.design.shape.size, 2)} µm`, 10, t.H - 20);
    const ph = this.analysis?.ph;
    if (ph) this.previewInfo.textContent = `${this.design.name} · V ${fmt(ph.V, 2)} µm³ · S/V ${fmt(ph.sv, 2)} µm⁻¹`;
  }

  tick(dt) { this.time += dt; if (this.design.envelope.motility !== 'aucune') this.drawPreview(); }

  bindCanvas() {
    const cv = this.canvas;
    const local = (e) => {
      const r = cv.getBoundingClientRect(), t = this.previewTransform();
      return { t, x: (e.clientX - r.left - t.cx) / t.scale, y: (e.clientY - r.top - t.cy) / t.scale };
    };
    cv.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (this.design.shape.kind !== 'libre') return;
      const { t, x, y } = local(e);
      const pts = this.design.shape.points;
      const i = this.nearestCtrl(t, x, y);
      if (i >= 0 && pts.length > 4) { pts.splice(i, 1); this.design.organellePositions = {}; this.change(); }
    });
    cv.addEventListener('dblclick', (e) => {
      if (this.design.shape.kind !== 'libre') return;
      const { t, x, y } = local(e);
      const [cx0, cy0] = t.geo.center, k = t.geo.k;
      const px = x / k + cx0, py = y / k + cy0;
      const pts = this.design.shape.points;
      let best = 0, bd = Infinity;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        const dd = Math.hypot(px - (a[0] + b[0]) / 2, py - (a[1] + b[1]) / 2);
        if (dd < bd) { bd = dd; best = i; }
      }
      if (pts.length < 16) { pts.splice(best + 1, 0, [px, py]); this.change(); }
    });
    cv.addEventListener('pointerdown', (e) => {
      const { t, x, y } = local(e);
      if (this.design.shape.kind === 'libre') {
        const i = this.nearestCtrl(t, x, y);
        if (i >= 0) { this.drag = { ctrl: i, t }; cv.setPointerCapture(e.pointerId); return; }
      }
      let best = null, bd = Infinity;
      for (const o of this.layout || []) { const dd = Math.hypot(o.x - x, o.y - y); if (dd < Math.max(o.r * 1.4, 0.12) && dd < bd) { bd = dd; best = o; } }
      if (best) {
        const d = this.design;
        if (!d.organellePositions[best.id] || d.organellePositions[best.id].length < d.organelles[best.id]) {
          d.organellePositions[best.id] = this.layout.filter((o) => o.id === best.id).map((o) => [o.x, o.y]);
        }
        this.drag = { org: best };
        cv.setPointerCapture(e.pointerId);
      }
    });
    cv.addEventListener('pointermove', (e) => {
      if (!this.drag) return;
      const { x, y } = local(e);
      if (this.drag.ctrl !== undefined) {
        const [cx0, cy0] = this.drag.t.geo.center, k = this.drag.t.geo.k;
        this.design.shape.points[this.drag.ctrl] = [x / k + cx0, y / k + cy0];
        this.design.organellePositions = {};
      } else if (this.drag.org) {
        const o = this.drag.org;
        this.design.organellePositions[o.id][o.k] = [+x.toFixed(3), +y.toFixed(3)];
      }
      this.drawPreview();
    });
    cv.addEventListener('pointerup', () => { if (this.drag) { this.drag = null; this.change(); } });
    new ResizeObserver(() => this.drawPreview()).observe(cv);
  }

  nearestCtrl(t, x, y) {
    const [cx0, cy0] = t.geo.center, k = t.geo.k;
    let best = -1, bd = 10 / t.scale;
    this.design.shape.points.forEach(([px, py], i) => { const dd = Math.hypot((px - cx0) * k - x, (py - cy0) * k - y); if (dd < bd) { bd = dd; best = i; } });
    return best;
  }

  /** Compatibilité avec main.js (après un enregistrement dans un atelier). */
  renderControls() { this.analyze(); this.renderStep(); this.renderSide(); }
  renderViability() { this.analyze(); this.renderSide(); if (this.step === 'test') this.renderStep(); }
}

function card(title, ...children) { return h('section', { class: 'card' }, h('h3', {}, title), ...children); }
function intro(text) { return h('p', { class: 'small muted intro' }, text); }
function row(label, input) { return h('label', { class: 'row' }, h('span', {}, label), input); }
function kv(k, v) { return h('div', { class: 'kv-row' }, h('span', { class: 'k' }, k), h('span', { class: 'v' }, v)); }
function choice(on, title, text, onclick) { return h('button', { class: `choice ${on ? 'on' : ''}`, onclick }, h('b', {}, (on ? '● ' : '○ ') + title), h('span', { class: 'small muted' }, text)); }
function toggleCard(on, title, text, fn) { return h('button', { class: `choice ${on ? 'on' : ''}`, onclick: () => fn(!on) }, h('b', {}, (on ? '☑ ' : '☐ ') + title), h('span', { class: 'small muted' }, text)); }
function slider(label, value, min, max, step, fn, show) {
  const val = h('span', { class: 'val' }, show(value));
  return h('label', { class: 'row slider' }, h('span', {}, label),
    h('input', { type: 'range', min, max, step, value, oninput: (e) => { const v = +e.target.value; val.textContent = show(v); fn(v); } }), val);
}
