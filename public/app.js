import { Chess } from './chess.js';
import { pieceSVG } from './pieces.js';

const boardEl = document.getElementById('board');
const statusEl = document.getElementById('status');
const depthEl = document.getElementById('depth');
const sideEl = document.getElementById('side');
const newGameBtn = document.getElementById('newgame');
const flipBtn = document.getElementById('flip');
const moveLogEl = document.getElementById('movelog');

let game = new Chess();
let humanColor = 'w';
let flipped = false;
let selected = null;
let legalForSelected = [];
let thinking = false;
let moveLog = [];
let pendingMove = null; // {from, to} — animate after next render

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
  for (const idx of order) {
    const sq = document.createElement('div');
    sq.className = 'sq ' + (((idx % 8) + Math.floor(idx / 8)) % 2 ? 'dark' : 'light');
    sq.dataset.idx = idx;

    if (selected === idx) sq.classList.add('selected');
    if (legalForSelected.some((m) => m.to === idx)) sq.classList.add('legal');

    const piece = game.board[idx];
    if (piece) {
      const wrap = document.createElement('div');
      wrap.className = 'piece-wrap';
      wrap.innerHTML = pieceSVG(piece);
      sq.appendChild(wrap);
    }
    sq.addEventListener('click', () => onSquareClick(idx));
    boardEl.appendChild(sq);
  }
  updateStatus();

  // Animate the pending move (slide piece from source to destination)
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

function onSquareClick(idx) {
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
  humanColor = sideEl.value;
  flipped = humanColor === 'b';
  updateMoveLog();
  render();
  if (humanColor === 'b') engineMove();
}

newGameBtn.addEventListener('click', newGame);
flipBtn.addEventListener('click', () => { flipped = !flipped; render(); });
sideEl.addEventListener('change', newGame);

newGame();
