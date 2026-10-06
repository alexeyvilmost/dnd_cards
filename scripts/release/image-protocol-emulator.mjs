// Local protocol peer, not a substitute for the application or an external-provider readiness claim.
export async function startImageProtocolEmulator({port = 8093, host = '0.0.0.0', token}) {
  const {createServer} = await import('node:http');
  const {createHash} = await import('node:crypto');
  if (typeof token !== 'string' || token.length < 16 || !Number.isInteger(port) || port < 0 || port > 65535) throw Error('Explicit owned emulator settings required');
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
  const jobs = new Map(), held = new Set(), sockets = new Set();
  let providerCalls = 0, storageUploads = 0, unexpected = 0;
  const respond = (response, status, body) => {response.writeHead(status, {'content-type': 'application/json'}); response.end(JSON.stringify(body));};
  const body = async request => {const chunks = []; let length = 0; for await (const chunk of request) {length += chunk.length; if (length > 65536) throw Error('Fixture request too large'); chunks.push(chunk);} return Buffer.concat(chunks);};
  const server = createServer(async (request, response) => {
    try {
      if (request.url === '/__owned/stats' && request.method === 'GET' && request.headers['x-owned-fixture-token'] === token) {
        respond(response, 200, {providerCalls, storageUploads, unexpected, jobs: [...jobs].map(([id, row]) => ({id, mode: row.mode, calls: row.calls})), held: held.size}); return;
      }
      if (request.url === '/__owned/control' && request.method === 'POST' && request.headers['x-owned-fixture-token'] === token) {
        const value = JSON.parse((await body(request)).toString('utf8'));
        if (!uuid.test(value.id) || !['success', 'unknown', 'hold'].includes(value.mode) || jobs.has(value.id) || jobs.size >= 16 || Object.keys(value).some(key => !['id', 'mode'].includes(key))) {respond(response, 400, {code: 'invalid-fixture-control'}); return;}
        jobs.set(value.id, {mode: value.mode, calls: 0}); respond(response, 201, {configured: true}); return;
      }
      if (request.url === '/v1/images/generations' && request.method === 'POST' && request.headers.authorization === `Bearer ${token}`) {
        const value = JSON.parse((await body(request)).toString('utf8'));
        const id = typeof value.prompt === 'string' && value.prompt.startsWith('owned-image-job:') ? value.prompt.slice('owned-image-job:'.length) : null;
        const row = uuid.test(id ?? '') ? jobs.get(id) : undefined;
        if (!row || value.model !== 'gpt-image-1') {unexpected++; respond(response, 400, {error: {message: 'Invalid local provider fixture'}}); return;}
        row.calls++; providerCalls++;
        if (row.mode === 'unknown') {response.destroy(); return;}
        if (row.mode === 'hold') {held.add(response); response.once('close', () => held.delete(response)); return;}
        respond(response, 200, {created: 1, data: [{b64_json: png.toString('base64')}]}); return;
      }
      if (request.method === 'PUT' && /^\/storage\/owned-image-fixture\/[A-Za-z0-9_./-]+$/.test(request.url ?? '') && request.headers.authorization?.startsWith('AWS4-HMAC-SHA256 ')) {
        const bytes = await body(request);
        if (!bytes.equals(png)) {unexpected++; respond(response, 400, {code: 'storage-bytes-differ'}); return;}
        storageUploads++; response.writeHead(200, {ETag: `"${createHash('md5').update(bytes).digest('hex')}"`}); response.end(); return;
      }
      unexpected++; respond(response, 404, {code: 'unexpected-fixture-request'});
    } catch {unexpected++; if (!response.destroyed && !response.headersSent) respond(response, 400, {code: 'invalid-fixture-request'}); else response.destroy();}
  });
  server.on('connection', socket => {sockets.add(socket); socket.once('close', () => sockets.delete(socket));});
  await new Promise((resolve, reject) => {server.once('error', reject); server.listen(port, host, resolve);});
  return {port: server.address().port, close: async () => {for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve));}};
}

// The exact same implementation runs under Node in an isolated labelled container.
export const imageProtocolEmulatorProgram = `(${startImageProtocolEmulator.toString()})({port:8093,token:process.env.OWNED_IMAGE_FIXTURE_TOKEN}).catch(()=>{process.exitCode=1;});`;
