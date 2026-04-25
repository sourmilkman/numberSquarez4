(() => {
'use strict';

// ── CONSTANTS ─────────────────────────────────────────────
const KEY_PREFIX = 'ns4-';
const HINTS_MAX = { easy: 5, medium: 3, hard: 2 };
const HOWTO_DATA = {
  kakuro: {
    title: 'How to Play Kakuro',
    body: `<p>Fill every white cell with a digit 1–9.</p><ul>
      <li>Each horizontal or vertical <strong>run</strong> (sequence of white cells) must add up to the <strong>clue number</strong> shown in the black cell at its start.</li>
      <li>You <strong>cannot repeat a digit</strong> within the same run.</li>
      <li>In clue cells, the <em>top-right</em> number is the row-run sum; the <em>bottom-left</em> is the column-run sum.</li>
    </ul>`
  },
  suguru: {
    title: 'How to Play Suguru',
    body: `<p>Fill every cell with a number.</p><ul>
      <li>Each boldly-outlined <strong>cage</strong> of n cells must contain the numbers <strong>1 to n</strong>, each exactly once.</li>
      <li>Identical numbers may <strong>not touch each other</strong> — not even diagonally.</li>
    </ul>`
  }
};

// ── STATE ─────────────────────────────────────────────────
let gameMode = 'kakuro';
let difficulty = 'medium';
let gameSerial = 0;
let timerStart = 0;
let timerRAF = 0;
let hintsLeft = 3;
let checksUsed = 0;
let moveHistory = [];
let selectedCell = null;
let pendingAnimCells = new Set();
let pendingAnimType = 'pop-in';
let darkMode = false;
let soundEnabled = true;
let audioCtx = null;

// Kakuro
let kN = 0, kGrid = [], kSol = [], kPuzzle = [], kPlayer = [];
let kHRuns = [], kVRuns = [], kHOf = {}, kVOf = {};

// Suguru
let sR = 0, sC = 0;
let sCages = [], sCageOf = [], sSol = [], sPuzzle = [], sPlayer = [];
let sMaxCage = 0;

// ── DOM ───────────────────────────────────────────────────
const $ = id => document.getElementById(id);

function showScreen(name) {
  ['menu-screen','setup-screen','game-screen'].forEach(id => $( id).classList.remove('active'));
  $(name + '-screen').classList.add('active');
  $('win-overlay').classList.remove('active');
  $('howto-overlay').classList.remove('active');
  if (name === 'menu') updateMenuScores();
}

// ── THEME ─────────────────────────────────────────────────
function applyTheme() {
  document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : '');
  $('theme-toggle').textContent = darkMode ? '🌙' : '☀️';
}

// ── SOUND ─────────────────────────────────────────────────
function ensureAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
}

function tone(freq, dur, type, vol, atk) {
  if (!soundEnabled || !audioCtx) return;
  const o = audioCtx.createOscillator(), g = audioCtx.createGain();
  o.type = type || 'sine';
  o.frequency.setValueAtTime(freq, audioCtx.currentTime);
  g.gain.setValueAtTime(0, audioCtx.currentTime);
  g.gain.linearRampToValueAtTime(vol || 0.14, audioCtx.currentTime + (atk || 0.01));
  g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
  o.connect(g); g.connect(audioCtx.destination);
  o.start(); o.stop(audioCtx.currentTime + dur + 0.05);
}

