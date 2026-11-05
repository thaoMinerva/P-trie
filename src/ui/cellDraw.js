// Dessin d'une cellule (partagé entre la vue du monde et l'éditeur).
import { ORG, WALLS } from '../data/index.js';
import { RNG, hashString } from '../simulation/rng.js';

export function pointInPolygon(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Positions des organites (coordonnées normalisées du contour). Respecte le placement manuel s'il existe. */
export function layoutOrganelles(design, outline) {
  const out = [];
  const rng = new RNG(hashString(design.type + JSON.stringify(design.organelles) + design.shape.kind + (design.shape.aspect || 1)));
  const shrink = outline.map(([x, y]) => [x * 0.82, y * 0.82]);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of shrink) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const order = ['vacuole', 'reticulum', 'thylakoides', 'granules'];
  const ids = Object.keys(design.organelles).sort((a, b) => {
    const ra = order.includes(a) ? -1 : (a === 'noyau' || a === 'nucleoide') ? 1 : 0;
    const rb = order.includes(b) ? -1 : (b === 'noyau' || b === 'nucleoide') ? 1 : 0;
    return ra - rb;
  });
  for (const id of ids) {
    const n = design.organelles[id];
    const o = ORG[id];
    if (!o || !o.radius) continue;
    const manual = design.organellePositions?.[id] || [];
    for (let k = 0; k < n; k++) {
      let p = manual[k];
      if (!p) {
        p = [0, 0];
        if (id === 'noyau' || id === 'nucleoide') p = [0.05, 0];
        else {
          for (let tries = 0; tries < 40; tries++) {
            const cand = [rng.range(x0, x1), rng.range(y0, y1)];
            if (pointInPolygon(cand[0], cand[1], shrink)) { p = cand; break; }
          }
        }
      }
      out.push({ id, k, x: p[0], y: p[1], r: o.radius, color: o.color });
    }
  }
  return out;
}

/**
 * Dessine une cellule centrée en (0,0) dans un contexte déjà transformé (échelle = rayon en px).
 * opts : { color, outline, design, detail (0..2), angle, alpha, phase }
 */
export function drawCellShape(ctx, outline, scale, angle, fill, stroke, lineWidth = 1) {
  const ca = Math.cos(angle), sa = Math.sin(angle);
  ctx.beginPath();
  for (let i = 0; i < outline.length; i++) {
    const [x, y] = outline[i];
    const px = (x * ca - y * sa) * scale, py = (x * sa + y * ca) * scale;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lineWidth; ctx.stroke(); }
}

