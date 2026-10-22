import { Chess } from './chess.js';
import { pieceSVG } from './pieces.js';
import { OnlineGame } from './online.js';
import { PositionEditor } from './editor.js';

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
const editPanel = document.getElementById('edit-panel');
const editPositionBtn = document.getElementById('edit-position');

// The editor works on its own board array: the app paints it while editing and
// resumes play from the position it hands over.
const editor = new PositionEditor({
  panelEl: editPanel,
  onRender: () => render(),
  onPlay: (fen) => playEditedPosition(fen),
});

let game = new Chess();
let humanColor = 'w';
let flipped = false;
let selected = null;
let legalForSelected = [];
let thinking = false;
let moveLog = [];
let pendingMove = null;
let lastMove = null;
let isOnline = false;
let onlineGame = null;

// Drag state
let dragFromIdx = null;
let dragStartX = 0;
let dragStartY = 0;
let dragDx = 0;
let dragDy = 0;
let dragMoved = false;
let dragGhost = null;

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
  // Note the move just played before painting, so this very render already
  // shows it highlighted (the slide animation still runs at the end).
  if (pendingMove) lastMove = pendingMove;

  boardEl.innerHTML = '';
  boardEl.classList.toggle('editing', editor.active);
  // While editing, the board shows the position being assembled instead of the
  // live game: it has no selection and no last-move tint, those belong to play.
  const board = editor.active ? editor.board : game.board;
  const sel = editor.active ? editor.selected : selected;
  const order = displayOrder();
  for (let pos = 0; pos < order.length; pos++) {
    const idx = order[pos];
    const isDark = ((idx % 8) + Math.floor(idx / 8)) % 2;
    const sq = document.createElement('div');
    sq.className = 'sq ' + (isDark ? 'dark' : 'light');
    sq.dataset.idx = idx;

    if (sel === idx) sq.classList.add('selected');
    if (!editor.active && legalForSelected.some((m) => m.to === idx)) sq.classList.add('legal');
    if (!editor.active && lastMove && (lastMove.from === idx || lastMove.to === idx)) sq.classList.add('lastmove');

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

    const piece = board[idx];
    if (piece) {
      const wrap = document.createElement('div');
      wrap.className = 'piece-wrap';
      wrap.innerHTML = pieceSVG(piece);
      sq.appendChild(wrap);
    }
    sq.addEventListener('pointerdown', (e) => onSquarePointerDown(e, idx));
    boardEl.appendChild(sq);
  }
  updateStatus();

  if (pendingMove) {
    animateMove(pendingMove.from, pendingMove.to);
    pendingMove = null;
  }
}

