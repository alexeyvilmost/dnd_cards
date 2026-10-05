import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createServer} from 'node:http';
import {startTestUI} from './ui-server.mjs';

test('performance cache models only immutable hashed assets; default, HTML and API stay no-store', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dnd-ui-cache-'));
  const api = createServer((_req, res) => {res.writeHead(200, {'cache-control': 'public,max-age=60'}); res.end('{}');});
  await new Promise(resolve => api.listen(0, '127.0.0.1', resolve));
  const apiOrigin = `http://127.0.0.1:${api.address().port}`;
  try {
    await mkdir(path.join(root, 'assets')); await writeFile(path.join(root, 'index.html'), 'fixture');
    await writeFile(path.join(root, 'assets/app-ABCD1234.js'), 'fixture'); await writeFile(path.join(root, 'assets/plain.js'), 'fixture');
    for (const cacheAssets of [false, true]) {
      const server = await startTestUI({root, apiOrigin, cacheAssets});
      try {
        const origin = `http://127.0.0.1:${server.address().port}`;
        for (const resource of ['/', '/route', '/api/health', '/assets/plain.js', '/assets/app-ABCD1234.js']) {
          const response = await fetch(origin + resource); await response.text();
          assert.equal(response.headers.get('cache-control'), cacheAssets && resource.endsWith('ABCD1234.js') ? 'public, max-age=31536000, immutable' : 'no-store');
        }
      } finally {await new Promise(resolve => {server.closeAllConnections(); server.close(resolve);});}
    }
  } finally {
    await new Promise(resolve => {api.closeAllConnections(); api.close(resolve);});
    const resolved = path.resolve(root); assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert(path.basename(resolved).startsWith('dnd-ui-cache-')); await rm(resolved, {recursive: true, force: true});
  }
});
