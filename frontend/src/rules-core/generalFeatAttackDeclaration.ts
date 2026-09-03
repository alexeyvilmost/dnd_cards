import type { ActorState } from './domain';

export const SHARPSHOOTER_CAPABILITY = 'general_feat.sharpshooter';
export const CROSSBOW_EXPERT_CAPABILITY = 'general_feat.crossbow_expert';

export function generalFeatRangedDeclaration(input: {
  actor: ActorState;
  rangeKind: 'melee' | 'ranged';
  weaponName: string;
  weaponType: string;
}) {
  const sources = input.actor.capabilities.featureSources ?? {};
  const ranged = input.rangeKind === 'ranged';
  const sharpshooter = ranged && Boolean(sources[SHARPSHOOTER_CAPABILITY]);
  const crossbow = ranged && /crossbow|арбалет/iu.test(`${input.weaponName} ${input.weaponType}`)
    && Boolean(sources[CROSSBOW_EXPERT_CAPABILITY]);
  return {
    ignoreHalfAndThreeQuarterCover: sharpshooter,
    ignoreLongRangeDisadvantage: sharpshooter,
    ignoreAdjacentEnemyDisadvantage: sharpshooter || crossbow,
  };
}
