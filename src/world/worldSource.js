// Interface entre le monde local et « les autres utilisateurs ».
// Aujourd'hui : populations fantômes simulées localement (GhostWorldSource).
// Demain : un backend multi-utilisateurs implémentera la même interface (ex. RemoteWorldSource via WebSocket),
// en recevant les lancements locaux et en injectant les populations distantes.

/**
 * @interface WorldSource
 * attach(world)                  appelé une fois quand la source est branchée au monde
 * update(world, dt)              appelé à chaque pas de simulation (peut lancer / retirer des populations)
 * onLaunch(world, population)    une population (locale ou non) vient d'être lancée
 * onExtinction(world, population) une population vient de s'éteindre
 * serialize() / deserialize(obj) état persistant de la source
 * users()                        liste des utilisateurs connus { id, name, profile, online }
 */
export class WorldSource {
  attach(world) { this.world = world; }
  update(world, dt) {}
  onLaunch(world, pop) {}
  onExtinction(world, pop) {}
  serialize() { return {}; }
  deserialize(obj) {}
  users() { return []; }
}
