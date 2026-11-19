// Local static server and attendance API forwarder.
// Start with: node dev-server.js
// Binds only to loopback and never logs request bodies or credentials.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 1514);
const attendanceUrl = 'https://attendance-mits.vercel.app/api/attendance';
const assets = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/mits-logo.png': ['mits-logo.png', 'image/png'],
  // Deliberately served as requested for direct browser Groq calls. Anyone
  // who can access this tunnel can also read the key in this file.
  '/api.txt': ['api.txt', 'text/plain; charset=utf-8']
};

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > 8192) throw new Error('Request is too large.');
  }
  return JSON.parse(body || '{}');
}

async function handleRequest(req, res) {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/attendance') {
    if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed.' });
    try {
      const data = await readJson(req);
      if (typeof data.roll !== 'string' || typeof data.password !== 'string' || !data.roll.trim() || !data.password) {
        return json(res, 400, { error: 'Enter your register number and password.' });
      }
      const upstream = await fetch(attendanceUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ roll: data.roll, password: data.password }),
        signal: AbortSignal.timeout(24000)
      });
      const text = await upstream.text();
      res.writeHead(upstream.status, {
        'Content-Type': upstream.headers.get('content-type') || 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
      });
      return res.end(text);
    } catch (error) {
      const timeout = error.name === 'TimeoutError';
      return json(res, timeout ? 504 : 502, { error: timeout ? 'Attendance service timed out.' : 'Attendance service unavailable.' });
    }
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Method not allowed.' });
  const asset = assets[url.pathname];
  if (!asset) return json(res, 404, { error: 'Not found.' });
  try {
    const content = await readFile(path.join(root, asset[0]));
    res.writeHead(200, { 'Content-Type': asset[1], 'Cache-Control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : content);
  } catch {
    json(res, 500, { error: 'Could not read the app files.' });
  }
}

for (const host of ['127.0.0.1', '::1']) {
  const server = http.createServer(handleRequest);
  server.on('error', error => {
    if (error.code !== 'EADDRINUSE') console.error(`Local server failed on ${host}: ${error.code}`);
  });
  server.listen({ port, host, ipv6Only: host === '::1' }, () => {
    console.log(`MITS Attendance listening on http://${host}:${port}`);
  });
}