function noise(dur, vol, cutoff) {
  if (!soundEnabled || !audioCtx) return;
  const n = audioCtx.sampleRate * dur;
  const buf = audioCtx.createBuffer(1, n, audioCtx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  const src = audioCtx.createBufferSource(); src.buffer = buf;
  const flt = audioCtx.createBiquadFilter(); flt.type = 'lowpass';
  flt.frequency.setValueAtTime(cutoff || 2000, audioCtx.currentTime);
  const g = audioCtx.createGain();
  g.gain.setValueAtTime(vol || 0.07, audioCtx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
  src.connect(flt); flt.connect(g); g.connect(audioCtx.destination);
  src.start(); src.stop(audioCtx.currentTime + dur + 0.01);
}

const sfx = {
  tap()   { tone(700,0.04,'triangle',0.08,0.003); },
  place() { tone(480,0.12,'sine',0.18); noise(0.05,0.06,800); },
  remove(){ tone(350,0.08,'triangle',0.1); },
  error() { tone(160,0.18,'sawtooth',0.07); },
  hint()  { tone(880,0.1,'sine',0.1); setTimeout(()=>tone(1100,0.13,'sine',0.08),70); setTimeout(()=>tone(1320,0.18,'sine',0.06),140); },
  undo()  { tone(600,0.06,'triangle',0.08); tone(400,0.08,'triangle',0.06,0.02); },
  clear() { noise(0.2,0.1,1200); tone(380,0.12,'sawtooth',0.04); },
  win()   { [523,659,784,1047].forEach((f,i)=>setTimeout(()=>{tone(f,0.3,'sine',0.12);tone(f*.5,0.25,'sine',0.06);},i*120)); setTimeout(()=>noise(0.3,0.06,3000),400); }
};

// ── UTILS ─────────────────────────────────────────────────
function shuffle(a) {
  for (let i = a.length-1; i > 0; i--) { const j = Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; }
  return a;
}

// ── STORAGE ───────────────────────────────────────────────
function getBest(mode, diff) { return parseInt(localStorage.getItem(KEY_PREFIX+`score-${mode}-${diff}`)||'0'); }
function saveBest(mode, diff, score) {
  if (score > getBest(mode,diff)) { localStorage.setItem(KEY_PREFIX+`score-${mode}-${diff}`, score); return true; }
  return false;
}
function getStats(mode) { return JSON.parse(localStorage.getItem(KEY_PREFIX+`stats-${mode}`)||'{"wins":0,"stars":0,"best":0}'); }
function saveStats(mode, s) { localStorage.setItem(KEY_PREFIX+`stats-${mode}`, JSON.stringify(s)); }
function recordWin(mode, score, stars) {
  const s = getStats(mode);
  s.wins++; s.stars += stars; s.best = Math.max(s.best||0, score);
  saveStats(mode, s);
}
function updateMenuScores() {
  ['kakuro','suguru'].forEach(m => {
    const s = getStats(m);
    $(`menu-${m}-best`).textContent = s.best ? s.best.toLocaleString() : '—';
    $(`menu-${m}-wins`).textContent = s.wins || 0;
    $(`menu-${m}-stars`).textContent = s.stars || 0;
  });
}
function updateSetupBest() {
  const b = getBest(gameMode, difficulty);
  $('setup-best').textContent = b ? `Best: ${b.toLocaleString()} pts` : '';
}

// ── TIMER & SCORE ─────────────────────────────────────────
function startTimer() {
  timerStart = performance.now();
  (function tick() {
    const el = Math.floor((performance.now()-timerStart)/1000);
    $('timer').textContent = `${Math.floor(el/60)}:${String(el%60).padStart(2,'0')}`;
    updateLiveScore();
    timerRAF = requestAnimationFrame(tick);
  })();
}
function stopTimer() { cancelAnimationFrame(timerRAF); timerRAF = 0; }

function basePoints() {
  return Math.round(500 * ({easy:1,medium:2,hard:3.5}[difficulty]) * ({kakuro:1.2,suguru:1.1}[gameMode]));
}
function calcScore() {
  const base = basePoints();
  const elapsed = Math.floor((performance.now()-timerStart)/1000);
  const tp = Math.min(base, Math.floor(elapsed/10)*Math.round(base*0.01));
  const hp = (HINTS_MAX[difficulty]-hintsLeft)*Math.round(base*0.15);
  const cp = Math.max(0,checksUsed-1)*Math.round(base*0.05);
  return { base, tp, hp, cp, total: Math.max(0, base-tp-hp-cp), elapsed };
}
function updateLiveScore() { $('live-score').textContent = calcScore().total.toLocaleString(); }
function getStars(score) { const p=score/basePoints(); return p>=0.8?3:p>=0.5?2:1; }

// ════════════════════════════════════════════════════════════
// KAKURO GENERATOR
// ════════════════════════════════════════════════════════════

function generateKakuro(diff) {
  const N = { easy:6, medium:8, hard:10 }[diff];

  let attempt = 0;
  while (attempt++ < 80) {
    const grid = buildKakuroLayout(N, diff);
    fixKakuroRuns(grid, N);
    const { hRuns, vRuns } = findKakuroRuns(grid, N);
    if (hRuns.length < 3 || vRuns.length < 3) continue;

    const hOf = {}, vOf = {};
    hRuns.forEach((r,i) => r.cells.forEach(([rr,cc]) => hOf[`${rr},${cc}`]=i));
    vRuns.forEach((r,i) => r.cells.forEach(([rr,cc]) => vOf[`${rr},${cc}`]=i));

    // Verify every white cell is in both an H-run and V-run
    let valid = true;
    for (let r=1;r<N&&valid;r++) for (let c=1;c<N&&valid;c++)
      if (grid[r][c].t==='w' && (hOf[`${r},${c}`]===undefined || vOf[`${r},${c}`]===undefined))
        valid = false;
    if (!valid) continue;

    const sol = solveKakuro(N, grid, hRuns, vRuns, hOf, vOf);
    if (!sol) continue;

    // Assign clues
    hRuns.forEach(run => {
      const [cr,cc] = run.cc;
      if (grid[cr][cc].t==='b') grid[cr][cc].t='clue';
      grid[cr][cc].r = run.cells.reduce((s,[rr,cc2])=>s+sol[rr][cc2],0);
    });
    vRuns.forEach(run => {
      const [cr,cc] = run.cc;
      if (grid[cr][cc].t==='b') grid[cr][cc].t='clue';
      grid[cr][cc].d = run.cells.reduce((s,[rr,cc2])=>s+sol[rr][cc2],0);
    });

    // Build puzzle (pre-fill some for easy)
    const prefillRate = diff==='easy' ? 0.22 : 0;
    const puzzle = grid.map((row,r) => row.map((cell,c) => {
      if (cell.t!=='w') return 0;
      return (Math.random()<prefillRate) ? sol[r][c] : 0;
    }));

    return { N, grid, sol, puzzle, hRuns, vRuns, hOf, vOf };
  }
  // Should never reach here with 60 attempts, but just in case re-seed
  console.warn('Kakuro generation exceeded attempts, retrying');
  return generateKakuro(diff);
}

function buildKakuroLayout(N, diff) {
  const MAX_RUN = {easy:3, medium:4, hard:5}[diff] || 4;
  const grid = Array.from({length:N}, (_, r) =>
    Array.from({length:N}, (_, c) => ({t:(r===0||c===0)?'b':'b', d:0, r:0}))
  );

  // Place H-runs row by row (guaranteed length ≥ 2)
  for (let r=1; r<N; r++) {
    let c=1;
    while (c <= N-2) {
      if (Math.random() < 0.25) { c++; continue; } // random gap
      const avail = N - c;
      if (avail < 2) break;
      const len = Math.min(2 + Math.floor(Math.random()*(MAX_RUN-1)), avail);
      for (let i=c; i<c+len; i++) grid[r][i].t='w';
      c += len + 1; // gap of at least 1 between runs
    }
  }

  // Single V-fix: remove white cells with no vertical neighbour
  for (let c=1; c<N; c++) {
    for (let r=1; r<N; r++) {
      if (grid[r][c].t!=='w') continue;
      const above = r>1 && grid[r-1][c].t==='w';
      const below = r<N-1 && grid[r+1][c].t==='w';
      if (!above && !below) grid[r][c].t='b';
    }
  }

  // Single H-fix after V-fix (removes any newly isolated H-cells)
  for (let r=1; r<N; r++) {
    let start=-1;
    for (let c=1; c<=N; c++) {
      const w=c<N&&grid[r][c].t==='w';
      if(w&&start===-1)start=c;
      else if(!w&&start!==-1){
        if(c-start===1)grid[r][start].t='b';
        else if(c-start>9)grid[r][start+9].t='b';
        start=-1;
      }
    }
  }
  return grid;
}

function fixKakuroRuns(grid, N) {
  // No-op: layout already fixed in buildKakuroLayout
}

function findKakuroRuns(grid, N) {
  const hRuns=[], vRuns=[];
  for (let r=1;r<N;r++) {
    let run=null;
    for (let c=0;c<N;c++) {
      if (grid[r][c].t==='w') { if(!run) run={cells:[],cc:[r,c-1]}; run.cells.push([r,c]); }
      else { if (run&&run.cells.length>=2) hRuns.push(run); run=null; }
    }
    if (run&&run.cells.length>=2) hRuns.push(run);
  }
  for (let c=1;c<N;c++) {
    let run=null;
    for (let r=0;r<N;r++) {
      if (grid[r][c].t==='w') { if(!run) run={cells:[],cc:[r-1,c]}; run.cells.push([r,c]); }
      else { if (run&&run.cells.length>=2) vRuns.push(run); run=null; }
    }
    if (run&&run.cells.length>=2) vRuns.push(run);
  }
  return { hRuns, vRuns };
}

function solveKakuro(N, grid, hRuns, vRuns, hOf, vOf) {
  const cells=[];
  for (let r=1;r<N;r++) for (let c=1;c<N;c++) if(grid[r][c].t==='w') cells.push([r,c]);
  const sol = Array.from({length:N},()=>new Array(N).fill(0));
  const hUsed = hRuns.map(()=>new Set());
  const vUsed = vRuns.map(()=>new Set());

  function bt(pos) {
    if (pos===cells.length) return true;
    const [r,c]=cells[pos];
    const hi=hOf[`${r},${c}`], vi=vOf[`${r},${c}`];
    const order = shuffle([1,2,3,4,5,6,7,8,9]);
    for (const v of order) {
      if (!hUsed[hi].has(v) && !vUsed[vi].has(v)) {
        sol[r][c]=v; hUsed[hi].add(v); vUsed[vi].add(v);
        if (bt(pos+1)) return true;
        sol[r][c]=0; hUsed[hi].delete(v); vUsed[vi].delete(v);
      }
    }
    return false;
  }
  return bt(0) ? sol : null;
}

// ════════════════════════════════════════════════════════════
// SUGURU GENERATOR
// ════════════════════════════════════════════════════════════

function generateSuguru(diff) {
  const DIMS = { easy:[5,5], medium:[6,6], hard:[7,7] };
  const MAX_CAGE = { easy:4, medium:5, hard:5 };
  const PREFILL = { easy:0.35, medium:0.20, hard:0.10 };

  const [R,C] = DIMS[diff];
  const maxCage = MAX_CAGE[diff];

  let attempt = 0;
  while (attempt++ < 40) {
    const { cages, cageOf } = buildSuguruCages(R, C, maxCage);
    const sol = solveSuguru(R, C, cages, cageOf);
    if (!sol) continue;

    const prefill = PREFILL[diff];
    const puzzle = sol.map((row,r) => row.map((v,c) => Math.random()<prefill ? v : 0));
    // Ensure at least 1 given per cage
    cages.forEach(cage => {
      const hasGiven = cage.cells.some(([r,c])=>puzzle[r][c]!==0);
      if (!hasGiven) {
        const [r,c] = cage.cells[Math.floor(Math.random()*cage.cells.length)];
        puzzle[r][c] = sol[r][c];
      }
    });

    const maxN = Math.max(...cages.map(c=>c.cells.length));
    return { R, C, cages, cageOf, sol, puzzle, maxN };
  }
  return generateSuguru(diff);
}

function buildSuguruCages(R, C, maxSize) {
  const cageOf = Array.from({length:R},()=>new Array(C).fill(-1));
  const cages = [];
  const allCells = [];
  for (let r=0;r<R;r++) for (let c=0;c<C;c++) allCells.push([r,c]);
  shuffle(allCells);

  for (const [sr,sc] of allCells) {
    if (cageOf[sr][sc]!==-1) continue;
    const cage = { id: cages.length, cells:[] };
    cageOf[sr][sc] = cage.id;
    cage.cells.push([sr,sc]);
    const frontier = [[sr,sc]];

    while (frontier.length && cage.cells.length < maxSize) {
      const qi = Math.floor(Math.random()*frontier.length);
      const [r,c] = frontier.splice(qi,1)[0];
      const ns = shuffle([[r-1,c],[r+1,c],[r,c-1],[r,c+1]]
        .filter(([nr,nc])=>nr>=0&&nr<R&&nc>=0&&nc<C&&cageOf[nr][nc]===-1));
      for (const [nr,nc] of ns) {
        if (cage.cells.length>=maxSize) break;
        cageOf[nr][nc]=cage.id; cage.cells.push([nr,nc]); frontier.push([nr,nc]);
      }
    }
    cages.push(cage);
  }
  return { cages, cageOf };
}

function solveSuguru(R, C, cages, cageOf) {
  const sol = Array.from({length:R},()=>new Array(C).fill(0));
  const cageUsed = cages.map(()=>new Set());
  const cells = [];
  for (let r=0;r<R;r++) for (let c=0;c<C;c++) cells.push([r,c]);

  function neighbors8(r,c) {
    const ns=[];
    for (let dr=-1;dr<=1;dr++) for (let dc=-1;dc<=1;dc++)
      if ((dr||dc)&&r+dr>=0&&r+dr<R&&c+dc>=0&&c+dc<C) ns.push([r+dr,c+dc]);
    return ns;
  }

  function bt(pos) {
    if (pos===cells.length) return true;
    const [r,c]=cells[pos];
    const ci=cageOf[r][c];
    const cageSize=cages[ci].cells.length;
    const nums = shuffle(Array.from({length:cageSize},(_,i)=>i+1));
    for (const v of nums) {
      if (cageUsed[ci].has(v)) continue;
      if (neighbors8(r,c).some(([nr,nc])=>sol[nr][nc]===v)) continue;
      sol[r][c]=v; cageUsed[ci].add(v);
      if (bt(pos+1)) return true;
      sol[r][c]=0; cageUsed[ci].delete(v);
    }
    return false;
  }
  return bt(0) ? sol : null;
}

// ════════════════════════════════════════════════════════════
// LAYOUT COMPUTATION
// ════════════════════════════════════════════════════════════

function computeCellSize(gridN) {
  const vw = Math.min(540, window.innerWidth);
  const vh = window.innerHeight;
  const topbarH = 52 + 20 + 8; // topbar + label + padding
  const actionsH = 44 + 24;    // actions + padding
  const trayH = 80;            // tray area minimum
  const gridBudget = vh - topbarH - actionsH - trayH;
  const maxFromH = Math.floor(gridBudget / gridN) - 1;
  const maxFromW = Math.floor((vw - 24) / gridN) - 1;
  return Math.max(28, Math.min(maxFromH, maxFromW, 70));
}

// ════════════════════════════════════════════════════════════
// KAKURO RENDERING
// ════════════════════════════════════════════════════════════

function renderKakuroGrid() {
  const cs = computeCellSize(kN);
  const gridEl = $('grid');
  const cageLayer = $('cage-layer');
  cageLayer.innerHTML = '';
  cageLayer.style.display = 'none';

  gridEl.style.gridTemplateColumns = `repeat(${kN}, ${cs}px)`;
  gridEl.style.gridTemplateRows    = `repeat(${kN}, ${cs}px)`;
  gridEl.style.gap = '1px';
  gridEl.style.background = 'var(--border)';
  gridEl.innerHTML = '';

  const fs = Math.max(11, Math.floor(cs * 0.38));
  const cluefs = Math.max(8, Math.floor(cs * 0.22));

  for (let r=0;r<kN;r++) {
    for (let c=0;c<kN;c++) {
      const cell = kGrid[r][c];
      const el = document.createElement('div');
      el.className = 'cell';
      el.dataset.r = r; el.dataset.c = c;
      el.style.width = el.style.height = cs + 'px';

      if (cell.t === 'w') {
        const val = kPlayer[r][c];
        const given = kPuzzle[r][c] !== 0;
        el.classList.add('white');
        if (given) el.classList.add('given');
        else if (selectedCell && selectedCell.r===r && selectedCell.c===c) el.classList.add('selected');
        else if (val) el.classList.add('filled');
        el.style.fontSize = fs + 'px';
        if (val) el.textContent = val;

        if (pendingAnimCells.has(`${r},${c}`) && !given) {
          el.classList.add(`anim-${pendingAnimType}`);
          el.addEventListener('animationend', () => el.classList.remove(`anim-${pendingAnimType}`), {once:true});
        }
      } else if (cell.t === 'clue') {
        el.classList.add('clue');
        const hasD = cell.d > 0, hasR = cell.r > 0;
        el.innerHTML = `<div class="clue-inner">
          ${(hasD||hasR) ? `<svg viewBox="0 0 ${cs} ${cs}" preserveAspectRatio="none"><line x1="2" y1="2" x2="${cs-2}" y2="${cs-2}" stroke="rgba(255,255,255,0.35)" stroke-width="1"/></svg>` : ''}
          ${hasD ? `<span class="clue-down" style="font-size:${cluefs}px;">${cell.d}</span>` : ''}
          ${hasR ? `<span class="clue-right" style="font-size:${cluefs}px;">${cell.r}</span>` : ''}
        </div>`;
      } else {
        el.classList.add('blank');
      }

      gridEl.appendChild(el);
    }
  }
  pendingAnimCells.clear();

  // Error highlighting
  applyKakuroErrors();
  renderKakuroTray();
}

function applyKakuroErrors() {
  const errors = getKakuroErrors();
  document.querySelectorAll('#grid .cell.white').forEach(el => {
    const r=+el.dataset.r, c=+el.dataset.c;
    el.classList.toggle('error', errors.has(`${r},${c}`) && kPlayer[r][c]!==0);
  });
}

function getKakuroErrors() {
  const errors = new Set();
  // Check H-runs
  kHRuns.forEach(run => {
    const vals = run.cells.map(([r,c])=>kPlayer[r][c]).filter(v=>v);
    const seen = new Set();
    run.cells.forEach(([r,c]) => {
      const v = kPlayer[r][c]; if (!v) return;
      if (seen.has(v)) errors.add(`${r},${c}`);
      seen.add(v);
    });
    // Check sum if run is fully filled
    if (vals.length === run.cells.length) {
      const sum = vals.reduce((a,b)=>a+b,0);
      const clue = kGrid[run.cc[0]][run.cc[1]].r;
      if (sum !== clue) run.cells.forEach(([r,c])=>errors.add(`${r},${c}`));
    }
  });
  // Check V-runs
  kVRuns.forEach(run => {
    const vals = run.cells.map(([r,c])=>kPlayer[r][c]).filter(v=>v);
    const seen = new Set();
    run.cells.forEach(([r,c]) => {
      const v = kPlayer[r][c]; if (!v) return;
      if (seen.has(v)) errors.add(`${r},${c}`);
      seen.add(v);
    });
    if (vals.length === run.cells.length) {
      const sum = vals.reduce((a,b)=>a+b,0);
      const clue = kGrid[run.cc[0]][run.cc[1]].d;
      if (sum !== clue) run.cells.forEach(([r,c])=>errors.add(`${r},${c}`));
    }
  });
  return errors;
}

function renderKakuroTray() {
  const tray = $('number-tray');
  tray.innerHTML = '';
  // Determine used numbers in selected cell's runs
  const usedInH = new Set(), usedInV = new Set();
  if (selectedCell) {
    const key = `${selectedCell.r},${selectedCell.c}`;
    const hi = kHOf[key], vi = kVOf[key];
    if (hi!==undefined) kHRuns[hi].cells.forEach(([r,c])=>{ if(kPlayer[r][c]) usedInH.add(kPlayer[r][c]); });
    if (vi!==undefined) kVRuns[vi].cells.forEach(([r,c])=>{ if(kPlayer[r][c]) usedInV.add(kPlayer[r][c]); });
  }
  const sz = computeTraySize(9);
  $('tray-section').style.setProperty('--tray-size', sz.size+'px');
  $('tray-section').style.setProperty('--tray-font', sz.font+'px');
  for (let v=1;v<=9;v++) {
    const el = document.createElement('div');
    el.className = 'tray-number';
    el.textContent = v;
    el.dataset.v = v;
    if (selectedCell && (usedInH.has(v) || usedInV.has(v))) el.classList.add('used');
    tray.appendChild(el);
  }
}

// ════════════════════════════════════════════════════════════
// SUGURU RENDERING
// ════════════════════════════════════════════════════════════

function renderSuguruGrid() {
  const cs = computeCellSize(Math.max(sR,sC));
  const gridEl = $('grid');
  gridEl.style.gridTemplateColumns = `repeat(${sC}, ${cs}px)`;
  gridEl.style.gridTemplateRows    = `repeat(${sR}, ${cs}px)`;
  gridEl.style.gap = '1px';
  gridEl.style.background = 'var(--border)';
  gridEl.innerHTML = '';

  const fs = Math.max(13, Math.floor(cs*0.44));
  const errors = getSuguruErrors();

  for (let r=0;r<sR;r++) {
    for (let c=0;c<sC;c++) {
      const el = document.createElement('div');
      el.className = 'cell white';
      el.dataset.r = r; el.dataset.c = c;
      el.style.width = el.style.height = cs + 'px';
      el.style.fontSize = fs + 'px';

      const given = sPuzzle[r][c] !== 0;
      const val = sPlayer[r][c];
      const isSel = selectedCell && selectedCell.r===r && selectedCell.c===c;
      const isErr = errors.has(`${r},${c}`) && val && !given;

      if (given) el.classList.add('given');
      else if (isSel) el.classList.add('selected');
      else if (isErr) el.classList.add('error');
      else if (val) el.classList.add('filled');

      if (val) el.textContent = val;

      if (pendingAnimCells.has(`${r},${c}`) && !given) {
        el.classList.add(`anim-${pendingAnimType}`);
        el.addEventListener('animationend',()=>el.classList.remove(`anim-${pendingAnimType}`),{once:true});
      }
      gridEl.appendChild(el);
    }
  }
  pendingAnimCells.clear();
  renderSuguruCageBorders(cs);
  renderSuguruTray();
}

function renderSuguruCageBorders(cs) {
  const layer = $('cage-layer');
  layer.innerHTML = '';
  layer.style.display = 'block';
  const gap = 1;
  const thick = 3;

  const gridW = sC*(cs+gap)-gap;
  const gridH = sR*(cs+gap)-gap;
  layer.style.width = gridW + 'px';
  layer.style.height = gridH + 'px';

  // Check cage satisfaction
  const cageSat = sCages.map(cage => {
    const vals = cage.cells.map(([r,c])=>sPlayer[r][c]);
    if (!vals.every(v=>v)) return null;
    const cageSize = cage.cells.length;
    const expected = new Set(Array.from({length:cageSize},(_,i)=>i+1));
    return vals.every(v=>expected.has(v)) && new Set(vals).size===cageSize;
  });

  function addSeg(x,y,w,h,sat) {
    const seg = document.createElement('div');
    seg.className = 'cage-seg' + (sat===true?' satisfied':'');
    seg.style.left=x+'px'; seg.style.top=y+'px';
    seg.style.width=w+'px'; seg.style.height=h+'px';
    layer.appendChild(seg);
  }

  for (let r=0;r<sR;r++) {
    for (let c=0;c<sC;c++) {
      const ci = sCageOf[r][c];
      const sat = cageSat[ci];
      const x0 = c*(cs+gap), y0 = r*(cs+gap);

      // Top border
      if (r===0 || sCageOf[r-1][c]!==ci)
        addSeg(x0-thick/2, y0-thick, cs+thick, thick, sat);
      // Bottom border
      if (r===sR-1 || sCageOf[r+1][c]!==ci)
        addSeg(x0-thick/2, y0+cs, cs+thick, thick, sat);
      // Left border
      if (c===0 || sCageOf[r][c-1]!==ci)
        addSeg(x0-thick, y0-thick/2, thick, cs+thick, sat);
      // Right border
      if (c===sC-1 || sCageOf[r][c+1]!==ci)
        addSeg(x0+cs, y0-thick/2, thick, cs+thick, sat);
    }
  }
}

function getSuguruErrors() {
  const errors = new Set();
  // Cage check
  sCages.forEach(cage => {
    const vals = cage.cells.map(([r,c])=>sPlayer[r][c]);
    const seen = new Set();
    cage.cells.forEach(([r,c]) => {
      const v = sPlayer[r][c]; if (!v||sPuzzle[r][c]) return;
      if (seen.has(v)) errors.add(`${r},${c}`);
      else seen.add(v);
      if (v > cage.cells.length) errors.add(`${r},${c}`);
    });
  });
  // Adjacency check
  for (let r=0;r<sR;r++) for (let c=0;c<sC;c++) {
    const v = sPlayer[r][c]; if (!v) continue;
    for (let dr=-1;dr<=1;dr++) for (let dc=-1;dc<=1;dc++) {
      if (!dr&&!dc) continue;
      const nr=r+dr, nc=c+dc;
      if (nr>=0&&nr<sR&&nc>=0&&nc<sC&&sPlayer[nr][nc]===v) {
        if (!sPuzzle[r][c]) errors.add(`${r},${c}`);
        if (!sPuzzle[nr][nc]) errors.add(`${nr},${nc}`);
      }
    }
  }
  return errors;
}

function renderSuguruTray() {
  const tray = $('number-tray');
  tray.innerHTML = '';
  const usedInCage = new Set();
  if (selectedCell) {
    const ci = sCageOf[selectedCell.r][selectedCell.c];
    sCages[ci].cells.forEach(([r,c]) => { if(sPlayer[r][c]) usedInCage.add(sPlayer[r][c]); });
  }
  const sz = computeTraySize(sMaxCage);
  $('tray-section').style.setProperty('--tray-size', sz.size+'px');
  $('tray-section').style.setProperty('--tray-font', sz.font+'px');
  for (let v=1;v<=sMaxCage;v++) {
    const el = document.createElement('div');
    el.className = 'tray-number';
    el.textContent = v;
    el.dataset.v = v;
    if (selectedCell && usedInCage.has(v)) el.classList.add('used');
    tray.appendChild(el);
  }
}

function computeTraySize(count) {
  const vw = Math.min(540, window.innerWidth);
  const avail = vw - 48;
  const gap = 6;
  const perRow = Math.min(count, 9);
  let size = Math.floor((avail - (perRow-1)*gap) / perRow);
  size = Math.max(36, Math.min(size, 64));
  const font = Math.max(13, Math.floor(size*0.44));
  return { size, font };
}

// ════════════════════════════════════════════════════════════
// CELL INTERACTION
// ════════════════════════════════════════════════════════════

function handleCellClick(r, c) {
  ensureAudio();
  if (gameMode === 'kakuro') {
    if (kGrid[r][c].t !== 'w') return;
    if (kPuzzle[r][c] !== 0) return;
    if (selectedCell && selectedCell.r===r && selectedCell.c===c) {
      selectedCell = null; renderKakuroGrid(); return;
    }
    selectedCell = {r,c};
    sfx.tap();
    renderKakuroGrid();
  } else {
    if (sPuzzle[r][c] !== 0) return;
    if (selectedCell && selectedCell.r===r && selectedCell.c===c) {
      selectedCell = null; renderSuguruGrid(); return;
    }
    selectedCell = {r,c};
    sfx.tap();
    renderSuguruGrid();
  }
}

function handleTrayClick(v) {
  ensureAudio();
  if (!selectedCell) return;
  const {r,c} = selectedCell;
  if (gameMode === 'kakuro') {
    if (kGrid[r][c].t !== 'w' || kPuzzle[r][c]) return;
    const prev = kPlayer[r][c];
    if (prev === v) { clearCell(r,c); return; }
    moveHistory.push({mode:'kakuro', r, c, prev, next:v});
    kPlayer[r][c] = v;
    pendingAnimCells.add(`${r},${c}`);
    pendingAnimType = 'pop-in';
    sfx.place();
    renderKakuroGrid();
    $('btn-undo').disabled = false;
    autoCheck();
  } else {
    if (sPuzzle[r][c]) return;
    const prev = sPlayer[r][c];
    if (prev === v) { clearCell(r,c); return; }
    moveHistory.push({mode:'suguru', r, c, prev, next:v});
    sPlayer[r][c] = v;
    pendingAnimCells.add(`${r},${c}`);
    pendingAnimType = 'pop-in';
    sfx.place();
    renderSuguruGrid();
    $('btn-undo').disabled = false;
    autoCheck();
  }
}

function clearCell(r, c) {
  if (gameMode === 'kakuro') {
    if (!kPlayer[r][c] || kPuzzle[r][c]) return;
    moveHistory.push({mode:'kakuro', r, c, prev:kPlayer[r][c], next:0});
    kPlayer[r][c] = 0;
    sfx.remove();
    renderKakuroGrid();
  } else {
    if (!sPlayer[r][c] || sPuzzle[r][c]) return;
    moveHistory.push({mode:'suguru', r, c, prev:sPlayer[r][c], next:0});
    sPlayer[r][c] = 0;
    sfx.remove();
    renderSuguruGrid();
  }
  $('btn-undo').disabled = moveHistory.length === 0;
}

// ════════════════════════════════════════════════════════════
// GAME ACTIONS
// ════════════════════════════════════════════════════════════

function doUndo() {
  ensureAudio();
  if (!moveHistory.length) return;
  const mv = moveHistory.pop();
  if (mv.mode === 'kakuro') kPlayer[mv.r][mv.c] = mv.prev;
  else sPlayer[mv.r][mv.c] = mv.prev;
  sfx.undo();
  $('btn-undo').disabled = moveHistory.length === 0;
  render();
}

function doClear() {
  ensureAudio();
  if (gameMode === 'kakuro') {
    for (let r=0;r<kN;r++) for (let c=0;c<kN;c++)
      if (kGrid[r][c].t==='w' && !kPuzzle[r][c]) kPlayer[r][c]=0;
  } else {
    for (let r=0;r<sR;r++) for (let c=0;c<sC;c++)
      if (!sPuzzle[r][c]) sPlayer[r][c]=0;
  }
  moveHistory = [];
  selectedCell = null;
  $('btn-undo').disabled = true;
  sfx.clear();
  render();
}

function doHint() {
  ensureAudio();
  if (hintsLeft <= 0) return;
  // Find an empty non-given cell to fill
  const empties = [];
  if (gameMode === 'kakuro') {
    for (let r=1;r<kN;r++) for (let c=1;c<kN;c++)
      if (kGrid[r][c].t==='w' && !kPuzzle[r][c] && !kPlayer[r][c]) empties.push([r,c]);
  } else {
    for (let r=0;r<sR;r++) for (let c=0;c<sC;c++)
      if (!sPuzzle[r][c] && !sPlayer[r][c]) empties.push([r,c]);
  }
  if (!empties.length) return;
  const [r,c] = empties[Math.floor(Math.random()*empties.length)];
  const sol = gameMode==='kakuro' ? kSol[r][c] : sSol[r][c];
  moveHistory.push({mode:gameMode, r, c, prev:0, next:sol});
  if (gameMode==='kakuro') kPlayer[r][c]=sol;
  else sPlayer[r][c]=sol;
  hintsLeft--;
  $('btn-hint').textContent = `Hint (${hintsLeft})`;
  if (hintsLeft<=0) $('btn-hint').disabled=true;
  pendingAnimCells.add(`${r},${c}`);
  pendingAnimType='pop-in';
  sfx.hint();
  $('btn-undo').disabled=false;
  render();
  autoCheck();
}

function doCheck() {
  ensureAudio();
  checksUsed++;
  const errors = gameMode==='kakuro' ? getKakuroErrors() : getSuguruErrors();
  if (errors.size===0) {
    // No errors — flash cells green briefly
    document.querySelectorAll('#grid .cell.filled, #grid .cell.given').forEach(el => {
      el.style.background='var(--success-light)';
      el.style.color='var(--success)';
      setTimeout(()=>{ el.style.background=''; el.style.color=''; }, 600);
    });
  } else {
    sfx.error();
    document.querySelectorAll('#grid .cell.white').forEach(el => {
      const r=+el.dataset.r, c=+el.dataset.c;
      if (errors.has(`${r},${c}`)) {
        el.classList.add('anim-shake');
        el.addEventListener('animationend',()=>el.classList.remove('anim-shake'),{once:true});
      }
    });
  }
  updateLiveScore();
}

function render() {
  if (gameMode==='kakuro') renderKakuroGrid();
  else renderSuguruGrid();
}

// ════════════════════════════════════════════════════════════
// WIN DETECTION
// ════════════════════════════════════════════════════════════

function isKakuroComplete() {
  for (let r=1;r<kN;r++) for (let c=1;c<kN;c++)
    if (kGrid[r][c].t==='w' && !kPlayer[r][c]) return false;
  return getKakuroErrors().size === 0;
}

function isSuguruComplete() {
  for (let r=0;r<sR;r++) for (let c=0;c<sC;c++)
    if (!sPlayer[r][c]) return false;
  return getSuguruErrors().size === 0;
}

function autoCheck() {
  const complete = gameMode==='kakuro' ? isKakuroComplete() : isSuguruComplete();
  if (!complete) return;
  stopTimer();
  const serial = ++gameSerial;
  // Win ripple animation
  document.querySelectorAll('#grid .cell').forEach(el => {
    const r=+el.dataset.r, c=+el.dataset.c;
    const delay = (gameMode==='kakuro' ? (r+c)*50 : (r+c)*60);
    setTimeout(() => {
      if (gameSerial!==serial) return;
      el.classList.add('anim-win');
      el.addEventListener('animationend',()=>el.classList.remove('anim-win'),{once:true});
    }, delay);
  });
  const maxDelay = gameMode==='kakuro' ? (kN+kN)*50+400 : (sR+sC)*60+400;
  setTimeout(() => {
    if (gameSerial!==serial) return;
    sfx.win();
    showWin();
  }, maxDelay);
}

function showWin() {
  const sc = calcScore();
  const stars = getStars(sc.total);
  const isNewBest = saveBest(gameMode, difficulty, sc.total);
  recordWin(gameMode, sc.total, stars);

  $('win-subtitle').textContent = `${gameMode==='kakuro'?'Kakuro':'Suguru'} · ${difficulty.charAt(0).toUpperCase()+difficulty.slice(1)}`;
  $('win-stars').textContent = '★'.repeat(stars) + '☆'.repeat(3-stars);
  $('win-score').textContent = sc.total.toLocaleString();
  $('win-best').textContent = isNewBest ? '🏆 New personal best!' : '';

  const rows = [
    ['Base score', '+'+sc.base.toLocaleString(), false],
    sc.tp   ? ['Time penalty', '-'+sc.tp.toLocaleString(), true] : null,
    sc.hp   ? ['Hint penalty', '-'+sc.hp.toLocaleString(), true] : null,
    sc.cp   ? ['Check penalty', '-'+sc.cp.toLocaleString(), true] : null,
  ].filter(Boolean);

  $('win-breakdown').innerHTML = rows.map(([label,val,pen]) =>
    `<div class="win-breakdown-row${pen?' penalty':''}">`+
    `<span>${label}</span><span>${val}</span></div>`
  ).join('');

  $('win-overlay').classList.add('active');
}

// ════════════════════════════════════════════════════════════
// GAME START
// ════════════════════════════════════════════════════════════

function startGame() {
  gameSerial++;
  selectedCell = null;
  moveHistory = [];
  pendingAnimCells.clear();
  checksUsed = 0;
  hintsLeft = HINTS_MAX[difficulty];
  $('btn-hint').textContent = `Hint (${hintsLeft})`;
  $('btn-hint').disabled = false;
  $('btn-undo').disabled = true;
  $('game-mode-label').textContent = `${gameMode.toUpperCase()} · ${difficulty.toUpperCase()}`;
  stopTimer();

  if (gameMode === 'kakuro') {
    const gen = generateKakuro(difficulty);
    kN=gen.N; kGrid=gen.grid; kSol=gen.sol; kPuzzle=gen.puzzle;
    kPlayer=gen.puzzle.map(row=>[...row]);
    kHRuns=gen.hRuns; kVRuns=gen.vRuns; kHOf=gen.hOf; kVOf=gen.vOf;
    $('cage-layer').style.display='none';
  } else {
    const gen = generateSuguru(difficulty);
    sR=gen.R; sC=gen.C; sCages=gen.cages; sCageOf=gen.cageOf;
    sSol=gen.sol; sPuzzle=gen.puzzle;
    sPlayer=gen.puzzle.map(row=>[...row]);
    sMaxCage=gen.maxN;
  }

  showScreen('game');
  render();
  startTimer();
}

// ════════════════════════════════════════════════════════════
// HOWTO
// ════════════════════════════════════════════════════════════

function showHowto() {
  const data = HOWTO_DATA[gameMode];
  $('howto-title').textContent = data.title;
  $('howto-body').innerHTML = data.body;
  $('howto-overlay').classList.add('active');
}

// ════════════════════════════════════════════════════════════
// EVENT LISTENERS
// ════════════════════════════════════════════════════════════

// Mode cards
document.querySelectorAll('.mode-card').forEach(card => {
  card.addEventListener('click', () => {
    sfx.tap(); ensureAudio();
    gameMode = card.dataset.mode;
    $('setup-title').textContent = gameMode==='kakuro' ? 'Kakuro' : 'Suguru';
    $('setup-desc').textContent = gameMode==='kakuro' ? 'Fill runs with no repeats' : 'Fill cages, no touching duplicates';
    document.querySelectorAll('.diff-btn').forEach(b => b.classList.toggle('selected', b.dataset.diff===difficulty));
    updateSetupBest();
    showScreen('setup');
  });
});

// Difficulty buttons
document.querySelectorAll('.diff-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    sfx.tap();
    difficulty = btn.dataset.diff;
    document.querySelectorAll('.diff-btn').forEach(b => b.classList.toggle('selected', b===btn));
    updateSetupBest();
  });
});

