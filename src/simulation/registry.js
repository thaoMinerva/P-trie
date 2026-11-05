// Registre des enzymes disponibles dans un monde (bibliothèque de base + enzymes personnalisées).
import { ENZYMES } from '../data/index.js';
import { analyzeReaction } from './chem.js';

export class EnzymeRegistry {
  constructor() {
    this.map = new Map();
    for (const e of ENZYMES) this.map.set(e.id, e);
  }
  get(id) { return this.map.get(id); }
  has(id) { return this.map.has(id); }
  all() { return [...this.map.values()]; }
  /** Enregistre une enzyme personnalisée après vérification (pas d'enzyme magique). */
  register(def) {
    const a = analyzeReaction(def.substrates, def.products);
    if (!a.balanced || !a.exergonic) throw new Error(`Enzyme « ${def.name} » refusée : ${a.errors.join(' ; ')}`);
    if (!this.map.has(def.id)) this.map.set(def.id, def);
    return def;
  }
}
