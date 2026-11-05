// Atelier d'enveloppe : parois sur mesure (matériau + modifications) et protéines membranaires.
import { WALL_DATA, MPROT_WORKSHOP, METABOLITES, MET } from '../data/index.js';
import { buildWall, emptyWallSpec, buildMembraneProtein, emptyProteinSpec } from '../simulation/envelopeDesign.js';
import { h, clear, toast } from '../ui/dom.js';
import { help } from '../ui/help.js';

const pct = (v) => `${Math.round(v * 100)} %`;

export class EnvelopeWorkshop {
  constructor(root, ctx) {
    this.root = root; this.ctx = ctx; // { progression, onSaved() }
    this.wall = { ...emptyWallSpec(), name: 'Paroi blindée' };
    this.prot = { ...emptyProteinSpec(), mechanism: 'abc_in', met: 'phosphate', autoName: true };
    this.autoNameProt();
    this.wallEditing = null; this.protEditing = null;
    this.render();
  }

  render() {
    clear(this.root).append(h('div', { class: 'page' },
      h('p', { class: 'small muted' }, 'Les parois et protéines créées ici apparaissent dans l\'éditeur de cellule, à l\'étape « Enveloppe ».'),
      h('div', { class: 'workshop-grid' }, this.wallBuilder(), this.wallResult()),
      h('div', { class: 'workshop-grid' }, this.protBuilder(), this.protResult())));
  }

  // ------------------------------------------------------------------ parois
  wallBuilder() {
    const s = this.wall;
    return h('div', { class: 'ws-left' },
      h('section', { class: 'card' },
        h('h3', {}, '🧱 Paroi · 1 · Matériau de base ', help('paroi')),
        h('label', { class: 'row' }, h('span', {}, 'Nom'), h('input', { type: 'text', value: s.name, oninput: (e) => { s.name = e.target.value; }, onchange: () => this.render() })),
        h('label', { class: 'row' }, h('span', {}, 'Couleur'), h('input', { type: 'color', value: s.color, oninput: (e) => { s.color = e.target.value; } })),
        h('div', { class: 'brick-grid' }, WALL_DATA.materials.map((m) => h('button', { class: `brick ${s.base === m.id ? 'on' : ''}`, style: { '--c': m.color }, title: m.description, onclick: () => { s.base = m.id; s.color = m.color; this.render(); } },
          h('span', { class: 'brick-name' }, m.name), h('span', { class: 'brick-sub' }, `${m.types.join(' / ')} · prédation ${pct(m.predation)} · osmose ${pct(m.osmo)}${m.lytic ? '' : ' · insensible à la lyse'}`))))),
      h('section', { class: 'card' },
        h('h3', {}, `🧱 Paroi · 2 · Modifications (${s.modifications.length}/3) `, help('lysozyme')),
        h('div', { class: 'brick-grid' }, WALL_DATA.modifications.map((m) => h('button', { class: `brick ${s.modifications.includes(m.id) ? 'on' : ''}`, style: { '--c': '#cdb4db' }, title: m.description, onclick: () => {
          s.modifications = s.modifications.includes(m.id) ? s.modifications.filter((x) => x !== m.id) : [...s.modifications, m.id]; this.render();
        } }, h('span', { class: 'brick-name' }, m.name), h('span', { class: 'brick-sub' }, m.description + (m.types ? ` (${m.types.join(', ')})` : '')))))));
  }

