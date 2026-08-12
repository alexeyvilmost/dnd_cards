import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import {
  executeRulesWorkerRequest,
  RULES_WORKER_ENGINE_VERSION,
  RULES_WORKER_PROTOCOL_VERSION,
  type RulesWorkerExecuteRequest,
  type RulesWorkerValidateRequest,
  validateRulesWorkerWorld,
} from './execute';
import generatedArtifact from '../character/sheetCombatCertification.generated.json';
import { resolveRulesWorkerPort } from './config';

const MAX_BODY_BYTES = 2 << 20;
const port = resolveRulesWorkerPort(process.env);
const secret = process.env.RULES_WORKER_SECRET?.trim() ?? '';

function json(response: ServerResponse, status: number, body: unknown): void {
  const encoded = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(encoded),
    'cache-control': 'no-store',
  });
  response.end(encoded);
}

function authorized(request: IncomingMessage): boolean {
  if (!secret) return process.env.NODE_ENV !== 'production';
  return request.headers.authorization === `Bearer ${secret}`;
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error('request body is too large');
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

function serverTape(length = 1024): number[] {
  const bytes = randomBytes(length * 4);
  return Array.from({ length }, (_, index) => bytes.readUInt32BE(index * 4));
}

const server = createServer(async (request, response) => {
  if (request.method === 'GET' && request.url === '/health') {
    json(response, 200, {
      status: 'ok',
      protocolVersion: RULES_WORKER_PROTOCOL_VERSION,
      engineVersion: RULES_WORKER_ENGINE_VERSION,
      rulesArtifactHash: generatedArtifact.source.release.releaseHash,
    });
    return;
  }
  if (request.method !== 'POST'
    || (request.url !== '/v1/execute' && request.url !== '/v1/validate')) {
    json(response, 404, { error: 'not found' });
    return;
  }
  if (!authorized(request)) {
    json(response, 401, { error: 'rules worker authentication is required' });
    return;
  }
  try {
    if (request.url === '/v1/validate') {
      const value = await readBody(request) as RulesWorkerValidateRequest;
      json(response, 200, await validateRulesWorkerWorld(value));
      return;
    }
    const value = await readBody(request) as Partial<RulesWorkerExecuteRequest>;
    const result = await executeRulesWorkerRequest({
      ...value,
      rngTape: Array.isArray(value.rngTape) && value.rngTape.length
        ? value.rngTape
        : serverTape(),
    } as RulesWorkerExecuteRequest);
    json(response, 200, result);
  } catch (error) {
    json(response, 422, {
      error: error instanceof Error ? error.message : 'rules worker execution failed',
    });
  }
});

if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
  throw new Error('RULES_WORKER_PORT must be a valid TCP port');
}
if (process.env.NODE_ENV === 'production' && !secret) {
  throw new Error('RULES_WORKER_SECRET is required in production');
}

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`rules worker ${RULES_WORKER_ENGINE_VERSION} listening on 127.0.0.1:${port}\n`);
});
