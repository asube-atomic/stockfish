// Free-position editor: rearrange the board by hand — lift a piece, drop it
// somewhere else, put one in from the palette, take one off — so a move already
// played can be corrected and the game resumed from the fixed position.
//
// Editing is deliberately rule-free: any piece may stand on any square. The
// assembled position is only handed over once it passes a basic check, because
// the engine refuses an impossible one.
import { Chess } from './chess.js';
import { pieceSVG } from './pieces.js';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const PALETTE = ['K', 'Q', 'R', 'B', 'N', 'P', 'k', 'q', 'r', 'b', 'n', 'p'];
const ERASE = 'erase';
const NAMES = { K: 'king', Q: 'queen', R: 'rook', B: 'bishop', N: 'knight', P: 'pawn' };
const HINT = 'Drag a piece to move it, drop it off the board to take it off, or pick a piece below and tap a square to place it.';

function boardFromFen(fen) {
  const board = new Array(64).fill(null);
  const rows = fen.trim().split(/\s+/)[0].split('/');
  for (let r = 0; r < 8; r++) {
    let f = 0;
    for (const ch of rows[r] || '') {
      if (/\d/.test(ch)) f += parseInt(ch, 10);
      else board[r * 8 + f++] = ch;
    }
  }
  return board;
}

function fenFromBoard(board, turn) {
  const rows = [];
  for (let r = 0; r < 8; r++) {
    let row = '', gap = 0;
    for (let f = 0; f < 8; f++) {
      const piece = board[r * 8 + f];
      if (piece) { if (gap) { row += gap; gap = 0; } row += piece; }
      else gap++;
    }
    rows.push(row + (gap || ''));
  }

  // Castling rights survive the edit only while king and rook still stand on
  // their home squares, so an edited position can never castle illegally.
  let castling = '';
  if (board[60] === 'K') {
    if (board[63] === 'R') castling += 'K';
    if (board[56] === 'R') castling += 'Q';
  }
  if (board[4] === 'k') {
    if (board[7] === 'r') castling += 'k';
    if (board[0] === 'r') castling += 'q';
  }
  return `${rows.join('/')} ${turn} ${castling || '-'} - 0 1`;
}

// Why the engine cannot be given this position, or null when it can. The limits
// mirror the ones the engine itself enforces: it exits on a position it refuses,
// which would take the engine down in the middle of a game.
function positionError(fen) {
  const pos = new Chess(fen);
  const kings = pos.board.filter((p) => p && p.toUpperCase() === 'K');
  if (kings.length !== 2 || kings[0] === kings[1]) {
    return 'A position needs exactly one king of each colour.';
  }
  for (let i = 0; i < 64; i++) {
    if ((i < 8 || i > 55) && pos.board[i] && pos.board[i].toUpperCase() === 'P') {
      return 'A pawn cannot stand on the first or last rank.';
    }
  }

  const pieces = pos.board.filter(Boolean);
  if (pieces.length > 32) {
    return `The engine refuses a position with more than 32 pieces (this one has ${pieces.length}).`;
  }

  const count = { P: 0, N: 0, B: 0, R: 0, Q: 0, p: 0, n: 0, b: 0, r: 0, q: 0 };
  for (const piece of pieces) count[piece] += 1;

  for (const side of [
    { name: 'White', pawn: 'P', extras: ['N', 'B', 'R'], queen: 'Q' },
    { name: 'Black', pawn: 'p', extras: ['n', 'b', 'r'], queen: 'q' },
  ]) {
    if (count[side.pawn] > 8) {
      return `${side.name} cannot have more than 8 pawns.`;
    }
    // Each piece beyond the starting set needs a pawn to have promoted.
    const promoted = side.extras.reduce((sum, p) => sum + Math.max(count[p] - 2, 0), 0)
      + Math.max(count[side.queen] - 1, 0);
    if (promoted > 8 - count[side.pawn]) {
      return `${side.name} has too many pieces for the pawns it is missing.`;
    }
  }

  const idle = pos.turn === 'w' ? 'b' : 'w';
  if (pos.inCheck(idle)) {
    return `${idle === 'w' ? 'White' : 'Black'} is in check although it is not their move.`;
  }
  return null;
}

