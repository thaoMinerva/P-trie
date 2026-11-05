// Identité du joueur local : 'joueur' en solo, identifiant attribué par le serveur en multijoueur.
export const identity = { id: 'joueur', name: 'Vous', multiplayer: false };
export const isMine = (pop) => pop && pop.ownerId === identity.id;
