// Vue principale du monde : Canvas 2D, zoom/déplacement, calques de ressources, sélection de cellules.
import { MET } from '../data/index.js';
import { MI } from '../simulation/metabolism.js';
import { drawCellShape, drawCellDetailed, layoutOrganelles } from './cellDraw.js';
import { hexToHsl } from './dom.js';

export const LAYERS = {
  aucun: { name: 'Aucun' },
  glucose: { name: 'Glucose', field: 'glucose', max: 8, color: [242, 193, 78] },
  o2: { name: 'Oxygène', field: 'o2', max: 10, color: [76, 201, 240] },
  light: { name: 'Lumière', custom: 'light', color: [255, 250, 200] },
  temperature: { name: 'Température', custom: 'temperature' },
  ph: { name: 'pH', custom: 'ph' },
  salinity: { name: 'Salinité', custom: 'salinity', color: [180, 220, 255] },
  nh4: { name: 'Ammonium', field: 'nh4', max: 6, color: [0, 187, 249] },
  phosphate: { name: 'Phosphate', field: 'phosphate', max: 3, color: [202, 255, 191] },
  co2: { name: 'CO₂', field: 'co2', max: 5, color: [200, 200, 210] },
  protein: { name: 'Protéines mortes', field: 'protein', max: 5, color: [229, 152, 155] },
  aa: { name: 'Acides aminés', field: 'aa', max: 3, color: [155, 93, 229] },
  starch: { name: 'Amidon', field: 'starch', max: 12, color: [233, 237, 201] },
  cellulose: { name: 'Cellulose (litière)', field: 'cellulose', max: 25, color: [160, 110, 70] },
  lactate: { name: 'Lactate', field: 'lactate', max: 3, color: [255, 140, 66] },
  ethanol: { name: 'Éthanol', field: 'ethanol', max: 3, color: [184, 242, 230] },
  toxin: { name: 'Toxines', field: 'toxin', max: 1.5, color: [230, 30, 30] },
  secreted: { name: 'Enzymes sécrétées (activité)', custom: 'secreted', color: [255, 80, 220] },
  uree: { name: 'Urée', field: 'uree', max: 8, color: [224, 170, 255] },
  signal: { name: 'Signal de quorum', field: 'signal', max: 0.3, color: [128, 255, 219] },
  phage: { name: 'Bactériophages', field: 'phage', max: 0.3, color: [255, 0, 110] },
  antibiotique: { name: 'Antibiotique', field: 'antibiotique', max: 2, color: [255, 190, 11] },
};

export const EVENT_ICONS = { canicule: ['🔥', '#ff6b35'], froid: ['❄️', '#8ecae6'], pluie: ['🌧️', '#90e0ef'], apport: ['🍂', '#dda15e'], antibiotique: ['💊', '#ffbe0b'], phages: ['🦠', '#ff006e'] };

/** Valeur brute du calque dans la case i, et normalisation 0..1 pour la couleur. */
export function layerValue(env, layer, i, autoMax = 1) {
  const L = LAYERS[layer];
  if (!L || layer === 'aucun') return null;
  if (L.field) { const v = env.fields[MET[L.field].index][i]; return { v, t: Math.min(1, v / L.max) }; }
  if (L.custom === 'light') { const v = env.lightAt(i); return { v: v * 100, t: v }; }
  if (L.custom === 'temperature') { const v = env.temperature[i]; return { v, t: Math.min(1, Math.max(0, (v - 5) / 50)) }; }
  if (L.custom === 'ph') { const v = env.pH[i]; return { v, t: Math.min(1, Math.max(0, (v - 4) / 6)) }; }
  if (L.custom === 'salinity') { const v = env.salinity[i]; return { v, t: Math.min(1, v) }; }
  if (L.custom === 'secreted') { const v = env.secreted[i]; return { v, t: Math.min(1, v / Math.max(1e-6, autoMax)) }; }
  return null;
}

