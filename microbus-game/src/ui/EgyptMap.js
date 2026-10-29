// =====================================================================
//  خريطة مصر الصغيرة في شاشة البداية: حدود مصر من OpenStreetMap (علاقة 1473947، مبسّطة) + نقطة لكل مدينة.
//  الدوس على نقطة = اختيار المدينة دي.
// =====================================================================
const OUTLINE = '4.8,36.0 9.2,30.2 11.7,23.5 8.8,16.3 8.7,11.7 13.0,8.6 14.1,6.3 28.3,3.2 36.4,3.8 58.2,8.5 61.6,11.5 68.0,10.8 70.9,13.5 78.7,13.7 89.3,17.7 101.2,13.1 112.7,6.0 117.3,6.3 126.8,3.9 131.5,4.2 138.6,6.5 142.6,5.2 146.0,5.4 150.8,9.1 155.7,10.5 158.7,13.6 168.1,10.8 178.4,12.9 185.7,10.3 189.2,13.5 194.2,25.4 195.1,30.5 196.4,31.3 200.9,43.1 202.3,49.0 193.6,76.4 194.6,82.4 189.5,89.0 189.0,97.6 190.9,100.5 194.2,111.7 201.4,122.9 205.0,126.1 211.3,137.1 211.7,140.1 219.7,146.6 222.8,153.3 233.4,160.5 233.7,173.9 238.0,178.7 239.3,183.1 242.5,185.4 244.5,192.3 11.5,192.3 11.5,52.9 9.2,48.0 9.9,46.0 7.9,42.6 7.9,39.6 6.5,36.6 4.8,36.0';
const W = 24.4, N = 32.0, SC = 19.2308;
const P = (lon, lat) => [(lon - W) * SC, (N - lat) * SC];

export function drawEgypt(svg, maps, current, onPick) {
  if (!svg) return;
  const ns = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs) => { const e = document.createElementNS(ns, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };
  svg.appendChild(el('polygon', { points: OUTLINE, class: 'eg-land' }));
  for (const m of maps) {
    const [x, y] = P(m.lon, m.lat), on = m.id === current;
    const g = el('g', { class: on ? 'eg-city on' : 'eg-city', tabindex: '0', role: 'button' });
    const t = el('title', {}); t.textContent = `${m.name} — ${m.gov}`; g.appendChild(t);
    g.appendChild(el('circle', { cx: x.toFixed(1), cy: y.toFixed(1), r: 7, class: 'eg-hit' })); // (مساحة دوس أكبر للصباع)
    g.appendChild(el('circle', { cx: x.toFixed(1), cy: y.toFixed(1), r: on ? 3.6 : 2.4, class: 'eg-dot' }));
    g.addEventListener('click', () => onPick(m.id));
    g.addEventListener('keydown', (e) => { if (e.key === 'Enter') onPick(m.id); });
    svg.appendChild(g);
  }
  const cur = maps.find((m) => m.id === current);
  if (cur) { const [x, y] = P(cur.lon, cur.lat); const l = el('text', { x: (x + (x > 120 ? -6 : 6)).toFixed(1), y: (y + 3).toFixed(1), class: 'eg-label', 'text-anchor': x > 120 ? 'end' : 'start' }); l.textContent = cur.name; svg.appendChild(l); }
}
