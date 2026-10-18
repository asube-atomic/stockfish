import { Chess } from './chess.js';
import { pieceSVG } from './pieces.js';
import { OnlineGame } from './online.js';

const FILES = 'abcdefgh';

const boardEl = document.getElementById('board');
const statusEl = document.getElementById('status');
const depthEl = document.getElementById('depth');
const sideEl = document.getElementById('side');
const newGameBtn = document.getElementById('newgame');
const undoBtn = document.getElementById('undo');
const flipBtn = document.getElementById('flip');
const moveLogEl = document.getElementById('movelog');
const engineIcon = document.getElementById('engine-icon');
const humanIcon = document.getElementById('human-icon');
const playOnlineBtn = document.getElementById('play-online');
const onlineModal = document.getElementById('online-modal');
const onlineModalClose = document.getElementById('online-modal-close');
const onlineModalContent = document.getElementById('online-modal-content');

let game = new Chess();
let humanColor = 'w';
let flipped = false;
let selected = null;
let legalForSelected = [];
let thinking = false;
let moveLog = [];
let pendingMove = null;
let isOnline = false;
let onlineGame = null;

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

  // Set initial position at source immediately to prevent the piece
  // from flashing at the destination before the animation starts
  wrap.style.transform = `translate(${dx}px, ${dy}px)`;

  const anim = wrap.animate(
    [
      { transform: `translate(${dx}px, ${dy}px)` },
      { transform: 'translate(0, 0)' },
    ],
    { duration: 300, easing: 'cubic-bezier(0.25,0.46,0.45,0.94)', fill: 'forwards' }
  );

  anim.onfinish = () => {
    wrap.style.transform = '';
    anim.cancel();
  };
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
      const uci = game.moveToUci(move);
      game._make(move);
      moveLog.push(uci);
      updateMoveLog();
      selected = null;
      legalForSelected = [];
      pendingMove = { from: move.from, to: move.to };
      render();
      if (isOnline) onlineGame.sendMove(uci);
      else if (game.gameStatus() === 'ongoing') engineMove();
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
      const uci = game.moveToUci(move);
      game._make(move);
      moveLog.push(uci);
      updateMoveLog();
      selected = null;
      legalForSelected = [];
      pendingMove = { from: move.from, to: move.to };
      render();
      if (isOnline) onlineGame.sendMove(uci);
      else if (game.gameStatus() === 'ongoing') engineMove();
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

// Position key for repetition detection (piece placement + turn + castling + ep)
function posKey(fen) {
  return fen.split(' ').slice(0, 4).join(' ');
}

// Count how many times a position key has occurred in the game
function countPosition(key) {
  const temp = new Chess();
  let count = 0;
  if (posKey(temp.fen()) === key) count++;
  for (const uci of moveLog) {
    const m = temp.parseUci(uci);
    if (!m) break;
    temp._make(m);
    if (posKey(temp.fen()) === key) count++;
  }
  return count;
}

async function callEngine(fen, depth, searchmoves) {
  const resp = await fetch('/api/bestmove', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fen, depth, searchmoves }),
  });
  return resp.json();
}

