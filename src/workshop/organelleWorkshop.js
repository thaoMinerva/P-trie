// Atelier d'organites : enveloppe + taille + modules fonctionnels → organite personnalisé.
import { ORG_BRICKS, ORGANELLES } from '../data/index.js';
import { buildOrganelle, emptyOrganelleSpec, MODULE } from '../simulation/organelleDesign.js';
import { h, clear, fmt, toast } from '../ui/dom.js';
import { help } from '../ui/help.js';

const EFFECT_LABELS = {
  'capacities.mitochondrie': (v) => `capacité respiratoire +${fmt(v, 3)} (une mitochondrie : 0,12)`,
  'capacities.chloroplaste': (v) => `capacité photosynthétique +${fmt(v, 3)} (un chloroplaste : 0,12)`,
  membraneBoost: (v) => `surface membranaire +${Math.round(v * 100)} %`,
  storage: (v) => `stockage +${fmt(v, 2)} u/µm³`,
  hyperProtect: (v) => `protection hypertonique +${Math.round(v * 100)} %`,
  cheapVolume: (v) => `${Math.round(v * 100)} % du volume quasi gratuit en biomasse`,
  osmoregulation: (v) => `osmorégulation +${fmt(v, 2)} (vacuole contractile : 0,6)`,
  rosDetox: (v) => `détoxication des ROS +${fmt(v, 3)}/s`,
  digestion: (v) => `digestion ${fmt(v * 1000, 2)} mu/µm³/s`,
  secretion: (v) => `sécrétion +${Math.round(v * 100)} %`,
  proteinSynthesis: (v) => `synthèse protéique +${Math.round(v * 100)} %`,
};

export class OrganelleWorkshop {
  constructor(root, ctx) {
    this.root = root; this.ctx = ctx; // { progression, onSaved() }
    this.spec = { ...emptyOrganelleSpec(), name: 'Mitochondrie géante' };
    this.editingId = null;
    this.render();
  }

  render() {
    const s = this.spec;
    const res = buildOrganelle(s, this.editingId);
    const builtin = ORGANELLES.filter((o) => !o.custom && o.radius);
    clear(this.root).append(h('div', { class: 'workshop-grid' },
      h('div', { class: 'ws-left' },
        h('section', { class: 'card' },
          h('h3', {}, '1 · Identité ', help('organites')),
          h('label', { class: 'row' }, h('span', {}, 'Nom'), h('input', { type: 'text', value: s.name, oninput: (e) => { s.name = e.target.value; } , onchange: () => this.render() })),
          h('label', { class: 'row' }, h('span', {}, 'Couleur'), h('input', { type: 'color', value: s.color, oninput: (e) => { s.color = e.target.value; this.drawPreview(); } })),
          h('label', { class: 'row' }, h('span', {}, 'Partir de'), h('select', { onchange: (e) => { const o = builtin[+e.target.value]; if (o) { this.fromBuiltin(o); } } },
            h('option', { value: '' }, '— un organite existant —'), builtin.map((o, i) => h('option', { value: i }, o.name))))),
        h('section', { class: 'card' },
          h('h3', {}, '2 · Enveloppe ', help('endosymbiose')),
          h('div', { class: 'brick-grid' }, ORG_BRICKS.membranes.map((m) => h('button', { class: `brick ${s.membrane === m.id ? 'on' : ''}`, style: { '--c': '#48cae4' }, title: m.description, onclick: () => { s.membrane = m.id; this.render(); } },
            h('span', { class: 'brick-name' }, m.name), h('span', { class: 'brick-sub' }, `${m.types.length === 2 ? 'procaryotes et eucaryotes' : 'eucaryotes'} · masse ×${m.massMul}`))))),
        h('section', { class: 'card' },
          h('h3', {}, `3 · Modules fonctionnels (${s.modules.length}/${ORG_BRICKS.base.maxModules})`),
          h('p', { class: 'small muted' }, 'Chaque module donne une fonction proportionnelle à la taille de l\'organite. Certains exigent une enveloppe particulière.'),
          h('div', { class: 'brick-grid' }, ORG_BRICKS.modules.map((m) => {
            const allowed = m.membranes.includes(s.membrane);
            return h('button', { class: `brick ${s.modules.includes(m.id) ? 'on' : ''} ${allowed ? '' : 'off'}`, style: { '--c': '#f4a261' }, title: m.description, onclick: () => {
              s.modules = s.modules.includes(m.id) ? s.modules.filter((x) => x !== m.id) : [...s.modules, m.id]; this.render();
            } }, h('span', { class: 'brick-name' }, m.name), h('span', { class: 'brick-sub' }, allowed ? m.description : `⛔ nécessite : ${m.membranes.join(' / ')}`));
          }))),
        h('section', { class: 'card' },
          h('h3', {}, '4 · Taille et nombre'),
          slider('Taille (part du volume)', s.size, ORG_BRICKS.base.minSize, ORG_BRICKS.base.maxSize, 0.005, (v) => { s.size = v; this.renderRight(); }, (v) => `${fmt(v * 100, 1)} %`),
          slider('Nombre maximum par cellule', s.max, 1, ORG_BRICKS.base.maxCount, 1, (v) => { s.max = v; this.renderRight(); }, (v) => `${v}`),
          h('p', { class: 'small muted' }, 'Plus l\'organite est gros, plus il est efficace… mais plus il coûte en biomasse, en ATP d\'entretien et en place.'))),
      this.right = h('div', { class: 'ws-right' })));
    this.renderRight(res);
  }

