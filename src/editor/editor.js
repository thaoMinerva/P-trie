// Éditeur de cellule : forme, type, enveloppe, organites (placement visuel), enzymes, viabilité en direct.
import { ORGANELLES, ORG, ENVELOPE, ENZYMES, ARCHETYPES, PARAMS } from '../data/index.js';
import { SHAPES, computeGeometry } from '../simulation/geometry.js';
import { normalizeDesign, defaultDesign, computePhenotype } from '../simulation/genome.js';
import { EnzymeRegistry } from '../simulation/registry.js';
import { analyzeDesign } from '../simulation/analysis.js';
import { runBenchmark, SCENARIOS } from '../simulation/benchmark.js';
import { launchCost } from '../game/progression.js';
import { drawCellDetailed, layoutOrganelles } from '../ui/cellDraw.js';
import { lineChart } from '../ui/charts.js';
import { h, clear, fmt, toast } from '../ui/dom.js';

const C = PARAMS.cell;

export class Editor {
  constructor(root, ctx) {
    this.root = root;
    this.ctx = ctx; // { progression, onLaunch(design, manual) }
    this.design = normalizeDesign(defaultDesign());
    this.bench = null;
    this.drag = null;
    this.time = 0;
    this.build();
  }

  registry() {
    const r = new EnzymeRegistry();
    for (const e of this.ctx.progression.p.customEnzymes) { try { r.register(e.def); } catch { /* ignorée */ } }
    return r;
  }

  setDesign(d) { this.design = normalizeDesign(d); this.bench = null; this.build(); }

  change(structural = false) {
    this.design = normalizeDesign(this.design);
    this.bench = null;
    if (structural) this.renderControls();
    this.renderViability();
    this.drawPreview();
  }

  build() {
    clear(this.root);
    this.controls = h('div', { class: 'ed-controls' });
    this.canvas = h('canvas', { class: 'ed-canvas' });
    this.previewInfo = h('div', { class: 'small muted center' });
    this.viability = h('div', { class: 'ed-viability' });
    this.root.append(h('div', { class: 'editor-grid' },
      this.controls,
      h('div', { class: 'ed-preview card' },
        h('h3', {}, 'Aperçu de la cellule'),
        h('div', { class: 'small muted' }, 'Glissez les organites pour les placer. En forme libre : glissez les points de contrôle, double-cliquez pour en ajouter, clic droit pour en retirer.'),
        this.canvas, this.previewInfo),
      this.viability));
    this.bindCanvas();
    this.renderControls();
    this.renderViability();
    requestAnimationFrame(() => this.drawPreview());
  }

