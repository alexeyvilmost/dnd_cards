import { describe, expect, it } from 'vitest';
import { CROSSBOW_EXPERT_CAPABILITY, generalFeatRangedDeclaration, SHARPSHOOTER_CAPABILITY } from './generalFeatAttackDeclaration';

const actor = (capability?: string): any => ({ capabilities: { actionIds: [], featureSources: capability ? { [capability]: ['feat-id'] } : {} } });

describe('general feat ranged declaration', () => {
  it('applies all three Sharpshooter declaration exceptions only to ranged attacks', () => {
    expect(generalFeatRangedDeclaration({ actor: actor(SHARPSHOOTER_CAPABILITY), rangeKind: 'ranged', weaponName: 'Longbow', weaponType: 'longbow' }))
      .toEqual({ ignoreHalfAndThreeQuarterCover: true, ignoreLongRangeDisadvantage: true, ignoreAdjacentEnemyDisadvantage: true });
    expect(generalFeatRangedDeclaration({ actor: actor(SHARPSHOOTER_CAPABILITY), rangeKind: 'melee', weaponName: 'Dagger', weaponType: 'dagger' }).ignoreHalfAndThreeQuarterCover).toBe(false);
  });
  it('limits Crossbow Expert to adjacent-enemy disadvantage with crossbows', () => {
    expect(generalFeatRangedDeclaration({ actor: actor(CROSSBOW_EXPERT_CAPABILITY), rangeKind: 'ranged', weaponName: 'Тяжёлый арбалет', weaponType: 'heavy_crossbow' }))
      .toEqual({ ignoreHalfAndThreeQuarterCover: false, ignoreLongRangeDisadvantage: false, ignoreAdjacentEnemyDisadvantage: true });
    expect(generalFeatRangedDeclaration({ actor: actor(CROSSBOW_EXPERT_CAPABILITY), rangeKind: 'ranged', weaponName: 'Longbow', weaponType: 'longbow' }).ignoreAdjacentEnemyDisadvantage).toBe(false);
  });
});
