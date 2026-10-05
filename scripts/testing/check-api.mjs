#!/usr/bin/env node
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {localAcceptanceContext} from './acceptance-context.mjs';

const context = await localAcceptanceContext();
let token;
async function api(method, resource, body, status = 200) {
  const response = await context.request(`/api${resource}`, {method, headers: {'content-type': 'application/json', ...(token ? {authorization: `Bearer ${token}`} : {})}, body: body === undefined ? undefined : JSON.stringify(body)});
  const data = await response.json();
  assert.equal(response.status, status, `${method} ${resource}: unexpected HTTP status (code=${typeof data.code === 'string' ? data.code.slice(0, 80) : 'absent'})`);
  return data;
}
const auth = await context.authenticate(); token = auth.token;
const catalog = await api('GET', '/character-templates');
assert.equal(catalog.templates.length, 3); assert.equal(catalog.can_manage, false);
const requestedPresets = process.argv.includes('--all-presets') ? ['line', 'swordsman', 'archer'] : ['line', 'swordsman'];
const selected = requestedPresets.map(key => {
  const template = catalog.templates.find(row => row.preset_key === key);
  assert(template, `Required fixture preset is absent: ${key}`); return template;
});
const evidence = [];
for (const template of selected) {
  const source = await api('POST', `/character-templates/${template.id}/copies`, {name: `Local fixture ${template.preset_key}`}, 201);
  assert.equal(source.user_id, auth.user.id);
  const sourceSnapshot = await api('GET', `/characters-v3/${source.id}`);
  let run = (await api('POST', '/roguelike/runs', {source_character_id: source.id}, 201)).run;
  assert.equal(run.source_character_id, source.id); assert.notEqual(run.character_id, source.id);
  async function command(type, payload = {}) {
    const request = {command_id: randomUUID(), expected_revision: run.revision, type, payload};
    const result = await api('POST', `/roguelike/runs/${run.id}/commands`, request);
    const retry = await api('POST', `/roguelike/runs/${run.id}/commands`, request);
    assert.deepEqual(retry, result, `${type} retry changes its persisted result`);
    run = result.run;
  }
  await command('start_encounter');
  await command('initialize_combat');
  assert(run.combat_state, 'Authoritative worker did not initialize combat');
  assert.equal(run.combat_state.world.actors[run.combat_state.characterId].kind, 'playerCharacter');
  const reloaded = (await api('GET', `/roguelike/runs/${run.id}`)).run;
  assert.deepEqual(reloaded.combat_state, run.combat_state, 'Reload changes initialized combat');
  assert.deepEqual(await api('GET', `/characters-v3/${source.id}`), sourceSnapshot, 'A run mutated its source sheet');
  evidence.push({template: template.preset_key, sourceId: source.id, runId: run.id, revision: run.revision});
}
await writeFile(path.join(context.output, 'api-smoke.json'), JSON.stringify({runId: context.registry.runId, status: 'passed', evidence}, null, 2));
console.log(`PASS: ${selected.length} template copies (${requestedPresets.join(', ')}), source isolation, real worker initialization, exact command retry and reload.`);