  // ------------------------------------------------------------------ contrôles
  renderControls() {
    const d = this.design, root = clear(this.controls);
    const euk = d.type === 'eucaryote';
    const [smin, smax] = euk ? [C.eukSizeMin, C.eukSizeMax] : [C.prokSizeMin, C.prokSizeMax];
    const templates = [
      { label: 'Bactérie par défaut', design: defaultDesign() },
      ...ARCHETYPES.map((a) => ({ label: `Modèle : ${a.names[0]} (${a.profile})`, design: { ...a.design, name: a.names[0], color: '#4ea8de' } })),
      ...this.ctx.progression.p.designs.map((s) => ({ label: `Sauvegarde : ${s.name}`, design: s.design })),
    ];
    root.append(
      section('Identité',
        row('Nom', h('input', { type: 'text', value: d.name, maxlength: 40, oninput: (e) => { d.name = e.target.value; this.change(); } })),
        row('Couleur', h('input', { type: 'color', value: d.color, oninput: (e) => { d.color = e.target.value; this.change(); } })),
        row('Partir de', h('select', { onchange: (e) => { const t = templates[+e.target.value]; if (t) this.setDesign(t.design); } },
          h('option', { value: '' }, '— choisir un modèle —'), templates.map((t, i) => h('option', { value: i }, t.label))))),
      section('Type cellulaire',
        h('div', { class: 'seg' }, ['procaryote', 'eucaryote'].map((t) => h('button', { class: `seg-btn ${d.type === t ? 'on' : ''}`, onclick: () => {
          if (d.type === t) return;
          d.type = t;
          d.shape.size = t === 'eucaryote' ? Math.max(3, d.shape.size * 3) : Math.min(1.2, d.shape.size / 3);
          d.organelles = t === 'eucaryote' ? { noyau: 1, ribosomes: 2, mitochondrie: 4, reticulum: 1, vacuole_contractile: 1 } : { nucleoide: 1, ribosomes: 2 };
          d.organellePositions = {};
          this.change(true);
        } }, t === 'procaryote' ? 'Procaryote' : 'Eucaryote'))),
        h('p', { class: 'small muted' }, euk ? 'Noyau et organites membranaires ; grande taille (2,5–10 µm), cycle G1-S-G2-M, phagocytose possible.' : 'Nucléoïde, pas d\'organites membranaires ; petite taille (0,4–2,5 µm), division rapide, enzymes respiratoires sur la membrane.')),
      section('Forme et taille',
        row('Forme', h('select', { onchange: (e) => {
          d.shape.kind = e.target.value;
          if (d.shape.kind === 'libre' && !d.shape.points) d.shape.points = [[1, 0], [0.6, 0.7], [-0.2, 0.9], [-0.9, 0.3], [-0.8, -0.5], [0.1, -0.8], [0.7, -0.6]];
          d.organellePositions = {};
          this.change(true);
        } }, Object.entries(SHAPES).map(([k, v]) => h('option', { value: k, selected: d.shape.kind === k }, v)))),
        slider('Taille (rayon équivalent)', d.shape.size, smin, smax, 0.05, (v) => { d.shape.size = v; this.change(); }, (v) => `${fmt(v, 2)} µm`),
        ['bacille', 'spirille', 'ovale'].includes(d.shape.kind) ? slider('Allongement', d.shape.aspect, 1, 6, 0.1, (v) => { d.shape.aspect = v; d.organellePositions = {}; this.change(); }, (v) => `×${fmt(v, 1)}`) : null),
      section('Enveloppe',
        slider('Épaisseur de paroi', d.envelope.wall, 0, 1, 0.01, (v) => { d.envelope.wall = v; this.change(); }, (v) => v ? fmt(v, 2) : 'aucune', ENVELOPE.wall.description),
        check('Capsule', d.envelope.capsule, (v) => { d.envelope.capsule = v; this.change(); }, ENVELOPE.capsule.description),
        row('Mobilité', h('select', { onchange: (e) => { d.envelope.motility = e.target.value; d.envelope.motilityUnits = 1; this.change(true); } },
          Object.entries(ENVELOPE.motility).filter(([, m]) => m.types.includes(d.type)).map(([k, m]) => h('option', { value: k, selected: d.envelope.motility === k, title: m.description || '' }, m.name)))),
        d.envelope.motility !== 'aucune' ? slider('Nombre / densité', d.envelope.motilityUnits, 1, ENVELOPE.motility[d.envelope.motility].maxUnits, 1, (v) => { d.envelope.motilityUnits = v; this.change(); }, (v) => `${v}`) : null,
        check('Suçoir (parasitisme)', d.envelope.parasite, (v) => { d.envelope.parasite = v; this.change(); }, ENVELOPE.parasite.description),
        check('Adhésines symbiotiques', d.envelope.adhesins, (v) => { d.envelope.adhesins = v; this.change(); }, ENVELOPE.adhesins.description)),
      section('Organites',
        ORGANELLES.filter((o) => o.types.includes(d.type)).map((o) => {
          const n = d.organelles[o.id] || 0, req = o.required?.includes(d.type);
          return h('div', { class: 'org-row', title: o.description },
            h('span', { class: 'swatch', style: { background: o.color } }),
            h('span', { class: 'org-name' }, o.name, h('small', { class: 'muted' }, ` vol ${Math.round(o.volume * 100)} % · ${fmt(o.upkeep * 1000, 1)} mATP/s/µm³`)),
            h('button', { class: 'btn tiny', disabled: n <= (req ? 1 : 0), onclick: () => { d.organelles[o.id] = n - 1; this.dropPositions(o.id); this.change(true); } }, '−'),
            h('b', { class: 'org-n' }, n),
            h('button', { class: 'btn tiny', disabled: n >= o.max, onclick: () => { d.organelles[o.id] = n + 1; this.change(true); } }, '+'));
        })),
      this.enzymeSection());
  }

  dropPositions(id) { if (this.design.organellePositions[id]) this.design.organellePositions[id].length = Math.min(this.design.organellePositions[id].length, this.design.organelles[id] || 0); }