export class PositionEditor {
  constructor({ panelEl, onRender, onPlay }) {
    this.panel = panelEl;
    this.palette = panelEl.querySelector('#edit-palette');
    this.turnSelect = panelEl.querySelector('#edit-turn');
    this.hintEl = panelEl.querySelector('#edit-hint');
    this.onRender = onRender;
    this.onPlay = onPlay;

    this.board = new Array(64).fill(null);
    this.turn = 'w';
    this.selected = null;
    this.brush = null;
    this.active = false;

    this.buildPalette();
    this.turnSelect.addEventListener('change', () => {
      this.turn = this.turnSelect.value;
      this.hint(HINT);
    });
    panelEl.querySelector('#edit-clear').addEventListener('click', () => this.clear());
    panelEl.querySelector('#edit-reset').addEventListener('click', () => this.reset());
    panelEl.querySelector('#edit-play').addEventListener('click', () => this.play());
    panelEl.querySelector('#edit-cancel').addEventListener('click', () => this.exit());
  }

  // Start editing the position the game is currently in.
  begin(fen) {
    this.board = boardFromFen(fen);
    this.turn = fen.trim().split(/\s+/)[1] === 'b' ? 'b' : 'w';
    this.turnSelect.value = this.turn;
    this.selected = null;
    this.setBrush(null);
    this.hint(HINT);
    this.active = true;
    this.panel.hidden = false;
    this.onRender();
  }

  // Leave editing and go back to the untouched game.
  exit() {
    if (!this.active) return;
    this.active = false;
    this.selected = null;
    this.setBrush(null);
    this.panel.hidden = true;
    this.onRender();
  }

  // A piece was lifted on `from` and let go on `to`; `to` is null when it was
  // dropped off the board, which takes the piece off the board.
  dropPiece(from, to) {
    if (from === null || to === from) return;
    const piece = this.board[from];
    if (!piece) return;
    this.board[from] = null;
    if (to !== null) this.board[to] = piece;
    this.selected = null;
    this.onRender();
  }

  // A tap with no drag: the chosen palette piece paints the square, the eraser
  // clears it, and with no brush picked it lifts a piece and sets it down.
  tapSquare(idx) {
    if (this.brush === ERASE) {
      this.board[idx] = null;
    } else if (this.brush) {
      this.board[idx] = this.brush;
    } else if (this.selected === null) {
      if (this.board[idx]) this.selected = idx;
    } else if (this.selected === idx) {
      this.selected = null;
    } else {
      const piece = this.board[this.selected];
      this.board[this.selected] = null;
      this.board[idx] = piece;
      this.selected = null;
    }
    this.onRender();
  }

  // Hand the position over to the game, unless the engine would refuse it.
  play() {
    const fen = fenFromBoard(this.board, this.turn);
    const error = positionError(fen);
    if (error) {
      this.hint(error, true);
      return;
    }
    this.active = false;
    this.selected = null;
    this.setBrush(null);
    this.panel.hidden = true;
    this.onPlay(fen);
  }

  clear() {
    this.board = new Array(64).fill(null);
    this.selected = null;
    this.hint(HINT);
    this.onRender();
  }

  reset() {
    this.board = boardFromFen(START_FEN);
    this.turn = 'w';
    this.turnSelect.value = 'w';
    this.selected = null;
    this.hint(HINT);
    this.onRender();
  }

  hint(text, isError) {
    this.hintEl.textContent = text;
    this.hintEl.classList.toggle('error', !!isError);
  }

  setBrush(piece) {
    this.brush = this.brush === piece ? null : piece;
    this.selected = null;
    for (const btn of this.palette.children) {
      btn.classList.toggle('active', btn.dataset.piece === this.brush);
    }
    this.onRender();
  }

  buildPalette() {
    const add = (piece, label, content, extra) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'palette-btn' + (extra || '');
      btn.dataset.piece = piece;
      btn.title = label;
      btn.innerHTML = content;
      btn.addEventListener('click', () => this.setBrush(piece));
      this.palette.appendChild(btn);
    };

    for (const piece of PALETTE) {
      const colour = piece === piece.toUpperCase() ? 'White' : 'Black';
      add(piece, `${colour} ${NAMES[piece.toUpperCase()]}`, pieceSVG(piece), '');
    }
    add(ERASE, 'Remove a piece', '✕', ' erase');
  }
}
