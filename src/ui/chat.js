// Chat du monde partagé (colonne de gauche de l'onglet Monde).
import { h, clear } from './dom.js';

const hueOf = (s) => { let x = 0; for (const c of String(s)) x = (x * 31 + c.charCodeAt(0)) % 360; return x; };
const hhmm = (t) => { const d = new Date(t); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

export class ChatPanel {
  constructor(root, { world, me, multiplayer }) {
    this.root = root; this.world = world; this.me = me; this.unread = 0;
    const mp = (this.mp = multiplayer ?? world.remote);
    this.collapsed = false;
    try { this.collapsed = localStorage.getItem('petri.chat.collapsed') === '1'; } catch { /* */ }
    this.list = h('div', { class: 'chat-list' });
    this.input = h('input', { type: 'text', maxlength: 300, placeholder: mp ? 'Écrire un message…' : 'Chat indisponible en solo', disabled: !mp,
      onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); this.send(); } } });
    this.badge = h('span', { class: 'chat-badge' });
    this.toggleBtn = h('button', { class: 'chat-toggle', title: 'Afficher / masquer le chat', onclick: () => this.setCollapsed(!this.collapsed) });
    clear(root).append(
      h('div', { class: 'chat-head' }, this.toggleBtn, h('b', { class: 'chat-label' }, '💬 Chat'), this.badge),
      h('div', { class: 'chat-body' },
        this.list,
        mp ? null : h('p', { class: 'small muted chat-solo' }, 'Le chat relie les joueurs d\'un monde partagé. Pour jouer à plusieurs, lancez le serveur avec « npm run multi » et ouvrez l\'adresse qu\'il affiche.'),
        h('form', { class: 'chat-form', onsubmit: (e) => { e.preventDefault(); this.send(); } }, this.input,
          h('button', { class: 'btn small primary', type: 'submit', disabled: !mp }, 'Envoyer'))));
    this.setCollapsed(this.collapsed);
    for (const m of world.chat || []) this.add(m, true);
    world.on?.('chat', (m) => this.add(m));
  }

  setCollapsed(v) {
    this.collapsed = v;
    this.root.classList.toggle('collapsed', v);
    this.toggleBtn.textContent = v ? '»' : '«';
    if (!v) { this.unread = 0; this.badge.textContent = ''; this.list.scrollTop = this.list.scrollHeight; }
    try { localStorage.setItem('petri.chat.collapsed', v ? '1' : '0'); } catch { /* */ }
    this.onToggle?.();
  }

  add(m, initial = false) {
    const atBottom = this.list.scrollHeight - this.list.scrollTop - this.list.clientHeight < 30;
    const mine = m.playerId && m.playerId === this.me.id;
    this.list.append(m.system
      ? h('div', { class: 'chat-msg system' }, h('span', { class: 'chat-time' }, hhmm(m.at)), ' ', m.text)
      : h('div', { class: `chat-msg ${mine ? 'mine' : ''}` },
        h('span', { class: 'chat-time' }, hhmm(m.at)), ' ',
        h('b', { style: { color: `hsl(${hueOf(m.playerId)},70%,70%)` } }, m.name), ' ', m.text));
    while (this.list.childElementCount > 150) this.list.firstElementChild.remove();
    if (atBottom || mine || initial) this.list.scrollTop = this.list.scrollHeight;
    if (this.collapsed && !initial && !m.system) { this.unread++; this.badge.textContent = String(this.unread); }
  }

  async send() {
    const text = this.input.value.trim();
    if (!text || !this.mp) return;
    this.input.value = '';
    const r = await this.world.sendChat(text).catch(() => ({ ok: false, error: 'serveur injoignable' }));
    if (!r.ok) this.add({ system: true, at: Date.now(), text: `⚠️ Message non envoyé : ${r.error}` });
  }
}
