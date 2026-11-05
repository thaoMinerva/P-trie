// Atelier d'enzymes (mode « briques ») : réaction, site actif, domaines, peptide signal, compromis cinétiques.
import { BRICKS, METABOLITES, MET } from '../data/index.js';
import { buildEnzyme, emptySpec, describe } from '../simulation/enzymeDesign.js';
import { ELEMENTS } from '../simulation/chem.js';
import { lineChart } from '../ui/charts.js';
import { h, clear, fmt, toast } from '../ui/dom.js';

const CHOICES = METABOLITES.filter((m) => !['biomass', 'phagosome'].includes(m.id));
const BRICK_COLORS = { site: '#e76f51', nad: '#577590', atp: '#f9c74f', antenne: '#52b788', thermo: '#f94144', psychro: '#4cc9f0', acido: '#f3722c', alcali: '#90be6d', disulfure: '#cdb4db', feedback: '#9b5de5', atp_haut: '#ffd166', atp_bas: '#ffb703', signal: '#adb5bd' };
const EL_NAMES = { C: 'Carbone', N: 'Azote', P: 'Phosphore', Nic: 'NAD (nicotinamide)' };

export class Workshop {
  constructor(root, ctx) {
    this.root = root; this.ctx = ctx; // { progression, onSaved() }
    this.spec = { ...emptySpec(), substrates: { pyruvate: 1, nadh: 1 }, products: { ethanol: 1, co2: 1, nad: 1 }, domains: ['nad'], name: 'Ma fermentation alcoolique' };
    this.editingId = null;
    this.build();
  }

  build() {
    clear(this.root);
    this.left = h('div', { class: 'ws-left' });
    this.right = h('div', { class: 'ws-right' });
    this.root.append(h('div', { class: 'workshop-grid' }, this.left, this.right));
    this.render();
  }

  render() {
    const s = this.spec;
    const res = buildEnzyme(s, this.editingId);
    this.result = res;
    clear(this.left).append(
      h('section', { class: 'card' },
        h('h3', {}, '1 · Réaction catalysée'),
        h('label', { class: 'row' }, h('span', {}, 'Nom'), h('input', { type: 'text', value: s.name, oninput: (e) => { s.name = e.target.value; this.renderRight(); } })),
        h('div', { class: 'reaction' }, this.sideEditor('substrates', 'Substrats'), h('div', { class: 'arrow' }, '→'), this.sideEditor('products', 'Produits')),
        h('p', { class: 'small muted' }, 'Les éléments (C, N, P, NAD) doivent être conservés et la réaction ne doit pas créer d\'énergie : l\'ATP et le NADH produits doivent être « payés » par la dégradation des substrats.')),
      h('section', { class: 'card' },
        h('h3', {}, '2 · Site actif'),
        h('div', { class: 'brick-grid' }, BRICKS.activeSites.map((b) => brick(b, s.activeSite === b.id, BRICK_COLORS.site, () => { s.activeSite = b.id; this.render(); }, `Km ×${b.kmMul} · kcat ×${b.kcatMul} · coût ×${b.costMul}`)))),
      h('section', { class: 'card' },
        h('h3', {}, `3 · Domaines (${s.domains.length}/${BRICKS.base.maxDomains})`),
        h('div', { class: 'brick-grid' }, BRICKS.domains.map((b) => brick(b, s.domains.includes(b.id), BRICK_COLORS[b.id] || '#888', () => {
          s.domains = s.domains.includes(b.id) ? s.domains.filter((x) => x !== b.id) : [...s.domains, b.id]; this.render();
        }, domainEffect(b))))),
      h('section', { class: 'card' },
        h('h3', {}, '4 · Peptide signal (adressage)'),
        h('div', { class: 'brick-grid' }, BRICKS.signals.map((b) => brick(b, s.signal === b.id, BRICK_COLORS.signal, () => { s.signal = b.id; this.render(); }, b.location)))),
      h('section', { class: 'card' },
        h('h3', {}, '5 · Compromis affinité ↔ vitesse'),
        h('label', { class: 'row slider' }, h('span', {}, 'Vitesse'), h('input', { type: 'range', min: -1, max: 1, step: 0.05, value: s.tradeoff, oninput: (e) => { s.tradeoff = +e.target.value; this.result = buildEnzyme(s, this.editingId); this.renderRight(); } }), h('span', {}, 'Affinité')),
        h('p', { class: 'small muted' }, 'Une enzyme ne peut pas être à la fois très affine (Km bas) et très rapide (kcat élevé) : déplacer le curseur échange l\'un contre l\'autre.')));
    this.renderRight();
  }

