// Analyse statique d'une conception : budgets, bilan énergétique estimé, avertissements de viabilité.
import { PARAMS, MET } from '../data/index.js';
import { normalizeDesign, computePhenotype } from './genome.js';

const CARBON_SOURCES = ['glucose', 'lactate', 'ethanol', 'acetate', 'aa', 'starch', 'cellulose', 'protein', 'co2', 'pyruvate'];

export function analyzeDesign(design, registry) {
  const d = normalizeDesign(design);
  for (const ce of d.customEnzymes || []) if (!registry.has(ce.id)) { try { registry.register(ce); } catch { /* signalé plus bas */ } }
  const ph = computePhenotype(d, registry);
  const errors = [], warnings = [], info = [];
  const enz = ph.enzymes;
  const consumes = (m) => enz.some((e) => e.subs.some((s) => s.m === m));
  const produces = (m) => enz.some((e) => e.prods.some((p) => p.m === m));

  // Organites et enzymes sont comptés en fraction du volume : agrandir la cellule ne libère pas de place
  // (une grande cellule a besoin de proportionnellement autant de machinerie).
  const pctVol = (ph.volUsed * 100).toFixed(0);
  if (ph.volUsed > 1) errors.push(`Impossible : organites et enzymes occupent ${pctVol} % du volume, il n'y a plus de place pour le cytoplasme. Retirez des organites ou baissez des concentrations.`);
  else if (ph.volUsed > 0.7) warnings.push(`Cytoplasme encombré (${pctVol} % du volume) : les enzymes ne tournent plus qu'à ${(ph.crowding * 100).toFixed(0)} % de leur vitesse (encombrement moléculaire).`);
  if (!enz.length) errors.push('Aucune enzyme : la cellule ne peut rien métaboliser.');
  if (ph.membraneUsed > 1) errors.push(`Membrane saturée : les protéines membranaires occupent ${(ph.membraneUsed * 100).toFixed(0)} % de la surface (max 100 %).`);
  for (const e of enz) if (e.lytic && e.lytic === ph.lyticTarget) warnings.push(`${e.def.name} attaque votre propre paroi (${ph.wallName}) : changez de matériau ou ajoutez l'O-acétylation.`);
  if (enz.some((e) => e.id === 'arn_polymerase' || e.id === 'adn_polymerase') && !consumes('adn') && !consumes('arn') && !produces('nucleotide') && !(d.membraneProteins?.t_nucleotide)) info.push('Les polymérases utilisent les nucléotides du milieu (issus de l\'ADN/ARN des cadavres) : une ADNase/ARNase ou la synthèse de nucléotides les rend plus efficaces.');

  // Communication, biofilm, défenses
  const quorumIds = Object.keys(d.quorum || {});
  if (quorumIds.length && !d.enzymes.synthase_signal) info.push('Les enzymes « quorum » ne s\'activeront qu\'avec le signal d\'autres populations (sans synthase d\'autoinducteur, votre cellule ne fait qu\'écouter).');
  if (quorumIds.length && d.enzymes.synthase_signal) info.push(`${quorumIds.length} enzyme(s) ne s'activeront que lorsque la population sera dense (quorum sensing).`);
  if (d.envelope.biofilm && ph.motile) warnings.push('En biofilm, la mobilité est réduite de 85 % dès que la cellule touche ses sœurs.');
  if (d.envelope.biofilm) info.push('Biofilm : la protection augmente avec le nombre de cellules sœurs collées (jusqu\'à 60 %).');
  if (consumes('uree')) info.push('L\'uréase libère de l\'ammonium : le milieu autour de la population devient basique.');
  if (!ph.euk && !ph.crispr && !ph.restriction) info.push('Aucune défense antivirale : en cas d\'invasion de phages, la population sera vulnérable si elle est la plus abondante de sa zone.');

  // Carbone et énergie
  const photo = enz.some((e) => e.subs.some((s) => s.i < 0));
  const fixC = consumes('co2') && produces('glucose');
  const carbon = CARBON_SOURCES.filter((m) => m !== 'co2' && consumes(m));
  if (!carbon.length && !fixC && !ph.phagocyte && !ph.parasite) errors.push('Aucune source de carbone exploitable (ni sucre, ni acides aminés, ni fixation du CO₂, ni phagocytose).');
  if (consumes('glucose') === false && produces('glucose')) warnings.push('Du glucose est produit mais aucune enzyme ne le consomme (ajoutez la glycolyse).');
  if (!consumes('glucose') && (carbon.includes('starch') || carbon.includes('cellulose'))) warnings.push("Amidon/cellulose sont dégradés en glucose, mais aucune enzyme ne transforme le glucose.");
  const nadhMakers = enz.filter((e) => e.prods.some((p) => p.m === 'nadh'));
  const nadhUsers = enz.filter((e) => e.subs.some((s) => s.m === 'nadh') && e.id !== 'synthese_aa');
  if (nadhMakers.length && !nadhUsers.length) errors.push('Le NADH produit n\'est jamais réoxydé : ajoutez une chaîne respiratoire ou une fermentation, sinon le métabolisme se bloque.');
  if (photo && !consumes('co2')) warnings.push('Photosystèmes sans cycle de Calvin : la lumière fournit de l\'énergie mais pas de carbone.');
  if (fixC && !photo) warnings.push('Le cycle de Calvin coûte 18 ATP et 12 NADH par glucose : sans photosystèmes, il ruine la cellule.');
  if (photo && ph.euk && ph.chloroFactor === 0) errors.push('Un eucaryote photosynthétique a besoin de chloroplastes.');
  const atpMakers = enz.filter((e) => e.makesAtp);
  if (!atpMakers.length) errors.push("Aucune enzyme ne produit d'ATP.");

  // Azote
  if (!consumes('nh4') && !consumes('aa') && !consumes('protein') && !ph.phagocyte && !ph.parasite) errors.push("Aucune source d'azote : impossible de fabriquer des acides aminés (ajoutez la synthèse d'acides aminés).");
  if (consumes('nh4') && !produces('nh4')) info.push('Dépend de l\'ammonium du milieu.');
  if (consumes('n2')) info.push('Fixe l\'azote atmosphérique (très coûteux, inhibé par l\'O₂).');
  if (consumes('n2') && consumes('o2')) warnings.push('La nitrogénase est inhibée par l\'O₂ produit/consommé : une capsule ou une respiration intense la protège en partie.');

  // Compartiments
  for (const e of enz) {
    if (ph.euk && e.def.location === 'mitochondrie' && ph.mitoFactor === 0) warnings.push(`${e.def.name} : aucune mitochondrie, l'enzyme fonctionne à ${(e.cap * 100).toFixed(0)} % sur la membrane plasmique.`);
    if (!ph.euk && e.loc === 'membrane' && e.cap < 0.5) warnings.push(`${e.def.name} : cellule trop grosse, la membrane ne suffit plus (${(e.cap * 100).toFixed(0)} % de capacité).`);
  }
  if (consumes('o2') && produces('ros') && !consumes('ros') && !ph.rosDetox) warnings.push('Métabolisme aérobie ou photosynthétique sans catalase : risque de stress oxydatif.');
  if (produces('toxin') && !consumes('toxin')) warnings.push('Produit une toxine sans détoxifiase : la cellule risque de s\'empoisonner elle-même.');
  if (!ph.osmoProtect && !ph.osmoregulation) warnings.push('Ni paroi ni vacuole contractile : la cellule éclatera en eau douce (choc osmotique).');
  if (ph.euk && (d.organelles.lysosome || 0) > 0 && !ph.phagocyte) warnings.push('Des lysosomes sont présents mais la paroi empêche la phagocytose.');
  if (ph.phagocyte) info.push(`Phagocyte : peut engloutir les cellules ${PARAMS.interactions.phagoSizeRatio}× plus petites.`);
  if (ph.parasite) info.push('Parasite : se fixe sur des hôtes plus grands, transporteurs réduits en vie libre.');
  if (ph.adhesins) info.push('Adhésines : peut former des associations symbiotiques avec d\'autres espèces porteuses d\'adhésines.');

  // Bilan énergétique à vide
  const founderAtp = Math.min(ph.atpCap, PARAMS.cell.founderAtpPerVolume * ph.V);
  const autonomy = founderAtp / ph.upkeep;
  if (autonomy < 4) errors.push(`Entretien trop coûteux : l'ATP de départ (${founderAtp.toFixed(1)}) ne couvre que ${autonomy.toFixed(1)} s d'entretien.`);
  return { design: d, ph, errors, warnings: [...new Set(warnings)], info, autonomy, founderAtp };
}
