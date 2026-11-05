// Livret pédagogique : sommaire, recherche, chapitres illustrant la biologie derrière le jeu.
import { LIVRET } from '../data/index.js';
import { h } from './dom.js';

/** Remplace les enfants d'un élément (accepte des tableaux imbriqués). */
const fill = (el, ...kids) => { el.replaceChildren(...kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false)); return el; };
import { richText, wikiUrl } from './help.js';

const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const plain = (s) => s.replace(/\*\*|\*|\[\[[a-z0-9_]+\||\]\]/g, '');

export class Livret {
  constructor(root) {
    this.root = root;
    this.query = '';
    this.chapterId = LIVRET[0].id;
    try { this.chapterId = localStorage.getItem('petri.livret') || this.chapterId; } catch { /* stockage indisponible */ }
    if (!LIVRET.some((c) => c.id === this.chapterId)) this.chapterId = LIVRET[0].id;
    this.toc = h('nav', { class: 'livret-toc' });
    this.content = h('article', { class: 'livret-content' });
    fill(root, h('div', { class: 'livret' }, this.toc, this.content));
    this.render();
  }

  /** Ouvre le chapitre contenant la section et la fait défiler à l'écran. */
  open(sectionId) {
    const ch = LIVRET.find((c) => c.id === sectionId || c.sections.some((s) => s.id === sectionId));
    if (!ch) return;
    this.query = '';
    this.setChapter(ch.id);
    requestAnimationFrame(() => {
      const el = this.content.querySelector(`[data-section="${sectionId}"]`);
      if (!el) return;
      el.scrollIntoView({ block: 'start' });
      el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1600);
    });
  }

  setChapter(id) {
    this.chapterId = id;
    try { localStorage.setItem('petri.livret', id); } catch { /* */ }
    this.render();
    this.content.scrollTop = 0;
  }

  render() {
    const search = h('input', { type: 'search', class: 'livret-search', placeholder: '🔎 Rechercher (osmose, ATP, Km…)', value: this.query,
      oninput: (e) => { this.query = e.target.value; this.renderContent(); this.renderTocList(); } });
    this.tocList = h('div', {});
    fill(this.toc, h('div', { class: 'livret-brand' }, '📖 Livret du biologiste'), search, this.tocList);
    this.renderTocList();
    this.renderContent();
  }

  renderTocList() {
    fill(this.tocList, LIVRET.map((ch) => h('div', { class: `toc-ch ${ch.id === this.chapterId && !this.query ? 'on' : ''}` },
      h('button', { class: 'toc-title', onclick: () => { this.query = ''; this.setChapter(ch.id); } }, `${ch.icon} ${ch.title}`),
      ch.id === this.chapterId && !this.query ? h('div', { class: 'toc-sections' }, ch.sections.map((s) => h('button', { class: 'toc-sec', onclick: () => this.open(s.id) }, s.title))) : null)));
  }

  renderContent() {
    const q = norm(this.query.trim());
    if (q) {
      const hits = [];
      for (const ch of LIVRET) for (const s of ch.sections) {
        const text = norm([s.title, s.short, ...s.body, s.petri || ''].map(plain).join(' '));
        if (text.includes(q)) hits.push({ ch, s });
      }
      fill(this.content, h('h2', {}, `Résultats pour « ${this.query.trim()} » (${hits.length})`),
        hits.length ? hits.map(({ ch, s }) => this.section(s, ch)) : h('p', { class: 'muted' }, 'Aucune section ne correspond.'));
      return;
    }
    const i = LIVRET.findIndex((c) => c.id === this.chapterId), ch = LIVRET[i];
    const prev = LIVRET[i - 1], next = LIVRET[i + 1];
    fill(this.content, 
      h('header', { class: 'livret-head' }, h('div', { class: 'muted small' }, `Chapitre ${i + 1} / ${LIVRET.length}`), h('h2', {}, `${ch.icon} ${ch.title}`)),
      ch.sections.map((s) => this.section(s)),
      h('div', { class: 'livret-nav' },
        prev ? h('button', { class: 'btn', onclick: () => this.setChapter(prev.id) }, `← ${prev.icon} ${prev.title}`) : h('span'),
        next ? h('button', { class: 'btn', onclick: () => this.setChapter(next.id) }, `${next.icon} ${next.title} →`) : h('span')));
  }

  section(s, ch) {
    return h('section', { class: 'livret-sec', 'data-section': s.id, id: `livret-${s.id}` },
      ch ? h('div', { class: 'muted small' }, `${ch.icon} ${ch.title}`) : null,
      h('h3', {}, s.title),
      h('p', { class: 'livret-short' }, richText(s.short, (id) => this.open(id))),
      s.body.map((p) => h('p', {}, richText(p, (id) => this.open(id)))),
      s.petri ? h('div', { class: 'livret-petri' }, h('b', {}, '🎮 Dans Petri : '), s.petri) : null,
      s.wiki ? h('div', { class: 'small' }, h('a', { href: wikiUrl(s.wiki), target: '_blank', rel: 'noopener noreferrer' }, `🔎 Pour aller plus loin : « ${s.wiki} » sur Wikipédia`)) : null);
  }
}
