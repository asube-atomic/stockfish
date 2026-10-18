import { Chess } from './chess.js';
import { pieceSVG } from './pieces.js';

const FILES = 'abcdefgh';

const boardEl = document.getElementById('board');
const statusEl = document.getElementById('status');
const depthEl = document.getElementById('depth');
const sideEl = document.getElementById('side');
const newGameBtn = document.getElementById('newgame');
const flipBtn = document.getElementById('flip');
const moveLogEl = document.getElementById('movelog');
const engineIcon = document.getElementById('engine-icon');
const humanIcon = document.getElementById('human-icon');

let game = new Chess();
let humanColor = 'w';
let flipped = false;
let selected = null;
let legalForSelected = [];
let thinking = false;
let moveLog = [];
let pendingMove = null;

// Drag state
let dragFromIdx = null;
let dragStartX = 0;
let dragStartY = 0;
let dragMoved = false;
let dragGhost = null;
let justDragged = false;

function displayOrder() {
  const order = [];
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const idx = r * 8 + f;
      order.push(flipped ? (7 - r) * 8 + (7 - f) : idx);
    }
  }
  return order;
}

function render() {
  boardEl.innerHTML = '';
  const order = displayOrder();
  for (let pos = 0; pos < order.length; pos++) {
    const idx = order[pos];
    const isDark = ((idx % 8) + Math.floor(idx / 8)) % 2;
    const sq = document.createElement('div');
    sq.className = 'sq ' + (isDark ? 'dark' : 'light');
    sq.dataset.idx = idx;

    if (selected === idx) sq.classList.add('selected');
    if (legalForSelected.some((m) => m.to === idx)) sq.classList.add('legal');

    // Coordinate labels
    const row = Math.floor(pos / 8);
    const col = pos % 8;
    if (col === 0) {
      const rank = document.createElement('span');
      rank.className = 'coord rank-coord ' + (isDark ? 'on-dark' : 'on-light');
      rank.textContent = 8 - Math.floor(idx / 8);
      sq.appendChild(rank);
    }
    if (row === 7) {
      const file = document.createElement('span');
      file.className = 'coord file-coord ' + (isDark ? 'on-dark' : 'on-light');
      file.textContent = FILES[idx % 8];
      sq.appendChild(file);
    }

    const piece = game.board[idx];
    if (piece) {
      const wrap = document.createElement('div');
      wrap.className = 'piece-wrap';
      wrap.innerHTML = pieceSVG(piece);
      sq.appendChild(wrap);
    }
    sq.addEventListener('click', () => onSquareClick(idx));
    sq.addEventListener('pointerdown', (e) => onSquarePointerDown(e, idx));
    boardEl.appendChild(sq);
  }
  updateStatus();

  if (pendingMove) {
    animateMove(pendingMove.from, pendingMove.to);
    pendingMove = null;
  }
}

function animateMove(fromIdx, toIdx) {
  const fromSq = document.querySelector(`.sq[data-idx="${fromIdx}"]`);
  const toSq = document.querySelector(`.sq[data-idx="${toIdx}"]`);
  if (!fromSq || !toSq) return;
  const wrap = toSq.querySelector('.piece-wrap');
  if (!wrap) return;

  const fr = fromSq.getBoundingClientRect();
  const tr = toSq.getBoundingClientRect();
  const dx = fr.left - tr.left;
  const dy = fr.top - tr.top;

  wrap.animate(
    [
      { transform: `translate(${dx}px, ${dy}px)` },
      { transform: 'translate(0, 0)' },
    ],
    { duration: 300, easing: 'cubic-bezier(0.25,0.46,0.45,0.94)' }
  );
}

// --- Drag and drop ---