export function drawCellDetailed(ctx, { outline, design, scale, angle = 0, color, wall = 0, capsule = false, time = 0, organelles = null, highlight = null }) {
  const ca = Math.cos(angle), sa = Math.sin(angle);
  const tf = (x, y) => [(x * ca - y * sa) * scale, (x * sa + y * ca) * scale];
  // flagelles / cils
  const env = design.envelope;
  if (env.motility === 'flagelle') {
    for (let u = 0; u < env.motilityUnits; u++) {
      let minX = 0; for (const [x] of outline) minX = Math.min(minX, x);
      const off = (u - (env.motilityUnits - 1) / 2) * 0.35;
      ctx.beginPath();
      for (let s = 0; s <= 20; s++) {
        const t = s / 20;
        const [px, py] = tf(minX - t * 2.2, off + Math.sin(t * 9 - time * 12) * 0.25 * t);
        if (s === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.strokeStyle = 'rgba(230,230,210,0.75)'; ctx.lineWidth = Math.max(1, scale * 0.05); ctx.stroke();
    }
  } else if (env.motility === 'cils') {
    ctx.strokeStyle = 'rgba(230,230,210,0.55)'; ctx.lineWidth = Math.max(0.6, scale * 0.025);
    for (let i = 0; i < outline.length; i += 1) {
      const [x, y] = outline[i]; const n = Math.hypot(x, y) || 1;
      const w = Math.sin(time * 10 + i * 0.8) * 0.12;
      const [ax, ay] = tf(x, y), [bx, by] = tf(x + (x / n) * 0.22 + w * (-y / n), y + (y / n) * 0.22 + w * (x / n));
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    }
  }
  if (capsule) drawCellShape(ctx, outline.map(([x, y]) => [x * 1.18, y * 1.18]), scale, angle, 'rgba(255,255,255,0.08)', 'rgba(255,255,255,0.25)', 1);
  if (env.parasite) {
    let maxX = 0; for (const [x] of outline) maxX = Math.max(maxX, x);
    const [px, py] = tf(maxX + 0.25, 0);
    ctx.beginPath(); ctx.arc(px, py, scale * 0.18, 0, Math.PI * 2); ctx.fillStyle = '#d62828'; ctx.fill();
  }
  if (env.adhesins) {
    ctx.fillStyle = '#ffd166';
    for (let i = 0; i < outline.length; i += 4) { const [x, y] = outline[i]; const [px, py] = tf(x * 1.07, y * 1.07); ctx.fillRect(px - 1, py - 1, 2.5, 2.5); }
  }
  drawCellShape(ctx, outline, scale, angle, color, wall > 0 ? (WALLS[design.envelope.wallType]?.color || 'rgba(240,220,170,0.9)') : 'rgba(255,255,255,0.6)', wall > 0 ? Math.max(1.2, wall * scale * 0.18) : Math.max(1, scale * 0.03));
  // ribosomes
  const ribo = design.organelles.ribosomes || 0;
  if (ribo && scale > 25) {
    const rng = new RNG(hashString(design.shape.kind + ribo));
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    for (let k = 0; k < ribo * 25; k++) {
      const x = rng.range(-3, 3), y = rng.range(-2, 2);
      if (!pointInPolygon(x, y, outline)) continue;
      const [px, py] = tf(x, y); ctx.fillRect(px, py, 1.2, 1.2);
    }
  }
  for (const o of organelles || layoutOrganelles(design, outline)) {
    const [px, py] = tf(o.x, o.y);
    const r = o.r * scale;
    ctx.beginPath();
    if (o.id === 'mitochondrie' || o.id === 'chloroplaste') ctx.ellipse(px, py, r * 1.5, r, angle + o.k, 0, Math.PI * 2);
    else if (o.id === 'nucleoide') { for (let a = 0; a <= 12; a++) { const t = (a / 12) * Math.PI * 2; const rr = r * (0.8 + 0.25 * Math.sin(t * 3)); const x = px + Math.cos(t) * rr, y = py + Math.sin(t) * rr * 0.7; if (a) ctx.lineTo(x, y); else ctx.moveTo(x, y); } }
    else if (o.id === 'reticulum' || o.id === 'thylakoides') { ctx.ellipse(px, py, r * 1.4, r * 0.5, angle + o.k * 0.7, 0, Math.PI * 2); }
    else ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fillStyle = o.color + (o.id === 'vacuole' ? '99' : 'dd');
    ctx.fill();
    ctx.strokeStyle = highlight === `${o.id}:${o.k}` ? '#fff' : 'rgba(0,0,0,0.35)';
    ctx.lineWidth = highlight === `${o.id}:${o.k}` ? 2 : 0.8;
    ctx.stroke();
    if (o.id === 'mitochondrie' && r > 3) { ctx.beginPath(); ctx.moveTo(px - r, py); for (let s = 0; s <= 6; s++) ctx.lineTo(px - r + (s * r) / 3, py + (s % 2 ? r * 0.5 : -r * 0.5)); ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.stroke(); }
    if (o.id === 'chloroplaste' && r > 3) { ctx.fillStyle = 'rgba(20,80,40,0.6)'; for (let s = -1; s <= 1; s++) ctx.fillRect(px - r * 0.8, py + s * r * 0.4 - 1, r * 1.6, 2); }
    if (o.id === 'noyau' && r > 3) { ctx.beginPath(); ctx.arc(px + r * 0.25, py - r * 0.2, r * 0.3, 0, Math.PI * 2); ctx.fillStyle = 'rgba(60,30,90,0.8)'; ctx.fill(); }
  }
}
