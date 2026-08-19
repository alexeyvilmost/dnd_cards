import type { Action, PassiveEffect } from '../types';
import { projectRuleAction } from '../canon/ruleActionProjection';
import type { ActorState, RuleActionDefinition } from '../rules-core/domain';
import type { Monster } from '../monsters/types';

const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;
const SIZE_INDEX: Record<string, number> = {
  tiny: 0, small: 1, medium: 2, large: 3, huge: 4, gargantuan: 5,
};

function abilityMod(score: number): number { return Math.floor((score - 10) / 2); }

export interface CompiledMonsterInstance {
  actor: ActorState;
  actions: RuleActionDefinition[];
}

export function compileMonsterInstance(input: {
  monster: Monster;
  instanceId: string;
  actions: readonly Action[];
  effects: readonly PassiveEffect[];
}): CompiledMonsterInstance {
  const actionRows = input.monster.action_ids.map((id) => input.actions.find((action) => action.id === id));
  if (actionRows.some((action) => !action)) {
    throw new Error(`У «${input.monster.name}» есть отсутствующее действие`);
  }
  const actions = actionRows.map((action) => projectRuleAction(action!, {
    sourceEntityIds: [input.monster.id],
  }));
  const effects = input.monster.effect_ids.map((id) => input.effects.find((effect) => effect.id === id));
  if (effects.some((effect) => !effect)) {
    throw new Error(`У «${input.monster.name}» есть отсутствующий эффект`);
  }
  const scores = Object.fromEntries(
    ABILITIES.map((key) => [key, Number(input.monster.abilities[key] ?? 10)]),
  ) as Record<(typeof ABILITIES)[number], number>;
  const mods = Object.fromEntries(ABILITIES.map((key) => [key, abilityMod(scores[key])])) as typeof scores;
  const runtime = {
    hp: { current: input.monster.max_hp, max: input.monster.max_hp, temp: 0 },
    resources: { action: 1, bonus_action: 1, reaction: 1 },
    maxResources: { action: 1, bonus_action: 1, reaction: 1 },
    equipment: {}, inventory: [], activeEffects: [],
  };
  return {
    actions,
    actor: {
      id: input.instanceId,
      name: input.monster.name,
      kind: 'monster',
      controllerId: 'solo-combat:monster-ai',
      ac: input.monster.armor_class,
      capabilities: { actionIds: actions.map((action) => action.id).sort() },
      character: {
        abilityScores: scores,
        abilityMods: mods,
        profBonus: input.monster.proficiency_bonus,
        level: 1,
        characterSpeed: input.monster.speed,
        baseSpeed: input.monster.speed,
        saveProficiencies: [], skillProficiencies: [], skillExpertise: [],
      },
      runtime,
      passives: effects.flatMap((effect) => effect?.mechanics ? [effect.mechanics] : []),
      attackProfile: {
        attacksPerAction: 1,
        size: SIZE_INDEX[input.monster.size] ?? 2,
        reachFt: 5,
        graspingParts: [],
        sourceEntityIds: [input.monster.id],
      },
    },
  };
}
