// Classements : records des populations (vivantes ou éteintes) et des joueurs.

/** Fiche de record d'une population (vivante ou non). */
export function recordOf(p, now) {
  const end = p.extinct ? (p.extinctAt ?? now) : now;
  return {
    name: p.name, owner: p.ownerName, ownerId: p.ownerId, color: p.color,
    maxCount: p.maxCount || 0, life: Math.max(0, Math.round(end - (p.launchedAt || 0))), maxGeneration: p.maxGeneration || 0,
    kills: p.kills || 0, alive: !p.extinct,
  };
}

export const BOARDS = [
  { key: 'maxCount', title: 'Plus grande population', unit: 'cellules' },
  { key: 'life', title: 'Plus longue survie', unit: 's' },
  { key: 'maxGeneration', title: 'Plus de générations', unit: 'générations' },
  { key: 'kills', title: 'Meilleurs prédateurs', unit: 'proies' },
];

/** Top 10 de chaque catégorie (un nom de population n'apparaît qu'une fois par catégorie). */
export function topLists(entries) {
  const out = {};
  for (const b of BOARDS) {
    const seen = new Set();
    out[b.key] = entries.filter((e) => e[b.key] > 0).sort((a, b2) => b2[b.key] - a[b.key])
      .filter((e) => { const k = `${e.ownerId}|${e.name}`; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 10);
  }
  return out;
}