/** Description de la légende : dégradé CSS, bornes et unité. */
export function layerLegend(layer, autoMax = 1) {
  const L = LAYERS[layer];
  if (!L || layer === 'aucun') return null;
  const ramp = (c) => `linear-gradient(90deg, rgba(${c},0.05), rgba(${c},0.6), rgba(${c},0.95))`;
  if (L.field) return { gradient: ramp(L.color.join(',')), min: '0', max: `≥ ${L.max}`, unit: 'u par case (10 × 10 µm)', low: 'absent', high: 'concentré' };
  if (L.custom === 'light') return { gradient: ramp(L.color.join(',')), min: '0 %', max: '100 %', unit: 'lumière reçue', low: 'obscurité', high: 'plein soleil' };
  if (L.custom === 'temperature') return { gradient: 'linear-gradient(90deg, rgb(0,80,255), rgb(128,160,128), rgb(255,80,0))', min: '5 °C', max: '55 °C', unit: 'température', low: 'froid', high: 'chaud' };
  if (L.custom === 'ph') return { gradient: 'linear-gradient(90deg, rgb(255,40,0), rgb(128,240,128), rgb(0,40,255))', min: 'pH 4', max: 'pH 10', unit: 'acidité', low: 'acide', high: 'basique' };
  if (L.custom === 'salinity') return { gradient: ramp(L.color.join(',')), min: '0', max: '1', unit: 'salinité relative (eau douce ≈ 0,12)', low: 'eau douce', high: 'saumure' };
  if (L.custom === 'secreted') return { gradient: ramp(L.color.join(',')), min: '0', max: autoMax.toPrecision(2).replace('.', ','), unit: 'u transformées / s (échelle automatique)', low: 'aucune', high: 'intense' };
  return null;
}

