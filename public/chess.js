// Self-contained chess rules engine: FEN parsing, legal move generation,
// make/unmake, check/checkmate/stalemate. Board is an array of 64 squares
// indexed 0=a8 .. 63=h1 (FEN reading order). Pieces are FEN letters; empty=null.

const WHITE = 'w';
const BLACK = 'b';

const isWhite = (p) => p && p === p.toUpperCase();
const colorOf = (p) => (p ? (isWhite(p) ? WHITE : BLACK) : null);

const KNIGHT_DELTAS = [[1,2],[2,1],[2,-1],[1,-2],[-1,-2],[-2,-1],[-2,1],[-1,2]];
const KING_DELTAS = [[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1],[0,-1],[1,-1]];
const BISHOP_DIRS = [[1,1],[1,-1],[-1,1],[-1,-1]];
const ROOK_DIRS = [[1,0],[-1,0],[0,1],[0,-1]];

const FILES = 'abcdefgh';
const alg = (idx) => FILES[idx % 8] + (8 - Math.floor(idx / 8));
const sqToIdx = (s) => (8 - parseInt(s[1], 10)) * 8 + FILES.indexOf(s[0]);

function inBounds(f, r) { return f >= 0 && f < 8 && r >= 0 && r < 8; }

export class Chess {
  constructor(fen) {
    this.load(fen || 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  }

  load(fen) {
    const parts = fen.trim().split(/\s+/);
    this.board = new Array(64).fill(null);
    const rows = parts[0].split('/');
    for (let r = 0; r < 8; r++) {
      let f = 0;
      for (const ch of rows[r]) {
        if (/\d/.test(ch)) { f += parseInt(ch, 10); }
        else { this.board[r * 8 + f] = ch; f++; }
      }
    }
    this.turn = parts[1] || 'w';
    this.castling = parts[2] || '-';
    this.ep = parts[3] && parts[3] !== '-' ? sqToIdx(parts[3]) : -1;
    this.halfmove = parseInt(parts[4], 10) || 0;
    this.fullmove = parseInt(parts[5], 10) || 1;
    this.history = [];
  }

  fen() {
    let rows = [];
    for (let r = 0; r < 8; r++) {
      let row = '', empty = 0;
      for (let f = 0; f < 8; f++) {
        const p = this.board[r * 8 + f];
        if (p) { if (empty) { row += empty; empty = 0; } row += p; }
        else { empty++; }
      }
      if (empty) row += empty;
      rows.push(row);
    }
    const ep = this.ep >= 0 ? alg(this.ep) : '-';
    return `${rows.join('/')} ${this.turn} ${this.castling} ${ep} ${this.halfmove} ${this.fullmove}`;
  }

  kingIdx(color) {
    const k = color === WHITE ? 'K' : 'k';
    for (let i = 0; i < 64; i++) if (this.board[i] === k) return i;
    return -1;
  }

  isAttacked(idx, byColor) {
    const f = idx % 8, r = Math.floor(idx / 8);
    const pawnDir = byColor === WHITE ? -1 : 1;
    for (const df of [-1, 1]) {
      const pf = f + df, pr = r + pawnDir;
      if (inBounds(pf, pr)) {
        const p = this.board[pr * 8 + pf];
        if (p && colorOf(p) === byColor && p.toUpperCase() === 'P') return true;
      }
    }
    for (const [df, dr] of KNIGHT_DELTAS) {
      const nf = f + df, nr = r + dr;
      if (inBounds(nf, nr)) {
        const p = this.board[nr * 8 + nf];
        if (p && colorOf(p) === byColor && p.toUpperCase() === 'N') return true;
      }
    }
    for (const [df, dr] of KING_DELTAS) {
      const kf = f + df, kr = r + dr;
      if (inBounds(kf, kr)) {
        const p = this.board[kr * 8 + kf];
        if (p && colorOf(p) === byColor && p.toUpperCase() === 'K') return true;
      }
    }
    for (const [df, dr] of BISHOP_DIRS) {
      let nf = f + df, nr = r + dr;
      while (inBounds(nf, nr)) {
        const p = this.board[nr * 8 + nf];
        if (p) { if (colorOf(p) === byColor && (p.toUpperCase() === 'B' || p.toUpperCase() === 'Q')) return true; break; }
        nf += df; nr += dr;
      }
    }
    for (const [df, dr] of ROOK_DIRS) {
      let nf = f + df, nr = r + dr;
      while (inBounds(nf, nr)) {
        const p = this.board[nr * 8 + nf];
        if (p) { if (colorOf(p) === byColor && (p.toUpperCase() === 'R' || p.toUpperCase() === 'Q')) return true; break; }
        nf += df; nr += dr;
      }
    }
    return false;
  }

  inCheck(color) {
    const ki = this.kingIdx(color);
    if (ki < 0) return false;
    return this.isAttacked(ki, color === WHITE ? BLACK : WHITE);
  }

  legalMoves() {
    const moves = [];
    const color = this.turn;
    for (let idx = 0; idx < 64; idx++) {
      const p = this.board[idx];
      if (!p || colorOf(p) !== color) continue;
      const f = idx % 8, r = Math.floor(idx / 8);
      const type = p.toUpperCase();

      if (type === 'P') {
        const dir = color === WHITE ? -1 : 1;
        const startRank = color === WHITE ? 6 : 1;
        const promoRank = color === WHITE ? 0 : 7;
        const nr = r + dir;
        if (inBounds(f, nr) && !this.board[nr * 8 + f]) {
          if (nr === promoRank) {
            for (const promo of ['Q','R','B','N']) moves.push({ from: idx, to: nr*8+f, promo });
          } else {
            moves.push({ from: idx, to: nr*8+f });
          }
          if (r === startRank) {
            const nr2 = r + 2*dir;
            if (!this.board[nr2*8+f]) moves.push({ from: idx, to: nr2*8+f });
          }
        }
        for (const df of [-1, 1]) {
          const cf = f + df, cr = r + dir;
          if (!inBounds(cf, cr)) continue;
          const target = this.board[cr*8+cf];
          if (target && colorOf(target) !== color) {
            if (cr === promoRank) {
              for (const promo of ['Q','R','B','N']) moves.push({ from: idx, to: cr*8+cf, promo });
            } else {
              moves.push({ from: idx, to: cr*8+cf });
            }
          }
          if (this.ep >= 0 && cr*8+cf === this.ep) {
            moves.push({ from: idx, to: this.ep, ep: true });
          }
        }
      } else if (type === 'N') {
        for (const [df, dr] of KNIGHT_DELTAS) {
          const nf = f+df, nr = r+dr;
          if (!inBounds(nf, nr)) continue;
          const target = this.board[nr*8+nf];
          if (!target || colorOf(target) !== color) moves.push({ from: idx, to: nr*8+nf });
        }
      } else if (type === 'K') {
        for (const [df, dr] of KING_DELTAS) {
          const nf = f+df, nr = r+dr;
          if (!inBounds(nf, nr)) continue;
          const target = this.board[nr*8+nf];
          if (!target || colorOf(target) !== color) moves.push({ from: idx, to: nr*8+nf });
        }
        const opp = color === WHITE ? BLACK : WHITE;
        if (color === WHITE && idx === 60) {
          if (this.castling.includes('K') && !this.board[61] && !this.board[62] &&
              this.board[63] === 'R' && !this.isAttacked(60, opp) && !this.isAttacked(61, opp) && !this.isAttacked(62, opp)) {
            moves.push({ from: idx, to: 62, castle: 'K' });
          }
          if (this.castling.includes('Q') && !this.board[59] && !this.board[58] && !this.board[57] &&
              this.board[56] === 'R' && !this.isAttacked(60, opp) && !this.isAttacked(59, opp) && !this.isAttacked(58, opp)) {
            moves.push({ from: idx, to: 58, castle: 'Q' });
          }
        }
        if (color === BLACK && idx === 4) {
          if (this.castling.includes('k') && !this.board[5] && !this.board[6] &&
              this.board[7] === 'r' && !this.isAttacked(4, opp) && !this.isAttacked(5, opp) && !this.isAttacked(6, opp)) {
            moves.push({ from: idx, to: 6, castle: 'k' });
          }
          if (this.castling.includes('q') && !this.board[3] && !this.board[2] && !this.board[1] &&
              this.board[0] === 'r' && !this.isAttacked(4, opp) && !this.isAttacked(3, opp) && !this.isAttacked(2, opp)) {
            moves.push({ from: idx, to: 2, castle: 'q' });
          }
        }
      } else {
        const dirs = type === 'B' ? BISHOP_DIRS : type === 'R' ? ROOK_DIRS : [...BISHOP_DIRS, ...ROOK_DIRS];
        for (const [df, dr] of dirs) {
          let nf = f+df, nr = r+dr;
          while (inBounds(nf, nr)) {
            const target = this.board[nr*8+nf];
            if (!target) { moves.push({ from: idx, to: nr*8+nf }); }
            else { if (colorOf(target) !== color) moves.push({ from: idx, to: nr*8+nf }); break; }
            nf += df; nr += dr;
          }
        }
      }
    }

    return moves.filter((m) => {
      this._make(m);
      const ok = !this.inCheck(color);
      this._unmake();
      return ok;
    });
  }

  _make(m) {
    const piece = this.board[m.from];
    this.history.push({
      from: m.from, to: m.to, piece, captured: this.board[m.to],
      castling: this.castling, ep: this.ep, halfmove: this.halfmove,
      fullmove: this.fullmove, epCapture: null, castle: m.castle || null, promo: m.promo || null,
    });
    this.board[m.to] = piece;
    this.board[m.from] = null;

    if (m.ep) {
      const capIdx = m.to + (m.from - m.to > 0 ? 8 : -8);
      this.history[this.history.length-1].epCapture = { idx: capIdx, piece: this.board[capIdx] };
      this.board[capIdx] = null;
    }
    if (m.promo) {
      this.board[m.to] = this.turn === WHITE ? m.promo : m.promo.toLowerCase();
    }
    if (m.castle) {
      if (m.castle === 'K') { this.board[61] = this.board[63]; this.board[63] = null; }
      else if (m.castle === 'Q') { this.board[59] = this.board[56]; this.board[56] = null; }
      else if (m.castle === 'k') { this.board[5] = this.board[7]; this.board[7] = null; }
      else if (m.castle === 'q') { this.board[3] = this.board[0]; this.board[0] = null; }
    }

    let c = this.castling;
    if (piece === 'K') c = c.replace('K','').replace('Q','');
    if (piece === 'k') c = c.replace('k','').replace('q','');
    if (m.from === 63 || m.to === 63) c = c.replace('K','');
    if (m.from === 56 || m.to === 56) c = c.replace('Q','');
    if (m.from === 7 || m.to === 7) c = c.replace('k','');
    if (m.from === 0 || m.to === 0) c = c.replace('q','');
    this.castling = c || '-';

    if (piece.toUpperCase() === 'P' && Math.abs(m.to - m.from) === 16) {
      this.ep = (m.from + m.to) / 2;
    } else {
      this.ep = -1;
    }

    if (piece.toUpperCase() === 'P' || this.history[this.history.length-1].captured) {
      this.halfmove = 0;
    } else {
      this.halfmove++;
    }
    if (this.turn === BLACK) this.fullmove++;
    this.turn = this.turn === WHITE ? BLACK : WHITE;
  }

  _unmake() {
    const h = this.history.pop();
    this.board[h.from] = h.piece;
    this.board[h.to] = h.captured;
    if (h.epCapture) { this.board[h.epCapture.idx] = h.epCapture.piece; }
    if (h.castle) {
      if (h.castle === 'K') { this.board[63] = this.board[61]; this.board[61] = null; }
      else if (h.castle === 'Q') { this.board[56] = this.board[59]; this.board[59] = null; }
      else if (h.castle === 'k') { this.board[7] = this.board[5]; this.board[5] = null; }
      else if (h.castle === 'q') { this.board[0] = this.board[3]; this.board[3] = null; }
    }
    this.castling = h.castling;
    this.ep = h.ep;
    this.halfmove = h.halfmove;
    this.fullmove = h.fullmove;
    this.turn = this.turn === WHITE ? BLACK : WHITE;
  }

  makeMove(m) {
    const legal = this.legalMoves().find(
      (lm) => lm.from === m.from && lm.to === m.to &&
        (!lm.promo || lm.promo === m.promo) &&
        (!!lm.ep) === (!!m.ep) && (!!lm.castle) === (!!m.castle)
    );
    if (!legal) return null;
    this._make(legal);
    return legal;
  }

  gameStatus() {
    const legal = this.legalMoves();
    if (legal.length === 0) {
      if (this.inCheck(this.turn)) return this.turn === WHITE ? 'checkmate-black' : 'checkmate-white';
      return 'stalemate';
    }
    if (this.halfmove >= 100) return 'fifty-move';
    return 'ongoing';
  }

  parseUci(uci) {
    const from = sqToIdx(uci.slice(0, 2));
    const to = sqToIdx(uci.slice(2, 4));
    const promo = uci.length > 4 ? uci[4].toUpperCase() : null;
    const legal = this.legalMoves().find(
      (lm) => lm.from === from && lm.to === to && (!promo || lm.promo === promo)
    );
    return legal || null;
  }

  moveToUci(m) {
    let uci = alg(m.from) + alg(m.to);
    if (m.promo) uci += m.promo.toLowerCase();
    return uci;
  }
}
