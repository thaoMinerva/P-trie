// Géométrie cellulaire : contour 2D normalisé (aire = π) → volume, surface et rapport S/V.
// Hypothèse : la cellule est un solide dont la section est ce contour ; on prend le volume de la sphère de
// même rayon équivalent et on gonfle la surface du rapport (périmètre du contour / périmètre du cercle).

export const SHAPES = {
  coque: 'Coque (sphérique)',
  bacille: 'Bacille (bâtonnet)',
  spirille: 'Spirille (hélice)',
  ovale: 'Ovale',
  libre: 'Forme libre',
};

function polyArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}
function polyPerimeter(pts) {
  let p = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
    p += Math.hypot(x2 - x1, y2 - y1);
  }
  return p;
}

function catmullRom(ctrl, samplesPer = 5) {
  const out = [];
  const n = ctrl.length;
  for (let i = 0; i < n; i++) {
    const p0 = ctrl[(i - 1 + n) % n], p1 = ctrl[i], p2 = ctrl[(i + 1) % n], p3 = ctrl[(i + 2) % n];
    for (let s = 0; s < samplesPer; s++) {
      const t = s / samplesPer, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  return out;
}

/** Contour brut (non normalisé) selon le type de forme. */
export function rawOutline(shape) {
  const kind = shape.kind || 'coque';
  const aspect = Math.max(1, Math.min(8, shape.aspect || 1));
  const pts = [];
  if (kind === 'coque' || kind === 'ovale') {
    const ax = kind === 'coque' ? 1 : aspect;
    for (let i = 0; i < 28; i++) { const a = (i / 28) * Math.PI * 2; pts.push([Math.cos(a) * ax, Math.sin(a)]); }
  } else if (kind === 'bacille') {
    const half = Math.max(0, aspect - 1); // longueur de la partie droite / 2 (rayon 1)
    for (let i = 0; i <= 12; i++) { const a = -Math.PI / 2 + (i / 12) * Math.PI; pts.push([half + Math.cos(a), Math.sin(a)]); }
    for (let i = 0; i <= 12; i++) { const a = Math.PI / 2 + (i / 12) * Math.PI; pts.push([-half + Math.cos(a), Math.sin(a)]); }
  } else if (kind === 'spirille') {
    const L = aspect * 2, w = 0.45, turns = Math.max(1.5, aspect / 1.5), amp = 0.9, N = 40;
    const top = [], bot = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N, x = -L / 2 + t * L;
      const y = amp * Math.sin(t * turns * Math.PI * 2);
      const dy = amp * turns * Math.PI * 2 * Math.cos(t * turns * Math.PI * 2) / L;
      const nx = -dy / Math.hypot(1, dy), ny = 1 / Math.hypot(1, dy);
      top.push([x + nx * w, y + ny * w]); bot.push([x - nx * w, y - ny * w]);
    }
    pts.push(...top, ...bot.reverse());
  } else if (kind === 'libre') {
    const ctrl = (shape.points && shape.points.length >= 3) ? shape.points : [[1, 0], [0, 1], [-1, 0], [0, -1]];
    pts.push(...catmullRom(ctrl, 5));
  }
  return pts;
}

/** Géométrie complète pour une forme et une taille (rayon équivalent en µm). */
export function computeGeometry(shape) {
  const raw = rawOutline(shape);
  // centrage
  let cx = 0, cy = 0;
  for (const [x, y] of raw) { cx += x; cy += y; }
  cx /= raw.length; cy /= raw.length;
  const area = polyArea(raw) || 1;
  const k = Math.sqrt(Math.PI / area);
  const outline = raw.map(([x, y]) => [(x - cx) * k, (y - cy) * k]);
  const perimeterRatio = Math.max(1, polyPerimeter(outline) / (2 * Math.PI));
  let extent = 0;
  for (const [x, y] of outline) extent = Math.max(extent, Math.hypot(x, y));
  const r = shape.size;
  const volume = (4 / 3) * Math.PI * r ** 3;
  const surface = 4 * Math.PI * r * r * perimeterRatio;
  return { outline, perimeterRatio, extent, radius: r, volume, surface, sv: surface / volume, center: [cx, cy], k };
}
