import {createServer} from 'node:http';
import {createHash, timingSafeEqual} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const hashOf = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const require = createRequire(import.meta.url);

// Independent of executable artifact versions, so archived workers also get a
// verifiable journal. Normalize objects while preserving array order.
export function snapshotHash(value) {
  const normalize = item => Array.isArray(item) ? item.map(normalize)
    : item && typeof item === 'object'
      ? Object.fromEntries(Object.keys(item).sort().map(key => [key, normalize(item[key])])) : item;
  return hashOf(JSON.stringify(normalize(value)));
}

export async function createRulesWorker({artifactFile, artifactsDirectory, token, sourceCommit = 'development'}) {
  if (typeof token !== 'string' || token.length < 32) throw Error('Worker token must contain at least 32 characters');
  const current = await readFile(artifactFile);
  const artifactHash = hashOf(current);
  await mkdir(artifactsDirectory, {recursive: true});
  const artifactPath = hash => path.join(artifactsDirectory, `${hash.slice(7)}.cjs`);
  try {await writeFile(artifactPath(artifactHash), current, {flag: 'wx', mode: 0o600});}
  catch (error) {if (error.code !== 'EEXIST') throw error;}
  if (hashOf(await readFile(artifactPath(artifactHash))) !== artifactHash) throw Error('Existing artifact is corrupt');
  const cache = new Map();
  async function load(hash) {
    if (!/^sha256:[a-f0-9]{64}$/.test(hash)) throw Error('Invalid artifact hash');
    if (!cache.has(hash)) {
      const file = artifactPath(hash);
      if (hashOf(await readFile(file)) !== hash) throw Error('Artifact hash mismatch');
      cache.set(hash, require(file));
    }
    return cache.get(hash);
  }
  const expectedAuth = Buffer.from(`Bearer ${token}`);
  return createServer(async (request, response) => {
    const send = (status, value) => {response.writeHead(status, {'Content-Type': 'application/json', 'Cache-Control': 'no-store'}); response.end(JSON.stringify(value));};
    if (request.method === 'GET' && request.url === '/health') return send(200, {status: 'ok', artifactHash, sourceCommit});
    const suppliedAuth = Buffer.from(request.headers.authorization || '');
    if (suppliedAuth.length !== expectedAuth.length || !timingSafeEqual(suppliedAuth, expectedAuth)) return send(401, {error: 'unauthorized'});
    if (request.method !== 'POST' || !['/initialize', '/transition', '/rest', '/camp-action'].includes(request.url)) return send(404, {error: 'not_found'});
    try {
      let size = 0;
      const chunks = [];
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 16 * 1024 * 1024) {send(413, {error: 'request_too_large'}); return;}
        chunks.push(chunk);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const hash = body.artifactHash || artifactHash;
      const artifact = await load(hash);
      if (request.url === '/camp-action') {
        const result = await artifact.executeRoguelikeCampAction(body.input);
        return send(200, {...result, artifactHash: hash});
      }
      if (request.url === '/rest') {
        const result = await artifact.executeRoguelikeCampRest(body.input);
        return send(200, {...result, artifactHash: hash});
      }
      if (request.url === '/initialize') {
        const result = await artifact.initializeRoguelikeCombat(body.input, hash);
        if (result.status !== 'ready') return send(200, result);
        const projected = artifact.projectRoguelikeCombatPatch(result.envelope, body.input.character);
        return send(200, {...result, ...projected,
          trace: {beforeHash: '', afterHash: snapshotHash(projected.envelope), runtimeRevision: projected.patch.runtime_revision}});
      }
      const result = artifact.stepRoguelikeCombat(body.envelope, body.intent, hash);
      const projected = artifact.projectRoguelikeCombatPatch(result.envelope, body.character);
      return send(200, {...result, ...projected,
        trace: {beforeHash: snapshotHash(body.envelope), afterHash: snapshotHash(projected.envelope), runtimeRevision: projected.patch.runtime_revision}});
    } catch (error) {
      // No request or snapshot logging: the envelope contains private entropy.
      const missing = error.code === 'ENOENT';
      send(missing ? 409 : 422, {error: missing ? 'artifact_unavailable' : 'invalid_combat_command', message: missing ? 'Pinned rules artifact unavailable' : String(error.message).slice(0, 500)});
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = await createRulesWorker({
    artifactFile: process.env.RULES_ARTIFACT_FILE || new URL('./artifact.cjs', import.meta.url),
    artifactsDirectory: process.env.RULES_ARTIFACTS_DIR || '/artifacts',
    token: process.env.RULES_WORKER_TOKEN, sourceCommit: process.env.SOURCE_COMMIT,
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  server.listen(Number(process.env.PORT || 8090), '0.0.0.0');
}
