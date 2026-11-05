// Fiche détaillée d'une cellule sélectionnée.
import { MET, ORG, ENVELOPE } from '../data/index.js';
import { MI, CAUSES, DMG_KEYS } from '../simulation/metabolism.js';
import { SHAPES } from '../simulation/geometry.js';
import { h, fmt } from './dom.js';

const PHASES = { G1: 'G1 (croissance)', S: 'S (réplication de l\'ADN)', G2: 'G2 (préparation)', M: 'M (mitose)', D: 'Scissiparité' };

function bar(label, frac, color, text) {
  const f = Math.max(0, Math.min(1, frac || 0));
  return h('div', { class: 'bar' }, h('span', { class: 'bar-label' }, label),
    h('span', { class: 'bar-track' }, h('span', { class: 'bar-fill', style: { width: `${f * 100}%`, background: color } })),
    h('span', { class: 'bar-val' }, text));
}

export function renderCellSheet(cell, world, actions = {}) {
  if (!cell || !cell.alive) return h('div', { class: 'muted' }, 'Cliquez sur une cellule pour afficher sa fiche.');
  const pop = world.populations.get(cell.popId);
  const g = cell.genome, ph = cell.ph, p = cell.pools, V = ph.V;
  const env = world.env, gi = env.idx(cell.x, cell.y);
  const conc = (id) => p[MI[id]] / V;
  const dmg = DMG_KEYS.map((k, i) => [k, cell.dmg[i]]).filter(([, v]) => v > 0.01).sort((a, b) => b[1] - a[1]);
  return h('div', { class: 'sheet' },
    h('div', { class: 'sheet-head' },
      h('span', { class: 'swatch', style: { background: pop.color } }),
      h('div', {}, h('strong', {}, pop.name), h('div', { class: 'muted small' }, `${pop.ownerName} · ${g.type} · génération ${cell.generation}`))),
    h('div', { class: 'sheet-actions' },
      h('button', { class: 'btn small', onclick: () => actions.follow?.(cell) }, '🎯 Suivre'),
      h('button', { class: 'btn small', onclick: () => actions.copy?.(cell) }, '🧬 Copier dans l\'éditeur')),
    h('h4', {}, 'Morphologie'),
    h('div', { class: 'kv' },
      kv('Forme', `${SHAPES[g.shape.kind]} · ${fmt(g.shape.size, 2)} µm`),
      kv('Volume / surface', `${fmt(V, 1)} µm³ · S/V ${fmt(ph.sv, 2)} µm⁻¹`),
      kv('Enveloppe', [g.envelope.wall > 0 ? `paroi ${ph.wallName || ''} ${fmt(g.envelope.wall, 2)}` : 'membrane seule', g.envelope.capsule ? 'capsule' : null, ENVELOPE.motility[g.envelope.motility].name + (g.envelope.motilityUnits > 1 ? ` ×${g.envelope.motilityUnits}` : ''), g.envelope.parasite ? 'suçoir' : null, g.envelope.adhesins ? 'adhésines' : null].filter(Boolean).join(', ')),
      kv('Organites', Object.entries(g.organelles).map(([id, n]) => `${ORG[id].name}${n > 1 ? ' ×' + n : ''}`).join(', ')),
      kv('Âge · phase', `${fmt(cell.age, 0)} s · ${PHASES[cell.phase] || cell.phase}`)),
    h('h4', {}, 'Enzymes (concentration)'),
    h('div', { class: 'chips' }, ph.enzymes.map((e) => h('span', { class: 'chip', title: e.def.description }, `${e.def.name.split(' (')[0]} `, h('b', {}, fmt(e.conc, 2))))),
    h('h4', {}, 'Stocks internes'),
    bar('ATP', p[MI.atp] / ph.atpCap, '#f9c74f', `${fmt(p[MI.atp], 2)} u`),
    bar('Biomasse', p[MI.biomass] / (2 * ph.B0), '#90be6d', `${fmt(p[MI.biomass] / ph.B0 * 100, 0)} % de B₀`),
    bar('NADH / NAD', p[MI.nadh] / (p[MI.nad] + p[MI.nadh]), '#577590', `${fmt(p[MI.nadh] / (p[MI.nad] + p[MI.nadh]) * 100, 0)} % réduit`),
    bar('Réserves', p[MI.reserve] / ph.storageCap, '#f8961e', `${fmt(p[MI.reserve], 2)} u`),
    bar('Glucose', conc('glucose') / 1, '#f2c14e', fmt(conc('glucose'), 3)),
    bar('Acides aminés', conc('aa') / 1, '#9b5de5', fmt(conc('aa'), 3)),
    bar('Pyruvate', conc('pyruvate') / 1, '#e5989b', fmt(conc('pyruvate'), 3)),
    p[MI.arn_cell] > 0.001 ? bar('ARN cellulaire', conc('arn_cell') / 0.1, '#fee440', fmt(conc('arn_cell'), 3)) : null,
    p[MI.adn_cell] > 0.001 ? bar('ADN de réparation', conc('adn_cell') / 0.05, '#f15bb5', fmt(conc('adn_cell'), 3)) : null,
    Object.keys(g.membraneProteins || {}).length ? h('div', { class: 'small muted' }, 'Protéines membranaires : ' + Object.entries(g.membraneProteins).map(([id, c]) => `${id.split(':').pop()} ${fmt(c, 2)}`).join(', ')) : null,
    p[MI.phagosome] > 0 ? bar('Proies digérées', p[MI.phagosome] / ph.B0, '#ef476f', fmt(p[MI.phagosome], 1)) : null,
    conc('toxin') > 0.0005 ? bar('Toxine', conc('toxin') / 0.01, '#d00000', fmt(conc('toxin'), 4)) : null,
    bar('Dommages', cell.damage, '#e63946', `${fmt(cell.damage * 100, 0)} %`),
    dmg.length ? h('div', { class: 'small muted' }, 'Stress : ' + dmg.map(([k, v]) => `${CAUSES[k] || k} (${fmt(v * 100, 0)} %)`).join(', ')) : null,
    h('h4', {}, 'Interactions'),
    h('div', { class: 'small' }, [
      cell.host ? '🩸 Fixée sur un hôte (parasitisme). ' : '',
      cell.parasites ? `⚠️ ${cell.parasites} parasite(s) fixé(s). ` : '',
      cell.partners.length ? `🤝 ${cell.partners.length} partenaire(s) symbiotique(s). ` : '',
      ph.phagocyte ? '🍽️ Phagocyte. ' : '',
    ].join('') || 'Aucune.'),
    h('h4', {}, 'Milieu local'),
    (() => {
      const L = cell.local || { T: env.temperature[gi], pH: env.pH[gi], light: env.lightAt(gi), salinity: env.salinity[gi],
        o2: env.fields[MET.o2.index][gi], glucose: env.fields[MET.glucose.index][gi], nh4: env.fields[MET.nh4.index][gi], protein: env.fields[MET.protein.index][gi] };
      return h('div', { class: 'kv' },
        kv('Température · pH', `${fmt(L.T, 1)} °C · pH ${fmt(L.pH, 2)}`),
        kv('Lumière · salinité', `${fmt(L.light * 100, 0)} % · ${fmt(L.salinity, 2)}`),
        kv('O₂ · glucose', `${fmt(L.o2, 2)} · ${fmt(L.glucose, 2)} u`),
        kv('NH₄⁺ · protéines', `${fmt(L.nh4, 2)} · ${fmt(L.protein, 2)} u`));
    })());
}

function kv(k, v) { return h('div', { class: 'kv-row' }, h('span', { class: 'k' }, k), h('span', { class: 'v' }, v)); }