  fromBuiltin(o) {
    const fx = o.effects;
    const mods = [];
    if (fx.compartment === 'mitochondrie') mods.push('respiration');
    if (fx.compartment === 'chloroplaste') mods.push('photosynthese');
    if (fx.membraneBoost) mods.push('membranes');
    if (fx.storage) mods.push('stockage');
    if (fx.osmoregulation) mods.push('osmo');
    if (fx.rosDetox) mods.push('detox');
    if (fx.digestion) mods.push('digestion');
    if (fx.secretion) mods.push('secretion');
    if (fx.proteinSynthesis && !fx.secretion) mods.push('traduction');
    const membrane = mods.some((m) => ['respiration', 'photosynthese'].includes(m)) ? 'double' : o.types.includes('procaryote') ? 'coque' : 'simple';
    this.spec = { name: `${o.name} (variante)`, color: o.color, membrane, size: Math.max(0.005, o.volume), modules: mods.slice(0, 3), max: o.max };
    this.editingId = null;
    this.render();
  }

  renderRight(res = buildOrganelle(this.spec, this.editingId)) {
    this.result = res;
    const d = res.def;
    this.canvas = h('canvas', { class: 'org-canvas' });
    const effects = [];
    for (const [k, v] of Object.entries(d.effects)) {
      if (k === 'capacities') for (const [c, x] of Object.entries(v)) effects.push(EFFECT_LABELS[`capacities.${c}`](x));
      else if (typeof v === 'number' && EFFECT_LABELS[k]) effects.push(EFFECT_LABELS[k](v));
      else if (v === true) effects.push(k === 'phagocytosis' ? 'permet la phagocytose (sans paroi)' : 'permet l\'autophagie');
    }
    clear(this.right).append(
      h('section', { class: 'card' },
        h('h3', {}, 'Aperçu'),
        this.canvas,
        h('div', { class: 'eq' }, d.description),
        h('div', { class: 'kv' },
          kv('Cellules compatibles', d.types.join(', ')),
          kv('Volume par unité', `${fmt(d.volume * 100, 1)} % de la cellule`),
          kv('Biomasse par unité', `${fmt(d.mass, 4)} u/µm³`),
          kv('Entretien par unité', `${fmt(d.upkeep * 1000, 2)} mATP/s/µm³`),
          kv('Maximum', `${d.max} par cellule`)),
        h('h4', {}, 'Effets (par unité)'),
        effects.length ? h('ul', { class: 'small effects' }, effects.map((e) => h('li', {}, e))) : h('div', { class: 'small muted' }, 'Aucun'),
        res.errors.map((e) => h('div', { class: 'msg error' }, '⛔ ', e)),
        res.warnings.map((e) => h('div', { class: 'msg warn' }, '⚠️ ', e)),
        res.ok ? h('div', { class: 'msg ok' }, '✅ Organite réalisable.') : null,
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn primary', disabled: !res.ok, onclick: () => this.save() }, this.editingId ? '💾 Mettre à jour' : '💾 Enregistrer dans ma bibliothèque'),
          this.editingId ? h('button', { class: 'btn', onclick: () => { this.editingId = null; this.render(); } }, 'Nouvel organite') : null)),
      this.libraryCard());
    requestAnimationFrame(() => this.drawPreview());
  }

  drawPreview() {
    const cv = this.canvas; if (!cv) return;
    const r = cv.getBoundingClientRect(); if (!r.width) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = r.width * dpr; cv.height = r.height * dpr;
    const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = r.width, H = r.height, R = Math.min(W, H) * 0.38;
    ctx.fillStyle = '#0c1d27'; ctx.fillRect(0, 0, W, H);
    // cellule de référence (eucaryote de 5 µm) et organite à l'échelle
    ctx.beginPath(); ctx.arc(W / 2, H / 2, R, 0, Math.PI * 2); ctx.fillStyle = 'rgba(78,168,222,0.25)'; ctx.fill(); ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.stroke();
    const d = this.result.def, rr = R * d.radius, mem = this.spec.membrane;
    ctx.beginPath(); ctx.ellipse(W / 2, H / 2, rr * 1.4, rr, 0.3, 0, Math.PI * 2);
    ctx.fillStyle = (this.spec.color || '#f4a261') + 'cc'; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = mem === 'coque' ? '#ddd' : 'rgba(0,0,0,0.5)';
    if (mem === 'coque') ctx.setLineDash([3, 3]);
    ctx.stroke(); ctx.setLineDash([]);
    if (mem === 'double') { ctx.beginPath(); ctx.ellipse(W / 2, H / 2, rr * 1.25, rr * 0.85, 0.3, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.stroke(); }
    ctx.fillStyle = '#9ab'; ctx.font = '11px system-ui'; ctx.fillText('échelle : dans une cellule eucaryote', 8, H - 8);
  }

  libraryCard() {
    const lib = this.ctx.progression.p.customOrganelles;
    return h('section', { class: 'card' }, h('h3', {}, `Mes organites (${lib.length})`),
      lib.length ? lib.map((e) => h('div', { class: 'saved-row' },
        h('span', { class: 'swatch', style: { background: e.def.color } }),
        h('span', {}, h('b', {}, e.def.name), h('div', { class: 'small muted' }, e.def.description)),
        h('button', { class: 'btn tiny', onclick: () => { this.spec = JSON.parse(JSON.stringify(e.spec)); this.editingId = e.def.id; this.render(); } }, 'Modifier'),
        h('button', { class: 'btn tiny danger', onclick: () => { this.ctx.progression.deleteOrganelle(e.def.id); this.render(); this.ctx.onSaved?.(); } }, '✕')))
        : h('div', { class: 'small muted' }, 'Vos organites apparaîtront dans l\'éditeur de cellule (étape « Organites »).'));
  }

  save() {
    const res = buildOrganelle(this.spec, null); // nouvel identifiant : les populations lancées gardent leur version
    if (!res.ok) return;
    if (this.editingId) this.ctx.progression.deleteOrganelle(this.editingId);
    this.ctx.progression.saveOrganelle(res.def, JSON.parse(JSON.stringify(this.spec)));
    this.editingId = res.def.id;
    toast(`Organite « ${res.def.name} » enregistré.`, 'ok');
    this.ctx.onSaved?.();
    this.render();
  }
}

function kv(k, v) { return h('div', { class: 'kv-row' }, h('span', { class: 'k' }, k), h('span', { class: 'v' }, v)); }
function slider(label, value, min, max, step, fn, show) {
  const val = h('span', { class: 'val' }, show(value));
  return h('label', { class: 'row slider' }, h('span', {}, label),
    h('input', { type: 'range', min, max, step, value, oninput: (e) => { const v = +e.target.value; val.textContent = show(v); fn(v); } }), val);
}
export { MODULE };
