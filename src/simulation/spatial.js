// Grille spatiale (hachage par cases) reconstruite à chaque tick : requêtes de voisinage en O(1) moyen.
export class SpatialHash {
  constructor(width, height, bucket = 16) {
    this.bucket = bucket;
    this.bw = Math.ceil(width / bucket) + 1;
    this.bh = Math.ceil(height / bucket) + 1;
    this.head = new Int32Array(this.bw * this.bh);
    this.count = new Int32Array(this.bw * this.bh);
    this.next = new Int32Array(1024);
  }
  rebuild(cells) {
    this.head.fill(-1);
    this.count.fill(0);
    if (this.next.length < cells.length) this.next = new Int32Array(cells.length * 2);
    this.cells = cells;
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      const b = this.key(c.x, c.y);
      this.next[i] = this.head[b];
      this.head[b] = i;
      this.count[b]++;
    }
  }
  key(x, y) {
    const bx = Math.max(0, Math.min(this.bw - 1, Math.floor(x / this.bucket)));
    const by = Math.max(0, Math.min(this.bh - 1, Math.floor(y / this.bucket)));
    return by * this.bw + bx;
  }
  /** Appelle fn(index) pour chaque cellule dont le centre est dans le carré [x±r, y±r]. */
  query(x, y, r, fn) {
    const b = this.bucket;
    const x0 = Math.max(0, Math.floor((x - r) / b)), x1 = Math.min(this.bw - 1, Math.floor((x + r) / b));
    const y0 = Math.max(0, Math.floor((y - r) / b)), y1 = Math.min(this.bh - 1, Math.floor((y + r) / b));
    for (let by = y0; by <= y1; by++) for (let bx = x0; bx <= x1; bx++) {
      for (let i = this.head[by * this.bw + bx]; i !== -1; i = this.next[i]) if (fn(i) === false) return;
    }
  }
}
