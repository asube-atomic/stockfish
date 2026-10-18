// Zero-dependency web UI bridge for the Stockfish UCI engine.
// Serves the static chessboard UI and exposes /api/bestmove which
// runs the engine over UCI and returns its chosen move.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = process.env.PORT || 3000;
const STOCKFISH = process.env.STOCKFISH_PATH || '/usr/local/bin/stockfish';
const PUBLIC_DIR = path.join(__dirname, 'public');

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

// Run Stockfish over UCI: set position from FEN, search to given depth, return bestmove.
function getBestMove(fen, depth) {
  return new Promise((resolve, reject) => {
    const sf = spawn(STOCKFISH, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) { settled = true; try { sf.kill('SIGKILL'); } catch {} reject(new Error('Engine timeout')); }
    }, 30000);

    sf.stdout.on('data', (d) => {
      out += d.toString();
      const m = out.match(/bestmove\s+(\S+)/);
      if (m && settled === false) {
        settled = true;
        clearTimeout(timeout);
        try { sf.stdin.end(); } catch {}
        try { sf.kill('SIGKILL'); } catch {}
        resolve(m[1]);
      }
    });
    sf.stderr.on('data', () => {});
    sf.on('error', (e) => { if (!settled) { settled = true; clearTimeout(timeout); reject(e); } });
    sf.on('close', () => { if (!settled) { settled = true; clearTimeout(timeout); reject(new Error('Engine exited without bestmove')); } });

    sf.stdin.write('uci\n');
    sf.stdin.write('isready\n');
    sf.stdin.write(`position fen ${fen}\n`);
    sf.stdin.write(`go depth ${depth}\n`);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/api/bestmove') {
    try {
      const body = JSON.parse(await readBody(req) || '{}');
      const fen = body.fen;
      const depth = Math.max(1, Math.min(20, parseInt(body.depth, 10) || 8));
      if (!fen || typeof fen !== 'string') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing fen' }));
        return;
      }
      const bestmove = await getBestMove(fen, depth);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ bestmove }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(e.message || e) }));
    }
    return;
  }
  if (req.method === 'GET' && req.url === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  serveStatic(req, res);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Stockfish web UI listening on 0.0.0.0:${PORT}`);
  console.log(`Engine binary: ${STOCKFISH}`);
});
