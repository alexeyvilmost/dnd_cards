import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { handleCommand } from './handler';
import { createStrictRngTape } from './determinism';
import type { HandlerReplayCase } from './testing/handlerReplayScenarios';

const directory = resolve(dirname(fileURLToPath(import.meta.url)), 'testing/fixtures/event-queue-v1');
const manifest = JSON.parse(readFileSync(resolve(directory, 'manifest.json'), 'utf8'));
const compressed = readFileSync(resolve(directory, manifest.file)), bytes = gunzipSync(compressed);
const hash = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
if (hash(compressed) !== manifest.compressedSha256 || hash(bytes) !== manifest.sha256) throw new Error('Immutable handler replay corpus hash mismatch');
const corpus = JSON.parse(bytes.toString('utf8')) as { schemaVersion: number; cases: HandlerReplayCase[] };
if (corpus.schemaVersion !== 1 || corpus.cases.length !== 13 || manifest.cases !== corpus.cases.length) throw new Error('Required handler replay cases are missing');

describe('world event queue extraction preserves captured command semantics', () => {
  it.each(corpus.cases)('$name', row => {
    for (let repeat = 0; repeat < 2; repeat++) {
      const world = structuredClone(row.world), command = structuredClone(row.command), actions = structuredClone(row.actions);
      const before = structuredClone({ world, command, actions }), tape = createStrictRngTape(row.dice);
      let index = 0;
      const result = handleCommand(world, command, { getAction: id => actions.find(action => action.id === id) }, {
        rng: tape.rng, clock: () => row.clock, nextId: () => {
          const id = row.ids[index++]; if (!id) throw new Error('Replay ID tape exhausted'); return id;
        },
      });
      expect(JSON.parse(JSON.stringify(result))).toEqual(row.result);
      expect({ world, command, actions }).toEqual(before);
      expect(index).toBe(row.ids.length); tape.assertExhausted();
    }
  });
});
