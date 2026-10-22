// Zero-dependency web UI bridge for the Stockfish UCI engine.
// Serves the static chessboard UI and exposes /api/bestmove which
// runs the engine over UCI and returns its chosen move.
//
// Uses a persistent engine process with multi-threading and a large
// hash table for maximum playing strength.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const STOCKFISH = process.env.STOCKFISH_PATH || '/usr/local/bin/stockfish';
const PUBLIC_DIR = path.join(__dirname, 'public');
const THREADS = parseInt(process.env.STOCKFISH_THREADS, 10) || 4;
const HASH_MB = parseInt(process.env.STOCKFISH_HASH_MB, 10) || 256;
// Time budget per move (ms). Short for snappy replies; the engine still
// searches as deep as it can (up to the requested depth) within it.
const MOVE_TIME_MS = parseInt(process.env.STOCKFISH_MOVE_TIME_MS, 10) || 500;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res) {
  let url = req.url.split('?')[0];
  if (url === '/') url = '/index.html';
  const resolved = path.resolve(PUBLIC_DIR, '.' + url);
  if (!resolved.startsWith(PUBLIC_DIR + path.sep) && resolved !== PUBLIC_DIR) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.readFile(resolved, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(resolved);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 1e5) req.destroy(); });
    req.on('end', () => resolve(body));
    req.on('error', () => resolve(''));
  });
}

// Persistent UCI engine process with multi-threading and large hash.
// Keeps the transposition table warm between moves for stronger play.
class Engine {
  constructor(binaryPath) {
    this.binaryPath = binaryPath;
    this.proc = null;
    this.ready = false;
    this.readyWaiters = [];
    this.pendingResolve = null;
    this.pendingTimeout = null;
    this.start();
  }

  start() {
    this.proc = spawn(this.binaryPath, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.ready = false;

    this.proc.stdout.on('data', (d) => {
      for (const line of d.toString().split('\n')) {
        const text = line.trim();
        if (!text) continue;
        // Stockfish 19 terminates on an invalid position or command and
        // reports it here — surface it instead of failing silently.
        if (text.includes('CRITICAL')) console.error('[stockfish] ' + text);
        this.handleLine(text);
      }
    });
    this.proc.stderr.on('data', (d) => console.error('[stockfish] ' + d.toString().trim()));

    this.proc.on('close', () => {
      if (this.pendingResolve) {
        clearTimeout(this.pendingTimeout);
        this.pendingResolve(null);
        this.pendingResolve = null;
        this.pendingTimeout = null;
      }
      // Auto-restart
      setTimeout(() => this.start(), 500);
    });

    // Configure for maximum strength
    this.send('uci');
    this.send(`setoption name Threads value ${THREADS}`);
    this.send(`setoption name Hash value ${HASH_MB}`);
    this.send('ucinewgame');
    this.send('isready');
  }

  send(cmd) {
    try { this.proc.stdin.write(cmd + '\n'); } catch {}
  }

  handleLine(line) {
    if (line === 'readyok' && !this.ready) {
      this.ready = true;
      for (const cb of this.readyWaiters) cb();
      this.readyWaiters = [];
      return;
    }
    const m = line.match(/bestmove\s+(\S+)/);
    if (m && this.pendingResolve) {
      clearTimeout(this.pendingTimeout);
      const resolve = this.pendingResolve;
      this.pendingResolve = null;
      this.pendingTimeout = null;
      resolve(m[1]);
    }
  }

  async waitForReady() {
    if (this.ready) return;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        // Engine never reported ready — restart it so the UI can recover
        try { this.proc.kill(); } catch {}
        reject(new Error('Engine not ready'));
      }, 10000);
      this.readyWaiters.push(() => { clearTimeout(timer); resolve(); });
    });
  }

  async bestMove(fen, depth, timeoutMs, searchmoves) {
    await this.waitForReady();

    if (this.pendingResolve) {
      throw new Error('Engine busy');
    }

    return new Promise((resolve, reject) => {
      this.pendingResolve = resolve;

      this.pendingTimeout = setTimeout(() => {
        // Ask the engine to stop — it will output bestmove with the
        // best move found so far.
        this.send('stop');
        // Hard reject if no bestmove arrives within 3s of stop
        setTimeout(() => {
          if (this.pendingResolve) {
            this.pendingResolve = null;
            this.pendingTimeout = null;
            reject(new Error('Engine timeout'));
          }
        }, 3000);
      }, timeoutMs);

      this.send(`position fen ${fen}`);
      if (searchmoves && searchmoves.length > 0) {
        this.send(`go depth ${depth} movetime ${MOVE_TIME_MS} searchmoves ${searchmoves.join(' ')}`);
      } else {
        this.send(`go depth ${depth} movetime ${MOVE_TIME_MS}`);
      }
    });
  }

  async newGame() {
    await this.waitForReady();
    this.send('ucinewgame');
    this.send('isready');
    await new Promise((resolve) => {
      const check = () => { this.ready = false; this.readyWaiters.push(resolve); this.send('isready'); };
      // ucinewgame is fast; just send it and wait for next readyok
      this.ready = false;
      this.readyWaiters.push(resolve);
      this.send('isready');
    });
  }
}

