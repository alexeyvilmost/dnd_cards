import {describe, expect, it, vi} from 'vitest';
import {createAssemblyMemo} from './assemblyMemo';
import type {AssembledCharacter, EntityBundle} from './assemblyFactory';
import type {CharacterDraft} from './types';

const bundle = {effects: [{effect: {id: 'effect', mechanics: {bonus: 1}}, origin: {kind: 'race'}}]} as unknown as EntityBundle;
const draft = {level: 1, classId: 'a', resolvedChoices: {}, abilities: {str: 12}} as unknown as CharacterDraft;
describe('immutable static assembly reuse', () => {
  it('reuses exact content while isolating all returned mutable trees', () => {
    const memo = createAssemblyMemo(() => 'owner');
    const build = vi.fn(() => ({effects: structuredClone(bundle.effects), variables: {bonus: 1}} as unknown as AssembledCharacter));
    const first = memo(bundle, draft, build); first.variables.bonus = 99;
    const second = memo(structuredClone(bundle), structuredClone(draft), build);
    expect(second.variables.bonus).toBe(1); second.effects[0].effect.mechanics = {bonus: 99};
    expect(memo(bundle, draft, build).effects[0].effect.mechanics).toEqual({bonus: 1});
    expect(build).toHaveBeenCalledOnce();
  });
  it('keys level, class, choices and loaded dependency content, and separates sessions', () => {
    let owner = 'one'; const memo = createAssemblyMemo(() => owner);
    const build = vi.fn(() => ({effects: [], variables: {}} as unknown as AssembledCharacter));
    memo(bundle, draft, build);
    for (const changed of [{level: 2}, {classId: 'b'}, {resolvedChoices: {slot: ['another']}}, {abilities: {str: 14}}]) memo(bundle, {...draft, ...changed}, build);
    memo({...bundle, effects: []}, draft, build);
    owner = 'two'; memo(bundle, draft, build);
    expect(build).toHaveBeenCalledTimes(7);
  });
  it('evicts bounded entries and never remembers a failed build', () => {
    const memo = createAssemblyMemo(() => null, 1);
    const build = vi.fn(() => ({effects: [], variables: {}} as unknown as AssembledCharacter));
    memo(bundle, draft, build); memo(bundle, {...draft, level: 2}, build); memo(bundle, draft, build);
    expect(build).toHaveBeenCalledTimes(3);
    const failure = vi.fn((): AssembledCharacter => {throw new Error('dependency unavailable');});
    expect(() => memo(bundle, {...draft, level: 3}, failure)).toThrow('dependency unavailable');
    memo(bundle, {...draft, level: 3}, build); expect(build).toHaveBeenCalledTimes(4);
  });

  it('does not collapse undefined, null, NaN, Infinity or negative zero in input keys', () => {
    const memo = createAssemblyMemo(() => 'owner', 12);
    const build = vi.fn(() => ({effects: [], variables: {}} as unknown as AssembledCharacter));
    for (const value of [undefined, null, NaN, Infinity, -Infinity, -0, 0]) memo(bundle, {...draft, level: value} as CharacterDraft, build);
    expect(build).toHaveBeenCalledTimes(7);
  });
});
