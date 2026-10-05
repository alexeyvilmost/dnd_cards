import {createServer, request} from 'node:http';
import {readFile, realpath} from 'node:fs/promises';
import path from 'node:path';
import {assertLocalOrigin, assertOwnedPath} from './guards.mjs';

export async function startTestUI({root, apiOrigin, port = 0, cacheAssets = false, fixtureOnly = false}) {
  const directory = await realpath(root), api = fixtureOnly ? null : new URL(assertLocalOrigin(apiOrigin));
  const types = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.webp': 'image/webp', '.wasm': 'application/wasm'};
  const server = createServer(async (req, res) => {
    if (req.url.startsWith('/api/')) {
      if (fixtureOnly) {res.writeHead(503, {'content-type':'application/json'}); res.end('{"error":"Unmocked API request in UI fixture profile"}'); return;}
      const upstream = request({hostname: api.hostname, port: api.port, method: req.method, path: req.url, headers: {...req.headers, host: api.host}}, response => {
        if (res.destroyed) {response.destroy(); return;}
        res.writeHead(response.statusCode, {...response.headers, 'cache-control': 'no-store'});
        response.on('error', () => res.destroy()); response.pipe(res);
      });
      upstream.on('error', () => {
        if (res.destroyed || res.writableEnded) return;
        if (res.headersSent) {res.destroy(); return;}
        res.writeHead(502); res.end('Local test API unavailable');
      });
      upstream.setTimeout(30_000, () => upstream.destroy());
      req.on('aborted', () => upstream.destroy());
      res.on('close', () => upstream.destroy());
      req.pipe(upstream); return;
    }
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      const file = path.extname(pathname) ? assertOwnedPath(directory, path.join(directory, pathname)) : path.join(directory, 'index.html');
      assertOwnedPath(directory, await realpath(file));
      const body = await readFile(file);
      const immutable = cacheAssets && /^\/assets\/[a-zA-Z0-9_.-]+-[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9]+$/.test(pathname);
      res.writeHead(200, {'content-type': types[path.extname(file)] ?? 'application/octet-stream', 'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-store'}); res.end(body);
    } catch {res.writeHead(404); res.end('Not found');}
  });
  await new Promise((resolve, reject) => {server.once('error', reject); server.listen(port, '127.0.0.1', resolve);});
  return server;
}