function onSquarePointerDown(e, idx) {
  if (thinking || game.gameStatus() !== 'ongoing' || game.turn !== humanColor) return;
  const piece = game.board[idx];
  if (!piece || (piece === piece.toUpperCase() ? 'w' : 'b') !== humanColor) return;

  e.preventDefault();
  dragFromIdx = idx;
  dragStartX = e.clientX;
  dragStartY = e.clientY;
  dragMoved = false;

  selected = idx;
  legalForSelected = game.legalMoves().filter((m) => m.from === idx);
  render();

  const sq = document.querySelector(`.sq[data-idx="${idx}"]`);
  const wrap = sq?.querySelector('.piece-wrap');
  if (wrap) {
    const rect = wrap.getBoundingClientRect();
    dragGhost = wrap.cloneNode(true);
    dragGhost.style.position = 'fixed';
    dragGhost.style.left = rect.left + 'px';
    dragGhost.style.top = rect.top + 'px';
    dragGhost.style.width = rect.width + 'px';
    dragGhost.style.height = rect.height + 'px';
    dragGhost.style.pointerEvents = 'none';
    dragGhost.style.zIndex = '1000';
    dragGhost.style.transition = 'none';
    dragGhost.classList.add('drag-ghost');
    document.body.appendChild(dragGhost);
    wrap.style.opacity = '0.25';
  }

  document.addEventListener('pointermove', onPointerMove);
  document.addEventListener('pointerup', onPointerUp);
}

function onPointerMove(e) {
  if (dragFromIdx === null) return;
  const dx = e.clientX - dragStartX;
  const dy = e.clientY - dragStartY;
  if (Math.abs(dx) > 5 || Math.abs(dy) > 5) dragMoved = true;

  if (dragMoved && dragGhost) {
    const sq = document.querySelector(`.sq[data-idx="${dragFromIdx}"]`);
    if (sq) {
      const rect = sq.getBoundingClientRect();
      dragGhost.style.left = (rect.left + dx) + 'px';
      dragGhost.style.top = (rect.top + dy) + 'px';
    }
  }
}

function onPointerUp(e) {
  document.removeEventListener('pointermove', onPointerMove);
  document.removeEventListener('pointerup', onPointerUp);

  if (dragGhost) { dragGhost.remove(); dragGhost = null; }
  const srcWrap = document.querySelector(`.sq[data-idx="${dragFromIdx}"] .piece-wrap`);
  if (srcWrap) srcWrap.style.opacity = '';

  if (!dragMoved) {
    dragFromIdx = null;
    return;
  }

  justDragged = true;

  const target = document.elementFromPoint(e.clientX, e.clientY);
  const targetSq = target?.closest?.('.sq');
  if (targetSq) {
    const targetIdx = parseInt(targetSq.dataset.idx, 10);
    const move = legalForSelected.find((m) => m.to === targetIdx);
    if (move) {
      if (move.promo) {
        showPromotionDialog(dragFromIdx, targetIdx, move);
        dragFromIdx = null;
        return;
      }
      game._make(move);
      moveLog.push(game.moveToUci(move));
      updateMoveLog();
      selected = null;
      legalForSelected = [];
      pendingMove = { from: move.from, to: move.to };
      render();
      if (game.gameStatus() === 'ongoing') engineMove();
      dragFromIdx = null;
      return;
    }
  }

  selected = null;
  legalForSelected = [];
  dragFromIdx = null;
  render();
}

// --- Click to move ---

function onSquareClick(idx) {
  if (justDragged) { justDragged = false; return; }
  if (thinking) return;
  if (game.gameStatus() !== 'ongoing') return;
  if (game.turn !== humanColor) return;

  const piece = game.board[idx];

  if (selected !== null) {
    const move = legalForSelected.find((m) => m.to === idx);
    if (move) {
      if (move.promo) {
        showPromotionDialog(selected, idx, move);
        return;
      }
      game._make(move);
      moveLog.push(game.moveToUci(move));
      updateMoveLog();
      selected = null;
      legalForSelected = [];
      pendingMove = { from: move.from, to: move.to };
      render();
      if (game.gameStatus() === 'ongoing') engineMove();
      return;
    }
  }

  if (piece && (piece === piece.toUpperCase() ? 'w' : 'b') === humanColor) {
    selected = idx;
    legalForSelected = game.legalMoves().filter((m) => m.from === idx);
  } else {
    selected = null;
    legalForSelected = [];
  }
  render();
}

