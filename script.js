'use strict';
/* =====================================================================
   Simulation d'oscilloscope cathodique – circuits RC / RLC
   1) Plaquette : chaque carré 3x3 = un nœud. Les composants relient 2 carrés voisins.
   2) Solveur : analyse nodale complexe (MNA) pour chaque harmonique du GBF.
   3) Oscilloscope : tracé du signal v(t) échantillonné + déclenchement.
   ===================================================================== */
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const COLS = 12, ROWS = 6;

/* ---------- utilitaires ---------- */
const PRE = [[1e6,'M'],[1e3,'k'],[1,''],[1e-3,'m'],[1e-6,'µ'],[1e-9,'n'],[1e-12,'p']];
const eng = (v, u) => { if (!v) return '0 ' + u; const a = Math.abs(v);
  for (const [s, p] of PRE) if (a >= s * 0.9999) return +(v / s).toPrecision(3) + ' ' + p + u;
  return v + ' ' + u; };
const seq = (a, b) => { const o = []; for (let e = a; e <= b; e++) for (const m of [1, 2, 5]) o.push(+(m + 'e' + e)); return o; };
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const VSTEPS = seq(-3, 1).filter(v => v >= 5e-3 && v <= 20), TSTEPS = [...seq(-6, -1), 1];

/* ---------- état ---------- */
const S = {
  mode: 'dual', xy: false, range: 1000, mult: 1, g1: false, g2: false, v1: 1, v2: 1, p1: 0, p2: 0, tb: 2e-4, hp: 0,
  gbf: { wave: 'sin', f: 1000, A: 4 },
  comps: [], wires: { gbfp: null, gbfm: null, ch1: null, ch1g: null, ch2: null, ch2g: null },
  sel: null
};
let uid = 0, terms = [], dirty = true;
const DEF = { R: 150, L: 0.1, C: 4.7e-6, W: 0 };
const SYM = { R: 'Ω', L: 'H', C: 'F', W: '' };
const UNITS = { R: [['Ω', 1], ['kΩ', 1e3], ['MΩ', 1e6]], L: [['µH', 1e-6], ['mH', 1e-3], ['H', 1]], C: [['pF', 1e-12], ['nF', 1e-9], ['µF', 1e-6]], W: [['', 1]] };
const WCOL = { gbfp: '#d62020', gbfm: '#2a2a2a', ch1: '#e8b900', ch1g: '#2a2a2a', ch2: '#4cc3ff', ch2g: '#2a2a2a' };

/* =====================================================================
   BOUTONS ROTATIFS : glisser (haut/bas ou gauche/droite), molette,
   clic à gauche (−) ou à droite (+) du bouton, double-clic = valeur par défaut
   ===================================================================== */