  sideEditor(side, title) {
    const s = this.spec;
    const box = h('div', { class: 'side' }, h('div', { class: 'small muted' }, title));
    for (const [m, n] of Object.entries(s[side])) {
      box.append(h('div', { class: 'side-row' },
        h('input', { type: 'number', min: 0.1, max: 20, step: 0.5, value: n, class: 'num', onchange: (e) => { s[side][m] = Math.max(0.1, +e.target.value || 1); this.render(); } }),
        h('span', { class: 'met', style: { borderColor: MET[m]?.color || '#666' } }, MET[m]?.name || m),
        h('button', { class: 'btn tiny', onclick: () => { delete s[side][m]; this.render(); } }, '✕')));
    }
    const sel = h('select', { onchange: (e) => { if (e.target.value) { s[side][e.target.value] = 1; this.render(); } } },
      h('option', { value: '' }, '+ ajouter…'),
      CHOICES.filter((m) => !(m.id in s[side]) && !(side === 'products' && m.id === 'light')).map((m) => h('option', { value: m.id }, `${m.name}${m.env ? '' : ' (interne)'}`)));
    box.append(sel);
    return box;
  }

  renderRight() {
    const res = this.result, d = res.def, an = res.analysis;
    const mm = h('canvas', { class: 'chart small' }), tc = h('canvas', { class: 'chart small' });
    const bricks = [{ label: 'Site', color: BRICK_COLORS.site }, ...this.spec.domains.map((id) => ({ label: BRICKS.domains.find((b) => b.id === id)?.name.split(' (')[0], color: BRICK_COLORS[id] })), { label: BRICKS.signals.find((b) => b.id === this.spec.signal)?.name.split(' (')[0], color: BRICK_COLORS.signal }];
    clear(this.right).append(
      h('section', { class: 'card' },
        h('h3', {}, 'Protéine assemblée'),
        h('div', { class: 'protein' }, h('span', { class: 'term' }, 'N'), bricks.map((b) => h('span', { class: 'pbrick', style: { background: b.color } }, b.label)), h('span', { class: 'term' }, 'C')),
        h('div', { class: 'eq' }, describe(d.substrates, d.products)),
        h('table', { class: 'table compact' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Bilan'), h('th', {}, 'Δ'), h('th', {}, ''))),
          h('tbody', {},
            ELEMENTS.map((el) => h('tr', {}, h('td', {}, EL_NAMES[el]), h('td', {}, fmt(an.elementDelta?.[el] || 0, 2)), h('td', {}, Math.abs(an.elementDelta?.[el] || 0) < 1e-6 ? '✅' : '⛔'))),
            h('tr', {}, h('td', {}, 'Énergie libre ΔG'), h('td', {}, `${fmt(an.deltaG, 2)} ATP-éq.`), h('td', {}, an.exergonic ? '✅' : '⛔')))),
        res.errors.map((e) => h('div', { class: 'msg error' }, '⛔ ', e)),
        res.warnings.map((e) => h('div', { class: 'msg warn' }, '⚠️ ', e)),
        res.ok ? h('div', { class: 'msg ok' }, '✅ Enzyme réalisable.') : null),
      h('section', { class: 'card' },
        h('h3', {}, 'Paramètres calculés'),
        h('div', { class: 'kv' },
          kv('Km', `${fmt(d.km._, 4)} u/µm³${d.location === 'secrete' ? ' (milieu)' : ''}`),
          kv('kcat (Vmax par unité)', `${fmt(d.kcat, 4)} u/s`),
          kv('T° optimale', `${fmt(d.tOpt, 0)} °C (± ${fmt(d.tWidth, 1)})`),
          kv('pH optimal', `${fmt(d.pHOpt, 1)} (± ${fmt(d.pHWidth, 1)})`),
          kv('Cofacteurs', d.cofactors.join(', ') || 'aucun'),
          kv('Inhibiteurs', Object.entries(d.inhibitors).map(([m, ki]) => `${MET[m]?.name} (Ki ${ki})`).join(', ') || 'aucun'),
          kv('Régulation', d.regulation === 'atpHigh' ? 'active si ATP abondant' : d.regulation === 'atpLow' ? 'active si ATP bas' : d.feedback ? 'rétro-inhibition' : 'aucune'),
          kv('Localisation', d.location),
          kv('Coût de synthèse', `${fmt(d.cost.synth, 3)} u biomasse /conc/µm³`),
          kv('Entretien', `${fmt(d.cost.upkeep * 1000, 2)} mATP/s /conc/µm³`),
          kv('Encombrement', `${fmt(d.cost.volume * 100, 1)} % du volume /conc`)),
        h('div', { class: 'small muted' }, 'Vitesse selon la concentration de substrat (Michaelis-Menten)'), mm,
        h('div', { class: 'small muted' }, 'Activité relative selon la température'), tc),
      h('section', { class: 'card' },
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn primary', disabled: !res.ok, onclick: () => this.save() }, this.editingId ? '💾 Mettre à jour' : '💾 Enregistrer dans ma bibliothèque'),
          this.editingId ? h('button', { class: 'btn', onclick: () => { this.editingId = null; this.render(); } }, 'Nouvelle enzyme') : null)),
      this.libraryCard());
    requestAnimationFrame(() => {
      const km = d.km._, pts = [];
      for (let i = 0; i <= 40; i++) { const S = (i / 40) * km * 10; pts.push([S, d.kcat * S / (km + S)]); }
      lineChart(mm, [{ color: '#f9c74f', points: pts }], { yMin: 0, xFmt: (v) => fmt(v, 3), markers: [{ x: km, color: '#888' }] });
      const tp = []; for (let T = 0; T <= 60; T += 1) tp.push([T, Math.exp(-(((T - d.tOpt) / d.tWidth) ** 2))]);
      lineChart(tc, [{ color: '#f94144', points: tp }], { yMin: 0, yMax: 1, xFmt: (v) => `${v} °C` });
    });
  }