const engine = new Engine(STOCKFISH);

// --- Online Multiplayer ---
const rooms = new Map();
const sseClients = new Map(); // roomId -> Set<res>

function genRoomId() {
  return crypto.randomBytes(4).toString('hex');
}

function broadcast(roomId, event) {
  const clients = sseClients.get(roomId);
  if (!clients) return;
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of clients) { try { res.write(data); } catch {} }
}

function addClient(roomId, res) {
  if (!sseClients.has(roomId)) sseClients.set(roomId, new Set());
  sseClients.get(roomId).add(res);
}

function removeClient(roomId, res) {
  const clients = sseClients.get(roomId);
  if (clients) {
    clients.delete(res);
    if (clients.size === 0) sseClients.delete(roomId);
  }
}

// Timer tick — broadcast remaining time every second for active games
setInterval(() => {
  const now = Date.now();
  for (const [roomId, room] of rooms) {
    if (!room.started || room.finished) continue;
    const elapsed = now - room.lastMoveTime;
    const remaining = room.timers[room.turn] - elapsed;
    if (remaining <= 0) {
      room.timers[room.turn] = 0;
      room.finished = true;
      broadcast(roomId, { type: 'timeout', loser: room.turn });
    } else {
      broadcast(roomId, { type: 'timer', timers: { ...room.timers }, turn: room.turn, elapsed });
    }
  }
}, 1000);

// Clean up stale rooms (older than 2 hours)
setInterval(() => {
  const now = Date.now();
  for (const [roomId, room] of rooms) {
    if (now - room.createdAt > 7200000) rooms.delete(roomId);
  }
}, 300000);

