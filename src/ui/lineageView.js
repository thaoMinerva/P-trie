// Arbre des lignées d'une population (souches apparues par mutation ou transfert de gènes).
import { h, fmtTime } from './dom.js';
import { help } from './help.js';

export function renderLineage(pop, world, onClose) {
  const strains = pop.strains || [];
  const kids = new Map();
  for (const s of strains) { if (!kids.has(s.parent)) kids.set(s.parent, []); kids.get(s.parent).push(s); }
  for (const l of kids.values()) l.sort((a, b) => b.max - a.max);
  const maxAll = Math.max(1, ...strains.map((s) => s.max));
  const alive = strains.filter((s) => s.count > 0).length;

  const node = (s, depth) => {
    const ch = kids.get(s.id) || [];
    const row = h('div', { class: `tree-row ${s.count ? 'alive' : 'dead'}` },
      h('span', { class: 'tree-id', style: { borderColor: pop.color } }, `S${s.id}`),
      h('span', { class: 'tree-bar', title: `${s.count} vivantes · maximum ${s.max}` },
        h('span', { class: 'tree-max', style: { width: `${(s.max / maxAll) * 100}%` } }),
        h('span', { class: 'tree-now', style: { width: `${(s.count / maxAll) * 100}%`, background: pop.color } })),
      h('span', { class: 'tree-count' }, s.count ? h('b', {}, s.count) : '†', h('span', { class: 'muted' }, ` / ${s.max}`)),
      h('span', { class: 'tree-notes' }, (s.notes || []).join(' · ') || '—'),
      h('span', { class: 'muted small tree-when' }, `${fmtTime(s.t - pop.launchedAt)} · gén. ${s.gen}`));
    // une chaîne sans embranchement reste au même niveau pour éviter un décalage infini
    const straight = ch.length === 1 && depth > 0;
    return [row, ch.length ? h('div', { class: straight ? 'tree-chain' : 'tree-kids' }, ch.map((c) => node(c, straight ? depth : depth + 1))) : null];
  };
  const roots = kids.get(null) || [];
  return h('section', { class: 'card lineage' },
    h('div', { class: 'tree-head' },
      h('h3', {}, `🌳 Lignées de « ${pop.name} » `, help('lignees')),
      h('button', { class: 'btn small', onclick: onClose }, 'Fermer')),
    h('p', { class: 'small muted' }, `${strains.length} souches connues, ${alive} encore vivantes. Barre claire : effectif maximal atteint ; barre colorée : effectif actuel. Les notes indiquent ce qui a changé par rapport à la souche mère.`),
    h('div', { class: 'tree' }, roots.map((r) => node(r, 0))));
}
