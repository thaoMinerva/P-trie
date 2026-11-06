// Petits graphiques interactifs du livret : on bouge un curseur, la courbe change.
import { h, fmt } from './dom.js';
import { lineChart } from './charts.js';

const curve = (f, a, b, n = 120) => { const pts = []; for (let i = 0; i <= n; i++) { const x = a + ((b - a) * i) / n; pts.push([x, f(x)]); } return pts; };

/** Curseur : { label, min, max, step, value, fmt } → élément + lecture de la valeur. */
function slider(o, onInput) {
  const val = h('span', { class: 'val' }, o.fmt(o.value));
  const input = h('input', { type: 'range', min: o.min, max: o.max, step: o.step, value: o.value, oninput: (e) => { val.textContent = o.fmt(+e.target.value); onInput(); } });
  return { el: h('label', { class: 'row slider' }, h('span', {}, o.label), input, val), get: () => +input.value };
}

function widget(title, sliders, draw, legend) {
  const canvas = h('canvas', { class: 'chart small' });
  const out = h('div', { class: 'small widget-out' });
  const s = {};
  const redraw = () => { const v = Object.fromEntries(Object.entries(s).map(([k, x]) => [k, x.get()])); draw(canvas, v, out); };
  for (const [k, o] of Object.entries(sliders)) s[k] = slider(o, redraw);
  const el = h('div', { class: 'livret-widget' }, h('div', { class: 'widget-title' }, '🧪 ', title), canvas, legend ? h('div', { class: 'small muted' }, legend) : null, Object.values(s).map((x) => x.el), out);
  // dessin une fois l'élément affiché (le canvas a besoin de sa taille)
  new ResizeObserver(() => redraw()).observe(canvas);
  return el;
}

const f2 = (v) => fmt(v, 2), f1 = (v) => fmt(v, 1), f0 = (v) => fmt(v, 0);

