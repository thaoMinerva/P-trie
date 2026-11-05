// Géométrie cellulaire : contour 2D (coupe longitudinale) → volume, surface et rapport S/V du solide 3D.
// Hypothèses :
//  - « taille » = rayon de la cellule : rayon de la sphère (coque), demi-largeur du bâtonnet (bacille),
//    demi-petit axe (ovale), échelle de l'hélice (spirille), rayon équivalent du contour (forme libre) ;
//  - coque, ovale, bacille, forme libre : solide de révolution autour du grand axe de la coupe
//    (sphère, ellipsoïde allongé, capsule… calculés par tranches) ;
//  - spirille : tube de section circulaire enroulé le long de l'hélice, terminé par deux demi-sphères.
// Allonger une cellule à taille fixe augmente donc son volume ET sa surface (le rapport S/V baisse peu).

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

const SPIRILLE_W = 0.45; // demi-épaisseur du tube de la spirille (unités du contour brut)

/** Ligne médiane de la spirille (longueur d'arc en unités brutes). */
function spirilleCenterLength(aspect) {
  const L = aspect * 2, turns = Math.max(1.5, aspect / 1.5), amp = 0.9, N = 400;
  let len = 0, px = -L / 2, py = 0;
  for (let i = 1; i <= N; i++) {
    const t = i / N, x = -L / 2 + t * L, y = amp * Math.sin(t * turns * Math.PI * 2);
    len += Math.hypot(x - px, y - py); px = x; py = y;
  }
  return len;
}

/** Solide de révolution autour de l'axe x, découpé en tranches verticales. pts : contour réel (µm). */
function revolution(pts) {
  let xmin = Infinity, xmax = -Infinity;
  for (const [x] of pts) { xmin = Math.min(xmin, x); xmax = Math.max(xmax, x); }
  const N = 240, dx = (xmax - xmin) / N;
  let V = 0, S = 0, prevW = 0;
  for (let i = 0; i <= N; i++) {
    let W = 0;
    if (i > 0 && i < N) {
      const x = xmin + i * dx, ys = [];
      for (let j = 0; j < pts.length; j++) {
        const [x1, y1] = pts[j], [x2, y2] = pts[(j + 1) % pts.length];
        if ((x1 <= x && x2 > x) || (x2 <= x && x1 > x)) ys.push(y1 + ((x - x1) / (x2 - x1)) * (y2 - y1));
      }
      ys.sort((a, b) => a - b);
      let w2 = 0;
      for (let k = 0; k + 1 < ys.length; k += 2) { const w = ys[k + 1] - ys[k]; W += w; w2 += w * w; }
      V += (Math.PI / 4) * w2 * dx; // disque de diamètre w (ou plusieurs lobes)
    }
    if (i > 0) S += Math.PI * ((W + prevW) / 2) * Math.hypot(dx, (W - prevW) / 2); // tronc de cône
    prevW = W;
  }
  return { V, S };
}

/** Rotation du contour pour aligner son grand axe sur x (analyse en composantes principales). */
function alignMajorAxis(pts) {
  let sxx = 0, syy = 0, sxy = 0;
  for (const [x, y] of pts) { sxx += x * x; syy += y * y; sxy += x * y; }
  const a = 0.5 * Math.atan2(2 * sxy, sxx - syy), c = Math.cos(-a), s = Math.sin(-a);
  return pts.map(([x, y]) => [x * c - y * s, x * s + y * c]);
}

/** Géométrie complète pour une forme et une taille (µm). */
export function computeGeometry(shape) {
  const kind = shape.kind || 'coque';
  const raw = rawOutline(shape);
  // centrage
  let cx = 0, cy = 0;
  for (const [x, y] of raw) { cx += x; cy += y; }
  cx /= raw.length; cy /= raw.length;
  const rawArea = polyArea(raw) || 1;
  const k = Math.sqrt(Math.PI / rawArea);
  // contour normalisé (aire = π) utilisé pour le dessin, mis à l'échelle par le rayon équivalent
  const outline = raw.map(([x, y]) => [(x - cx) * k, (y - cy) * k]);
  const perimeterRatio = Math.max(1, polyPerimeter(outline) / (2 * Math.PI));
  let extent = 0;
  for (const [x, y] of outline) extent = Math.max(extent, Math.hypot(x, y));

  const s = shape.size;
  // contour réel en µm (la forme libre est d'abord ramenée à un rayon équivalent de 1)
  const scale = kind === 'libre' ? s * k : s;
  const real = raw.map(([x, y]) => [(x - cx) * scale, (y - cy) * scale]);
  const area2D = rawArea * scale * scale;
  const radius = Math.sqrt(area2D / Math.PI); // rayon équivalent de la coupe (collisions, dessin)
  let volume, surface;
  if (kind === 'coque') {
    volume = (4 / 3) * Math.PI * s ** 3; surface = 4 * Math.PI * s * s;
  } else if (kind === 'spirille') {
    const a = SPIRILLE_W * s, Lc = spirilleCenterLength(Math.max(1, Math.min(8, shape.aspect || 1))) * s;
    volume = Math.PI * a * a * Lc + (4 / 3) * Math.PI * a ** 3;
    surface = 2 * Math.PI * a * Lc + 4 * Math.PI * a * a;
  } else {
    const r = revolution(kind === 'libre' ? alignMajorAxis(real) : real);
    volume = r.V; surface = r.S;
  }
  return { outline, perimeterRatio, extent, radius, volume, surface, sv: surface / volume, area2D, center: [cx, cy], k };
}
