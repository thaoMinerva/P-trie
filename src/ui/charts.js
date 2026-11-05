// Graphiques minimalistes en Canvas 2D.
function niceStep(range, target = 5) {
  const raw = range / target, p = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  const n = raw / p;
  return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * p;
}

/**
 * series : [{ label, color, points: [[x, y], ...], width, dashed }]
 * opts : { xLabel, yLabel, log, xFmt, yMin, yMax, legend }
 */
export function lineChart(canvas, series, opts = {}) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  if (!rect.width) return;
  canvas.width = Math.round(rect.width * dpr); canvas.height = Math.round(rect.height * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const W = rect.width, H = rect.height;
  const css = getComputedStyle(document.documentElement);
  const fg = css.getPropertyValue('--muted').trim() || '#9ab';
  const grid = css.getPropertyValue('--line').trim() || 'rgba(255,255,255,0.08)';
  ctx.clearRect(0, 0, W, H);
  const pad = { l: 42, r: 10, t: 10, b: 22 };
  let x0 = Infinity, x1 = -Infinity, y0 = opts.yMin ?? 0, y1 = opts.yMax ?? -Infinity;
  for (const s of series) for (const [x, y] of s.points) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); if (opts.yMax === undefined) y1 = Math.max(y1, y); }
  if (!Number.isFinite(x0)) { ctx.fillStyle = fg; ctx.font = '12px system-ui'; ctx.fillText(opts.empty || 'Pas encore de données', pad.l, H / 2); return; }
  if (x1 === x0) x1 = x0 + 1;
  if (!(y1 > y0)) y1 = y0 + 1;
  const log = opts.log;
  const ty = (y) => log ? Math.log10(1 + y) : y;
  const Y0 = ty(y0), Y1 = ty(y1) * 1.05;
  const px = (x) => pad.l + ((x - x0) / (x1 - x0)) * (W - pad.l - pad.r);
  const py = (y) => H - pad.b - ((ty(y) - Y0) / (Y1 - Y0)) * (H - pad.t - pad.b);
  ctx.font = '10px system-ui'; ctx.fillStyle = fg; ctx.strokeStyle = grid; ctx.lineWidth = 1;
  const yt = log ? [0, 1, 10, 100, 1000, 10000].filter((v) => v <= y1 * 1.05) : (() => { const st = niceStep(y1 - y0, 4); const a = []; for (let v = Math.ceil(y0 / st) * st; v <= y1 * 1.05; v += st) a.push(+v.toPrecision(6)); return a; })();
  ctx.textAlign = 'right';
  for (const v of yt) { const y = py(v); ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(W - pad.r, y); ctx.stroke(); ctx.fillText(String(v).replace('.', ','), pad.l - 4, y + 3); }
  const xs = niceStep(x1 - x0, 6);
  ctx.textAlign = 'center';
  for (let v = Math.ceil(x0 / xs) * xs; v <= x1; v += xs) { const x = px(v); ctx.fillText(opts.xFmt ? opts.xFmt(v) : String(+v.toPrecision(4)).replace('.', ','), x, H - 6); }
  for (const s of series) {
    if (!s.points.length) continue;
    ctx.beginPath();
    s.points.forEach(([x, y], i) => (i ? ctx.lineTo(px(x), py(y)) : ctx.moveTo(px(x), py(y))));
    ctx.strokeStyle = s.color; ctx.lineWidth = s.width || 1.6;
    ctx.setLineDash(s.dashed ? [4, 3] : []);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  if (opts.yLabel) { ctx.save(); ctx.translate(10, pad.t + 4); ctx.textAlign = 'left'; ctx.fillStyle = fg; ctx.fillText(opts.yLabel, 4, 6); ctx.restore(); }
  if (opts.markers) for (const m of opts.markers) { const x = px(m.x); ctx.strokeStyle = m.color || '#fff'; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, H - pad.b); ctx.stroke(); ctx.setLineDash([]); }
}