const K = {};
function knob(id, cfg) {
  const el = $(`[data-k=${id}]`), big = el.classList.contains('big'), F = big ? 200 : 140, c = F / 2, rd = big ? 52 : 31, st = cfg.steps;
  let i = 0, v = cfg.v || 0, g = '';
  const fr = x => st ? st.indexOf(x) / (st.length - 1) : (x - cfg.min) / (cfg.max - cfg.min);
  const P = (f, r) => { const a = (-135 + f * 270) * Math.PI / 180; return [(c + r * Math.sin(a)).toFixed(1), (c - r * Math.cos(a)).toFixed(1)]; };
  const tick = (f, r1, r2, w) => { const [a, b] = P(f, r1), [d, e] = P(f, r2); g += `<line x1="${a}" y1="${b}" x2="${d}" y2="${e}" stroke-width="${w}"/>`; };
  if (!st) for (let k = 0, n = Math.round((cfg.max - cfg.min) / cfg.minor); k <= n; k++) tick(k / n, rd + 4, rd + 8, 1);      // petites graduations
  const marks = st || cfg.maj;
  marks.forEach((x, k) => { tick(fr(x), rd + 4, rd + 12, 2); const [a, b] = P(fr(x), rd + 21 + (marks.length > 14 && k % 2 ? 9 : 0)); g += `<text x="${a}" y="${b}">${cfg.lab(x)}</text>`; });
  el.innerHTML = `<div class="face" style="width:${F}px;height:${F}px"><svg class="scale" viewBox="0 0 ${F} ${F}">${g}</svg><div class="dial"><i></i></div></div><b></b><em>${el.dataset.t}</em>`;
  el.title = 'Glisser, molette, ou cliquer à gauche (−) / à droite (+) du bouton. Lire la valeur sur la graduation.';
  const dial = el.querySelector('.dial'), out = el.querySelector('b'), txt = [...el.querySelectorAll('text')];
  const render = () => {
    dial.style.setProperty('--a', (-135 + fr(st ? st[i] : v) * 270) + 'deg');
    out.textContent = cfg.fmt(st ? st[i] : v); if (st) txt.forEach((t, k) => t.classList.toggle('act', k === i));
  };
  const apply = () => { render(); cfg.on(st ? st[i] : v); };
  const step = (d, m = 1) => { if (st) i = clamp(i + d, 0, st.length - 1); else v = clamp(Math.round((v + d * cfg.inc * m) * 1000) / 1000, cfg.min, cfg.max); apply(); };
  let x0 = 0, y0 = 0, acc = 0, moved = 0;
  dial.onpointerdown = e => { dial.setPointerCapture(e.pointerId); x0 = e.clientX; y0 = e.clientY; acc = 0; moved = 0; };
  dial.onpointermove = e => {
    if (!dial.hasPointerCapture(e.pointerId)) return;
    const d = (y0 - e.clientY) + (e.clientX - x0); moved += Math.abs(d); acc += d; x0 = e.clientX; y0 = e.clientY;
    const q = st ? 16 : 2;
    const m = !st && Math.abs(d) > 10 ? 5 : 1;       // geste rapide = pas ×5
    while (Math.abs(acc) >= q) { const s = Math.sign(acc); step(s, m); acc -= s * q; }
  };
  dial.onpointerup = e => { if (moved < 3) { const r = dial.getBoundingClientRect(); step(e.clientX < r.left + r.width / 2 ? -1 : 1, st ? 1 : 5); } };
  el.onwheel = e => { e.preventDefault(); step(e.deltaY < 0 ? 1 : -1, e.shiftKey ? 1 : 5); };
  dial.ondblclick = () => { if (!st && cfg.def !== undefined) { v = cfg.def; apply(); } };
  K[id] = { set(x) { if (st) { i = st.reduce((b, q, k) => Math.abs(Math.log(q / x)) < Math.abs(Math.log(st[b] / x)) ? k : b, 0); } else v = clamp(x, cfg.min, cfg.max); apply(); } };
}
const nf = (x, d = 2) => String(+x.toFixed(d)).replace('.', ',').replace('-', '−');
const vlab = x => x < 1 ? +(x * 1e3).toPrecision(2) + 'm' : nf(x);                       // 5m … 500m (mV), 1 … 20 (V)
const tlab = x => x >= 1 ? nf(x) + 's' : x >= 1e-3 ? nf(x * 1e3) + 'ms' : nf(x * 1e6) + 'µs';   // s, ms ou µs selon l’ordre de grandeur
const tfmt = x => x >= 1 ? +x.toPrecision(3) + ' s/div' : x >= 1e-3 ? +(x * 1e3).toPrecision(3) + ' ms/div' : +(x * 1e6).toPrecision(3) + ' µs/div';
const fp = x => (x > 0 ? '+' : '') + x.toFixed(2) + ' div';
const rng = (a, b, s) => Array.from({ length: Math.round((b - a) / s) + 1 }, (_, k) => +(a + k * s).toFixed(3));
knob('v1', { steps: VSTEPS, lab: vlab, fmt: x => eng(x, 'V/div'), on: x => { S.v1 = x; dirty = true; } });
knob('v2', { steps: VSTEPS, lab: vlab, fmt: x => eng(x, 'V/div'), on: x => { S.v2 = x; dirty = true; } });
knob('p1', { min: -4, max: 4, inc: .02, def: 0, maj: rng(-4, 4, 1), minor: .2, lab: nf, fmt: fp, on: x => { S.p1 = x; dirty = true; } });
knob('p2', { min: -4, max: 4, inc: .02, def: 0, maj: rng(-4, 4, 1), minor: .2, lab: nf, fmt: fp, on: x => { S.p2 = x; dirty = true; } });
knob('t', { steps: TSTEPS, lab: tlab, fmt: tfmt, on: x => { S.tb = x; dirty = true; } });
knob('ph', { min: -5, max: 5, inc: .02, def: 0, maj: rng(-5, 5, 1), minor: .5, lab: nf, fmt: fp, on: x => { S.hp = x; dirty = true; } });
knob('fm', { min: .2, max: 2, inc: .002, def: 1, maj: rng(.2, 2, .1), minor: .02, lab: x => nf(x, 1), fmt: x => '× ' + x.toFixed(2), on: x => { S.mult = x; applyF(); } });
knob('am', { min: 0, max: 10, inc: .05, def: 4, maj: rng(0, 10, 1), minor: .5, lab: nf, fmt: x => eng(x, 'V'), on: x => { S.gbf.A = x; applyA(); } });

/* ---------- boutons ---------- */
const radio = (sel, fn) => $$(sel + ' button').forEach(b => b.onclick = () => { $$(sel + ' button').forEach(x => x.classList.remove('on')); b.classList.add('on'); fn(b); dirty = true; });
function uiXY() {
  $('#xybtn').classList.toggle('on', S.xy && S.mode === 'ch2');
  const bad = S.xy && S.mode !== 'ch2';
  $('#xyhint').textContent = bad ? "X-Y est armé : sélectionne CH2 pour l'activer." : 'X-Y : choisir CH2, puis X-Y. X = CH1, Y = CH2.';
  $('#xyhint').classList.toggle('warn', bad); dirty = true;
}
radio('#modes', b => { S.mode = b.dataset.m; uiXY(); });
$('#xybtn').onclick = () => { S.xy = !S.xy; uiXY(); };
$('#gnd1').onclick = e => { S.g1 = !S.g1; e.target.classList.toggle('on', S.g1); dirty = true; };
$('#gnd2').onclick = e => { S.g2 = !S.g2; e.target.classList.toggle('on', S.g2); dirty = true; };
$('#corr').onchange = e => { $('#theory').hidden = $('#phiw').hidden = $('#profbtn').hidden = !e.target.checked; document.body.classList.toggle('prof', e.target.checked); applyF(); applyA(); };
$('#phimode').onchange = () => updateTheory();