// Repaint selection and legal-move hints by toggling classes on the existing
// squares. Rebuilding all 64 squares (and re-parsing their piece SVGs) on every
// tap and drag start is what made picking a piece feel sluggish.
function paintSelection() {
  for (const sq of boardEl.children) {
    const idx = Number(sq.dataset.idx);
    sq.classList.toggle('selected', selected === idx);
    sq.classList.toggle('legal', legalForSelected.some((m) => m.to === idx));
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

// Squares involved in each castle: [king from, king to, rook from, rook to]
const CASTLE_SQUARES = {
  K: [60, 62, 63, 61],
  Q: [60, 58, 56, 59],
  k: [4, 6, 7, 5],
  q: [4, 2, 0, 3],
};

// Castling is usually played by moving the king two squares, but it is just as
// natural to play it with the rook: drop the king on its own rook, or drag the
// rook onto one of the two squares the castle involves. Translate that gesture
// into the real castling move, as long as the position allows it.
function findCastleMove(fromIdx, toIdx) {
  if (fromIdx === null || fromIdx === toIdx) return null;
  const dragged = game.board[fromIdx];
  if (!dragged) return null;
  const isKing = dragged.toUpperCase() === 'K';
  if (!isKing && dragged.toUpperCase() !== 'R') return null;

  for (const m of game.legalMoves()) {
    if (!m.castle) continue;
    const [kingFrom, kingTo, rookFrom, rookTo] = CASTLE_SQUARES[m.castle];
    if (fromIdx !== (isKing ? kingFrom : rookFrom)) continue;
    if (isKing) {
      if (toIdx === rookFrom) return m;
    } else if (toIdx === rookTo || toIdx === kingTo) {
      return m;
    }
  }
  return null;
}

// Begin a gesture on a square. `grabIdx` is the square whose piece is being
// dragged, or null when the gesture starts on an empty square.
function startPointerGesture(e, idx, grabIdx) {
  dragFromIdx = grabIdx;
  dragStartX = e.clientX;
  dragStartY = e.clientY;
  dragDx = 0;
  dragDy = 0;
  dragMoved = false;

  const sq = document.querySelector(`.sq[data-idx="${idx}"]`);
  const wrap = grabIdx === null ? null : sq?.querySelector('.piece-wrap');
  if (wrap) {
    const rect = wrap.getBoundingClientRect();
    dragGhost = wrap.cloneNode(true);
    dragGhost.style.position = 'fixed';
    dragGhost.style.left = rect.left + 'px';
    dragGhost.style.top = rect.top + 'px';
    dragGhost.style.transform = 'translate3d(0, 0, 0)';
    dragGhost.style.width = rect.width + 'px';
    dragGhost.style.height = rect.height + 'px';
    dragGhost.style.pointerEvents = 'none';
    dragGhost.style.zIndex = '1000';
    dragGhost.style.transition = 'none';
    dragGhost.classList.add('drag-ghost');
    document.body.appendChild(dragGhost);
    wrap.style.opacity = '0.25';
    document.body.classList.add('dragging');
  }

  document.addEventListener('pointermove', onPointerMove, { passive: true });
  document.addEventListener('pointerup', onPointerUp);
}

function onSquarePointerDown(e, idx) {
  // While editing both colours can be lifted from any square; a tap on a square
  // holding no piece still reaches the editor so the palette brush can paint it.
  if (editor.active) {
    if (editor.board[idx]) e.preventDefault();
    startPointerGesture(e, idx, editor.board[idx] ? idx : null);
    return;
  }

  if (thinking || gameFinished() || game.turn !== humanColor) return;
  const piece = game.board[idx];
  const isOwn = !!piece && (piece === piece.toUpperCase() ? 'w' : 'b') === humanColor;
  if (isOwn) {
    e.preventDefault();
    selected = idx;
    legalForSelected = game.legalMoves().filter((m) => m.from === idx);
    paintSelection();
  }
  startPointerGesture(e, idx, isOwn ? idx : null);
}

function onPointerMove(e) {
  if (dragFromIdx === null) return;
  const dx = e.clientX - dragStartX;
  const dy = e.clientY - dragStartY;
  if (Math.abs(dx) > 5 || Math.abs(dy) > 5) dragMoved = true;

  // Follow the pointer with a transform, written only when the pointer really
  // moved: no layout work per event and no needless compositor updates, so the
  // dragged piece stays glued to the pointer.
  if (dragMoved && dragGhost && (dx !== dragDx || dy !== dragDy)) {
    dragDx = dx;
    dragDy = dy;
    dragGhost.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
  }
}

function onPointerUp(e) {
  document.removeEventListener('pointermove', onPointerMove);
  document.removeEventListener('pointerup', onPointerUp);
  document.body.classList.remove('dragging');

  if (dragGhost) { dragGhost.remove(); dragGhost = null; }
  const srcWrap = dragFromIdx !== null
    ? document.querySelector(`.sq[data-idx="${dragFromIdx}"] .piece-wrap`)
    : null;
  if (srcWrap) srcWrap.style.opacity = '';

  const target = document.elementFromPoint(e.clientX, e.clientY);

  if (!dragMoved) {
    // A tap (not a drag): select a piece or complete a move on the square
    // under the pointer. Handled here instead of on 'click' so tapping works
    // on touch devices and after the board re-renders mid-gesture.
    const tapSq = target?.closest?.('.sq');
    const tapIdx = tapSq ? parseInt(tapSq.dataset.idx, 10) : dragFromIdx;
    dragFromIdx = null;
    if (tapIdx !== null && !Number.isNaN(tapIdx)) {
      if (editor.active) editor.tapSquare(tapIdx);
      else onSquareClick(tapIdx);
    }
    return;
  }

  const targetSq = target?.closest?.('.sq');
  if (editor.active) {
    // Let go on a square: the piece lands there. Let go off the board: the
    // piece comes off, which is how a stray piece is removed.
    editor.dropPiece(dragFromIdx, targetSq ? parseInt(targetSq.dataset.idx, 10) : null);
    dragFromIdx = null;
    return;
  }
  if (targetSq) {
    const targetIdx = parseInt(targetSq.dataset.idx, 10);
    // A castle read from the gesture wins over the rook's plain move to the
    // same square, so dragging the rook two squares castles instead of moving.
    const move = findCastleMove(dragFromIdx, targetIdx) || legalForSelected.find((m) => m.to === targetIdx);
    if (move) {
      if (move.promo) {
        showPromotionDialog(dragFromIdx, targetIdx, move);
        dragFromIdx = null;
        return;
      }
      const uci = game.moveToUci(move);
      game._make(move);
      recordMove(uci);
      selected = null;
      legalForSelected = [];
      pendingMove = { from: move.from, to: move.to };
      render();
      if (isOnline) onlineGame.sendMove(uci, game.fen());
      else if (!gameFinished()) engineMove();
      dragFromIdx = null;
      return;
    }
  }

  selected = null;
  legalForSelected = [];
  dragFromIdx = null;
  paintSelection();
}

// --- Click to move ---

function onSquareClick(idx) {
  if (thinking) return;
  if (gameFinished()) return;
  if (game.turn !== humanColor) return;

  const piece = game.board[idx];

  if (selected !== null) {
    const move = findCastleMove(selected, idx) || legalForSelected.find((m) => m.to === idx);
    if (move) {
      if (move.promo) {
        showPromotionDialog(selected, idx, move);
        return;
      }
      const uci = game.moveToUci(move);
      game._make(move);
      recordMove(uci);
      selected = null;
      legalForSelected = [];
      pendingMove = { from: move.from, to: move.to };
      render();
      if (isOnline) onlineGame.sendMove(uci, game.fen());
      else if (!gameFinished()) engineMove();
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
  paintSelection();
}

function updateStatus() {
  if (editor.active) {
    statusEl.textContent = 'Editing position';
    statusEl.className = 'status';
    return;
  }
  const status = game.gameStatus();
  let text;
  if (status === 'checkmate-white') text = 'Checkmate — White wins!';
  else if (status === 'checkmate-black') text = 'Checkmate — Black wins!';
  else if (status === 'stalemate') text = 'Stalemate — Draw';
  else {
    const who = game.turn === 'w' ? 'White' : 'Black';
    const check = game.inCheck(game.turn) ? ' — Check!' : '';
    text = `${who} to move${check}`;
  }
  if (thinking) text = 'Engine thinking\u2026';
  statusEl.textContent = text;
  statusEl.className = 'status' + (status.startsWith('checkmate') ? ' done' : '');
}

// Entries are either a move ({ uci, mover }) or a position edited by hand
// ({ edit, fen }), so an edited game keeps the moves it has already played and
// only marks the point where the board was changed.

// Record a move together with the side that played it, which the move list
// needs to keep numbering straight across an edit.
function recordMove(uci) {
  const last = game.history[game.history.length - 1];
  const mover = last && last.piece === last.piece.toUpperCase() ? 'w' : 'b';
  moveLog.push({ uci, mover });
  updateMoveLog();
}

// The numbers carry on across an edit: White's move gets its number, Black's
// move is numbered too when an edit left it without a White move in front of
// it, so the list never restarts at 1 or drops a number.
function updateMoveLog() {
  let moveNo = 1;
  let whiteToFollow = false;
  moveLogEl.innerHTML = moveLog.map((entry) => {
    if (entry.edit) return '<span class="ply edited" title="Position edited by hand">&#9998;</span>';
    if (entry.mover === 'b') {
      const prefix = whiteToFollow ? '' : `${moveNo}... `;
      whiteToFollow = false;
      moveNo++;
      return `<span class="ply">${prefix}${entry.uci}</span>`;
    }
    if (whiteToFollow) moveNo++;
    whiteToFollow = true;
    return `<span class="ply">${moveNo}. ${entry.uci}</span>`;
  }).join(' ');
  moveLogEl.scrollTop = moveLogEl.scrollHeight;
}

// Position key for repetition detection (piece placement + turn + castling + ep)
function posKey(fen) {
  return fen.split(' ').slice(0, 4).join(' ');
}

// Every position that has already been played in this game, including the
// starting position. Replaying the log once is much cheaper than re-walking
// it for every candidate move.
function seenPositions() {
  const seen = new Set();
  let temp = new Chess();
  seen.add(posKey(temp.fen()));
  for (const entry of moveLog) {
    if (entry.edit) {
      // An edit replaced the line played so far, so only the positions reached
      // since then are still on this game's path.
      temp = new Chess(entry.fen);
      seen.clear();
      seen.add(posKey(temp.fen()));
      continue;
    }
    const m = temp.parseUci(entry.uci);
    if (!m) break;
    temp._make(m);
    seen.add(posKey(temp.fen()));
  }
  return seen;
}

// Would this move bring back a position that has already been played?
// This is the only way a game is drawn by repetition, so the engine stays
// away from such moves as long as it has anything else to play.
function repeatsPosition(move, seen) {
  const temp = new Chess(game.fen());
  temp._make(move);
  return seen.has(posKey(temp.fen()));
}

async function callEngine(fen, depth, searchmoves) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const resp = await fetch('/api/bestmove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fen, depth, searchmoves }),
      signal: ctrl.signal,
    });
    return await resp.json();
  } finally {
    clearTimeout(timer);
  }
}

// Ask the engine for a move, retrying briefly so a transient hiccup
// (engine restarting, busy or timed out) cannot leave the game stuck.
async function askEngine(fen, depth, searchmoves) {
  let lastErr = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const data = await callEngine(fen, depth, searchmoves);
      if (data && data.bestmove) return data;
      lastErr = new Error((data && data.error) || 'no move returned');
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw lastErr || new Error('engine unavailable');
}

// The game is only over once it is really decided (mate or stalemate).
// A draw by the fifty-move rule does not stop play, so the engine keeps
// playing a long endgame instead of stopping mid-game.
function gameFinished() {
  const status = game.gameStatus();
  return status !== 'ongoing' && status !== 'fifty-move';
}

async function engineMove() {
  if (gameFinished()) return;
  thinking = true;
  updateStatus();
  try {
    const depth = parseInt(depthEl.value, 10) || 8;
    let data = await askEngine(game.fen(), depth);

    let bestUci = data.bestmove;
    let m = game.parseUci(bestUci);
    if (!m) throw new Error('engine returned an unplayable move: ' + bestUci);

    // Never let the engine shuffle the game into a repetition draw: if its
    // move brings back a position already played, ask it again for the best
    // move that keeps the game moving forward instead.
    const seen = seenPositions();
    if (repeatsPosition(m, seen)) {
      const alternatives = game.legalMoves()
        .filter((mv) => !repeatsPosition(mv, seen))
        .map((mv) => game.moveToUci(mv));

      if (alternatives.length > 0) {
        try {
          const alt = await askEngine(game.fen(), depth, alternatives);
          const altMove = game.parseUci(alt.bestmove);
          if (altMove && !repeatsPosition(altMove, seen)) {
            bestUci = alt.bestmove;
            m = altMove;
          }
        } catch (e) {
          // Engine unreachable — play its first choice rather than stall
        }
      }
    }

    if (m) {
      game._make(m);
      recordMove(bestUci);
      pendingMove = { from: m.from, to: m.to };
    }
  } catch (e) {
    statusEl.textContent = 'Engine error: ' + (e.message || e);
  } finally {
    // Always release the board, even if the engine call failed or timed out
    thinking = false;
    render();
  }
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
      recordMove(uci);
      selected = null;
      legalForSelected = [];
      overlay.remove();
      pendingMove = { from: m.from, to: m.to };
      render();
      if (isOnline) onlineGame.sendMove(uci, game.fen());
      else if (!gameFinished()) engineMove();
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
    paintSelection();
  });
  overlay.appendChild(cancel);
  document.body.appendChild(overlay);
}

