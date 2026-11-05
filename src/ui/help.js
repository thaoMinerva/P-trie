// Aide pédagogique non intrusive : petits boutons « ? » qui ouvrent une bulle (résumé + lien vers le livret).
import { LIVRET } from '../data/index.js';
import { h } from './dom.js';

export const SECTIONS = new Map();
for (const ch of LIVRET) for (const s of ch.sections) SECTIONS.set(s.id, { ...s, chapter: ch });

let opener = null;
/** Le livret s'enregistre ici pour que les bulles puissent l'ouvrir. */
export function setLivretOpener(fn) { opener = fn; }
export function openLivret(id) { closeHelp(); opener?.(id); }

export const wikiUrl = (term) => `https://fr.wikipedia.org/w/index.php?search=${encodeURIComponent(term)}`;

/** Texte enrichi minimal : **gras** et [[id|lien vers une section]]. Pas d'HTML injecté. */
export function richText(str, onLink = openLivret) {
  const out = [];
  const re = /\*\*(.+?)\*\*|\[\[([a-z0-9_]+)\|(.+?)\]\]|\*(.+?)\*/g;
  let last = 0, m;
  while ((m = re.exec(str))) {
    if (m.index > last) out.push(str.slice(last, m.index));
    if (m[1]) out.push(h('b', {}, m[1]));
    else if (m[2]) out.push(SECTIONS.has(m[2]) ? h('a', { href: '#', class: 'xref', onclick: (e) => { e.preventDefault(); onLink(m[2]); } }, m[3]) : m[3]);
    else out.push(h('i', {}, m[4]));
    last = re.lastIndex;
  }
  if (last < str.length) out.push(str.slice(last));
  return out;
}

let pop = null, popFor = null;
export function closeHelp() { pop?.remove(); pop = null; popFor = null; }
document.addEventListener('pointerdown', (e) => { if (pop && !pop.contains(e.target) && !e.target.closest?.('.help-btn')) closeHelp(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeHelp(); });
window.addEventListener('resize', closeHelp);

function showHelp(id, anchor) {
  const s = SECTIONS.get(id);
  if (!s) return;
  if (popFor === id) { closeHelp(); return; }
  closeHelp();
  popFor = id;
  pop = h('div', { class: 'help-pop', role: 'dialog' },
    h('div', { class: 'help-head' }, h('span', { class: 'muted small' }, `${s.chapter.icon} ${s.chapter.title}`), h('button', { class: 'help-x', title: 'Fermer', onclick: closeHelp }, '✕')),
    h('b', { class: 'help-title' }, s.title),
    h('p', {}, richText(s.short)),
    s.petri ? h('p', { class: 'help-petri small' }, h('b', {}, 'Dans Petri : '), s.petri) : null,
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn small primary', onclick: () => openLivret(id) }, '📖 Lire dans le livret'),
      s.wiki ? h('a', { class: 'btn small', href: wikiUrl(s.wiki), target: '_blank', rel: 'noopener noreferrer' }, '🔎 Wikipédia') : null));
  document.body.append(pop);
  // placement : sous le bouton, sans sortir de l'écran
  const r = anchor.getBoundingClientRect(), pw = pop.offsetWidth, ph = pop.offsetHeight;
  let x = Math.min(window.innerWidth - pw - 8, Math.max(8, r.left - 12));
  let y = r.bottom + 6;
  if (y + ph > window.innerHeight - 8) y = Math.max(8, r.top - ph - 6);
  pop.style.left = `${x}px`; pop.style.top = `${y}px`;
}

/** Petit bouton « ? » ; id = section du livret. */
export function help(id) {
  const s = SECTIONS.get(id);
  if (!s) { console.warn('Aide inconnue :', id); return null; }
  return h('button', { class: 'help-btn', type: 'button', title: `${s.title} — cliquez pour en savoir plus`, 'aria-label': `Aide : ${s.title}`,
    onclick: (e) => { e.preventDefault(); e.stopPropagation(); showHelp(id, e.currentTarget); } }, '?');
}