/* ---------- GBF : gamme × bouton (0 à 2) ---------- */
const RANGES = [1, 10, 100, 1e3, 1e4, 1e5, 1e6];
$('#ranges').innerHTML = RANGES.map(r => `<button data-r="${r}">${eng(r, 'Hz')}</button>`).join('');
radio('#ranges', b => { S.range = +b.dataset.r; applyF(); });
radio('#waves', b => { S.gbf.wave = b.dataset.w; changed(); });
function applyF() {
  S.gbf.f = S.range * S.mult; $('#lcd').textContent = document.body.classList.contains('prof') ? eng(S.gbf.f, 'Hz') : '× ' + eng(S.range, 'Hz');
  $$('#ranges button').forEach(b => b.classList.toggle('on', +b.dataset.r === S.range));
  if (!['gf', 'gfu'].includes(document.activeElement.id)) {
    const u = S.gbf.f >= 1e6 ? 1e6 : S.gbf.f >= 1e3 ? 1e3 : 1; $('#gfu').value = u; $('#gf').value = +(S.gbf.f / u).toPrecision(6);
  }
  changed();
}
function applyA() {
  $('#lcdA').textContent = document.body.classList.contains('prof') ? eng(S.gbf.A, 'V') : '';
  if (document.activeElement.id !== 'ga') $('#ga').value = +S.gbf.A.toFixed(3);
  changed();
}
function setF(f) {                                   // choisit la gamme pour que le bouton reste entre 0,2 et 2
  f = clamp(f, .2, 2e6); S.range = [...RANGES].reverse().find(r => f / r >= .2) || 1; K.fm.set(f / S.range);
}
$('#gf').oninput = $('#gfu').oninput = () => { const f = +$('#gf').value * +$('#gfu').value; if (f > 0) setF(f); };
$('#ga').oninput = () => K.am.set(+$('#ga').value || 0);
function setGbf(f, A, w) {
  $$('#waves button').forEach(b => b.classList.toggle('on', b.dataset.w === w)); S.gbf.wave = w; K.am.set(A); setF(f);
}

/* =====================================================================
   SOLVEUR (analyse nodale complexe)
   ===================================================================== */
function csolve(A, b, n) {
  for (let i = 0; i < n; i++) {
    let p = i, m = 0;
    for (let r = i; r < n; r++) { const v = Math.hypot(A[r][i][0], A[r][i][1]); if (v > m) { m = v; p = r; } }
    [A[i], A[p]] = [A[p], A[i]]; [b[i], b[p]] = [b[p], b[i]];
    const [pr, pi] = A[i][i], d = pr * pr + pi * pi || 1e-30;
    for (let r = i + 1; r < n; r++) {
      const [ar, ai] = A[r][i]; if (!ar && !ai) continue;
      const fr = (ar * pr + ai * pi) / d, fi = (ai * pr - ar * pi) / d;
      for (let c = i; c < n; c++) { const [xr, xi] = A[i][c]; A[r][c][0] -= fr * xr - fi * xi; A[r][c][1] -= fr * xi + fi * xr; }
      b[r][0] -= fr * b[i][0] - fi * b[i][1]; b[r][1] -= fr * b[i][1] + fi * b[i][0];
    }
  }
  const x = Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let sr = b[i][0], si = b[i][1];
    for (let c = i + 1; c < n; c++) { const [ar, ai] = A[i][c], [xr, xi] = x[c]; sr -= ar * xr - ai * xi; si -= ar * xi + ai * xr; }
    const [pr, pi] = A[i][i], d = pr * pr + pi * pi || 1e-30;
    x[i] = [(sr * pr + si * pi) / d, (si * pr - sr * pi) / d];
  }
  return x;
}
function harmonics() {
  const { wave, A } = S.gbf; if (wave === 'sin') return [[1, A]];
  const o = [], N = wave === 'sq' ? 49 : 15;
  for (let k = 1; k <= N; k += 2) o.push([k, wave === 'sq' ? 4 * A / (Math.PI * k) : 8 * A / (Math.PI ** 2 * k * k) * (((k - 1) / 2) % 2 ? -1 : 1)]);
  return o;
}
function recompute() {
  const W = S.wires, par = [...Array(76).keys()];             // 0..71 carrés, 72 GBF+, 73 masse, 74 CH1, 75 CH2
  const F = a => par[a] === a ? a : (par[a] = F(par[a]));
  const T = { gbfp: 72, gbfm: 73, ch1g: 73, ch2g: 73, ch1: 74, ch2: 75 };
  for (const t in W) if (W[t] != null) par[F(W[t])] = F(T[t]);
  for (const p of S.comps) if (p.t === 'W' && !p.out) par[F(blkA(p))] = F(blkB(p));      // fil = court-circuit
  const gnd = F(73), src = F(72), shorted = gnd === src;
  const comps = S.comps.filter(p => !p.out && p.t !== 'W').map(p => ({ t: p.t, v: p.v, a: F(blkA(p)), b: F(blkB(p)) }));
  const ids = new Map(), add = x => { if (x !== gnd && x !== src && !ids.has(x)) ids.set(x, ids.size); };
  comps.forEach(c => { add(c.a); add(c.b); }); add(F(74)); add(F(75));
  const n = ids.size; terms = [];
  for (const [k, a] of harmonics()) {
    const w = 2 * Math.PI * S.gbf.f * k;
    const M = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => [i === j ? 1e-9 : 0, 0]));
    const rhs = Array.from({ length: n }, () => [0, 0]);
    const st = (x, o, y) => {
      const i = ids.get(x); if (i === undefined) return;
      M[i][i][0] += y[0]; M[i][i][1] += y[1];
      const j = ids.get(o);
      if (j !== undefined) { M[i][j][0] -= y[0]; M[i][j][1] -= y[1]; } else if (o === src && !shorted) { rhs[i][0] += y[0]; rhs[i][1] += y[1]; }
    };
    for (const c of comps) {
      if (c.a === c.b) continue;
      const y = c.t === 'R' ? [1 / Math.max(c.v, 1e-3), 0] : c.t === 'C' ? [0, w * c.v] : [0, -1 / (w * Math.max(c.v, 1e-9))];
      st(c.a, c.b, y); st(c.b, c.a, y);
    }
    const sol = csolve(M, rhs, n);
    const H = x => x === gnd ? [0, 0] : x === src ? [1, 0] : sol[ids.get(x)];
    const h1 = H(F(74)), h2 = H(F(75));
    terms.push([w, a * Math.hypot(...h1), Math.atan2(h1[1], h1[0]), a * Math.hypot(...h2), Math.atan2(h2[1], h2[0])]);
  }
  const m = [];
  if (W.gbfp == null) m.push('Relie GBF + à un carré de la plaquette.');
  if (W.gbfm == null && W.ch1g == null && W.ch2g == null) m.push('Aucune masse reliée : relie GBF − (et CH1 G / CH2 G) à la plaquette.');
  if (shorted && W.gbfp != null) m.push('Court-circuit : GBF + et la masse sont sur le même nœud.');
  if (W.ch1 == null && W.ch2 == null) m.push('Relie CH1 et/ou CH2 à la plaquette pour mesurer.');
  if (!S.comps.some(p => !p.out)) m.push('Glisse des composants sur la plaquette.');
  const st = $('#status'); st.textContent = m.length ? m.join(' ') : 'Circuit connecté ✓'; st.classList.toggle('ok', !m.length);
  updateTheory();
}
const V = (ch, t) => { let s = 0; const i = ch === 1 ? 1 : 3; for (const h of terms) s += h[i] * Math.sin(h[0] * t + h[i + 1]); return s; };
function updateTheory() {
  const h = terms[0]; if (!h) return;
  const ui = $('#phimode').value === 'ui';
  let phi = (ui ? h[2] - h[4] : h[4] - h[2]) * 180 / Math.PI; phi = ((phi + 540) % 360) - 180;
  const um1 = h[1], um2 = h[3], f = S.gbf.f;
  $('#theory').innerHTML = `f = ${eng(f, 'Hz')} · T = ${eng(1 / f, 's')}<br>Um1 = ${eng(um1, 'V')} · Um2 = ${eng(um2, 'V')}` +
    (um1 > 1e-9 ? ` · Um2/Um1 = ${(um2 / um1).toFixed(3)}` : '') +
    `<br>φ = ${phi.toFixed(1)}° (${ui ? 'φu − φi' : 'φ(CH2) − φ(CH1)'}) · Δt = ${eng(phi / 360 / f, 's')}<br>|sin φ| = BB'/AA' = ${Math.abs(Math.sin(phi * Math.PI / 180)).toFixed(3)}` +
    (ui && um1 > 1e-9 && um2 > 1e-9 ? `<br>Circuit ${Math.abs(phi) < .5 ? 'à la résonance (φ = 0)' : phi < 0 ? 'capacitif : i en avance sur u (φ < 0)' : 'inductif : i en retard sur u (φ > 0)'}` : '') +
    (S.gbf.wave !== 'sin' ? '<br>(valeurs du fondamental)' : '') + thText();
}

