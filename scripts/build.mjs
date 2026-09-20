// Generates every SVG in assets/ — run `node scripts/build.mjs`.
// Only SMIL + inline CSS animations are used: GitHub renders README images
// through <img>, so scripts, external fonts and external resources never load.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'assets');
mkdirSync(OUT, { recursive: true });

const SANS = `-apple-system,BlinkMacSystemFont,'Segoe UI','Noto Sans',Helvetica,Arial,sans-serif`;
const MONO = `ui-monospace,SFMono-Regular,'SF Mono',Menlo,Consolas,'Liberation Mono','DejaVu Sans Mono',monospace`;

const THEMES = {
  dark: {
    fg: '#e6edf3', muted: '#8b949e', faint: '#484f58',
    grad: ['#a78bfa', '#22d3ee', '#f472b6'],
    edge: '#8b949e', edgeOpacity: 0.28, packet: '#22d3ee', node: '#a78bfa', ring: '#22d3ee',
  },
  light: {
    fg: '#1f2328', muted: '#656d76', faint: '#8c959f',
    grad: ['#7c3aed', '#0891b2', '#db2777'],
    edge: '#57606a', edgeOpacity: 0.3, packet: '#0891b2', node: '#7c3aed', ring: '#0891b2',
  },
};

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fmt = (n) => Number(n.toFixed(5)).toString();
const len = (s) => [...s].length;

// ---------------------------------------------------------------------------
// Typewriter: deterministic regardless of the viewer's fonts. Each phrase is
// forced to a known width with textLength, then revealed by a clip rect whose
// width jumps char-by-char (calcMode="discrete"). The cursor follows via the
// same event list.
// ---------------------------------------------------------------------------
function typingTimeline(phrases, { cw, type = 65, hold = 1500, del = 30, gap = 350, loop = true }) {
  const events = [];
  let t = 0;
  phrases.forEach((p, i) => {
    const n = len(p);
    for (let k = 1; k <= n; k++) { t += type; events.push({ t, i, w: k * cw }); }
    if (!loop) return;
    t += hold;
    for (let k = 1; k <= n; k++) { t += del; events.push({ t, i, w: (n - k) * cw }); }
    t += gap;
  });
  return { events, total: t };
}

function discreteAnimate(attr, pairs, total, extra = '') {
  // pairs: [[timeMs, value]] — must start at 0 and be strictly increasing.
  const keyTimes = pairs.map(([t]) => t / total);
  for (let i = 1; i < keyTimes.length; i++) {
    if (!(keyTimes[i] > keyTimes[i - 1])) throw new Error(`keyTimes not increasing at ${i}`);
  }
  return `<animate attributeName="${attr}" calcMode="discrete" values="${pairs.map(([, v]) => fmt(v)).join(';')}" keyTimes="${keyTimes.map(fmt).join(';')}" dur="${total}ms" ${extra}/>`;
}

function typewriter({ id, x, y, phrases, size, color, cw = size * 0.6, cursorColor, loop = true, timing = {} }) {
  const { events, total } = typingTimeline(phrases, { cw, loop, ...timing });
  const repeat = loop ? 'repeatCount="indefinite"' : 'fill="freeze"';
  const cursorH = Math.round(size * 1.1);
  const cursorY = y - Math.round(size * 0.85);
  let defs = '', body = '';
  phrases.forEach((p, i) => {
    const own = events.filter((e) => e.i === i).map((e) => [e.t, e.w]);
    const pairs = [[0, 0], ...own];
    if (loop) pairs.push([total, 0]);
    // keyTimes must end at 1 — the final entry above provides it for loops;
    // for one-shot typing the last typed char is the end of the timeline.
    defs += `<clipPath id="${id}-c${i}"><rect x="${x}" y="${cursorY - 4}" width="0" height="${cursorH + 8}">${discreteAnimate('width', pairs, total, repeat)}</rect></clipPath>`;
    body += `<text x="${x}" y="${y}" clip-path="url(#${id}-c${i})" font-family="${MONO}" font-size="${size}" fill="${color}" textLength="${fmt(len(p) * cw)}" lengthAdjust="spacing">${esc(p)}</text>`;
  });
  const cursorPairs = [[0, x], ...events.map((e) => [e.t, x + e.w])];
  if (loop) cursorPairs.push([total, x]);
  body += `<rect id="${id}-cursor" x="${x}" y="${cursorY}" width="${Math.max(2, Math.round(size * 0.12))}" height="${cursorH}" rx="1" fill="${cursorColor || color}">` +
    discreteAnimate('x', cursorPairs, total, repeat) +
    `<animate attributeName="opacity" calcMode="discrete" values="1;0" dur="1s" repeatCount="indefinite"/></rect>`;
  return { defs, body, total };
}

