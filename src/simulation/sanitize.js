// Validation d'une conception reçue d'un autre joueur (serveur multijoueur) :
// chaque élément personnalisé est RECONSTRUIT à partir de ses briques, ce qui empêche d'envoyer des
// paramètres trafiqués (kcat énorme, coût nul…). Les identifiants sont préfixés par le joueur pour éviter
// qu'un joueur écrase les créations d'un autre.
import { buildEnzyme } from './enzymeDesign.js';
import { buildOrganelle } from './organelleDesign.js';
import { buildWall, buildMembraneProtein } from './envelopeDesign.js';
import { normalizeDesign } from './genome.js';

function renameKey(obj, from, to) { if (obj && from in obj && from !== to) { obj[to] = obj[from]; delete obj[from]; } }

export function sanitizeDesign(raw, playerId) {
  const d = JSON.parse(JSON.stringify(raw || {}));
  const pre = (id) => (id.startsWith(`${playerId}:`) ? id : `${playerId}:${id}`);
  const fail = (what, errs) => { throw new Error(`${what} refusé(e) : ${errs.join(' ; ')}`); };

  d.customEnzymes = (d.customEnzymes || []).map((e) => {
    const b = e.bricks || {};
    const r = buildEnzyme({ name: e.name, substrates: e.substrates, products: e.products, activeSite: b.activeSite, domains: b.domains, signal: b.signal, tradeoff: b.tradeoff }, pre(e.id));
    if (!r.ok) fail(`Enzyme « ${e.name} »`, r.errors);
    renameKey(d.enzymes, e.id, r.def.id);
    renameKey(d.quorum, e.id, r.def.id);
    return r.def;
  });
  d.customOrganelles = (d.customOrganelles || []).map((o) => {
    const b = o.bricks || {};
    const r = buildOrganelle({ name: o.name, color: o.color, membrane: b.membrane, size: b.size, modules: b.modules, max: o.max }, pre(o.id));
    if (!r.ok) fail(`Organite « ${o.name} »`, r.errors);
    renameKey(d.organelles, o.id, r.def.id);
    renameKey(d.organellePositions, o.id, r.def.id);
    return r.def;
  });
  d.customWalls = (d.customWalls || []).map((w) => {
    const b = w.bricks || {};
    const r = buildWall({ name: w.name, color: w.color, base: b.base, modifications: b.modifications }, pre(w.id));
    if (!r.ok) fail(`Paroi « ${w.name} »`, r.errors);
    if (d.envelope?.wallType === w.id) d.envelope.wallType = r.def.id;
    return r.def;
  });
  d.customMembraneProteins = (d.customMembraneProteins || []).map((m) => {
    const b = m.bricks || {};
    const r = buildMembraneProtein({ name: m.name, mechanism: b.mechanism, met: b.met }, pre(m.id));
    if (!r.ok) fail(`Protéine « ${m.name} »`, r.errors);
    renameKey(d.membraneProteins, m.id, r.def.id);
    return r.def;
  });
  // Toute référence à un élément personnalisé non fourni est retirée par la normalisation.
  d.name = String(d.name || 'Organisme').slice(0, 40);
  d.color = /^#[0-9a-f]{6}$/i.test(d.color) ? d.color : '#4ea8de';
  return normalizeDesign(d);
}
