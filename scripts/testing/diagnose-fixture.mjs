#!/usr/bin/env node
// Read-only diagnosis of a synthetic integration fixture using the same built
// artifact. Never sends or commits a combat result and never logs input state.
import {createRequire} from 'node:module';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {startTestStack} from './stack.mjs';
import {localFetch} from './guards.mjs';
import {repositoryRoot} from './runtime.mjs';
const stack = await startTestStack({profile: 'integration', reuseBuild: true});
try {
  const request = async (resource, options = {}) => {
    const result = await localFetch(stack.registry.origins.api, `/api${resource}`, options);
    if (!result.ok) throw new Error(`Local diagnostic HTTP ${result.status}`);
    return result.json();
  };
  const login = await request('/auth/login', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(stack.accounts.player)});
  const headers = {'content-type': 'application/json', authorization: `Bearer ${login.token}`};
  const templates = (await request('/character-templates', {headers})).templates;
  const tableNames = {race: 'races', class: 'classes', background: 'backgrounds', feat: 'feats', effect: 'effects', action: 'actions', spell: 'spells', card: 'cards', resource: 'resources'};
  const rows = async table => {
    const output = await stack.database.query(`SELECT coalesce(json_agg(t),'[]'::json) FROM ${table} t;`, undefined, {sensitive: true});
    let parsed;
    try {parsed = JSON.parse(output.trim().replace(/^SET\r?\n/, ''));} catch {throw new Error(`Malformed local diagnostic rows for ${table}`);}
    return parsed.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => {
      if (typeof value === 'string' && ['properties', 'legacy_tags', 'related_cards', 'related_actions', 'related_effects'].includes(key) && /^[\[{]/.test(value)) value = JSON.parse(value);
      return [key === 'legacy_tags' ? 'tags' : key, value];
    })));
  };
  const entities = {};
  for (const [kind, table] of Object.entries(tableNames)) entities[kind] = await rows(table);
  const catalog = {schemaVersion: 1, entities, variables: await rows('variables'), variablesComplete: true, completeEffectTypes: [...new Set(entities.effect.map(row => row.type))]};
  const require = createRequire(import.meta.url);
  const artifact = require(path.join(repositoryRoot, 'frontend/worker/dist/artifact.cjs'));
  const evidence = [];
  for (const template of templates) {
    const character = await request(`/character-templates/${template.id}/copies`, {method: 'POST', headers, body: JSON.stringify({name: 'Local diagnostic'})});
    const monsters = await rows('monsters');
    try {
      const result = await artifact.initializeRoguelikeCombat({character, catalog, basicActionIds: entities.action.filter(row => row.type === 'basic').map(row => row.id),
        monsters: {version: 1, monsters, actions: entities.action.filter(row => row.type === 'monster'), effects: []},
        roster: [{monster_id: monsters[0].id, monster_slug: monsters[0].slug, quantity: 1}], seed: 'local-fixture-diagnostic', mapIndex: 0, mapSeed: 1}, stack.registry.artifactHash);
      evidence.push({preset: template.preset_key, status: result.status, ...(result.status === 'needs_content' ? {needs: result.needs} : {}),
        ...(result.status === 'ready' ? {actionContracts: result.envelope.state.catalogActions.map(row => ({id: row.id, name: row.name, primitive: row.mechanics?.primitive,
          attackKinds: row.mechanics?.effects?.filter(effect => effect.resolution === 'attack_roll').map(effect => effect.attack_kind)}))} : {})});
    } catch (error) {evidence.push({preset: template.preset_key, error: error.stack});}
  }
  await writeFile(path.join(stack.registry.directory, 'fixture-diagnostic.json'), JSON.stringify(evidence, null, 2));
  console.log(`Fixture-only diagnostic saved: ${stack.registry.directory}`);
} finally {await stack.cleanup();}
