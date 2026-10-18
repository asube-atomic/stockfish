import { Chess } from './chess.js';

const PIECES = {
  K: '\u2654', Q: '\u2655', R: '\u2656', B: '\u2657', N: '\u2658', P: '\u2659',
  k: '\u265A', q: '\u265B', r: '\u265C', b: '\u265D', n: '\u265E', p: '\u265F',
};

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
      const span = document.createElement('span');
      span.className = 'piece ' + (piece === piece.toUpperCase() ? 'w' : 'b');
      span.textContent = PIECES[piece];
      sq.appendChild(span);
    }
    sq.addEventListener('click', () => onSquareClick(idx));
    boardEl.appendChild(sq);
  }
  updateStatus();
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

  // If a square is selected and this is a legal target, make the move
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
      render();
      if (game.gameStatus() === 'ongoing') engineMove();
      return;
    }
  }

  // Select a piece of the human's color
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
  const choices = humanColor === 'w' ? ['Q','R','B','N'] : ['Q','R','B','N'];
  for (const promo of choices) {
    const btn = document.createElement('button');
    btn.className = 'promo-btn';
    btn.textContent = PIECES[humanColor === 'w' ? promo : promo.toLowerCase()];
    btn.addEventListener('click', () => {
      const m = { ...baseMove, promo };
      game._make(m);
      moveLog.push(game.moveToUci(m));
      updateMoveLog();
      selected = null;
      legalForSelected = [];
      overlay.remove();
      render();
      if (game.gameStatus() === 'ongoing') engineMove();
    });
    overlay.appendChild(btn);
  }
  const cancel = document.createElement('button');
  cancel.className = 'promo-cancel';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', () => { overlay.remove(); selected = null; legalForSelected = []; render(); });
  overlay.appendChild(cancel);
  document.body.appendChild(overlay);
}

function newGame() {
  game = new Chess();
  selected = null;
  legalForSelected = [];
  thinking = false;
  moveLog = [];
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