// ---------------------------------------------------------------------------
// Header banner: prompt line, gradient name, typewriter, and an "agent graph"
// on the right with packets travelling between nodes.
// ---------------------------------------------------------------------------
function agentGraph(t) {
  const hub = [810, 130];
  const nodes = [
    { p: [686, 62], l: 'plan', lx: -8, ly: -12, anchor: 'end' },
    { p: [932, 52], l: 'code', lx: 10, ly: -8 },
    { p: [970, 150], l: 'review', lx: -10, ly: 22, anchor: 'end' },
    { p: [900, 228], l: 'ui', lx: 12, ly: 4 },
    { p: [726, 224], l: 'tools', lx: -10, ly: 6, anchor: 'end' },
    { p: [648, 152], l: 'memory', lx: 4, ly: 24 },
  ];
  const ring = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0]];
  let s = `<g id="graph"><animateTransform attributeName="transform" type="translate" values="0 0;0 -5;0 0" dur="7s" repeatCount="indefinite"/>`;
  // spokes
  nodes.forEach((n, i) => {
    s += `<path id="sp${i}" d="M${hub[0]} ${hub[1]} L${n.p[0]} ${n.p[1]}" stroke="${t.edge}" stroke-opacity="${t.edgeOpacity}" stroke-width="1.2" fill="none"/>`;
  });
  // ring (dashed, slowly flowing)
  ring.forEach(([a, b], i) => {
    const A = nodes[a].p, B = nodes[b].p;
    s += `<path d="M${A[0]} ${A[1]} L${B[0]} ${B[1]}" stroke="${t.edge}" stroke-opacity="${t.edgeOpacity * 0.6}" stroke-width="1" stroke-dasharray="3 7" fill="none"><animate attributeName="stroke-dashoffset" from="0" to="${i % 2 ? 40 : -40}" dur="4s" repeatCount="indefinite"/></path>`;
  });
  // packets along spokes, alternating direction, staggered
  const durs = [2.6, 3.1, 2.4, 3.4, 2.9, 2.2];
  nodes.forEach((n, i) => {
    const rev = i % 2 === 1;
    s += `<circle r="3" fill="${t.packet}" opacity="0"><animateMotion dur="${durs[i]}s" begin="${(i * 0.45).toFixed(2)}s" repeatCount="indefinite" ${rev ? 'keyPoints="1;0" keyTimes="0;1" calcMode="linear"' : ''}><mpath href="#sp${i}" xlink:href="#sp${i}"/></animateMotion><animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.12;0.88;1" dur="${durs[i]}s" begin="${(i * 0.45).toFixed(2)}s" repeatCount="indefinite"/></circle>`;
  });
  // satellite nodes + labels
  nodes.forEach((n, i) => {
    s += `<circle cx="${n.p[0]}" cy="${n.p[1]}" r="5" fill="${t.node}"><animate attributeName="r" values="5;6.5;5" dur="${3 + i * 0.4}s" begin="${i * 0.3}s" repeatCount="indefinite"/></circle>`;
    s += `<text x="${n.p[0] + n.lx}" y="${n.p[1] + n.ly}" font-family="${MONO}" font-size="11" fill="${t.muted}" text-anchor="${n.anchor || 'start'}">${n.l}</text>`;
  });
  // hub: ripple + gradient core
  s += `<circle cx="${hub[0]}" cy="${hub[1]}" r="10" fill="none" stroke="${t.ring}" stroke-width="1.5"><animate attributeName="r" values="10;30" dur="2.8s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.7;0" dur="2.8s" repeatCount="indefinite"/></circle>`;
  s += `<circle cx="${hub[0]}" cy="${hub[1]}" r="10" fill="none" stroke="${t.ring}" stroke-width="1.5"><animate attributeName="r" values="10;30" dur="2.8s" begin="1.4s" repeatCount="indefinite"/><animate attributeName="opacity" values="0;0.7;0" keyTimes="0;0.01;1" dur="2.8s" begin="1.4s" repeatCount="indefinite"/></circle>`;
  s += `<circle cx="${hub[0]}" cy="${hub[1]}" r="10" fill="url(#hubGrad)"/>`;
  s += `<text x="${hub[0]}" y="${hub[1] + 30}" font-family="${MONO}" font-size="11" fill="${t.muted}" text-anchor="middle">orchestrator</text>`;
  s += `</g>`;
  return s;
}