function updateStatus() {
  const status = game.gameStatus();
  let text;
  if (status === 'checkmate-white') text = 'Checkmate — White wins!';
  else if (status === 'checkmate-black') text = 'Checkmate — Black wins!';
  else if (status === 'stalemate') text = 'Stalemate — Draw';
  else if (status === 'fifty-move') text = 'Draw — 50-move rule';
  else {
    const who = game.turn === 'w' ? 'White' : 'Black';
    const check = game.inCheck(game.turn) ? ' — Check!' : '';
    text = `${who} to move${check}`;
  }
  if (thinking) text = 'Engine thinking\u2026';
  statusEl.textContent = text;
  statusEl.className = 'status' + (status.startsWith('checkmate') ? ' done' : '');
}

function updateMoveLog() {
  moveLogEl.innerHTML = moveLog.map((m, i) => {
    const num = Math.floor(i / 2) + 1;
    const dot = i % 2 === 0 ? `${num}.` : '';
    return `<span class="ply">${dot} ${m}</span>`;
  }).join(' ');
  moveLogEl.scrollTop = moveLogEl.scrollHeight;
}

async function engineMove() {
  if (game.gameStatus() !== 'ongoing') return;
  thinking = true;
  updateStatus();
  try {
    const depth = parseInt(depthEl.value, 10) || 8;
    const resp = await fetch('/api/bestmove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fen: game.fen(), depth }),
    });
    const data = await resp.json();
    if (data.bestmove) {
      const m = game.parseUci(data.bestmove);
      if (m) {
        game._make(m);
        moveLog.push(data.bestmove);
        updateMoveLog();
        pendingMove = { from: m.from, to: m.to };
      }
    }
  } catch (e) {
    statusEl.textContent = 'Engine error: ' + (e.message || e);
  }
  thinking = false;
  render();
}

function showPromotionDialog(fromIdx, toIdx, baseMove) {
  const overlay = document.createElement('div');
  overlay.className = 'promo-overlay';
  for (const promo of ['Q', 'R', 'B', 'N']) {
    const btn = document.createElement('button');
    btn.className = 'promo-btn';
    btn.innerHTML = pieceSVG(humanColor === 'w' ? promo : promo.toLowerCase());
    btn.addEventListener('click', () => {
      const m = { ...baseMove, promo };
      game._make(m);
      moveLog.push(game.moveToUci(m));
      updateMoveLog();
      selected = null;
      legalForSelected = [];
      overlay.remove();
      pendingMove = { from: m.from, to: m.to };
      render();
      if (game.gameStatus() === 'ongoing') engineMove();
    });
    overlay.appendChild(btn);
  }
  const cancel = document.createElement('button');
  cancel.className = 'promo-cancel';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', () => {
    overlay.remove();
    selected = null;
    legalForSelected = [];
    render();
  });
  overlay.appendChild(cancel);
  document.body.appendChild(overlay);
}

function newGame() {
  game = new Chess();
  selected = null;
  legalForSelected = [];
  thinking = false;
  moveLog = [];
  pendingMove = null;
  dragFromIdx = null;
  humanColor = sideEl.value;
  flipped = humanColor === 'b';

  // Set player icons (engine plays opposite color)
  if (engineIcon) engineIcon.innerHTML = pieceSVG(humanColor === 'w' ? 'p' : 'P');
  if (humanIcon) humanIcon.innerHTML = pieceSVG(humanColor === 'w' ? 'P' : 'p');

  // Clear engine hash table for a fresh game
  fetch('/api/newgame', { method: 'POST' }).catch(() => {});

  updateMoveLog();
  render();
  if (humanColor === 'b') engineMove();
}

newGameBtn.addEventListener('click', newGame);
flipBtn.addEventListener('click', () => { flipped = !flipped; render(); });
sideEl.addEventListener('change', newGame);

newGame();