  wallResult() {
    const res = buildWall(this.wall, this.wallEditing), d = res.def;
    const lib = this.ctx.progression.p.customWalls;
    return h('div', { class: 'ws-right' },
      h('section', { class: 'card' },
        h('h3', {}, 'Propriétés de la paroi'),
        h('div', { class: 'eq' }, d.description),
        h('div', { class: 'kv' },
          kv('Cellules compatibles', d.types.join(', ') || 'aucune'),
          kv('Protection contre la prédation', pct(d.predation)),
          kv(['Protection osmotique ', help('osmose')], pct(d.osmo)),
          kv('Barrière aux toxines', pct(d.toxin)),
          kv('Ralentissement des échanges', `×${d.exchangePenalty} par unité d'épaisseur`),
          kv('Biomasse', `${d.mass} u/µm² par unité d'épaisseur`),
          kv('Enzymes lytiques', d.lytic ? `sensible (${d.lytic})` : 'insensible'),
          d.rosProtect ? kv('Stress oxydatif', `−${pct(d.rosProtect)}`) : null),
        h('p', { class: 'small muted' }, 'Les valeurs de protection sont atteintes à épaisseur 1 ; l\'épaisseur se règle dans l\'éditeur.'),
        res.errors.map((e) => h('div', { class: 'msg error' }, '⛔ ', e)),
        res.warnings.map((e) => h('div', { class: 'msg warn' }, '⚠️ ', e)),
        res.ok ? h('div', { class: 'msg ok' }, '✅ Paroi réalisable.') : null,
        h('div', { class: 'btn-row' }, h('button', { class: 'btn primary', disabled: !res.ok, onclick: () => this.saveWall() }, this.wallEditing ? '💾 Mettre à jour' : '💾 Enregistrer la paroi'),
          this.wallEditing ? h('button', { class: 'btn', onclick: () => { this.wallEditing = null; this.render(); } }, 'Nouvelle paroi') : null)),
      library('Mes parois', lib, (e) => { this.wall = JSON.parse(JSON.stringify(e.spec)); this.wallEditing = e.def.id; this.render(); }, (e) => { this.ctx.progression.deleteWall(e.def.id); this.render(); this.ctx.onSaved?.(); }));
  }

  saveWall() {
    const res = buildWall(this.wall, null);
    if (!res.ok) return;
    if (this.wallEditing) this.ctx.progression.deleteWall(this.wallEditing);
    this.ctx.progression.saveWall(res.def, JSON.parse(JSON.stringify(this.wall)));
    this.wallEditing = res.def.id;
    toast(`Paroi « ${res.def.name} » enregistrée.`, 'ok');
    this.ctx.onSaved?.(); this.render();
  }

  // ------------------------------------------------------------------ protéines membranaires
  autoNameProt() {
    const s = this.prot;
    if (!s.autoName) return;
    const short = { uniport: 'Canal', symport: 'Symporteur', abc_in: 'Importeur ABC', abc_out: 'Pompe d\'efflux' }[s.mechanism] || 'Transporteur';
    s.name = `${short} · ${MET[s.met]?.name || ''}`;
  }

  protBuilder() {
    const s = this.prot;
    const mets = METABOLITES.filter((m) => m.env);
    return h('div', { class: 'ws-left' },
      h('section', { class: 'card' },
        h('h3', {}, '🔌 Protéine membranaire · 1 · Mécanisme ', help('transporteurs')),
        h('label', { class: 'row' }, h('span', {}, 'Nom'), h('input', { type: 'text', value: s.name, oninput: (e) => { s.name = e.target.value; s.autoName = false; }, onchange: () => this.render() })),
        h('div', { class: 'brick-grid' }, MPROT_WORKSHOP.mechanisms.map((m) => h('button', { class: `brick ${s.mechanism === m.id ? 'on' : ''}`, style: { '--c': m.kind === 'efflux' ? '#e63946' : '#4cc9f0' }, title: m.description, onclick: () => { s.mechanism = m.id; this.autoNameProt(); this.render(); } },
          h('span', { class: 'brick-name' }, m.name), h('span', { class: 'brick-sub' }, m.description))))),
      h('section', { class: 'card' },
        h('h3', {}, '🔌 Protéine membranaire · 2 · Molécule transportée ', help('diffusion')),
        h('div', { class: 'brick-grid' }, mets.map((m) => h('button', { class: `brick ${s.met === m.id ? 'on' : ''} ${m.transport === 'aucun' ? 'off' : ''}`, style: { '--c': m.color || '#888' }, onclick: () => { s.met = m.id; this.autoNameProt(); this.render(); } },
          h('span', { class: 'brick-name' }, m.name), h('span', { class: 'brick-sub' }, m.transport === 'aucun' ? 'polymère : ne traverse pas' : m.transport === 'actif' ? 'normalement pompé' : 'diffuse librement'))))));
  }