/* =====================================================================
   ÉCRAN DE L'OSCILLOSCOPE
   ===================================================================== */
const PX = d => 50 + d * 100, PY = d => 50 + (4 - d) * 100;
function draw() {
  const cv = $('#screen'), dpr = window.devicePixelRatio || 1;
  const w = Math.round(cv.clientWidth * dpr), h = Math.round(cv.clientHeight * dpr);
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  const c = cv.getContext('2d'); c.setTransform(w / 1100, 0, 0, h / 900, 0, 0);
  c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1;
  const bg = c.createRadialGradient(550, 450, 60, 550, 450, 700);
  bg.addColorStop(0, '#1d8040'); bg.addColorStop(1, '#093a1b'); c.fillStyle = bg; c.fillRect(0, 0, 1100, 900);

  /* graticule : 10 x 8 divisions, 1 division = 100 unités */
  c.lineWidth = 1.3; c.strokeStyle = 'rgba(200,255,210,.32)'; c.beginPath();
  for (let i = 0; i <= 10; i++) { c.moveTo(PX(i), 50); c.lineTo(PX(i), 850); }
  for (let j = 0; j <= 8; j++) { c.moveTo(50, 50 + j * 100); c.lineTo(1050, 50 + j * 100); }
  c.stroke();
  c.strokeStyle = 'rgba(235,255,240,.72)'; c.lineWidth = 2; c.beginPath();
  c.moveTo(550, 50); c.lineTo(550, 850); c.moveTo(50, 450); c.lineTo(1050, 450);
  for (let i = 0; i <= 50; i++) { const x = 50 + i * 20, t = i % 5 ? 7 : 11; c.moveTo(x, 450 - t); c.lineTo(x, 450 + t); }
  for (let j = 0; j <= 40; j++) { const y = 50 + j * 20, t = j % 5 ? 7 : 11; c.moveTo(550 - t, y); c.lineTo(550 + t, y); }
  c.stroke(); c.strokeRect(50, 50, 1000, 800);

  const beam = (pts, col) => {
    c.save(); c.beginPath(); c.rect(48, 48, 1004, 804); c.clip();
    c.lineJoin = c.lineCap = 'round'; c.globalCompositeOperation = 'lighter';
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    pts.forEach(([x, y]) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); });
    if (x1 - x0 < .8 && y1 - y0 < .8) {            // un seul point lumineux
      const [x, y] = pts[0], g = c.createRadialGradient(x, y, 0, x, y, 26);
      g.addColorStop(0, '#ffffff'); g.addColorStop(.18, col); g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g; c.beginPath(); c.arc(x, y, 26, 0, 7); c.fill();
    } else {
      c.beginPath(); pts.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y));
      for (const [lw, al, cl] of [[14, .12, col], [7, .22, col], [3.8, .9, col], [1.7, 1, '#ffffff']]) { c.lineWidth = lw; c.globalAlpha = al; c.strokeStyle = cl; c.stroke(); }
    }
    c.restore();
  };
  const T = 1 / S.gbf.f;
  if (S.xy && S.mode === 'ch2') {
    const pts = [], N = 1600;
    for (let i = 0; i <= N; i++) {
      const t = i / N * T, vx = S.g1 ? 0 : V(1, t), vy = S.g2 ? 0 : V(2, t);
      pts.push([PX(5 + vx / D.v1 + D.hp), PY(vy / D.v2 + D.p2)]);
    }
    beam(pts, '#fffb9a');
  } else {
    const draws = [];
    if (S.mode !== 'ch2') draws.push([1, S.g1, D.v1, D.p1, '#fff56b']);
    if (S.mode !== 'ch1') draws.push([2, S.g2, D.v2, D.p2, '#c9fff4']);
    for (const [ch, g, sens, pos, col] of draws) {
      const pts = [];
      for (let i = 0; i <= 2000; i++) {      // signal fixe : t = 0 est la phase 0 du GBF
        const v = g ? 0 : V(ch, (i / 200 - D.hp) * D.tb);
        pts.push([50 + i / 2, PY(v / sens + pos)]);
      }
      beam(pts, col);
    }
  }
}
const D = { v1: S.v1, v2: S.v2, p1: 0, p2: 0, tb: S.tb, hp: 0 };      // valeurs affichées : rejoignent doucement les réglages
(function loop() {
  for (const k in D) {
    const l = k[0] === 'v' || k === 'tb', a = l ? Math.log(D[k]) : D[k], b = l ? Math.log(S[k]) : S[k], d = b - a;
    if (Math.abs(d) < .002) { if (D[k] !== S[k]) { D[k] = S[k]; dirty = true; } } else { D[k] = l ? Math.exp(a + d * .25) : a + d * .25; dirty = true; }
  }
  if (dirty) { draw(); dirty = false; analyse(); }
  requestAnimationFrame(loop);
})();