async function engineMove() {
  if (game.gameStatus() !== 'ongoing') return;
  thinking = true;
  updateStatus();
  try {
    const depth = parseInt(depthEl.value, 10) || 8;
    let data = await callEngine(game.fen(), depth);
    if (!data.bestmove) return;

    let bestUci = data.bestmove;
    let m = game.parseUci(bestUci);
    if (!m) return;

    // Check if the engine's move leads to a threefold repetition
    const tempGame = new Chess(game.fen());
    tempGame._make(m);
    const repCount = countPosition(posKey(tempGame.fen()));

    if (repCount >= 2) {
      // Repetition detected — request alternative excluding this move
      const legalMoves = game.legalMoves()
        .map((mv) => game.moveToUci(mv))
        .filter((u) => u !== bestUci);
      if (legalMoves.length > 0) {
        data = await callEngine(game.fen(), depth, legalMoves);
        if (data.bestmove) {
          bestUci = data.bestmove;
          m = game.parseUci(bestUci);
        }
      }
    }

    if (m) {
      game._make(m);
      moveLog.push(bestUci);
      updateMoveLog();
      pendingMove = { from: m.from, to: m.to };
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
      const uci = game.moveToUci(m);
      game._make(m);
      moveLog.push(uci);
      updateMoveLog();
      selected = null;
      legalForSelected = [];
      overlay.remove();
      pendingMove = { from: m.from, to: m.to };
      render();
      if (isOnline) onlineGame.sendMove(uci);
      else if (game.gameStatus() === 'ongoing') engineMove();
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

function undoMove() {
  if (thinking || game.history.length === 0) return;
  // Undo two half-moves (engine reply + your move) so it's your turn again.
  // If only one half-move exists (e.g. playing black), undo just that one.
  const undoCount = Math.min(2, game.history.length);
  for (let i = 0; i < undoCount; i++) game._unmake();
  moveLog.splice(-undoCount);
  selected = null;
  legalForSelected = [];
  pendingMove = null;
  updateMoveLog();
  render();
}

// --- Online multiplayer ---

function formatTime(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function updateOnlineTimers(event) {
  const { timers, turn, elapsed } = event;
  const oppColor = humanColor === 'w' ? 'b' : 'w';
  const myTime = turn === humanColor ? timers[humanColor] - elapsed : timers[humanColor];
  const oppTime = turn === oppColor ? timers[oppColor] - elapsed : timers[oppColor];
  const humanTimerEl = document.getElementById('human-timer');
  const engineTimerEl = document.getElementById('engine-timer');
  humanTimerEl.textContent = formatTime(myTime);
  engineTimerEl.textContent = formatTime(oppTime);
  humanTimerEl.classList.toggle('low', myTime < 30000);
  engineTimerEl.classList.toggle('low', oppTime < 30000);
}

function applyOpponentMove(uci) {
  const m = game.parseUci(uci);
  if (m) {
    game._make(m);
    moveLog.push(uci);
    updateMoveLog();
    pendingMove = { from: m.from, to: m.to };
    render();
  }
}

function makeOnlineCallbacks() {
  return {
    onStart: (data) => startOnlineGame(data),
    onMove: (event) => {
      // event.turn is the turn AFTER the move; if it's my turn, opponent moved
      if (event.turn === humanColor) applyOpponentMove(event.uci);
    },
    onTimer: (event) => updateOnlineTimers(event),
    onTimeout: (event) => {
      const iWon = event.loser !== humanColor;
      statusEl.textContent = iWon ? 'Opponent ran out of time — You win!' : 'You ran out of time — Opponent wins!';
      statusEl.className = 'status done';
    },
    onOpponentLeft: () => {
      statusEl.textContent = 'Opponent left the game';
      statusEl.className = 'status done';
    },
    onDisconnect: () => {
      statusEl.textContent = 'Connection lost';
      statusEl.className = 'status done';
    },
  };
}

function startOnlineGame(data) {
  isOnline = true;
  game = new Chess();
  selected = null;
  legalForSelected = [];
  thinking = false;
  moveLog = [];
  pendingMove = null;
  humanColor = onlineGame.color;
  flipped = humanColor === 'b';

  const topName = document.querySelector('.player-bar .player-name');
  const topElo = document.querySelector('.player-bar .player-elo');
  if (topName) topName.textContent = 'Opponent';
  if (topElo) topElo.textContent = '';

  onlineModal.style.display = 'none';

  if (engineIcon) engineIcon.innerHTML = pieceSVG(humanColor === 'w' ? 'p' : 'P');
  if (humanIcon) humanIcon.innerHTML = pieceSVG(humanColor === 'w' ? 'P' : 'p');

  document.getElementById('engine-timer').textContent = formatTime(data.timeControl || data.timers.w);
  document.getElementById('human-timer').textContent = formatTime(data.timeControl || data.timers.w);

  updateMoveLog();
  render();
}

function showCreateChallenge() {
  onlineModalContent.innerHTML = `
    <div class="online-form">
      <label class="field">Time control
        <select id="time-control">
          <option value="60000">1 min</option>
          <option value="180000">3 min</option>
          <option value="300000" selected>5 min</option>
          <option value="600000">10 min</option>
          <option value="900000">15 min</option>
          <option value="1800000">30 min</option>
        </select>
      </label>
      <button id="create-challenge-btn" type="button">Create Challenge</button>
    </div>
  `;
  onlineModal.style.display = 'flex';
  document.getElementById('create-challenge-btn').addEventListener('click', createChallenge);
}

async function createChallenge() {
  const tc = parseInt(document.getElementById('time-control').value, 10);
  onlineModalContent.innerHTML = '<p>Creating challenge...</p>';

  onlineGame = new OnlineGame(makeOnlineCallbacks());

  try {
    const data = await onlineGame.createRoom(tc);
    const link = window.location.origin + window.location.pathname + '?room=' + data.roomId;
    onlineModalContent.innerHTML = `
      <p>Share this link with your opponent:</p>
      <div class="challenge-link-row">
        <input type="text" id="challenge-link" readonly value="${link}">
        <button id="copy-link-btn" type="button">Copy</button>
      </div>
      <p class="waiting">Waiting for opponent to join...</p>
    `;
    document.getElementById('copy-link-btn').addEventListener('click', () => {
      const input = document.getElementById('challenge-link');
      input.select();
      navigator.clipboard.writeText(input.value).then(() => {
        document.getElementById('copy-link-btn').textContent = 'Copied!';
      });
    });
  } catch (e) {
    onlineModalContent.innerHTML = `<p class="error">Error: ${e.message}</p>`;
  }
}

async function joinChallenge(roomId) {
  onlineGame = new OnlineGame(makeOnlineCallbacks());
  onlineModalContent.innerHTML = '<p>Joining game...</p>';
  onlineModal.style.display = 'flex';

  try {
    await onlineGame.joinRoom(roomId);
  } catch (e) {
    onlineModalContent.innerHTML = `<p class="error">Error: ${e.message}</p>`;
  }
}

function closeOnlineModal() {
  onlineModal.style.display = 'none';
  if (onlineGame && !isOnline) {
    onlineGame.leave();
    onlineGame = null;
  }
}

function newGame() {
  if (isOnline && onlineGame) {
    onlineGame.leave();
    onlineGame = null;
  }
  isOnline = false;
  const topName = document.querySelector('.player-bar .player-name');
  const topElo = document.querySelector('.player-bar .player-elo');
  if (topName) topName.textContent = 'Stockfish';
  if (topElo) topElo.textContent = '(19)';
  document.getElementById('engine-timer').innerHTML = '&#8734;';
  document.getElementById('human-timer').innerHTML = '&#8734;';
  if (window.location.search) {
    window.history.replaceState({}, '', window.location.pathname);
  }

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
undoBtn.addEventListener('click', undoMove);
flipBtn.addEventListener('click', () => { flipped = !flipped; render(); });
sideEl.addEventListener('change', newGame);
playOnlineBtn.addEventListener('click', showCreateChallenge);
onlineModalClose.addEventListener('click', closeOnlineModal);

// Auto-join if ?room= is in the URL
const urlParams = new URLSearchParams(window.location.search);
const roomParam = urlParams.get('room');
if (roomParam) {
  joinChallenge(roomParam);
} else {
  newGame();
}
