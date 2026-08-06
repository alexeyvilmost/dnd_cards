import { describe, expect, it } from 'vitest';
import {
  BuildRuleError,
  createMicroMvpBuildRoots,
  FREE_ORIGIN_FEAT_CHOICE_RULE_ID,
  microMvpRootsCanonicalHashInput,
  resolveFreeOriginFeatChoice,
  type MicroMvpRootScope,
} from './microMvpRoots';

const scope: MicroMvpRootScope = {
  classes: ['fighter', 'wizard', 'rogue', 'cleric', 'sorcerer', 'warlock', 'druid']
    .map((id) => ({ id: `class.${id}` })),
  species: ['human', 'elf', 'dwarf', 'dragonborn'].map((id) => ({ id: `species.${id}` })),
  backgrounds: [
    { id: 'background.soldier', officialOriginFeatId: 'feat.savage-attacker' },
    { id: 'background.sage', officialOriginFeatId: 'feat.magic-initiate-wizard' },
    { id: 'background.criminal', officialOriginFeatId: 'feat.alert' },
    { id: 'background.acolyte', officialOriginFeatId: 'feat.magic-initiate-cleric' },
  ],
  originFeats: ['alert', 'magic-initiate', 'skilled', 'tough'].map((id) => ({ id: `feat.${id}` })),
};

describe('micro-MVP 448 root denominator', () => {
  it('generates exactly 7×4×4×4 unique roots with the expected distribution', () => {
    const roots = createMicroMvpBuildRoots(scope);
    expect(roots).toHaveLength(448);
    expect(new Set(roots.map((root) => root.key))).toHaveLength(448);

    for (const klass of scope.classes) {
      expect(roots.filter((root) => root.classId === klass.id)).toHaveLength(64);
    }
    for (const entity of [...scope.species, ...scope.backgrounds, ...scope.originFeats]) {
      const count = roots.filter((root) => [root.speciesId, root.backgroundId, root.originFeatId].includes(entity.id)).length;
      expect(count).toBe(112);
    }
    for (const background of scope.backgrounds) {
      for (const feat of scope.originFeats) {
        expect(roots.filter((root) => root.backgroundId === background.id && root.originFeatId === feat.id)).toHaveLength(28);
      }
    }
  });

  it('gives every root one product-rule feat and never adds the official background grant', () => {
    for (const root of createMicroMvpBuildRoots(scope)) {
      const productGrants = root.originFeatChoice.grants.filter((grant) => grant.sourceType === 'product_rule');
      expect(productGrants).toEqual([{
        entityId: root.originFeatId,
        kind: 'origin_feat',
        sourceType: 'product_rule',
        sourceId: FREE_ORIGIN_FEAT_CHOICE_RULE_ID,
      }]);
      expect(root.originFeatChoice.grants).toHaveLength(1);
      expect(root.originFeatChoice.grants.some((grant) => grant.sourceId === root.backgroundId)).toBe(false);
    }
  });

  it('is byte-stable for equivalent scope inputs', () => {
    const first = microMvpRootsCanonicalHashInput(createMicroMvpBuildRoots(scope));
    const rebuilt = microMvpRootsCanonicalHashInput(createMicroMvpBuildRoots({
      classes: scope.classes.map((entity) => ({ ...entity })),
      species: scope.species.map((entity) => ({ ...entity })),
      backgrounds: scope.backgrounds.map((entity) => ({ ...entity })),
      originFeats: scope.originFeats.map((entity) => ({ ...entity })),
    }));
    expect(rebuilt).toBe(first);
  });
});

describe('free_origin_feat_choice_v1', () => {
  it('rejects zero, multiple and out-of-pool selections with stable codes', () => {
    const choose = (selectedOriginFeatIds: string[]) => resolveFreeOriginFeatChoice({
      backgroundId: 'background.soldier',
      selectedOriginFeatIds,
      allowedOriginFeatIds: ['feat.alert', 'feat.tough'],
    });
    for (const selection of [[], ['feat.alert', 'feat.tough']]) {
      try {
        choose(selection);
        throw new Error('expected BuildRuleError');
      } catch (error) {
        expect(error).toBeInstanceOf(BuildRuleError);
        expect((error as BuildRuleError).code).toBe('OriginFeatChoiceCount');
      }
    }
    try {
      choose(['feat.outside']);
      throw new Error('expected BuildRuleError');
    } catch (error) {
      expect((error as BuildRuleError).code).toBe('OriginFeatNotAllowed');
    }
  });

  it('keeps a species-granted Origin feat as a separate source', () => {
    const result = resolveFreeOriginFeatChoice({
      backgroundId: 'background.sage',
      officialBackgroundFeatId: 'feat.magic-initiate-wizard',
      selectedOriginFeatIds: ['feat.tough'],
      allowedOriginFeatIds: ['feat.tough'],
      speciesId: 'species.human',
      speciesGrantedOriginFeatIds: ['feat.skilled'],
    });
    expect(result.grants).toEqual([
      expect.objectContaining({ entityId: 'feat.tough', sourceType: 'product_rule' }),
      expect.objectContaining({ entityId: 'feat.skilled', sourceType: 'species', sourceId: 'species.human' }),
    ]);
  });
});
