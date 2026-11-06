// Onglet « Défis » : missions guidées liées au livret.
import { h, fmt } from './dom.js';
import { help } from './help.js';

export function renderChallenges(root, list) {
  const done = list.filter((c) => c.done).length;
  const total = list.reduce((a, c) => a + c.reward, 0), won = list.filter((c) => c.done).reduce((a, c) => a + c.reward, 0);
  root.replaceChildren(
    h('section', { class: 'card' },
      h('h3', {}, `🎯 Défis guidés · ${done} / ${list.length} réussis`),
      h('p', { class: 'small muted' }, `Chaque défi illustre une notion du livret (bouton « ? »). Ils se valident tout seuls pendant la partie et rapportent des points (${won} / ${total}).`),
      h('div', { class: 'bar' }, h('span', { class: 'bar-label' }, 'Avancée'), h('span', { class: 'bar-track' }, h('span', { class: 'bar-fill', style: { width: `${(done / list.length) * 100}%`, background: '#43aa8b' } })), h('span', { class: 'bar-val' }, `${Math.round((done / list.length) * 100)} %`))),
    h('div', { class: 'challenge-grid' }, list.map((c) => {
      const [cur, tgt] = c.progress || [0, 1];
      const f = c.done ? 1 : Math.min(1, cur / tgt);
      return h('div', { class: `challenge ${c.done ? 'done' : ''}` },
        h('div', { class: 'ch-head' }, h('span', { class: 'ch-icon' }, c.icon), h('b', {}, c.title), help(c.help), h('span', { class: 'ch-reward' }, `+${c.reward} pts`)),
        h('div', {}, c.goal),
        c.done ? h('div', { class: 'msg ok' }, '✅ Réussi !')
          : h('div', { class: 'bar' }, h('span', { class: 'bar-track' }, h('span', { class: 'bar-fill', style: { width: `${f * 100}%`, background: '#4cc9f0' } })), h('span', { class: 'bar-val' }, `${fmt(Math.min(cur, tgt), 0)} / ${tgt}`)),
        c.done ? null : h('div', { class: 'small muted' }, '💡 ', c.hint));
    })));
}