  protResult() {
    const res = buildMembraneProtein(this.prot, this.protEditing), d = res.def;
    const lib = this.ctx.progression.p.customProteins;
    return h('div', { class: 'ws-right' },
      h('section', { class: 'card' },
        h('h3', {}, 'Propriétés de la protéine'),
        h('div', { class: 'eq' }, d.description),
        h('div', { class: 'kv' },
          kv('Type', d.kind === 'efflux' ? 'pompe d\'efflux (expulse)' : 'transporteur (importe / échange)'),
          kv('Molécule', MET[d.met]?.name || '?'),
          d.kind === 'efflux' ? kv('Débit', `${d.rate} par unité · 1 ATP par molécule`) : kv('Perméabilité', `+${Math.round(d.permAdd * 100)} % par unité de densité`),
          kv('Surface occupée', `${Math.round(d.area * 100)} % de la membrane par unité`),
          kv('Coût de synthèse', `${d.cost.synth} u/µm³ par unité`),
          kv('Entretien', `${(d.cost.upkeep * 1000).toFixed(2)} mATP/s/µm³ par unité`)),
        res.errors.map((e) => h('div', { class: 'msg error' }, '⛔ ', e)),
        res.warnings.map((e) => h('div', { class: 'msg warn' }, '⚠️ ', e)),
        res.ok ? h('div', { class: 'msg ok' }, '✅ Protéine réalisable.') : null,
        h('div', { class: 'btn-row' }, h('button', { class: 'btn primary', disabled: !res.ok, onclick: () => this.saveProt() }, this.protEditing ? '💾 Mettre à jour' : '💾 Enregistrer la protéine'),
          this.protEditing ? h('button', { class: 'btn', onclick: () => { this.protEditing = null; this.render(); } }, 'Nouvelle protéine') : null)),
      library('Mes protéines membranaires', lib, (e) => { this.prot = JSON.parse(JSON.stringify(e.spec)); this.protEditing = e.def.id; this.render(); }, (e) => { this.ctx.progression.deleteProtein(e.def.id); this.render(); this.ctx.onSaved?.(); }));
  }

  saveProt() {
    const res = buildMembraneProtein(this.prot, null);
    if (!res.ok) return;
    if (this.protEditing) this.ctx.progression.deleteProtein(this.protEditing);
    this.ctx.progression.saveProtein(res.def, JSON.parse(JSON.stringify(this.prot)));
    this.protEditing = res.def.id;
    toast(`Protéine « ${res.def.name} » enregistrée.`, 'ok');
    this.ctx.onSaved?.(); this.render();
  }

  renderRight() { this.render(); }
}

function library(title, lib, onEdit, onDelete) {
  return h('section', { class: 'card' }, h('h3', {}, `${title} (${lib.length})`),
    lib.length ? lib.map((e) => h('div', { class: 'saved-row' },
      h('span', {}, h('b', {}, e.def.name), h('div', { class: 'small muted' }, e.def.description)),
      h('button', { class: 'btn tiny', onclick: () => onEdit(e) }, 'Modifier'),
      h('button', { class: 'btn tiny danger', onclick: () => onDelete(e) }, '✕'))) : h('div', { class: 'small muted' }, 'Rien pour le moment.'));
}
function kv(k, v) { return h('div', { class: 'kv-row' }, h('span', { class: 'k' }, k), h('span', { class: 'v' }, v)); }