function undoMove() {
  if (thinking || game.history.length === 0) return;
  // Undo two half-moves (engine reply + your move) so it's your turn again.
  // If only one half-move exists (e.g. playing black), undo just that one.
  // A hand-edited position is a wall: the moves played before it are no longer
  // part of this game's history, so undo stops at the edit instead of wiping
  // the game's record.
  const undoCount = Math.min(2, game.history.length);
  for (let i = 0; i < undoCount; i++) game._unmake();
  for (let i = 0; i < undoCount; i++) moveLog.pop();
  selected = null;
  legalForSelected = [];
  pendingMove = null;
  lastMove = null;
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
    recordMove(uci);
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
  // A live game against a person cannot be edited: the edited board would no
  // longer match the opponent's.
  if (editor.active) editor.exit();
  editPositionBtn.disabled = true;
  isOnline = true;
  game = new Chess();
  selected = null;
  legalForSelected = [];
  thinking = false;
  moveLog = [];
  pendingMove = null;
  lastMove = null;
  humanColor = onlineGame.color;
  flipped = humanColor === 'b';

  // Reopening a game's link mid-game: catch up with the moves played so far.
  for (const uci of data.history || []) {
    const m = game.parseUci(uci);
    if (!m) break;
    game._make(m);
    recordMove(uci);
  }

  const topName = document.querySelector('.player-bar .player-name');
  const topElo = document.querySelector('.player-bar .player-elo');
  if (topName) topName.textContent = data.engine ? 'Stockfish' : 'Opponent';
  if (topElo) topElo.textContent = data.engine ? '(19)' : '';

  onlineModal.style.display = 'none';

  if (engineIcon) engineIcon.innerHTML = pieceSVG(humanColor === 'w' ? 'p' : 'P');
  if (humanIcon) humanIcon.innerHTML = pieceSVG(humanColor === 'w' ? 'P' : 'p');

  document.getElementById('engine-timer').textContent = formatTime(data.timeControl || data.timers.w);
  document.getElementById('human-timer').textContent = formatTime(data.timeControl || data.timers.w);

  updateMoveLog();
  render();
}