/* =====================================================================
   PLAQUETTE
   ===================================================================== */
const grid = $('#grid'), parts = $('#parts'), lab = $('#lab');
for (let i = 0; i < COLS * ROWS; i++) { const d = document.createElement('div'); d.className = 'blk'; d.dataset.i = i; d.innerHTML = '<s></s>'.repeat(9); grid.append(d); }
const blkA = p => p.r * COLS + p.c, blkB = p => p.o === 'h' ? p.r * COLS + p.c + 1 : (p.r + 1) * COLS + p.c;
const cellSize = () => { const b = grid.getBoundingClientRect(); return [b.width / COLS, b.height / ROWS]; };
const clampPart = p => { if (p.o === 'h') { p.c = clamp(p.c, 0, COLS - 2); p.r = clamp(p.r, 0, ROWS - 1); } else { p.r = clamp(p.r, 0, ROWS - 2); p.c = clamp(p.c, 0, COLS - 1); } };
const place = (p, px, py) => {
  const [cw, ch] = cellSize();
  if (p.o === 'h') { p.c = Math.round(px / cw) - 1; p.r = Math.floor(py / ch); } else { p.r = Math.round(py / ch) - 1; p.c = Math.floor(px / cw); }
  clampPart(p);
};

const BC = ['#151515', '#7a3b10', '#d62d20', '#f08a1c', '#f2d21b', '#2e9b3a', '#2a62d6', '#8a3fc7', '#8a8a8a', '#f2f2f2'];
function bands(v) {                                  // code des couleurs d'une résistance
  if (!(v > 0)) return [BC[0], BC[0], BC[0]];
  let e = Math.floor(Math.log10(v)), m = Math.round(v / 10 ** (e - 1)); if (m >= 100) { m = Math.round(m / 10); e++; }
  const x = e - 1; return [BC[Math.floor(m / 10)], BC[m % 10], x >= 0 && x <= 9 ? BC[x] : x === -1 ? '#d4a017' : '#c0c0c0'];
}
function decor(p) {
  if (p.t === 'R') return bands(p.v).map((c, k) => `<i class="bd" style="left:${14 + k * 9}%;background:${c}"></i>`).join('') + '<i class="bd" style="left:82%;background:#d4a017"></i>';
  return p.t === 'C' ? '<i class="capstripe"></i>' : '';
}
$$('.pal').forEach(el => el.insertAdjacentHTML('afterbegin', decor({ t: el.dataset.t, v: DEF[el.dataset.t] })));
function renderParts() {
  parts.innerHTML = ''; const [cw, ch] = cellSize();
  for (const p of S.comps) {
    const h = p.o === 'h', d = document.createElement('div');
    d.className = 'part' + (h ? '' : ' v') + (S.sel === p.id ? ' sel' : '') + (p.out ? ' out' : '');
    d.style.cssText = `left:${h ? (p.c + 1) * cw : (p.c + .5) * cw}px;top:${h ? (p.r + .5) * ch : (p.r + 1) * ch}px;width:${cw}px;height:${ch * .44}px`;
    d.innerHTML = `<u></u><div class="cmp ${p.t}">${decor(p)}<span>${p.t === 'W' ? 'fil' : eng(p.v, SYM[p.t])}</span></div>`;
    d.onpointerdown = e => { e.preventDefault(); S.sel = p.id; drag = { p, sx: e.clientX, sy: e.clientY, moved: false }; changed(false); };
    parts.append(d);
  }
}

