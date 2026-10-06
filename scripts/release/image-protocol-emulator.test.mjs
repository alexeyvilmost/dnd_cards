import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {startImageProtocolEmulator} from './image-protocol-emulator.mjs';

test('owned provider/storage protocol peer uses real HTTP, exact image bytes and per-job counters', async () => {
  const token = 'local-image-protocol-fixture', server = await startImageProtocolEmulator({host: '127.0.0.1', port: 0, token});
  const origin = `http://127.0.0.1:${server.port}`;
  const send = (path, method = 'GET', value, headers = {}) => fetch(origin + path, {method, headers: {'content-type': 'application/json', 'x-owned-fixture-token': token, ...headers}, ...(value === undefined ? {} : {body: typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)})});
  try {
    const id = randomUUID(); assert.equal((await send('/__owned/control', 'POST', {id, mode: 'success'})).status, 201);
    const response = await send('/v1/images/generations', 'POST', {model: 'gpt-image-1', prompt: `owned-image-job:${id}`}, {authorization: `Bearer ${token}`});
    assert.equal(response.status, 200); const bytes = Buffer.from((await response.json()).data[0].b64_json, 'base64');
    assert.equal((await send('/storage/owned-image-fixture/spell_icons/synthetic.png', 'PUT', bytes, {authorization: 'AWS4-HMAC-SHA256 local-fixture'})).status, 200);
    const stats = await (await send('/__owned/stats')).json();
    assert.equal(stats.providerCalls, 1); assert.equal(stats.storageUploads, 1); assert.equal(stats.unexpected, 0); assert.equal(stats.jobs[0].calls, 1);
    assert.ok(!JSON.stringify(stats).includes(token)); assert.ok(!JSON.stringify(stats).includes('prompt'));
  } finally {await server.close();}
});

test('unknown disconnect and held response preserve real attempt counts; control cannot rewrite accepted jobs', async () => {
  const token = 'local-image-protocol-fixture', server = await startImageProtocolEmulator({host: '127.0.0.1', port: 0, token});
  const origin = `http://127.0.0.1:${server.port}`;
  const configure = (id, mode) => fetch(origin + '/__owned/control', {method: 'POST', headers: {'x-owned-fixture-token': token}, body: JSON.stringify({id, mode})});
  const invoke = (id, signal) => fetch(origin + '/v1/images/generations', {method: 'POST', headers: {authorization: `Bearer ${token}`}, body: JSON.stringify({model: 'gpt-image-1', prompt: `owned-image-job:${id}`}), signal});
  const stats = async () => (await fetch(origin + '/__owned/stats', {headers: {'x-owned-fixture-token': token}})).json();
  try {
    const unknown = randomUUID(), hold = randomUUID();
    assert.equal((await configure(unknown, 'unknown')).status, 201); await assert.rejects(invoke(unknown));
    assert.equal((await configure(hold, 'hold')).status, 201); const controller = new AbortController();
    const request = invoke(hold, controller.signal).catch(error => error);
    for (let attempt = 0; attempt < 50 && (await stats()).held !== 1; attempt++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal((await stats()).held, 1); assert.equal((await stats()).providerCalls, 2);
    assert.equal((await configure(hold, 'success')).status, 400);
    controller.abort(); await request;
  } finally {await server.close();}
});