$('start-btn').addEventListener('click', () => { sfx.tap(); startGame(); });
$('back-link').addEventListener('click', () => { sfx.tap(); showScreen('menu'); });

// Game buttons
$('btn-back').addEventListener('click', () => {
  sfx.tap(); stopTimer(); selectedCell=null; showScreen('menu');
});
$('btn-howto').addEventListener('click', () => { sfx.tap(); showHowto(); });
$('btn-undo').addEventListener('click', doUndo);
$('btn-clear').addEventListener('click', doClear);
$('btn-hint').addEventListener('click', doHint);
$('btn-check').addEventListener('click', doCheck);

// Howto/win overlays
$('howto-close').addEventListener('click', () => { sfx.tap(); $('howto-overlay').classList.remove('active'); });
$('win-menu').addEventListener('click', () => { sfx.tap(); stopTimer(); showScreen('menu'); });
$('win-again').addEventListener('click', () => { sfx.tap(); startGame(); });

// Grid clicks
$('grid').addEventListener('click', e => {
  const el = e.target.closest('.cell');
  if (!el) return;
  handleCellClick(+el.dataset.r, +el.dataset.c);
});

// Tray clicks
$('number-tray').addEventListener('click', e => {
  const el = e.target.closest('.tray-number');
  if (!el) return;
  handleTrayClick(+el.dataset.v);
});