  enzymeSection() {
    const d = this.design;
    const custom = this.ctx.progression.p.customEnzymes.map((e) => e.def);
    const cats = new Map();
    for (const e of [...ENZYMES, ...custom]) { if (!cats.has(e.category)) cats.set(e.category, []); cats.get(e.category).push(e); }
    const sec = section('Enzymes', h('p', { class: 'small muted' }, 'Cochez une enzyme puis réglez sa concentration : plus elle est concentrée, plus la voie est rapide, mais plus elle coûte en volume, en biomasse à synthétiser et en ATP d\'entretien.'));
    for (const [cat, list] of cats) {
      sec.append(h('div', { class: 'enz-cat' }, cat));
      for (const e of list) {
        const on = d.enzymes[e.id] !== undefined;
        const r = h('div', { class: `enz-row ${on ? 'on' : ''}`, title: `${e.description}\nKm ${JSON.stringify(e.km)} · kcat ${e.kcat} · T° opt ${e.tOpt} °C · pH opt ${e.pHOpt}${e.location !== 'cytosol' ? ' · ' + e.location : ''}` },
          h('label', {}, h('input', { type: 'checkbox', checked: on, onchange: (ev) => {
            if (ev.target.checked) { d.enzymes[e.id] = 1; if (e.custom) d.customEnzymes = [...(d.customEnzymes || []).filter((x) => x.id !== e.id), e]; }
            else delete d.enzymes[e.id];
            this.change(true);
          } }), ' ', e.name, e.location === 'secrete' ? h('small', { class: 'tag' }, 'sécrétée') : null, e.custom ? h('small', { class: 'tag custom' }, 'perso') : null));
        if (on) {
          const val = h('span', { class: 'val' }, fmt(d.enzymes[e.id], 2));
          r.append(h('div', { class: 'enz-slider' }, h('input', { type: 'range', min: 0.1, max: 5, step: 0.05, value: d.enzymes[e.id], oninput: (ev) => { d.enzymes[e.id] = +ev.target.value; val.textContent = fmt(+ev.target.value, 2); this.change(); } }), val));
        }
        sec.append(r);
      }
    }
    return sec;
  }

