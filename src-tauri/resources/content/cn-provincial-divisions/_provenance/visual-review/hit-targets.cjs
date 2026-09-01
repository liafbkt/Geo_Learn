// Offline analysis of DOM-observed SVG only; never edits the map or browser state.
const fs = require('node:fs');
const path = require('node:path');
const dom = JSON.parse(fs.readFileSync(path.join(__dirname, 'rendered-svg.json'), 'utf8'));
const entities = JSON.parse(fs.readFileSync(path.join(__dirname, '../../entities.json'), 'utf8'));
const inside = (p, ring) => {
  let result = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) result = !result;
  }
  return result;
};
const distance = (p, a, b) => {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
};
const targets = dom.regions.map(region => {
  const rings = region.d.split('M').filter(Boolean).map(s => Array.from(s.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g), m => [Number(m[1]), Number(m[2])]));
  let point = null, clearance = -Infinity;
  for (const ring of rings) {
    const xs = ring.map(p => p[0]), ys = ring.map(p => p[1]);
    const lo = [Math.min(...xs), Math.min(...ys)], hi = [Math.max(...xs), Math.max(...ys)];
    for (let iy = 1; iy < 31; iy++) for (let ix = 1; ix < 31; ix++) {
      const p = [lo[0] + (hi[0] - lo[0]) * ix / 31, lo[1] + (hi[1] - lo[1]) * iy / 31];
      if (rings.filter(r => inside(p, r)).length % 2 !== 1) continue;
      let score = Infinity;
      for (const r of rings) for (let i = 0; i < r.length; i++) score = Math.min(score, distance(p, r[i], r[(i + 1) % r.length]));
      for (const marker of dom.places) score = Math.min(score, Math.hypot(p[0] - Number(marker.cx), p[1] - Number(marker.cy)) - Number(marker.r) - 0.4);
      if (score > clearance) { point = p; clearance = score; }
    }
  }
  return { label: region.label, id: entities.find(e => e.kind === 'region' && region.label === `${e.names.zh} / ${e.names.en}`).id, point, clearance };
});
const result = { method: '31-grid sampling within actual SVG paths, excluding circle footprints with 0.4 SVG-unit margin; negative clearance is a warning, not a proof of total occlusion.', targets };
fs.writeFileSync(path.join(__dirname, 'svg-hit-targets.json'), JSON.stringify(result, null, 2) + '\n');
const capitalTargets = dom.places.map((marker, index) => {
  let point = null, clearance = -Infinity;
  const x = Number(marker.cx), y = Number(marker.cy), radius = Number(marker.r);
  for (let ix = -20; ix <= 20; ix++) for (let iy = -20; iy <= 20; iy++) {
    const p = [x + ix * radius / 20, y + iy * radius / 20];
    let score = radius - Math.hypot(p[0] - x, p[1] - y);
    for (const later of dom.places.slice(index + 1)) score = Math.min(score, Math.hypot(p[0] - Number(later.cx), p[1] - Number(later.cy)) - Number(later.r));
    if (score > clearance) { point = p; clearance = score; }
  }
  return { id: `${targets[index].id}-capital`, point, clearance };
});
fs.writeFileSync(path.join(__dirname, 'capital-hit-targets.json'), JSON.stringify(capitalTargets, null, 2) + '\n');
console.log(JSON.stringify(targets.map(({ id, clearance }) => ({ id, clearance: Number(clearance.toFixed(2)) })), null, 2));