export const WIDGETS = {
  michaelis: () => widget('Vitesse d\'une enzyme selon la concentration de substrat', {
    vmax: { label: 'Vmax', min: 0.5, max: 5, step: 0.1, value: 2, fmt: f1 },
    km: { label: 'Km', min: 0.05, max: 3, step: 0.05, value: 0.5, fmt: f2 },
  }, (cv, v, out) => {
    lineChart(cv, [
      { color: '#4cc9f0', width: 2.2, points: curve((s) => (v.vmax * s) / (v.km + s), 0, 5) },
      { color: 'rgba(255,255,255,0.35)', dashed: true, points: [[0, v.vmax], [5, v.vmax]] },
      { color: 'rgba(249,199,79,0.6)', dashed: true, points: [[v.km, 0], [v.km, v.vmax / 2]] },
    ], { yMax: 5, xFmt: (x) => `${f1(x)}` });
    const sat = 5 / (v.km + 5);
    out.textContent = `À [S] = Km = ${f2(v.km)}, la vitesse vaut Vmax/2 = ${f2(v.vmax / 2)}. À [S] = 5, elle atteint ${Math.round(sat * 100)} % de Vmax : ${sat > 0.85 ? 'l\'enzyme est presque saturée (Km bas = grande affinité).' : 'l\'enzyme est encore loin de la saturation (Km élevé = faible affinité).'}`;
  }, 'Axe horizontal : concentration de substrat [S] ; vertical : vitesse v. Pointillés : Vmax et Km.'),

  cooperativite: () => widget('Réponse coopérative (équation de Hill)', {
    n: { label: 'Coefficient n', min: 1, max: 5, step: 0.5, value: 3, fmt: f1 },
    k: { label: 'Seuil K', min: 0.2, max: 3, step: 0.1, value: 1, fmt: f1 },
  }, (cv, v, out) => {
    lineChart(cv, [
      { color: 'rgba(255,255,255,0.4)', dashed: true, points: curve((s) => s / (v.k + s), 0, 5) },
      { color: '#80ffdb', width: 2.2, points: curve((s) => s ** v.n / (v.k ** v.n + s ** v.n), 0, 5) },
    ], { yMax: 1, xFmt: (x) => f1(x) });
    const lo = (0.5 * v.k) ** v.n / (v.k ** v.n + (0.5 * v.k) ** v.n), hi = (2 * v.k) ** v.n / (v.k ** v.n + (2 * v.k) ** v.n);
    out.textContent = `Entre K/2 et 2K, l'activité passe de ${Math.round(lo * 100)} % à ${Math.round(hi * 100)} % (contre 33 % → 67 % sans coopérativité, en pointillés) : un vrai interrupteur, comme le quorum sensing.`;
  }, 'Axe horizontal : signal ou substrat ; vertical : fraction d\'activité.'),

  surface_volume: () => widget('Rapport surface / volume', {
    r: { label: 'Rayon (µm)', min: 0.3, max: 10, step: 0.1, value: 1, fmt: f1 },
    a: { label: 'Allongement', min: 1, max: 6, step: 0.5, value: 3, fmt: (x) => `×${f1(x)}` },
  }, (cv, v, out) => {
    const sphere = (r) => 3 / r;
    const rod = (r) => { const L = 2 * r * (v.a - 1); return (2 * Math.PI * r * L + 4 * Math.PI * r * r) / (Math.PI * r * r * L + (4 / 3) * Math.PI * r ** 3); };
    lineChart(cv, [
      { color: '#f9c74f', width: 2, points: curve(sphere, 0.3, 10) },
      { color: '#90be6d', width: 2, points: curve(rod, 0.3, 10) },
    ], { log: true, markers: [{ x: v.r, color: '#fff' }], xFmt: (x) => `${f0(x)} µm` });
    out.textContent = `Rayon ${f1(v.r)} µm : sphère S/V = ${f2(sphere(v.r))} µm⁻¹ (jaune), bâtonnet ×${f1(v.a)} S/V = ${f2(rod(v.r))} µm⁻¹ (vert). Doubler le rayon divise S/V par 2 : chaque µm³ reçoit deux fois moins de nourriture.`;
  }, 'Axe horizontal : rayon ; vertical : S/V (échelle log). Trait blanc : votre choix.'),

  temperature_ph: () => widget('Activité d\'une enzyme selon la température', {
    t: { label: 'T° optimale', min: 5, max: 90, step: 1, value: 35, fmt: (x) => `${f0(x)} °C` },
    w: { label: 'Tolérance', min: 4, max: 30, step: 1, value: 15, fmt: (x) => `± ${f0(x)} °C` },
  }, (cv, v, out) => {
    lineChart(cv, [{ color: '#ff6b35', width: 2.2, points: curve((T) => Math.exp(-(((T - v.t) / v.w) ** 2)), 0, 100) }], { yMax: 1, xFmt: (x) => `${f0(x)}°` });
    const at = (T) => Math.round(Math.exp(-(((T - v.t) / v.w) ** 2)) * 100);
    out.textContent = `À 20 °C : ${at(20)} % · à 37 °C : ${at(37)} % · à 60 °C : ${at(60)} % de l'activité maximale. Une enzyme « large » tolère plus de milieux mais (dans la réalité) est souvent moins rapide.`;
  }, 'Axe horizontal : température ; vertical : activité relative (même forme pour le pH).'),

  cycle_cellulaire: () => widget('Croissance d\'une population', {
    d: { label: 'Temps de doublement', min: 1, max: 30, step: 1, value: 5, fmt: (x) => `${f0(x)} min` },
    k: { label: 'Capacité du milieu', min: 100, max: 5000, step: 100, value: 1000, fmt: (x) => `${f0(x)} cellules` },
  }, (cv, v, out) => {
    const r = Math.log(2) / v.d, n0 = 10;
    lineChart(cv, [
      { color: 'rgba(255,255,255,0.4)', dashed: true, points: curve((t) => Math.min(1e5, n0 * Math.exp(r * t)), 0, 120) },
      { color: '#43aa8b', width: 2.2, points: curve((t) => v.k / (1 + ((v.k - n0) / n0) * Math.exp(-r * t)), 0, 120) },
    ], { log: true, xFmt: (x) => `${f0(x)} min` });
    const tHalf = Math.log((v.k - n0) / n0) / r;
    out.textContent = `Sans limite (pointillés), 10 cellules deviennent ${fmt(n0 * Math.exp(r * 120), 0)} en 2 h. Avec un milieu limité (vert, croissance logistique), la population atteint la moitié de la capacité vers ${f0(tHalf)} min puis plafonne.`;
  }, 'Axe horizontal : temps ; vertical : effectif (échelle log).'),

  ph: () => widget('L\'échelle logarithmique du pH', {
    p: { label: 'pH', min: 1, max: 13, step: 0.1, value: 7, fmt: f1 },
  }, (cv, v, out) => {
    lineChart(cv, [{ color: '#e0aaff', width: 2.2, points: curve((p) => 10 ** (7 - p), 4, 10) }], { log: true, markers: [{ x: v.p, color: '#fff' }], xFmt: (x) => `pH ${f0(x)}` });
    const ratio = 10 ** (7 - v.p);
    out.textContent = ratio >= 1 ? `À pH ${f1(v.p)}, il y a ${fmt(ratio, ratio < 10 ? 1 : 0)} fois plus d'ions H⁺ qu'à pH 7.` : `À pH ${f1(v.p)}, il y a ${fmt(1 / ratio, 1 / ratio < 10 ? 1 : 0)} fois moins d'ions H⁺ qu'à pH 7.`;
  }, 'Axe horizontal : pH ; vertical : concentration en H⁺ relative à pH 7 (échelle log).'),
};