  // ------------------------------------------------------------------ viabilité
  renderViability() {
    const root = clear(this.viability);
    const reg = this.registry();
    const a = analyzeDesign(this.design, reg);
    this.analysis = a;
    const ph = a.ph;
    const cost = launchCost(this.design);
    const pts = this.ctx.progression.points;
    const canLaunch = !a.errors.length && pts >= cost;
    const volFrac = ph.volUsed / 0.85;
    root.append(
      h('section', { class: 'card' },
        h('h3', {}, 'Viabilité'),
        h('div', { class: 'bar' }, h('span', { class: 'bar-label' }, 'Volume'), h('span', { class: 'bar-track' }, h('span', { class: 'bar-fill', style: { width: `${Math.min(1, volFrac) * 100}%`, background: volFrac > 1 ? '#e63946' : volFrac > 0.82 ? '#f8961e' : '#43aa8b' } })), h('span', { class: 'bar-val' }, `${Math.round(ph.volUsed * 100)} / 85 %`)),
        h('div', { class: 'kv' },
          kv('Volume · surface', `${fmt(ph.V, 2)} µm³ · ${fmt(ph.SA, 1)} µm²`),
          kv('Rapport S/V', `${fmt(ph.sv, 2)} µm⁻¹ ${ph.sv > 2 ? '(échanges rapides)' : ph.sv < 0.8 ? '(échanges lents)' : ''}`),
          kv('Biomasse à construire (B₀)', `${fmt(ph.B0, 2)} u`),
          kv('Entretien', `${fmt(ph.upkeep, 3)} ATP/s`),
          kv('ATP de départ', `${fmt(a.founderAtp, 1)} → ${fmt(a.autonomy, 0)} s d'autonomie`),
          kv('Vitesse', ph.speed ? `${fmt(ph.speed, 0)} µm/s` : 'immobile'),
          kv('Protection prédation', `${Math.round(ph.predationProtect * 100)} %`),
          kv('Tolérance', `${fmt(ph.tOpt - C.tempTolLow, 0)}–${fmt(ph.tOpt + C.tempTolHigh, 0)} °C · pH ${fmt(ph.pHOpt - C.pHTol, 1)}–${fmt(ph.pHOpt + C.pHTol, 1)}`)),
        a.errors.map((e) => h('div', { class: 'msg error' }, '⛔ ', e)),
        a.warnings.map((e) => h('div', { class: 'msg warn' }, '⚠️ ', e)),
        a.info.map((e) => h('div', { class: 'msg info' }, 'ℹ️ ', e)),
        !a.errors.length && !a.warnings.length ? h('div', { class: 'msg ok' }, '✅ Aucune incohérence détectée. Testez-la au banc d\'essai !') : null),
      this.benchCard(),
      h('section', { class: 'card' },
        h('h3', {}, 'Lancement'),
        h('div', { class: 'kv' }, kv('Coût', `${cost} points`), kv('Vos points', fmt(pts, 1)), kv('Fondateurs', `${PARAMS.game.founders} individus`)),
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn primary', disabled: !canLaunch, onclick: () => this.ctx.onLaunch(this.design, false) }, `🚀 Lancer (${cost} pts)`),
          h('button', { class: 'btn', disabled: !canLaunch, onclick: () => this.ctx.onLaunch(this.design, true) }, '📍 Choisir le lieu')),
        !canLaunch && !a.errors.length ? h('div', { class: 'small muted' }, 'Points insuffisants : laissez vos populations prospérer pour en gagner.') : null,
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn', onclick: () => { this.ctx.progression.saveDesign(this.design); toast(`Conception « ${this.design.name} » enregistrée.`, 'ok'); this.renderControls(); } }, '💾 Enregistrer la conception')),
        this.savedList()));
  }

  savedList() {
    const list = this.ctx.progression.p.designs;
    if (!list.length) return null;
    return h('div', { class: 'saved' }, h('div', { class: 'small muted' }, 'Conceptions enregistrées :'),
      list.map((s) => h('div', { class: 'saved-row' },
        h('span', { class: 'swatch', style: { background: s.design.color } }), h('span', {}, s.name),
        h('button', { class: 'btn tiny', onclick: () => this.setDesign(s.design) }, 'Ouvrir'),
        h('button', { class: 'btn tiny danger', onclick: () => { this.ctx.progression.deleteDesign(s.id); this.renderViability(); this.renderControls(); } }, '✕'))));
  }

  benchCard() {
    const sel = h('select', {}, Object.entries(SCENARIOS).map(([k, s]) => h('option', { value: k, selected: this.bench?.key === k }, s.name)));
    const preySel = h('label', { class: 'small' }, h('input', { type: 'checkbox', checked: this.bench?.withPrey }), ' ajouter des proies (bactéries)');
    const out = h('div', {});
    const chart = h('canvas', { class: 'chart small' });
    const card = h('section', { class: 'card' }, h('h3', {}, 'Banc d\'essai'),
      h('p', { class: 'small muted' }, 'Fait vivre 4 fondateurs pendant 2 minutes simulées dans un milieu constant, avec le vrai moteur.'),
      h('div', { class: 'btn-row' }, sel, h('button', { class: 'btn', disabled: this.analysis.errors.length > 0, onclick: () => {
        out.textContent = 'Simulation en cours…';
        setTimeout(() => {
          const withPrey = preySel.querySelector('input').checked;
          const r = runBenchmark(this.design, { scenario: sel.value, prey: withPrey ? defaultDesign() : null });
          this.bench = { key: sel.value, withPrey, r };
          this.renderViability();
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
    return card;
  }

  // ------------------------------------------------------------------ aperçu
  previewTransform() {
    const geo = computeGeometry(this.design.shape);
    const W = this.canvas.width / (window.devicePixelRatio || 1), H = this.canvas.height / (window.devicePixelRatio || 1);
    let ex = 0, ey = 0;
    for (const [x, y] of geo.outline) { ex = Math.max(ex, Math.abs(x)); ey = Math.max(ey, Math.abs(y)); }
    const extra = this.design.envelope.motility === 'flagelle' ? 2.4 : 1.3;
    const scale = Math.min((W / 2 - 20) / (ex + extra), (H / 2 - 20) / (ey + 1.3));
    return { geo, W, H, scale, cx: W / 2 + (this.design.envelope.motility === 'flagelle' ? scale * 0.8 : 0), cy: H / 2 };
  }

  drawPreview() {
    const cv = this.canvas;
    const rect = cv.getBoundingClientRect();
    if (!rect.width) return;
    const dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(rect.width * dpr)) { cv.width = Math.round(rect.width * dpr); cv.height = Math.round(rect.height * dpr); }
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const t = this.previewTransform();
    ctx.clearRect(0, 0, t.W, t.H);
    const g = ctx.createRadialGradient(t.W / 2, t.H / 2, 10, t.W / 2, t.H / 2, t.W / 1.4);
    g.addColorStop(0, '#1d4a5e'); g.addColorStop(1, '#0c1d27');
    ctx.fillStyle = g; ctx.fillRect(0, 0, t.W, t.H);
    ctx.save(); ctx.translate(t.cx, t.cy);
    this.layout = layoutOrganelles(this.design, t.geo.outline);
    drawCellDetailed(ctx, { outline: t.geo.outline, design: this.design, scale: t.scale, color: this.design.color + 'cc', wall: this.design.envelope.wall, capsule: this.design.envelope.capsule, time: this.time, organelles: this.layout, highlight: this.drag?.org ? `${this.drag.org.id}:${this.drag.org.k}` : null });
    if (this.design.shape.kind === 'libre') {
      const [cx0, cy0] = t.geo.center, k = t.geo.k;
      for (const [x, y] of this.design.shape.points) {
        ctx.beginPath(); ctx.arc((x - cx0) * k * t.scale, (y - cy0) * k * t.scale, 6, 0, Math.PI * 2);
        ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = '#000'; ctx.stroke();
      }
    }
    ctx.restore();
    // barre d'échelle
    const um = this.design.shape.size;
    ctx.fillStyle = '#ddd'; ctx.fillRect(16, t.H - 20, t.scale, 3);
    ctx.font = '11px system-ui'; ctx.fillText(`${fmt(um, 2)} µm`, 16, t.H - 26);
    const ph = this.analysis?.ph;
    if (ph) this.previewInfo.textContent = `V = ${fmt(ph.V, 2)} µm³ · S = ${fmt(ph.SA, 1)} µm² · S/V = ${fmt(ph.sv, 2)} µm⁻¹ · B₀ = ${fmt(ph.B0, 2)} u`;
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
      // insertion entre les deux points les plus proches consécutifs
      let best = 0, bd = Infinity;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        const d = Math.hypot(px - (a[0] + b[0]) / 2, py - (a[1] + b[1]) / 2);
        if (d < bd) { bd = d; best = i; }
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
      for (const o of this.layout || []) { const d = Math.hypot(o.x - x, o.y - y); if (d < Math.max(o.r * 1.4, 0.12) && d < bd) { bd = d; best = o; } }
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
      const { t, x, y } = local(e);
      if (this.drag.ctrl !== undefined) {
        const [cx0, cy0] = this.drag.t.geo.center, k = this.drag.t.geo.k;
        this.design.shape.points[this.drag.ctrl] = [x / k + cx0, y / k + cy0];
        this.design.organellePositions = {};
        this.drawPreview();
      } else if (this.drag.org) {
        const o = this.drag.org;
        this.design.organellePositions[o.id][o.k] = [+x.toFixed(3), +y.toFixed(3)];
        this.drawPreview();
      }
    });
    cv.addEventListener('pointerup', () => { if (this.drag) { this.drag = null; this.change(); } });
    new ResizeObserver(() => this.drawPreview()).observe(cv);
  }

  nearestCtrl(t, x, y) {
    const [cx0, cy0] = t.geo.center, k = t.geo.k;
    let best = -1, bd = 10 / t.scale;
    this.design.shape.points.forEach(([px, py], i) => { const d = Math.hypot((px - cx0) * k - x, (py - cy0) * k - y); if (d < bd) { bd = d; best = i; } });
    return best;
  }
}

function section(title, ...children) { return h('details', { class: 'card ed-section', open: true }, h('summary', {}, title), ...children); }
function row(label, input) { return h('label', { class: 'row' }, h('span', {}, label), input); }
function kv(k, v) { return h('div', { class: 'kv-row' }, h('span', { class: 'k' }, k), h('span', { class: 'v' }, v)); }
function check(label, value, fn, title = '') { return h('label', { class: 'row check', title }, h('input', { type: 'checkbox', checked: value, onchange: (e) => fn(e.target.checked) }), h('span', {}, label)); }
function slider(label, value, min, max, step, fn, show, title = '') {
  const val = h('span', { class: 'val' }, show(value));
  return h('label', { class: 'row slider', title }, h('span', {}, label),
    h('input', { type: 'range', min, max, step, value, oninput: (e) => { const v = +e.target.value; val.textContent = show(v); fn(v); } }), val);
}
export { computePhenotype };