export class WorldView {
  constructor(canvas, getWorld) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.getWorld = getWorld;
    this.cam = { x: 400, y: 300, zoom: 1 };
    this.layer = 'glucose';
    this.layerCanvas = document.createElement('canvas');
    this.selectedId = null;
    this.follow = false;
    this.colorCache = new Map();
    this.onSelect = () => {};
    this.onMapClick = null;
    this.frame = 0;
    this.hoverPop = null;
    this.hover = null;
    this.autoMax = 1;
    this.bindInput();
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.round(r.width * dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * dpr));
    this.dpr = dpr;
  }

  fit() {
    const w = this.getWorld();
    this.resize();
    const cw = this.canvas.width / this.dpr, chh = this.canvas.height / this.dpr;
    this.cam.zoom = Math.min(cw / w.width, chh / w.height) * 0.98;
    this.cam.x = w.width / 2; this.cam.y = w.height / 2;
  }

  centerOn(x, y, zoom = null) { this.cam.x = x; this.cam.y = y; if (zoom) this.cam.zoom = zoom; }

  toWorld(sx, sy) {
    const cw = this.canvas.width / this.dpr, chh = this.canvas.height / this.dpr;
    return [(sx - cw / 2) / this.cam.zoom + this.cam.x, (sy - chh / 2) / this.cam.zoom + this.cam.y];
  }

  bindInput() {
    const c = this.canvas;
    let drag = null;
    c.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, cx: this.cam.x, cy: this.cam.y, moved: false }; c.setPointerCapture(e.pointerId); });
    c.addEventListener('pointermove', (e) => {
      const r = c.getBoundingClientRect();
      this.hover = this.toWorld(e.clientX - r.left, e.clientY - r.top);
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
      if (drag.moved) { this.follow = false; this.cam.x = drag.cx - dx / this.cam.zoom; this.cam.y = drag.cy - dy / this.cam.zoom; }
    });
    c.addEventListener('pointerup', (e) => {
      if (drag && !drag.moved) {
        const r = c.getBoundingClientRect();
        const [wx, wy] = this.toWorld(e.clientX - r.left, e.clientY - r.top);
        if (this.onMapClick) { const fn = this.onMapClick; this.onMapClick = null; fn(wx, wy); }
        else this.pick(wx, wy);
      }
      drag = null;
    });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = c.getBoundingClientRect();
      const sx = e.clientX - r.left, sy = e.clientY - r.top;
      const [wx, wy] = this.toWorld(sx, sy);
      const f = Math.exp(-e.deltaY * 0.0015);
      this.cam.zoom = Math.min(80, Math.max(0.3, this.cam.zoom * f));
      const [wx2, wy2] = this.toWorld(sx, sy);
      this.cam.x += wx - wx2; this.cam.y += wy - wy2;
    }, { passive: false });
  }

  /** Valeur du calque actif sous la souris (pour la légende). */
  hoverValue() {
    const w = this.getWorld();
    if (!this.hover || !w) return null;
    const [x, y] = this.hover;
    if (x < 0 || y < 0 || x > w.width || y > w.height) return null;
    return layerValue(w.env, this.layer, w.env.idx(x, y), this.autoMax);
  }

  pick(wx, wy) {
    const w = this.getWorld();
    let best = null, bd = (10 / this.cam.zoom) ** 2;
    for (const c of w.cells) {
      const d2 = (c.x - wx) ** 2 + (c.y - wy) ** 2 - c.ph.radius ** 2;
      if (d2 < bd) { bd = d2; best = c; }
    }
    this.selectedId = best ? best.id : null;
    this.onSelect(best);
  }

  cellColor(c, pop) {
    const hue = Math.round((c.hue ?? c.genome.hue ?? 0) / 3) * 3;
    const key = pop.id + ':' + hue;
    let col = this.colorCache.get(key);
    if (!col) {
      const [hh, s, l] = hexToHsl(pop.color);
      col = { fill: `hsla(${(hh + hue + 360) % 360},${s}%,${l}%,0.82)`, solid: `hsl(${(hh + hue + 360) % 360},${s}%,${Math.min(85, l + 10)}%)` };
      this.colorCache.set(key, col);
    }
    return col;
  }

  updateLayer(w) {
    const env = w.env, L = LAYERS[this.layer];
    const lc = this.layerCanvas;
    if (lc.width !== env.gw) { lc.width = env.gw; lc.height = env.gh; }
    if (!L || this.layer === 'aucun') return;
    const lctx = lc.getContext('2d');
    const img = lctx.createImageData(env.gw, env.gh);
    const d = img.data;
    if (L.custom === 'secreted') { let m = 0; for (let i = 0; i < env.n; i++) if (env.secreted[i] > m) m = env.secreted[i]; this.autoMax = Math.max(1e-4, m); }
    for (let i = 0; i < env.n; i++) {
      const lv = layerValue(env, this.layer, i, this.autoMax);
      const t = lv ? lv.t : 0;
      let r = 0, g = 0, b = 0, a = 0;
      if (L.custom === 'temperature') { r = 255 * t; g = 80 + 80 * (1 - Math.abs(t - 0.5) * 2); b = 255 * (1 - t); a = 150; }
      else if (L.custom === 'ph') { r = 255 * (1 - t); g = 200 * (1 - Math.abs(t - 0.5) * 2) + 40; b = 255 * t; a = 150; }
      else { [r, g, b] = L.color; a = (L.field ? Math.sqrt(t) * 150 : t * 200); }
      d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b; d[i * 4 + 3] = a;
    }
    lctx.putImageData(img, 0, 0);
  }

  render(time) {
    const w = this.getWorld();
    if (!w) return;
    const ctx = this.ctx, dpr = this.dpr || 1;
    const cw = this.canvas.width / dpr, chh = this.canvas.height / dpr;
    if (this.follow && this.selectedId) {
      const s = w.cellById.get(this.selectedId);
      if (s) { this.cam.x += (s.x - this.cam.x) * 0.2; this.cam.y += (s.y - this.cam.y) * 0.2; } else this.follow = false;
    }
    const z = this.cam.zoom;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0b1a24';
    ctx.fillRect(0, 0, cw, chh);
    ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * (cw / 2 - this.cam.x * z), dpr * (chh / 2 - this.cam.y * z));
    // fond : eau en surface, sol en profondeur
    const grad = ctx.createLinearGradient(0, 0, 0, w.height);
    grad.addColorStop(0, '#16455c'); grad.addColorStop(0.55, '#123444'); grad.addColorStop(1, '#2a2318');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, w.width, w.height);
    if (this.frame++ % 15 === 0) this.updateLayer(w);
    if (this.layer !== 'aucun') {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.layerCanvas, 0, 0, w.width, w.height);
    }
    // nuit
    const night = 1 - w.env.lightLevel;
    if (night > 0.02) { ctx.fillStyle = `rgba(5,8,25,${night * 0.45})`; ctx.fillRect(0, 0, w.width, w.height); }
    ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 1 / z; ctx.strokeRect(0, 0, w.width, w.height);

    // limites visibles
    const [vx0, vy0] = this.toWorld(0, 0), [vx1, vy1] = this.toWorld(cw, chh);
    const pops = w.populations;
    const sel = this.selectedId;
    // liens symbiotiques et parasites
    ctx.lineWidth = 1.2 / z;
    for (const c of w.cells) {
      if (c.partners.length) {
        for (const pid of c.partners) {
          if (pid < c.id) continue;
          const o = w.cellById.get(pid); if (!o) continue;
          ctx.strokeStyle = 'rgba(255,209,102,0.8)';
          ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(o.x, o.y); ctx.stroke();
        }
      }
    }
    // matrice des biofilms (halo commun sous les cellules collées)
    ctx.fillStyle = 'rgba(190,230,150,0.16)';
    for (const c of w.cells) {
      if (!(c.bfN > 0)) continue;
      const r = c.ph.radius;
      if (c.x + r * 3 < vx0 || c.x - r * 3 > vx1 || c.y + r * 3 < vy0 || c.y - r * 3 > vy1) continue;
      ctx.beginPath(); ctx.arc(c.x, c.y, r * 1.9, 0, Math.PI * 2); ctx.fill();
    }
    for (const c of w.cells) {
      const r = c.ph.radius;
      if (c.x + r * 3 < vx0 || c.x - r * 3 > vx1 || c.y + r * 3 < vy0 || c.y - r * 3 > vy1) continue;
      const pop = pops.get(c.popId);
      const col = this.cellColor(c, pop);
      const grow = Math.cbrt(Math.min(2.05, Math.max(0.6, c.pools[MI.biomass] / c.ph.B0)) / 1.4);
      const rpx = r * grow * z;
      if (rpx < 1.6) {
        ctx.fillStyle = col.solid;
        const s = Math.max(1.6, rpx * 1.6) / z;
        ctx.fillRect(c.x - s / 2, c.y - s / 2, s, s);
      } else {
        ctx.save();
        ctx.translate(c.x, c.y);
        if (rpx > 16) {
          ctx.scale(1 / z, 1 / z);
          if (!c._org || c._orgGenome !== c.genome) { c._org = layoutOrganelles(c.genome, c.ph.geo.outline); c._orgGenome = c.genome; }
          drawCellDetailed(ctx, { outline: c.ph.geo.outline, design: c.genome, scale: r * grow * z, angle: c.angle, color: col.fill, wall: c.ph.wall, capsule: c.genome.envelope.capsule, time, organelles: c._org });
        } else {
          drawCellShape(ctx, c.ph.geo.outline, r * grow, c.angle, col.fill, c.ph.wall > 0.05 ? 'rgba(240,220,170,0.8)' : null, 0.8 / z);
          if (c.genome.envelope.motility !== 'aucune' && rpx > 4) {
            ctx.strokeStyle = 'rgba(230,230,210,0.6)'; ctx.lineWidth = 0.8 / z;
            const bx = -Math.cos(c.angle) * r * grow * 1.1, by = -Math.sin(c.angle) * r * grow * 1.1;
            ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx * 2.2 + Math.sin(time * 15 + c.id) * r * 0.3, by * 2.2 + Math.cos(time * 15 + c.id) * r * 0.3); ctx.stroke();
          }
        }
        if (c.phase !== 'G1' && rpx > 5) { ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.setLineDash([2 / z, 2 / z]); ctx.lineWidth = 0.8 / z; ctx.beginPath(); ctx.arc(0, 0, r * grow * 1.15, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); }
        ctx.restore();
      }
      if (c.infected) { // cellule infectée : virions qui s'accumulent
        ctx.fillStyle = `rgba(255,0,110,${0.55 + 0.35 * Math.sin(time * 6 + c.id)})`;
        for (let k = 0; k < 3; k++) { const a = k * 2.1 + c.id; ctx.beginPath(); ctx.arc(c.x + Math.cos(a) * r * 0.45, c.y + Math.sin(a) * r * 0.45, Math.max(r * 0.16, 0.6 / z), 0, Math.PI * 2); ctx.fill(); }
      }
      if (this.hoverPop && c.popId === this.hoverPop) {
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1 / z; ctx.beginPath(); ctx.arc(c.x, c.y, Math.max(r * 1.5, 3 / z), 0, Math.PI * 2); ctx.stroke();
      }
    }
    // événements du milieu en cours
    const evs = w.remote ? (w.envEvents || []) : (w.scheduler?.summary() || []);
    for (const e of evs) {
      const [icon, color] = EVENT_ICONS[e.type] || ['❗', '#fff'];
      ctx.strokeStyle = color; ctx.lineWidth = 1.5 / z; ctx.setLineDash([6 / z, 5 / z]);
      ctx.beginPath(); ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      ctx.font = `${16 / z}px system-ui`; ctx.textAlign = 'center'; ctx.fillStyle = '#fff';
      ctx.fillText(`${icon} ${e.left} s`, e.x, e.y - e.r - 6 / z);
    }
    if (sel) {
      const s = w.cellById.get(sel);
      if (s) {
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2 / z;
        ctx.beginPath(); ctx.arc(s.x, s.y, Math.max(s.ph.radius * 1.8, 8 / z), 0, Math.PI * 2); ctx.stroke();
        if (s.host) { const h = w.cellById.get(s.host); if (h) { ctx.strokeStyle = '#d62828'; ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(h.x, h.y); ctx.stroke(); } }
      }
    }
    if (this.onMapClick) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(cw / 2 - 170, 12, 340, 30);
      ctx.fillStyle = '#fff'; ctx.font = '14px system-ui'; ctx.textAlign = 'center';
      ctx.fillText('Cliquez sur le monde pour choisir le point de lâcher', cw / 2, 32);
    }
  }
}
