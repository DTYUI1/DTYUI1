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
    edge: '#8b949e', edgeOpacity: 0.28, packet: '#67e8f9', ring: '#22d3ee',
    sats: ['#22d3ee', '#a78bfa', '#f472b6'],
    planet: ['#ede9fe', '#8b5cf6', '#2e1065'], bands: ['#22d3ee', '#f472b6'], bandOpacity: 0.4,
    shade: '#05070d', shadeOpacity: 0.7, glow: '#8b5cf6', glowOpacity: 0.4, star: '#e6edf3',
  },
  light: {
    fg: '#1f2328', muted: '#656d76', faint: '#8c959f',
    grad: ['#7c3aed', '#0891b2', '#db2777'],
    edge: '#57606a', edgeOpacity: 0.3, packet: '#0891b2', ring: '#0891b2',
    sats: ['#0891b2', '#7c3aed', '#db2777'],
    planet: ['#ddd6fe', '#7c3aed', '#2e1065'], bands: ['#22d3ee', '#f472b6'], bandOpacity: 0.35,
    shade: '#1e1b4b', shadeOpacity: 0.45, glow: '#7c3aed', glowOpacity: 0.18, star: '#8c959f',
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
// Header banner: prompt line, gradient name, typewriter, and the orchestrator
// planet on the right with agents orbiting it. All orbits lie in one tilted
// plane; positions are sampled in JS (SMIL can't do parametric ellipses), so
// motion is faster at the front/back and slower at the sides, like a real
// circle seen in perspective. Each agent is tethered to the planet and a
// packet runs along the tether (out to the agent or back to the planet).
// ---------------------------------------------------------------------------
function orbitSystem(t) {
  const C = [780, 124];
  const K = 0.37; // ry / rx — how flat the orbital plane looks
  const TILT = -7; // degrees, SVG rotate() convention
  const [ct, st] = [Math.cos((TILT * Math.PI) / 180), Math.sin((TILT * Math.PI) / 180)];
  const toScreen = (x, y) => [C[0] + x * ct - y * st, C[1] + x * st + y * ct];
  const r1 = (n) => Number(n.toFixed(1));
  const anim = (attr, values, dur, extra = '') =>
    `<animate attributeName="${attr}" values="${values.join(';')}" dur="${dur}s" repeatCount="indefinite"${extra}/>`;
  const animT = (type, values, dur) =>
    `<animateTransform attributeName="transform" type="${type}" values="${values.join(';')}" dur="${dur}s" repeatCount="indefinite"/>`;
  // Half of an ellipse in the orbital plane: back (far, upper) or front (near, lower).
  const halfArc = (rx, back) => {
    const [a, b] = [toScreen(-rx, 0), toScreen(rx, 0)];
    return `M${r1(a[0])} ${r1(a[1])} A${rx} ${r1(rx * K)} ${TILT} 0 ${back ? 1 : 0} ${r1(b[0])} ${r1(b[1])}`;
  };

  const orbits = [
    { rx: 88, T: 15, trips: 5, phase: 0.6, sats: [{ l: 'plan', out: true }, { l: 'memory', out: false }] },
    { rx: 138, T: 24, trips: 6, phase: 2.2, sats: [{ l: 'tools', out: true }, { l: 'code', out: false }] },
    { rx: 190, T: 36, trips: 8, phase: 4.3, sats: [{ l: 'review', out: false }, { l: 'ui', out: true }] },
  ];
  const STEPS = 15; // samples per packet trip; a trip is T / trips seconds

  let defs = '', stars = '', rails = '', tethers = '', agents = '';

  // twinkling background stars (deterministic LCG so rebuilds are stable)
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 16; i++) {
    const x = 540 + rnd() * 450, y = 12 + rnd() * 238, r = 0.6 + rnd() * 0.8, d = 2.5 + rnd() * 3.5;
    stars += `<circle cx="${r1(x)}" cy="${r1(y)}" r="${r1(r)}" fill="${t.star}" opacity="0.2">${anim('opacity', [0.15, 0.7, 0.15], r1(d), ` begin="${r1(rnd() * 4)}s"`)}</circle>`;
  }

  orbits.forEach((o, oi) => {
    const color = t.sats[oi];
    defs += `<radialGradient id="sat${oi}" cx="0.35" cy="0.35" r="0.75"><stop offset="0" stop-color="#fff" stop-opacity="0.9"/><stop offset="0.35" stop-color="${color}"/><stop offset="1" stop-color="${color}" stop-opacity="0.85"/></radialGradient>`;
    rails += `<path d="${halfArc(o.rx, true)}" stroke="${t.edge}" stroke-opacity="${t.edgeOpacity * 0.55}" stroke-width="1" stroke-dasharray="2 5" fill="none"/>`;
    rails += `<path d="${halfArc(o.rx, false)}" stroke="${t.edge}" stroke-opacity="${t.edgeOpacity * 1.1}" stroke-width="1" fill="none"/>`;

    const N = o.trips * STEPS;
    o.sats.forEach((s, si) => {
      const pos = [], tx2 = [], ty2 = [], scale = [], op = [], pkt = [], pktOp = [];
      for (let i = 0; i <= N; i++) {
        // decreasing angle → the near (lower) half moves left-to-right
        const a = o.phase + si * Math.PI - (2 * Math.PI * i) / N;
        const depth = Math.sin(a); // +1 nearest to the viewer, -1 farthest
        const [x, y] = toScreen(o.rx * Math.cos(a), o.rx * K * Math.sin(a));
        pos.push(`${r1(x)} ${r1(y)}`);
        tx2.push(r1(x));
        ty2.push(r1(y));
        scale.push(r1(1 + 0.22 * depth));
        op.push(r1(0.55 + 0.45 * (depth + 1) / 2));
        // packet: j walks 0..STEPS-1 each trip; invisible on the first and
        // last sample so the jump back to the start is never seen
        const j = (i + si * 7 + oi * 4) % STEPS;
        let f = Math.min(j / (STEPS - 2), 1);
        if (!s.out) f = 1 - f;
        pkt.push(`${r1(C[0] + f * (x - C[0]))} ${r1(C[1] + f * (y - C[1]))}`);
        pktOp.push(j === 0 || j === STEPS - 1 ? 0 : 1);
      }
      tethers += `<line x1="${C[0]}" y1="${C[1]}" x2="${tx2[0]}" y2="${ty2[0]}" stroke="${color}" stroke-opacity="0.32" stroke-width="1" stroke-dasharray="3 4">` +
        anim('x2', tx2, o.T) + anim('y2', ty2, o.T) +
        `<animate attributeName="stroke-dashoffset" from="0" to="${s.out ? -14 : 14}" dur="1.2s" repeatCount="indefinite"/></line>`;
      tethers += `<circle r="2.4" fill="${t.packet}" opacity="0">` +
        animT('translate', pkt, o.T) + anim('opacity', pktOp, o.T) + `</circle>`;
      agents += `<g>` + animT('translate', pos, o.T) + anim('opacity', op, o.T) +
        `<g>${animT('scale', scale, o.T)}` +
        `<circle r="11" fill="${color}" opacity="0.14"/><circle r="5" fill="url(#sat${oi})"/></g>` +
        `<text y="-12" font-family="${MONO}" font-size="11" fill="${t.muted}" text-anchor="middle">${s.l}</text></g>`;
    });
  });

  // planet: glow, ring (back half behind the body, front half over it),
  // gradient body with drifting cloud bands and limb shading
  const R = 22, ringRx = [34, 41];
  defs += `<radialGradient id="glow"><stop offset="0.3" stop-color="${t.glow}" stop-opacity="${t.glowOpacity}"/><stop offset="1" stop-color="${t.glow}" stop-opacity="0"/></radialGradient>`;
  defs += `<radialGradient id="body" cx="0.35" cy="0.3" r="0.8"><stop offset="0" stop-color="${t.planet[0]}"/><stop offset="0.45" stop-color="${t.planet[1]}"/><stop offset="1" stop-color="${t.planet[2]}"/></radialGradient>`;
  defs += `<radialGradient id="shade" cx="0.32" cy="0.28" r="0.85"><stop offset="0" stop-color="#fff" stop-opacity="0.35"/><stop offset="0.35" stop-color="#fff" stop-opacity="0"/><stop offset="0.7" stop-color="${t.shade}" stop-opacity="0"/><stop offset="1" stop-color="${t.shade}" stop-opacity="${t.shadeOpacity}"/></radialGradient>`;
  defs += `<linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${t.grad[1]}" stop-opacity="0.2"/><stop offset="0.5" stop-color="${t.grad[1]}" stop-opacity="0.9"/><stop offset="1" stop-color="${t.grad[2]}" stop-opacity="0.3"/></linearGradient>`;
  defs += `<filter id="soft" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="1.2"/></filter>`;
  defs += `<clipPath id="planetClip"><circle cx="${C[0]}" cy="${C[1]}" r="${R}"/></clipPath>`;
  const ring = (back) => ringRx.map((rx, i) =>
    `<path d="${halfArc(rx, back)}" stroke="url(#ringGrad)" stroke-width="${i ? 1.2 : 3}" stroke-opacity="${back ? 0.55 : 1}" fill="none"/>`).join('');
  // bands: copies one period apart, slid by exactly one period → seamless loop
  const P = 60;
  let bands = '';
  [[-13, 5, 0], [-4, 3, 1], [5, 6, 0], [14, 3, 1]].forEach(([y, h, c], i) => {
    for (let k = -1; k <= 1; k++) {
      const x0 = C[0] - R + k * P + ((i * 17) % P);
      bands += `<rect x="${x0}" y="${C[1] + y}" width="${40 - i * 5}" height="${h}" rx="${h / 2}" fill="${t.bands[c]}"/>`;
    }
  });
  const planet =
    `<circle cx="${C[0]}" cy="${C[1]}" r="62" fill="url(#glow)">${anim('r', [58, 66, 58], 6)}</circle>` +
    // signal waves spreading through the orbital plane
    [0, 2.5].map((b) => `<ellipse cx="0" cy="0" rx="30" ry="${r1(30 * K)}" fill="none" stroke="${t.ring}" stroke-width="1" opacity="0" transform="translate(${C[0]} ${C[1]}) rotate(${TILT})">` +
      `<animate attributeName="rx" values="30;200" dur="5s" begin="${b}s" repeatCount="indefinite"/><animate attributeName="ry" values="${r1(30 * K)};${r1(200 * K)}" dur="5s" begin="${b}s" repeatCount="indefinite"/>` +
      `<animate attributeName="opacity" values="0;0.3;0" keyTimes="0;0.1;1" dur="5s" begin="${b}s" repeatCount="indefinite"/></ellipse>`).join('');
  const body =
    ring(true) +
    `<circle cx="${C[0]}" cy="${C[1]}" r="${R}" fill="url(#body)"/>` +
    `<g clip-path="url(#planetClip)"><g transform="rotate(${TILT} ${C[0]} ${C[1]})" opacity="${t.bandOpacity}"><g filter="url(#soft)">${animT('translate', ['0 0', `${P} 0`], 9)}${bands}</g></g></g>` +
    `<circle cx="${C[0]}" cy="${C[1]}" r="${R}" fill="url(#shade)"/>` +
    ring(false);

  const svg = `<g id="orbits">${stars}${planet}${rails}${tethers}${body}${agents}` +
    `<circle cx="${C[0] - 42}" cy="227" r="3" fill="none" stroke="${t.ring}" stroke-width="1.5"/>` +
    `<text x="${C[0] - 34}" y="231" font-family="${MONO}" font-size="11" fill="${t.muted}">orchestrator</text></g>`;
  return { defs, svg };
}

function header(theme) {
  const t = THEMES[theme];
  const W = 1000, H = 262;
  const orbit = orbitSystem(t);
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
  ${tw.defs}
  ${orbit.defs}
</defs>
<text x="40" y="66" font-family="${MONO}" font-size="14" fill="${t.muted}"><tspan fill="${t.grad[1]}">~</tspan> $ whoami</text>
<text x="39" y="122" font-family="${SANS}" font-size="46" font-weight="800" letter-spacing="-1" fill="url(#nameGrad)">Ярослав Тихонов</text>
<text x="40" y="151" font-family="${MONO}" font-size="13" fill="${t.faint}">@DTYUI1</text>
${tw.body}
<text x="40" y="231" font-family="${MONO}" font-size="12" fill="${t.faint}">frontend  ·  ai agents  ·  telegram bots  ·  arch linux</text>
${orbit.svg}
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