/* ---------- glisser-déposer ---------- */
let drag = null;
$$('.pal').forEach(el => el.onpointerdown = e => {
  e.preventDefault();
  const p = { id: ++uid, t: el.dataset.t, v: DEF[el.dataset.t], r: 0, c: 0, o: 'h', out: true };
  S.comps.push(p); S.sel = p.id; drag = { p, sx: e.clientX, sy: e.clientY, moved: true };
  changed(false);
});
document.addEventListener('pointermove', e => {
  mouse = { x: e.clientX, y: e.clientY };
  if (wiring) {
    const bi = blockAt(e.clientX, e.clientY); if (bi !== hot) { if (hot >= 0) grid.children[hot].classList.remove('hot'); if (bi >= 0) grid.children[bi].classList.add('hot'); hot = bi; }
    renderWires();
  }
  if (!drag) return;
  if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 5) drag.moved = true;
  if (!drag.moved) return;
  const b = grid.getBoundingClientRect(), inside = e.clientX >= b.left && e.clientX <= b.right && e.clientY >= b.top && e.clientY <= b.bottom;
  drag.p.out = !inside; if (inside) place(drag.p, e.clientX - b.left, e.clientY - b.top);
  changed(false);
});
document.addEventListener('pointerup', e => {
  if (drag) { if (drag.p.out) { S.comps = S.comps.filter(q => q !== drag.p); S.sel = null; } drag = null; changed(); }
  if (wiring) wireUp(e);
});
function rotate(p) { p.o = p.o === 'h' ? 'v' : 'h'; clampPart(p); changed(); }
document.addEventListener('keydown', e => {
  if (/INPUT|SELECT/.test(document.activeElement.tagName)) return;
  const p = drag ? drag.p : S.comps.find(q => q.id === S.sel);
  if ((e.key === 'r' || e.key === 'R') && p) rotate(p);
  if ((e.key === 'Delete' || e.key === 'Backspace') && p && !drag) { S.comps = S.comps.filter(q => q !== p); S.sel = null; changed(); }
  if (e.key === 'Escape') { wiring = null; renderWires(); }
});

/* ---------- inspecteur de valeur ---------- */
function updateInsp() {
  const p = S.comps.find(q => q.id === S.sel);
  $('#inspf').hidden = !p; $('#inspHint').hidden = !!p; if (!p) return;
  $('#ilab').textContent = { R: 'Résistance', L: 'Bobine', C: 'Condensateur', W: 'Fil (relie deux carrés)' }[p.t];
  $('#ival').style.display = $('#iunit').style.display = p.t === 'W' ? 'none' : '';
  if (document.activeElement.id === 'ival') return;
  const u = UNITS[p.t], best = [...u].reverse().find(x => p.v / x[1] >= 1) || u[0];
  $('#iunit').innerHTML = u.map(x => `<option value="${x[1]}" ${x === best ? 'selected' : ''}>${x[0]}</option>`).join('');
  $('#ival').value = +(p.v / best[1]).toPrecision(6);
}
const readVal = () => { const p = S.comps.find(q => q.id === S.sel); if (!p || p.t === 'W') return; p.v = Math.max(0, +$('#ival').value * +$('#iunit').value); changed(true, true); };
$('#ival').oninput = readVal; $('#iunit').onchange = readVal;
$('#irot').onclick = () => { const p = S.comps.find(q => q.id === S.sel); if (p) rotate(p); };
$('#idel').onclick = () => { S.comps = S.comps.filter(q => q.id !== S.sel); S.sel = null; changed(); };

