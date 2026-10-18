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

const PORT = process.env.PORT || 3000;
const STOCKFISH = process.env.STOCKFISH_PATH || '/usr/local/bin/stockfish';
const PUBLIC_DIR = path.join(__dirname, 'public');
const THREADS = parseInt(process.env.STOCKFISH_THREADS, 10) || 4;
const HASH_MB = parseInt(process.env.STOCKFISH_HASH_MB, 10) || 256;

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
        if (!line.trim()) continue;
        this.handleLine(line.trim());
      }
    });
    this.proc.stderr.on('data', () => {});

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
    await new Promise((resolve) => this.readyWaiters.push(resolve));
  }

  async bestMove(fen, depth, timeoutMs) {
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
      this.send(`go depth ${depth}`);
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

const server = http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/api/bestmove') {
    try {
      const body = JSON.parse(await readBody(req) || '{}');
      const fen = body.fen;
      const depth = Math.max(1, Math.min(30, parseInt(body.depth, 10) || 18));
      if (!fen || typeof fen !== 'string') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing fen' }));
        return;
      }
      // Timeout scales with depth: deeper searches get more time
      const timeoutMs = depth <= 15 ? 30000 : depth <= 22 ? 60000 : 120000;
      const bestmove = await engine.bestMove(fen, depth, timeoutMs);
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
  serveStatic(req, res);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Stockfish web UI listening on 0.0.0.0:${PORT}`);
  console.log(`Engine binary: ${STOCKFISH}`);
  console.log(`Threads: ${THREADS}, Hash: ${HASH_MB} MB`);
});
