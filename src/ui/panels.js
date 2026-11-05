// Panneaux : populations, progression, archives, journal.
import { h, fmt, fmtTime, clear } from './dom.js';
import { lineChart } from './charts.js';
import { CAUSES } from '../simulation/metabolism.js';
import { RES_LABELS } from '../simulation/population.js';
import { PARAMS } from '../data/index.js';

const resName = (r) => (r === 'light' ? 'lumière' : RES_LABELS[r] || r);

export function popSeries(world, filter = () => true, highlight = null) {
  return [...world.populations.values()].filter(filter).map((p) => ({
    label: p.name, color: p.color, points: p.history, width: p.id === highlight ? 3 : p.ownerId === 'joueur' ? 2.2 : 1.2, dashed: p.extinct,
  }));
}

export function renderMiniPops(root, world, { onHover, onFocus }) {
  clear(root);
  const pops = world.livingPopulations().sort((a, b) => (a.ownerId === 'joueur' ? -1 : 1) - (b.ownerId === 'joueur' ? -1 : 1) || b.count - a.count);
  if (!pops.length) root.append(h('div', { class: 'muted small' }, 'Aucune population vivante.'));
  for (const p of pops) {
    root.append(h('div', { class: `mini-pop ${p.ownerId === 'joueur' ? 'mine' : ''}`, onmouseenter: () => onHover(p.id), onmouseleave: () => onHover(null), onclick: () => onFocus(p) },
      h('span', { class: 'swatch', style: { background: p.color } }),
      h('span', { class: 'mini-name' }, p.name, h('small', {}, ` ${p.ownerId === 'joueur' ? '(vous)' : p.ownerName}`)),
      h('span', { class: 'mini-count' }, p.count)));
  }
}

export function renderPopulations(root, world, progression, ghostSource, actions) {
  clear(root);
  const living = world.livingPopulations();
  const mine = living.filter((p) => p.ownerId === 'joueur');
  const others = living.filter((p) => p.ownerId !== 'joueur');
  const chart = h('canvas', { class: 'chart big' });
  const S = PARAMS.score;
  root.append(
    h('div', { class: 'grid2' },
      h('section', { class: 'card' },
        h('h3', {}, 'Progression'),
        h('div', { class: 'stat-row' },
          stat('Points disponibles', fmt(progression.points, 1)),
          stat('Points gagnés au total', fmt(progression.p.totalEarned, 1)),
          stat('Populations lancées', progression.p.launched),
          stat('Populations vivantes', mine.length)),
        h('p', { class: 'small muted' }, `Toutes les ${S.interval} s, chaque population vivante rapporte ${S.sizeWeight} × √(effectif) × (1 + ${S.diversityWeight} × nombre de ressources exploitées) points, plus ${S.generationBonus} point par tranche de 5 générations atteinte. Survivre longtemps, être nombreux, exploiter des ressources variées et évoluer sont donc récompensés.`)),
      h('section', { class: 'card' },
        h('h3', {}, 'Autres utilisateurs (simulés)'),
        h('p', { class: 'small muted' }, 'Ces « joueurs » sont générés localement par une GhostWorldSource ; un vrai serveur pourra les remplacer.'),
        h('div', { class: 'users' }, ghostSource.users().map((u) => h('div', { class: 'user' },
          h('span', { class: `dot ${u.online ? 'on' : 'off'}` }), h('b', {}, u.name), h('span', { class: 'muted small' }, ` · ${u.profile} · ${u.online ? 'en ligne' : 'hors ligne'}`)))))),
    h('section', { class: 'card' }, h('h3', {}, 'Effectifs dans le temps'), chart),
    h('section', { class: 'card' }, h('h3', {}, `Vos populations (${mine.length})`), popTable(mine, world, actions, true)),
    h('section', { class: 'card' }, h('h3', {}, `Populations des autres (${others.length})`), popTable(others, world, actions, false)),
  );
  requestAnimationFrame(() => lineChart(chart, popSeries(world, (p) => !p.extinct || world.time - p.extinctAt < 300), { log: true, xFmt: (v) => `${Math.round(v)} s`, yLabel: 'individus (échelle log)' }));
}