/* ---------- fils ---------- */
let wiring = null, sticky = false, mouse = { x: 0, y: 0 };
$$('.term').forEach(el => {
  const t = el.dataset.t;
  el.onpointerdown = e => { e.preventDefault(); if (wiring === t && sticky) { wiring = null; sticky = false; } else { wiring = t; sticky = false; } mouse = { x: e.clientX, y: e.clientY }; renderWires(); };
  el.ondblclick = () => { S.wires[t] = null; wiring = null; changed(); };
});
function blockAt(x, y) {
  const b = grid.getBoundingClientRect(); if (x < b.left || x > b.right || y < b.top || y > b.bottom) return -1;
  return clamp(Math.floor((y - b.top) / (b.height / ROWS)), 0, ROWS - 1) * COLS + clamp(Math.floor((x - b.left) / (b.width / COLS)), 0, COLS - 1);
}
let hot = -1;
function wireUp(e) {
  const el = document.elementFromPoint(e.clientX, e.clientY), bi = blockAt(e.clientX, e.clientY), tm = el && el.closest('.term');
  if (bi >= 0) { S.wires[wiring] = bi; wiring = null; sticky = false; changed(); }
  else if (tm && tm.dataset.t === wiring && !sticky) sticky = true;
  else { wiring = null; sticky = false; }
  renderWires();
}
$('#wires').ondblclick = e => { const t = e.target.dataset && e.target.dataset.t; if (t) { S.wires[t] = null; changed(); } };
const HOLE = { gbfp: 0, ch1: 2, ch2: 8, gbfm: 6, ch1g: 1, ch2g: 7 };        // un trou différent par fil dans le carré de 9 trous
function rounded(p, r) {                              // polyligne à angles droits arrondis
  let d = `M${p[0][0]} ${p[0][1]}`;
  for (let k = 1; k < p.length - 1; k++) {
    const [a, b, c] = [p[k - 1], p[k], p[k + 1]], l1 = Math.hypot(b[0] - a[0], b[1] - a[1]), l2 = Math.hypot(c[0] - b[0], c[1] - b[1]), q = Math.min(r, l1 / 2, l2 / 2);
    const u = [(b[0] - a[0]) / l1 || 0, (b[1] - a[1]) / l1 || 0], w = [(c[0] - b[0]) / l2 || 0, (c[1] - b[1]) / l2 || 0];
    d += `L${b[0] - u[0] * q} ${b[1] - u[1] * q}Q${b[0]} ${b[1]} ${b[0] + w[0] * q} ${b[1] + w[1] * q}`;
  }
  return d + `L${p[p.length - 1][0]} ${p[p.length - 1][1]}`;
}
function renderWires() {
  if (!wiring && hot >= 0) { grid.children[hot].classList.remove('hot'); hot = -1; }
  document.body.classList.toggle('wiring', !!wiring);
  const bb = lab.getBoundingClientRect(), gb = grid.getBoundingClientRect(), [cw, ch] = cellSize();
  const jack = t => { const r = $(`.term[data-t=${t}] .jack`).getBoundingClientRect(); return [r.left + r.width / 2 - bb.left, r.top + r.height / 2 - bb.top]; };
  const W = [];
  for (const t in S.wires) {
    const bi = S.wires[t]; if (bi == null) continue; const [x1, y1] = jack(t), hc = HOLE[t] % 3, hr = Math.floor(HOLE[t] / 3);
    W.push({ t, x1, y1, x2: gb.left - bb.left + ((bi % COLS) + .15 + .7 * (hc + .5) / 3) * cw, y2: gb.top - bb.top + (Math.floor(bi / COLS) + .15 + .7 * (hr + .5) / 3) * ch });
  }
  const lanes = [];                                   // chaque fil prend le premier couloir horizontal libre : pas de fils superposés
  W.sort((p, q) => Math.min(p.x1, p.x2) - Math.min(q.x1, q.x2)).forEach(w => {
    const lo = Math.min(w.x1, w.x2) - 7, hi = Math.max(w.x1, w.x2) + 7;
    let k = lanes.findIndex(L => L.every(([a, b]) => hi < a || lo > b)); if (k < 0) { k = lanes.length; lanes.push([]); } lanes[k].push([lo, hi]); w.lane = k;
  });
  const base = Math.max(0, ...W.map(w => w.y1)) + 36, room = gb.top - bb.top - 12 - base, gap = clamp(room / Math.max(1, lanes.length), 4, 9);
  let hh = '';
  W.sort((p, q) => (/g$|gm$/.test(q.t) ? 1 : 0) - (/g$|gm$/.test(p.t) ? 1 : 0)).forEach(w => {      // masses dessous, signaux dessus
    const yl = base + w.lane * gap, d = rounded([[w.x1, w.y1], [w.x1, yl], [w.x2, yl], [w.x2, w.y2]], 7);
    hh += `<path class="wl" d="${d}"/><path class="wk" stroke="${WCOL[w.t]}" d="${d}"/><path class="wh" data-t="${w.t}" d="${d}"/>` +
      `<circle cx="${w.x1}" cy="${w.y1}" r="5" fill="${WCOL[w.t]}" stroke="#fff" stroke-width="1.5"/><circle cx="${w.x2}" cy="${w.y2}" r="4.5" fill="${WCOL[w.t]}" stroke="#fff" stroke-width="1.5"/>`;
  });
  if (wiring) { const [x1, y1] = jack(wiring); hh += `<path d="M${x1} ${y1}L${mouse.x - bb.left} ${mouse.y - bb.top}" fill="none" stroke="${WCOL[wiring]}" stroke-width="2.5" stroke-dasharray="6 5" opacity=".85"/>`; }
  $('#wires').innerHTML = hh;
}

/* ---------- mise à jour globale ---------- */
function changed(solve = true, keepInsp = false) {
  if (solve) recompute();
  S.comps.forEach(p => { if (!p.out) clampPart(p); });
  renderParts(); renderWires(); if (!keepInsp) updateInsp();
  dirty = true;
}
window.addEventListener('resize', () => { renderParts(); renderWires(); dirty = true; });

/* ---------- montages prêts à l'emploi ---------- */
const B = (r, c) => r * COLS + c;
function example(n) {
  S.comps = []; S.sel = null; wiring = null;
  for (const k in S.wires) S.wires[k] = null;
  const P = (t, v, r, c, o) => S.comps.push({ id: ++uid, t, v, r, c, o });
  const wire = (inp, out, g) => Object.assign(S.wires, { gbfp: inp, ch1: inp, ch2: out, gbfm: g, ch1g: g, ch2g: g });
  if (n) { K.v1.set(1); K.v2.set(1); K.t.set(1e-3); K.p1.set(0); K.p2.set(0); K.ph.set(0); }
  if (n === 1) { P('R', 150, 1, 3, 'h'); P('C', 4.7e-6, 1, 4, 'v'); wire(B(1, 3), B(1, 4), B(2, 4)); setGbf(200, 4, 'sin'); }
  if (n === 2) { P('C', 4.7e-6, 1, 3, 'h'); P('R', 150, 1, 4, 'v'); wire(B(1, 3), B(1, 4), B(2, 4)); setGbf(200, 4, 'sin'); }
  if (n === 3) { P('L', 0.1, 1, 2, 'h'); P('C', 4.7e-6, 1, 3, 'h'); P('R', 150, 1, 4, 'v'); wire(B(1, 2), B(1, 4), B(2, 4)); setGbf(230, 4, 'sin'); }
  $('#phimode').value = n === 3 ? 'ui' : 'out'; $('#obj').textContent = GOALS[n] || '';
  changed();
}
$$('.ex').forEach(b => b.onclick = () => example(+b.dataset.e));

/* =====================================================================
   FICHE TP : étapes, conseils, détection de la fréquence caractéristique
   ===================================================================== */