function header(theme) {
  const t = THEMES[theme];
  const W = 1000, H = 262;
  const tw = typewriter({
    id: 'tw', x: 40, y: 185, size: 22, color: t.fg, cursorColor: t.grad[1],
    phrases: ['frontend-разработчик', 'делаю AI-агентов', 'React · TypeScript · Node.js', 'MCP · tool-use · оркестрация', 'и да, я люблю пиццу'],
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Ярослав Тихонов — frontend-разработчик, AI-агенты">
<title>Ярослав Тихонов</title>
<defs>
  <linearGradient id="nameGrad" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="520" y2="0" spreadMethod="reflect">
    <stop offset="0" stop-color="${t.grad[0]}"/><stop offset="0.5" stop-color="${t.grad[1]}"/><stop offset="1" stop-color="${t.grad[2]}"/>
    <animateTransform attributeName="gradientTransform" type="translate" from="0 0" to="1040 0" dur="12s" repeatCount="indefinite"/>
  </linearGradient>
  <linearGradient id="hubGrad" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${t.grad[0]}"/><stop offset="1" stop-color="${t.grad[1]}"/>
  </linearGradient>
  ${tw.defs}
</defs>
<text x="40" y="66" font-family="${MONO}" font-size="14" fill="${t.muted}"><tspan fill="${t.grad[1]}">~</tspan> $ whoami</text>
<text x="39" y="122" font-family="${SANS}" font-size="46" font-weight="800" letter-spacing="-1" fill="url(#nameGrad)">Ярослав Тихонов</text>
<text x="40" y="151" font-family="${MONO}" font-size="13" fill="${t.faint}">@DTYUI1</text>
${tw.body}
<text x="40" y="231" font-family="${MONO}" font-size="12" fill="${t.faint}">frontend  ·  ai agents  ·  telegram bots  ·  arch linux</text>
${agentGraph(t)}
</svg>`;
}

// ---------------------------------------------------------------------------
// Terminal card: one command is typed, then the "introspection" output fades
// in line by line. Plays once per page load.
// ---------------------------------------------------------------------------
function terminal() {
  const W = 900, H = 318;
  const bg = '#0d1117', border = '#30363d', fg = '#e6edf3', muted = '#8b949e', key = '#a78bfa', acc = '#22d3ee', ok = '#3fb950';
  const rows = [
    ['роль', 'frontend-разработчик · AI-агенты'],
    ['frontend', 'React · Next.js · TypeScript · Tailwind · Framer Motion'],
    ['агенты', 'Claude · MCP · tool-use · мультиагентная оркестрация'],
    ['backend', 'Node.js · Python · PostgreSQL · Docker'],
    ['окружение', 'Arch Linux · Claude Code · GitHub Actions'],
    ['топливо', 'пицца 🍕 (не обсуждается)'],
    ['статус', '● online — делаю штуки, которые делают штуки'],
  ];
  const size = 14, lh = 26, x0 = 34, y0 = 84;
  const cmd = 'agent --introspect @DTYUI1';
  const promptW = 3 * size * 0.6; // "~ $" + space
  const tw = typewriter({ id: 'cmd', x: x0 + promptW + 4, y: y0, size, color: fg, cursorColor: acc, phrases: [cmd], loop: false, timing: { type: 55 } });
  const start = tw.total + 350;
  let lines = '';
  rows.forEach(([k, v], i) => {
    const begin = ((start + i * 170) / 1000).toFixed(2);
    const y = y0 + lh * (i + 1);
    const val = k === 'статус'
      ? `<tspan fill="${ok}">●</tspan>${esc(v.slice(1))}`
      : esc(v);
    lines += `<g opacity="0"><animate attributeName="opacity" values="0;1" dur="0.3s" begin="${begin}s" fill="freeze"/><animateTransform attributeName="transform" type="translate" from="0 6" to="0 0" dur="0.3s" begin="${begin}s" fill="freeze"/>` +
      `<text x="${x0 + 14}" y="${y}" font-family="${MONO}" font-size="${size}" fill="${key}">${esc(k)}</text>` +
      `<text x="${x0 + 14 + 11 * size * 0.6}" y="${y}" font-family="${MONO}" font-size="${size}" fill="${fg}">${val}</text></g>`;
  });
  const endBegin = ((start + rows.length * 170 + 250) / 1000).toFixed(2);
  const yEnd = y0 + lh * (rows.length + 1) + 6;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Стек: ${rows.map(([k, v]) => `${k}: ${v}`).join('; ')}">
<defs>${tw.defs}
  <clipPath id="card"><rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="12"/></clipPath>
</defs>
<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="12" fill="${bg}" stroke="${border}"/>
<g clip-path="url(#card)">
  <rect x="0" y="0" width="${W}" height="40" fill="#161b22"/>
  <line x1="0" y1="40.5" x2="${W}" y2="40.5" stroke="${border}"/>
</g>
<circle cx="22" cy="20" r="6" fill="#ff5f57"/><circle cx="42" cy="20" r="6" fill="#febc2e"/><circle cx="62" cy="20" r="6" fill="#28c840"/>
<text x="${W / 2}" y="25" font-family="${MONO}" font-size="12" fill="${muted}" text-anchor="middle">dtyui1 — zsh</text>
<text x="${x0}" y="${y0}" font-family="${MONO}" font-size="${size}" fill="${muted}"><tspan fill="${acc}">~</tspan> $</text>
${tw.body.replace('</rect>', `<set attributeName="opacity" to="0" begin="${(start / 1000).toFixed(2)}s" fill="freeze"/></rect>`)}
${lines}
<g opacity="0"><animate attributeName="opacity" values="0;1" dur="0.2s" begin="${endBegin}s" fill="freeze"/>
  <text x="${x0}" y="${yEnd}" font-family="${MONO}" font-size="${size}" fill="${muted}"><tspan fill="${acc}">~</tspan> $</text>
  <rect x="${x0 + promptW + 4}" y="${yEnd - 12}" width="2" height="16" rx="1" fill="${acc}"><animate attributeName="opacity" calcMode="discrete" values="1;0" dur="1s" repeatCount="indefinite"/></rect>
</g>
</svg>`;
}

// ---------------------------------------------------------------------------
// Divider: thin gradient line with a travelling highlight.
// ---------------------------------------------------------------------------
function divider() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="6" viewBox="0 0 1000 6" preserveAspectRatio="none" role="presentation">
<defs>
  <linearGradient id="line" x1="0" x2="1"><stop offset="0" stop-color="#8b5cf6" stop-opacity="0"/><stop offset="0.5" stop-color="#06b6d4" stop-opacity="0.8"/><stop offset="1" stop-color="#ec4899" stop-opacity="0"/></linearGradient>
  <linearGradient id="spark" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="0.5" stop-color="#06b6d4" stop-opacity="1"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
</defs>
<rect x="0" y="2.25" width="1000" height="1.5" fill="url(#line)"/>
<rect x="-160" y="1.5" width="160" height="3" rx="1.5" fill="url(#spark)"><animate attributeName="x" from="-160" to="1000" dur="4s" repeatCount="indefinite"/></rect>
</svg>`;
}

// ---------------------------------------------------------------------------
// Buttons: dark pill, gradient border, icon + label. ~1 KB each, no CDN.
// ---------------------------------------------------------------------------
function iconMarkup(name) {
  const raw = readFileSync(join(ROOT, 'scripts/icons', `${name}.svg`), 'utf8');
  const inner = raw.replace(/<!--[\s\S]*?-->/g, '').replace(/<title>.*?<\/title>/, '').match(/<svg[^>]*>([\s\S]*)<\/svg>/)[1].trim();
  const stroked = /stroke="currentColor"/.test(raw);
  return stroked
    ? `<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</g>`
    : `<g fill="currentColor">${inner}</g>`;
}

function button({ file, label, icon, colors }) {
  const size = 14, cw = 7.9;
  const textW = Math.round(len(label) * cw);
  const W = 16 + 20 + 10 + textW + 18, H = 40;
  writeFileSync(join(OUT, file), `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">
<defs><linearGradient id="b" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${colors[0]}"/><stop offset="1" stop-color="${colors[1]}"/></linearGradient></defs>
<rect x="0.75" y="0.75" width="${W - 1.5}" height="${H - 1.5}" rx="${(H - 1.5) / 2}" fill="#0f172a" stroke="url(#b)" stroke-width="1.5"/>
<g transform="translate(16 10) scale(0.8333)" color="${colors[1]}">${iconMarkup(icon)}</g>
<text x="46" y="25" font-family="${SANS}" font-size="${size}" font-weight="600" fill="#f1f5f9" textLength="${textW}" lengthAdjust="spacingAndGlyphs">${esc(label)}</text>
</svg>
`);
}

// ---------------------------------------------------------------------------
writeFileSync(join(OUT, 'header-dark.svg'), header('dark'));
writeFileSync(join(OUT, 'header-light.svg'), header('light'));
writeFileSync(join(OUT, 'terminal.svg'), terminal());
writeFileSync(join(OUT, 'divider.svg'), divider());
button({ file: 'btn-telegram.svg', label: 'Telegram', icon: 'telegram', colors: ['#38bdf8', '#22d3ee'] });
button({ file: 'btn-email.svg', label: 'Написать', icon: 'mail', colors: ['#a78bfa', '#f472b6'] });
console.log('assets built');
