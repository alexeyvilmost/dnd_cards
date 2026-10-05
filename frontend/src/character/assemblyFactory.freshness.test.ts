import {describe, expect, it, vi} from 'vitest';
import {createAssemblyRuntime, type AssemblyDataSource} from './assemblyFactory';
import {emptyDraft} from './types';

const rootId = '10000000-0000-4000-8000-000000000001';
function setup() {
  const root = {id: rootId, name: 'Synthetic choice', card_number: 'choice-root', mechanics: {effects: [
    {kind: 'choice', id: 'first', count: 1, options: {source: 'effect_type', type: 'synthetic-type'}},
    {kind: 'choice', id: 'second', count: 1, options: {source: 'effect_type', type: 'synthetic-type'}},
  ]}};
  const getEffects = vi.fn();
  const runtime = createAssemblyRuntime({
    variablesApi: {getVariables: async () => ({variables: []})},
    effectsApi: {getEffect: async () => root, getEffects},
    entityRegistry: {resolve: async () => null, resolveMany: async () => []},
  } as unknown as AssemblyDataSource);
  const draft = emptyDraft(); draft.effectIds = [rootId];
  return {root, getEffects, runtime, draft};
}
const rows = (id: string) => ({effects: [{id, name: id, card_number: id}]});
function items(bundle: Awaited<ReturnType<ReturnType<typeof createAssemblyRuntime>['loadBundle']>>) {
  return (bundle.effects[0].effect.mechanics as {effects: {options: {items: {id: string}[]}}[]}).effects.map(row => row.options.items.map(item => item.id));
}
describe('effect-type membership belongs to one bundle load', () => {
  it('rechecks membership on the next bundle and never materializes into shared API objects', async () => {
    const {root, getEffects, runtime, draft} = setup();
    const original = structuredClone(root);
    getEffects.mockResolvedValueOnce(rows('A')).mockResolvedValueOnce(rows('B'));
    const first = await runtime.loadBundle(draft);
    expect(items(first)).toEqual([['A'], ['A']]);
    expect(root).toEqual(original);
    const second = await runtime.loadBundle(draft);
    expect(items(second)).toEqual([['B'], ['B']]);
    expect(items(first)).toEqual([['A'], ['A']]);
    expect(root).toEqual(original);
    expect(getEffects).toHaveBeenCalledTimes(2);
  });
  it('does not retain a failed membership request across bundle loads', async () => {
    const {getEffects, runtime, draft} = setup();
    getEffects.mockRejectedValueOnce(new Error('temporary')).mockResolvedValueOnce(rows('B'));
    expect(items(await runtime.loadBundle(draft))).toEqual([[], []]);
    expect(items(await runtime.loadBundle(draft))).toEqual([['B'], ['B']]);
    expect(getEffects).toHaveBeenCalledTimes(2);
  });
});