// Challenge links are built from the address the app is served on. A preview
// address is temporary: it only answers while that preview is running and it
// changes when the environment is recreated, so a link copied from it stops
// working for the opponent. Only a permanently hosted address shares safely.
function isTemporaryHost() {
  return /(^|\.)base44-preview\.app$/i.test(location.hostname)
    || location.hostname === 'localhost'
    || location.hostname === '127.0.0.1';
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
      <button id="play-engine-btn" type="button">Play vs Stockfish</button>
    </div>
  `;
  onlineModal.style.display = 'flex';
  document.getElementById('create-challenge-btn').addEventListener('click', () => createChallenge(false));
  document.getElementById('play-engine-btn').addEventListener('click', () => createChallenge(true));
}

// A challenge waits for a second player to open the link. A game against the
// engine starts at once, with Stockfish on the other side and the game's link
// left in the address bar so it can be reopened later.
async function createChallenge(vsEngine) {
  const tc = parseInt(document.getElementById('time-control').value, 10);
  onlineModalContent.innerHTML = vsEngine
    ? '<p>Starting game against Stockfish...</p>'
    : '<p>Creating challenge...</p>';

  onlineGame = new OnlineGame(makeOnlineCallbacks());

  try {
    const data = await onlineGame.createRoom(tc, vsEngine);
    const link = window.location.origin + window.location.pathname + '?room=' + data.roomId;
    if (data.engine) {
      window.history.replaceState({}, '', window.location.pathname + '?room=' + data.roomId);
      startOnlineGame({
        color: data.color,
        timeControl: data.timeControl,
        timers: data.timers,
        engine: true,
      });
      onlineModal.style.display = 'none';
      return;
    }
    onlineModalContent.innerHTML = `
      <p>Share this link with your opponent:</p>
      <div class="challenge-link-row">
        <input type="text" id="challenge-link" readonly value="${link}">
        <button id="copy-link-btn" type="button">Copy</button>
      </div>
      ${isTemporaryHost() ? '<p class="preview-note">This is a temporary preview address: the link stops working when the preview stops, restarts or moves, so your opponent cannot rely on it. Host the app at a permanent address to invite people with links that keep working.</p>' : ''}
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

// Resume play from the position the editor handed over. The game carries on as
// the same game — its moves stay in the list, the edit is marked there and the
// move counter keeps running — while the engine is put back into the same fresh
// state a new game starts from, so an edit can never leave it searching from the
// line that was edited away and its strength is unchanged.
function playEditedPosition(fen) {
  // Carry the game's move number over to the edited position.
  const parts = fen.split(' ');
  parts[5] = String(Math.floor(moveLog.filter((e) => !e.edit).length / 2) + 1);
  const continued = parts.join(' ');

  game = new Chess(continued);
  moveLog.push({ edit: true, fen: continued });
  selected = null;
  legalForSelected = [];
  thinking = false;
  pendingMove = null;
  lastMove = null;
  updateMoveLog();
  // Same engine reset a new game performs, so an edit changes neither the
  // engine's settings nor the state it searches from.
  fetch('/api/newgame', { method: 'POST' }).catch(() => {});
  render();
  // An edit can leave the engine on move; in that case it moves right away.
  if (game.turn !== humanColor) engineMove();
}

function newGame() {
  if (editor.active) editor.exit();
  editPositionBtn.disabled = false;
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
  lastMove = null;
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
editPositionBtn.addEventListener('click', () => {
  if (thinking || editor.active) return;
  editor.begin(game.fen());
});
flipBtn.addEventListener('click', () => { flipped = !flipped; render(); });
sideEl.addEventListener('change', newGame);
playOnlineBtn.addEventListener('click', showCreateChallenge);
onlineModalClose.addEventListener('click', closeOnlineModal);

// Auto-join if ?room= is in the URL — always render the board first
const roomParam = new URLSearchParams(window.location.search).get('room');
newGame();
if (roomParam) joinChallenge(roomParam);