const GOALS = {
  1: 'Objectif : trouver la fréquence de coupure fc (Um2/Um1 = 1/√2 et φ = −45°) puis la fréquence limite f = 1/(10RC) ; les comparer à la théorie.',
  2: 'Objectif : trouver fc du filtre passe-haut (Um2/Um1 = 1/√2 et φ = +45°), puis la comparer à 1/(2πRC).',
  3: 'Objectif : trouver la résonance (u et i en phase, φ = 0, Um2 maximale), puis comparer à f0 = 1/(2π√LC).'
};
function theo() {                                   // valeurs théoriques d’après les composants posés sur la plaquette
  const a = S.comps.filter(p => !p.out), g = t => a.find(p => p.t === t), R = g('R'), L = g('L'), C = g('C');
  if (R && L && C && R.v > 0 && L.v > 0 && C.v > 0) { const f = 1 / (2 * Math.PI * Math.sqrt(L.v * C.v)); return { k: 'rlc', f, Q: 2 * Math.PI * f * L.v / R.v }; }
  if (R && C && !L && R.v > 0 && C.v > 0) return { k: 'rc', f: 1 / (2 * Math.PI * R.v * C.v), fl: 1 / (10 * R.v * C.v) };
  if (R && L && !C && R.v > 0 && L.v > 0) return { k: 'rc', f: R.v / (2 * Math.PI * L.v), fl: R.v / (10 * L.v) };
  return null;
}
function thText() {
  const t = theo(); if (!t) return '';
  return t.k === 'rlc' ? `<br>— Théorie : f0 = ${eng(t.f, 'Hz')} · Q = ${t.Q.toFixed(2)} · Δf = f0/Q = ${eng(t.f / t.Q, 'Hz')}` : `<br>— Théorie : fc = ${eng(t.f, 'Hz')} (gain 1/√2 ≈ 0,707 · |φ| = 45°)<br>— Théorie : fréquence limite = 1/(10τ) = ${eng(t.fl, 'Hz')} (τ = RC)`;
}
function analyse() {
  const h = terms[0]; if (!h) return;
  const w = S.wires, t = theo(), pill = $('#goal'), ok = $('#status').classList.contains('ok'), act = [];
  if (S.mode !== 'ch2' && w.ch1 != null && !S.g1) act.push(h[1] / S.v1);
  if (S.mode !== 'ch1' && w.ch2 != null && !S.g2) act.push(h[3] / S.v2);
  const big = act.some(x => x > 3.8), small = act.length && act.every(x => x < .5), np = 10 * S.tb * S.gbf.f;
  let name = '', hit = false, near = false, dir = '';
  if (t && w.ch1 != null && w.ch2 != null && h[1] > 1e-9 && h[3] > 1e-9) {
    const phi = (((h[2] - h[4]) * 180 / Math.PI + 540) % 360) - 180, r = h[3] / h[1];
    if (t.k === 'rlc') { const e = Math.abs(phi); name = 'la résonance'; hit = e < 1.5; near = e < 12; dir = phi > 0 ? 'diminue f' : 'augmente f'; }
    else { const e = Math.abs(r - Math.SQRT1_2); name = 'la fréquence de coupure fc'; hit = e < .02; near = e < .1;
      dir = (phi > 0) === (r > Math.SQRT1_2) ? 'augmente f' : 'diminue f'; }   // phi > 0 : passe-bas (gain décroît avec f)
  }
  if (t && t.fl && w.ch1 != null && Math.abs(S.gbf.f / t.fl - 1) < .015) { name = 'la fréquence limite'; hit = true; }
  $('#gotol').hidden = !(t && t.fl); $('#goto').textContent = t && t.k === 'rlc' ? '→ Aller à f0' : '→ Aller à fc';
  const on = (s, v) => $(`#steps [data-s=${s}]`).classList.toggle('ok', !!v);
  on('wire', ok); on('sig', act.length && !big && !small); on('per', np >= 1.5 && np <= 6); on('goal', hit);
  $('#tip').textContent = !ok ? 'Câble GBF +, GBF −, CH1, CH2 et les masses vers la plaquette.' : !act.length ? 'Active une voie (CH1 / CH2) et désactive GND.'
    : big ? 'Le signal sort de l’écran : augmente VOLTS/DIV.' : small ? 'Signal trop petit : diminue VOLTS/DIV.'
    : np < 1.5 ? 'Moins de 2 périodes à l’écran : augmente TEMPS/DIV.' : np > 6 ? 'Trop de périodes : diminue TEMPS/DIV.'
    : 'Affichage correct : lis sur le graticule (divisions × sensibilité).';
  pill.hidden = !name; if (!name) return;
  pill.className = 'goal ' + (hit ? 'hit' : near ? 'near' : '');
  pill.textContent = hit ? `✓ Tu es à ${name} !` : (near ? `Tu t’approches de ${name}` : `Cherche ${name}`) + ($('#aid').checked ? ' → ' + dir : '');
}
$('#aid').onchange = () => { dirty = true; };
$('#goto').onclick = () => { const t = theo(); if (t) setF(t.f); };
$('#gotol').onclick = () => { const t = theo(); if (t && t.fl) setF(t.fl); };
let sw = null;                                      // balayage logarithmique de f/10 à 10f pour la démonstration en classe
$('#sweep').onclick = () => { const b = $('#sweep'); if (sw) { sw = null; b.textContent = '▶ Balayage en fréquence'; return; } const t = theo(); if (t) { sw = { t0: performance.now(), f: t.f }; b.textContent = '■ Arrêter'; } };
(function sweepLoop() {
  if (sw) { const x = Math.min(1, (performance.now() - sw.t0) / 14000); setF(sw.f * 10 ** (2 * x - 1)); if (x >= 1) { sw = null; $('#sweep').textContent = '▶ Balayage en fréquence'; } }
  requestAnimationFrame(sweepLoop);
})();

/* ---------- démarrage ---------- */
K.v1.set(1); K.v2.set(1); K.p1.set(0); K.p2.set(0); K.t.set(1e-3); K.ph.set(0); uiXY();
example(1);