function stat(label, value) { return h('div', { class: 'stat' }, h('div', { class: 'stat-v' }, value), h('div', { class: 'stat-l' }, label)); }

function popTable(pops, world, actions, mine) {
  if (!pops.length) return h('div', { class: 'muted small' }, mine ? 'Aucune population vivante. Concevez un organisme dans l\'éditeur puis lancez-le !' : 'Aucune.');
  return h('table', { class: 'table' },
    h('thead', {}, h('tr', {}, ['', 'Nom', 'Propriétaire', 'Profil', 'Effectif', 'Max', 'Gén.', 'Âge', 'Ressources', 'Interactions', 'Score', ''].map((t) => h('th', {}, t)))),
    h('tbody', {}, pops.map((p) => h('tr', {},
      h('td', {}, h('span', { class: 'swatch', style: { background: p.color } })),
      h('td', {}, p.name), h('td', {}, p.ownerName), h('td', {}, p.profile || (p.design.type === 'eucaryote' ? 'Eucaryote' : 'Procaryote')),
      h('td', {}, h('b', {}, p.count)), h('td', {}, p.maxCount), h('td', {}, p.maxGeneration), h('td', {}, fmtTime(world.time - p.launchedAt)),
      h('td', { class: 'small' }, p.resourcesUsed.map(resName).join(', ') || '–'),
      h('td', { class: 'small' }, [p.kills ? `${p.kills} proies` : '', p.symbiosis > 1 ? 'symbiose' : '', p.parasitism > 1 ? 'parasitisme' : ''].filter(Boolean).join(', ') || '–'),
      h('td', {}, fmt(p.score, 1)),
      h('td', {}, h('button', { class: 'btn small', onclick: () => actions.focus(p) }, 'Voir'), mine ? h('button', { class: 'btn small danger', onclick: () => actions.abandon(p) }, 'Abandonner') : null)))));
}

export function renderArchives(root, world, progression) {
  clear(root);
  const arch = progression.p.archives;
  const others = [...world.populations.values()].filter((p) => p.extinct && p.ownerId !== 'joueur').sort((a, b) => b.extinctAt - a.extinctAt).slice(0, 20);
  root.append(h('section', { class: 'card' }, h('h3', {}, `Vos populations éteintes (${arch.length})`),
    arch.length ? h('div', { class: 'archive-grid' }, arch.map((a) => archiveCard(a))) : h('div', { class: 'muted small' }, 'Aucune pour le moment.')));
  root.append(h('section', { class: 'card' }, h('h3', {}, 'Extinctions récentes chez les autres'),
    others.length ? h('div', { class: 'archive-grid' }, others.map((p) => archiveCard(p.summary()))) : h('div', { class: 'muted small' }, 'Aucune.')));
}

function archiveCard(a) {
  const chart = h('canvas', { class: 'chart tiny' });
  requestAnimationFrame(() => lineChart(chart, [{ color: a.color, points: a.history || [] }], { xFmt: (v) => `${Math.round(v)}` }));
  const causes = Object.entries(a.deathCauses || {}).sort((x, y) => y[1] - x[1]).slice(0, 4).map(([k, v]) => `${CAUSES[k] || k} : ${v}`).join(' · ');
  return h('div', { class: 'archive' },
    h('div', { class: 'sheet-head' }, h('span', { class: 'swatch', style: { background: a.color } }), h('div', {}, h('strong', {}, a.name), h('div', { class: 'muted small' }, `${a.ownerName} · lancée à ${Math.round(a.launchedAt)} s · éteinte à ${Math.round(a.extinctAt)} s`))),
    chart,
    h('div', { class: 'small' }, `Max ${a.maxCount} individus · ${a.maxGeneration} générations · ${a.births} naissances · score ${fmt(a.score, 1)}`),
    h('div', { class: 'small muted' }, causes),
    h('p', { class: 'small summary' }, a.extinctionSummary));
}

export function renderJournal(root, world) {
  clear(root);
  for (const ev of world.events.slice(-30).reverse()) root.append(h('div', { class: `ev ${ev.kind}` }, h('span', { class: 'muted' }, `${Math.round(ev.t)} s `), ev.text));
}