  libraryCard() {
    const lib = this.ctx.progression.p.customEnzymes;
    return h('section', { class: 'card' }, h('h3', {}, `Ma bibliothèque (${lib.length})`),
      lib.length ? lib.map((e) => h('div', { class: 'saved-row' },
        h('span', {}, h('b', {}, e.def.name), h('div', { class: 'small muted' }, e.def.description)),
        h('button', { class: 'btn tiny', onclick: () => { this.spec = JSON.parse(JSON.stringify(e.spec)); this.editingId = e.def.id; this.render(); } }, 'Modifier'),
        h('button', { class: 'btn tiny danger', onclick: () => { this.ctx.progression.deleteEnzyme(e.def.id); this.render(); this.ctx.onSaved?.(); } }, '✕'))) : h('div', { class: 'small muted' }, 'Vos enzymes apparaîtront ici et dans l\'éditeur de cellule (catégorie « Enzymes personnalisées »).'));
  }

  save() {
    // nouvel identifiant à chaque enregistrement : les populations déjà lancées gardent leur version
    const res = buildEnzyme(this.spec, null);
    if (!res.ok) return;
    if (this.editingId) this.ctx.progression.deleteEnzyme(this.editingId);
    this.ctx.progression.saveEnzyme(res.def, JSON.parse(JSON.stringify(this.spec)));
    this.editingId = res.def.id;
    toast(`Enzyme « ${res.def.name} » enregistrée.`, 'ok');
    this.ctx.onSaved?.();
    this.render();
  }
}

function brick(b, on, color, onclick, sub) {
  return h('button', { class: `brick ${on ? 'on' : ''}`, style: { '--c': color }, title: b.description, onclick },
    h('span', { class: 'brick-name' }, b.name), h('span', { class: 'brick-sub' }, sub || ''));
}
function domainEffect(b) {
  const parts = [];
  if (b.provides) parts.push(`fournit ${b.provides}`);
  if (b.tOptShift) parts.push(`T° ${b.tOptShift > 0 ? '+' : ''}${b.tOptShift}`);
  if (b.pHShift) parts.push(`pH ${b.pHShift > 0 ? '+' : ''}${b.pHShift}`);
  if (b.kcatMul && b.kcatMul !== 1) parts.push(`kcat ×${b.kcatMul}`);
  if (b.tWidthMul && b.tWidthMul !== 1) parts.push(`tolérance ×${b.tWidthMul}`);
  if (b.regulation) parts.push('régulation');
  if (b.feedback) parts.push('rétro-inhibition');
  parts.push(`coût +${Math.round(b.costAdd * 100)} %`);
  return parts.join(' · ');
}
function kv(k, v) { return h('div', { class: 'kv-row' }, h('span', { class: 'k' }, k), h('span', { class: 'v' }, v)); }
