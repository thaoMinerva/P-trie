// Chimie : bilan des éléments et de l'énergie libre d'une réaction (garde-fou contre les enzymes « magiques »).
import { MET } from '../data/index.js';

export const ELEMENTS = ['C', 'N', 'P', 'Nic'];

/** Somme des éléments d'un côté de la réaction. */
export function elementTotals(side) {
  const tot = { C: 0, N: 0, P: 0, Nic: 0 };
  for (const [id, n] of Object.entries(side || {})) {
    const m = MET[id];
    if (!m) throw new Error(`Métabolite inconnu : ${id}`);
    for (const [el, k] of Object.entries(m.elements)) tot[el] += k * n;
  }
  return tot;
}

export function energyTotal(side) {
  let e = 0;
  for (const [id, n] of Object.entries(side || {})) e += (MET[id]?.energy ?? 0) * n;
  return e;
}

/**
 * Analyse une réaction. Retourne { balanced, elementDelta, deltaG, exergonic, errors[] }.
 * deltaG = énergie(produits) − énergie(substrats) (équivalents ATP) ; doit être ≤ 0.
 */
export function analyzeReaction(substrates, products) {
  const errors = [];
  for (const id of [...Object.keys(substrates || {}), ...Object.keys(products || {})]) {
    if (!MET[id]) errors.push(`Métabolite inconnu : ${id}`);
  }
  if (errors.length) return { balanced: false, exergonic: false, errors, elementDelta: {}, deltaG: 0 };
  const a = elementTotals(substrates), b = elementTotals(products);
  const elementDelta = {};
  let balanced = true;
  for (const el of ELEMENTS) {
    elementDelta[el] = +(b[el] - a[el]).toFixed(6);
    if (Math.abs(elementDelta[el]) > 1e-6) {
      balanced = false;
      const names = { C: 'carbone', N: 'azote', P: 'phosphore', Nic: 'NAD (nicotinamide)' };
      errors.push(`${elementDelta[el] > 0 ? 'Création' : 'Disparition'} de ${names[el]} : ${elementDelta[el] > 0 ? '+' : ''}${elementDelta[el]}`);
    }
  }
  const deltaG = energyTotal(products) - energyTotal(substrates);
  const exergonic = deltaG <= 1e-6;
  if (!exergonic) errors.push(`Réaction endergonique : les produits contiennent ${deltaG.toFixed(2)} ATP-éq. de plus que les substrats (ajoutez de l'ATP ou du NADH en substrat).`);
  if (!Object.keys(substrates || {}).length) errors.push('Aucun substrat.');
  return { balanced, exergonic, deltaG, elementDelta, errors };
}
