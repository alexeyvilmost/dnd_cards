import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {describe, expect, it} from 'vitest';
import type {WorldState} from './domain';
import {migrateWorldState} from './worldMigration';

const fixture = new URL('../../worker/fixtures/replay-v1/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('corpus-manifest.json', fixture), 'utf8'));
const bytes = gunzipSync(readFileSync(new URL(manifest.corpusFile, fixture)));
const hash = (value: Uint8Array) => `sha256:${createHash('sha256').update(value).digest('hex')}`;
if (hash(bytes) !== manifest.corpusHash) throw Error('Historical corpus bytes changed');
const corpus = JSON.parse(bytes.toString('utf8')) as {cases: Array<{name: string; response: {
  envelope: {before?: WorldState; after?: WorldState; state?: {world?: WorldState}};
}}>};
const worlds = corpus.cases.flatMap(row => ['before', 'after', 'combat'].flatMap(phase => {
  const world = phase === 'combat' ? row.response.envelope?.state?.world
    : row.response.envelope?.[phase as 'before' | 'after'];
  return world ? [{name: `${row.name}:${phase}`, world}] : [];
}));
if (worlds.length < 10) throw Error('Historical world matrix is empty or incomplete');

describe('new world reader preserves immutable original-executable snapshots', () => {
  it.each(worlds)('$name keeps its original ruleset, pending outcome and resource projection', ({world}) => {
    const raw = JSON.parse(JSON.stringify(world));
    const before = JSON.stringify(raw);
    const migrated = migrateWorldState(raw);
    expect(JSON.stringify(raw)).toBe(before);
    expect(migrated.id).toBe(world.id);
    expect(migrated.ruleset).toEqual(world.ruleset);
    expect(migrated.revision).toBe(world.revision);
    expect(migrated.pendingResolution).toEqual(world.pendingResolution);
    for (const [id, actor] of Object.entries(world.actors)) {
      expect(migrated.actors[id].runtime.hp).toEqual(actor.runtime.hp);
      expect(migrated.actors[id].runtime.resources).toEqual(actor.runtime.resources);
      expect(migrated.actors[id].runtime.inventory).toEqual(actor.runtime.inventory);
      expect(migrated.actors[id].runtime.equipment).toEqual(actor.runtime.equipment);
      expect(migrated.actors[id].runtime.activeEffects).toEqual(actor.runtime.activeEffects);
    }
    expect(migrateWorldState(JSON.parse(JSON.stringify(migrated)))).toEqual(migrated);
  });

  it('rejects an unknown schema without mutating or repinning the source', () => {
    const raw = {...JSON.parse(JSON.stringify(worlds[0].world)), schemaVersion: 999};
    const before = JSON.stringify(raw);
    expect(() => migrateWorldState(raw)).toThrow(/schema/i);
    expect(JSON.stringify(raw)).toBe(before);
  });
});
