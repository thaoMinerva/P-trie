// Lignées : résumé compact d'un génome, distance entre souches et description lisible des mutations.
import { ORG } from '../data/index.js';

/** Ce qui compte pour distinguer deux souches (et reste léger à sauvegarder / envoyer). */
export function compactGenome(g) {
  return {
    enzymes: { ...g.enzymes }, organelles: { ...g.organelles },
    size: +g.shape.size.toFixed(3), wall: +(g.envelope.wall || 0).toFixed(3),
  };
}

/** Distance : écarts de concentration (log), gènes gagnés/perdus, organites, taille, paroi. */
export function strainDistance(a, b) {
  let d = 0;
  for (const id of new Set([...Object.keys(a.enzymes), ...Object.keys(b.enzymes)])) {
    const x = a.enzymes[id], y = b.enzymes[id];
    d += x === undefined || y === undefined ? 3 : Math.max(0, Math.abs(Math.log(x / y)) - 0.2); // la petite dérive ne compte pas
  }
  for (const id of new Set([...Object.keys(a.organelles), ...Object.keys(b.organelles)])) d += 2 * Math.abs((a.organelles[id] || 0) - (b.organelles[id] || 0));
  d += 4 * Math.abs(Math.log(a.size / b.size));
  d += 4 * Math.abs(a.wall - b.wall);
  return d;
}

const pct = (r) => `${r > 1 ? '+' : '−'}${Math.round(Math.abs(r - 1) * 100)} %`;

/** Les 3 changements les plus marquants de a vers b, en français. */
export function describeChanges(a, b, nameOf = (id) => id) {
  const out = [];
  for (const id of new Set([...Object.keys(a.enzymes), ...Object.keys(b.enzymes)])) {
    const x = a.enzymes[id], y = b.enzymes[id];
    if (x === undefined) out.push([10, `+ ${nameOf(id)}`]);
    else if (y === undefined) out.push([10, `− ${nameOf(id)} (perdue)`]);
    else if (Math.abs(Math.log(y / x)) > 0.2) out.push([Math.abs(Math.log(y / x)), `${nameOf(id)} ${pct(y / x)}`]);
  }
  for (const id of new Set([...Object.keys(a.organelles), ...Object.keys(b.organelles)])) {
    const x = a.organelles[id] || 0, y = b.organelles[id] || 0;
    if (x !== y) out.push([5, `${ORG[id]?.name || id} ${x} → ${y}`]);
  }
  if (Math.abs(Math.log(b.size / a.size)) > 0.05) out.push([Math.abs(Math.log(b.size / a.size)) * 8, `taille ${pct(b.size / a.size)}`]);
  if (Math.abs(b.wall - a.wall) > 0.03) out.push([Math.abs(b.wall - a.wall) * 8, `paroi ${a.wall.toFixed(2)} → ${b.wall.toFixed(2)}`]);
  return out.sort((p, q) => q[0] - p[0]).slice(0, 3).map((x) => x[1]);
}