// The engine exits on a position it refuses, which would take the shared engine
// process down mid-move, so the piece-count limits it enforces are checked here
// before any position reaches it. Returns the reason, or null when it is fine.
function positionRejection(fen) {
  const rows = String(fen).trim().split(/\s+/)[0].split('/');
  if (rows.length !== 8) return 'the board must have eight ranks';

  const count = {};
  let total = 0;
  for (const row of rows) {
    let squares = 0;
    for (const ch of row) {
      if (ch >= '1' && ch <= '8') { squares += Number(ch); continue; }
      squares += 1;
      total += 1;
      count[ch] = (count[ch] || 0) + 1;
    }
    if (squares !== 8) return 'every rank must hold eight squares';
  }

  if (total > 32) return `more than 32 pieces on the board (${total})`;
  if ((count.K || 0) !== 1 || (count.k || 0) !== 1) return 'there must be exactly one king of each colour';
  if (/[Pp]/.test(rows[0] + rows[7])) return 'a pawn cannot stand on the first or last rank';

  for (const side of [
    { name: 'White', pawn: 'P', extras: ['N', 'B', 'R'], queen: 'Q' },
    { name: 'Black', pawn: 'p', extras: ['n', 'b', 'r'], queen: 'q' },
  ]) {
    const pawns = count[side.pawn] || 0;
    if (pawns > 8) return `${side.name} has more than 8 pawns`;
    const promoted = side.extras.reduce((sum, p) => sum + Math.max((count[p] || 0) - 2, 0), 0)
      + Math.max((count[side.queen] || 0) - 1, 0);
    if (promoted > 8 - pawns) return `${side.name} has too many pieces for the pawns it is missing`;
  }
  return null;
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/api/bestmove') {
    try {
      const body = JSON.parse(await readBody(req) || '{}');
      const fen = body.fen;
      const depth = Math.max(1, Math.min(30, parseInt(body.depth, 10) || 30));
      if (!fen || typeof fen !== 'string') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing fen' }));
        return;
      }
      const rejected = positionRejection(fen);
      if (rejected) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Position refused: ' + rejected }));
        return;
      }
      // Fast fixed time budget; engine searches as deep as possible (up to
      // max depth) within it, then returns the best move found so far.
      const timeoutMs = MOVE_TIME_MS + 500; // safety net; movetime handles actual timing
      const bestmove = await engine.bestMove(fen, depth, timeoutMs, body.searchmoves);
      if (!bestmove) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Engine returned no move' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ bestmove }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(e.message || e) }));
    }
    return;
  }
  if (req.method === 'POST' && req.url === '/api/newgame') {
    try { await engine.newGame(); } catch {}
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  if (req.method === 'GET' && req.url === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, threads: THREADS, hash_mb: HASH_MB }));
    return;
  }
  // --- Online Multiplayer Routes ---
  if (req.method === 'POST' && req.url === '/api/createroom') {
    try {
      const body = JSON.parse(await readBody(req) || '{}');
      const tc = Math.max(60000, Math.min(3600000, parseInt(body.timeControl, 10) || 300000));
      const roomId = genRoomId();
      rooms.set(roomId, {
        id: roomId,
        fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
        turn: 'w',
        timeControl: tc,
        timers: { w: tc, b: tc },
        lastMoveTime: null,
        started: false,
        finished: false,
        players: { w: true, b: false },
        history: [],
        createdAt: Date.now(),
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ roomId, color: 'w', timeControl: tc }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(e.message || e) }));
    }
    return;
  }

  if (req.method === 'POST' && req.url === '/api/joinroom') {
    try {
      const body = JSON.parse(await readBody(req) || '{}');
      const room = rooms.get(body.roomId);
      if (!room) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Room not found' }));
        return;
      }
      if (room.players.b) {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Room is full' }));
        return;
      }
      room.players.b = true;
      room.started = true;
      room.lastMoveTime = Date.now();
      broadcast(body.roomId, { type: 'start', fen: room.fen, timeControl: room.timeControl, timers: { ...room.timers } });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ roomId: body.roomId, color: 'b', fen: room.fen, timeControl: room.timeControl, timers: { ...room.timers } }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(e.message || e) }));
    }
    return;
  }

  if (req.method === 'GET' && req.url.startsWith('/api/stream/')) {
    const roomId = req.url.split('/api/stream/')[1].split('?')[0];
    const room = rooms.get(roomId);
    if (!room) { res.writeHead(404); res.end('Room not found'); return; }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    res.write(`data: ${JSON.stringify({ type: 'connected', fen: room.fen, started: room.started, timeControl: room.timeControl, timers: { ...room.timers }, turn: room.turn })}\n\n`);
    addClient(roomId, res);
    const heartbeat = setInterval(() => { try { res.write(': heartbeat\n\n'); } catch {} }, 15000);
    req.on('close', () => {
      clearInterval(heartbeat);
      removeClient(roomId, res);
      broadcast(roomId, { type: 'opponentLeft' });
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/api/onlinemove') {
    try {
      const body = JSON.parse(await readBody(req) || '{}');
      const room = rooms.get(body.roomId);
      if (!room) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Room not found' }));
        return;
      }
      if (room.finished) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Game finished' }));
        return;
      }
      const now = Date.now();
      if (room.lastMoveTime) {
        const elapsed = now - room.lastMoveTime;
        room.timers[room.turn] = Math.max(0, room.timers[room.turn] - elapsed);
      }
      room.lastMoveTime = now;
      room.turn = room.turn === 'w' ? 'b' : 'w';
      room.history.push(body.uci);
      broadcast(body.roomId, { type: 'move', uci: body.uci, timers: { ...room.timers }, turn: room.turn });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(e.message || e) }));
    }
    return;
  }

  if (req.method === 'POST' && req.url === '/api/leave') {
    try {
      const body = JSON.parse(await readBody(req) || '{}');
      broadcast(body.roomId, { type: 'opponentLeft' });
    } catch {}
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  serveStatic(req, res);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Stockfish web UI listening on 0.0.0.0:${PORT}`);
  console.log(`Engine binary: ${STOCKFISH}`);
  console.log(`Threads: ${THREADS}, Hash: ${HASH_MB} MB`);
});