// Theme / mute toggles
$('theme-toggle').addEventListener('click', () => {
  ensureAudio(); sfx.tap();
  darkMode = !darkMode;
  localStorage.setItem(KEY_PREFIX+'theme', darkMode?'dark':'light');
  applyTheme();
});
$('mute-toggle').addEventListener('click', () => {
  soundEnabled = !soundEnabled;
  localStorage.setItem(KEY_PREFIX+'sound', soundEnabled?'on':'off');
  $('mute-toggle').textContent = soundEnabled ? '🔊' : '🔇';
  if (soundEnabled) { ensureAudio(); sfx.tap(); }
});

// Keyboard input
document.addEventListener('keydown', e => {
  if (!selectedCell) return;
  const v = parseInt(e.key);
  if (v>=1 && v<=9) { handleTrayClick(v); return; }
  if (e.key==='Backspace'||e.key==='Delete'||e.key==='0') {
    clearCell(selectedCell.r, selectedCell.c);
  }
  if (e.key==='Escape') { selectedCell=null; render(); }
});

// Ensure audio on first touch
document.addEventListener('touchstart', ensureAudio, {once:true,passive:true});
document.addEventListener('mousedown', ensureAudio, {once:true});

// Resize → re-render
window.addEventListener('resize', () => { if ($('game-screen').classList.contains('active')) render(); });

// ════════════════════════════════════════════════════════════
// INIT
// ════════════════════════════════════════════════════════════

function init() {
  // Load preferences
  darkMode = localStorage.getItem(KEY_PREFIX+'theme') === 'dark';
  soundEnabled = localStorage.getItem(KEY_PREFIX+'sound') !== 'off';
  $('mute-toggle').textContent = soundEnabled ? '🔊' : '🔇';
  applyTheme();

  // Register service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js').catch(()=>{});
  }

  // Set initial difficulty UI
  document.querySelectorAll('.diff-btn').forEach(b => b.classList.toggle('selected', b.dataset.diff===difficulty));

  updateMenuScores();
  showScreen('menu');
}

init();
})();
