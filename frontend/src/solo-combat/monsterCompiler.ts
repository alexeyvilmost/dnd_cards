import {cardPropertyList} from '../utils/cardProperties';
import type { Action, PassiveEffect } from '../types';
import type {RuntimeState} from '../mvp/contracts';
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
  const actions = actionRows.flatMap((action) => {
    const projected = projectRuleAction(action!, {
    sourceEntityIds: [input.monster.id],
    });
    const effects = projected.mechanics.effects;
    if (!Array.isArray(effects) || effects.length < 2
      || !effects.every(effect => effect.resolution === 'attack_roll')) return [projected];
    // Each stat-block strike uses the common single-attack resolver. The
    // controller persists the tail instead of previewing/replaying all dice.
    const followUps = effects.slice(1).map((effect, index): RuleActionDefinition => ({
      ...projected, id: `${projected.id}:multiattack:${index + 2}`,
      mechanics: {...projected.mechanics, effects: [effect], npc_multiattack_followup: true,
        activation: {...(projected.mechanics.activation as Record<string, unknown>), cost: []}},
    }));
    return [{...projected, mechanics: {...projected.mechanics, effects: [effects[0]],
      npc_multiattack: {followUpActionIds: followUps.map(row => row.id)}}}, ...followUps];
  });
  const effects = input.monster.effect_ids.map((id) => input.effects.find((effect) => effect.id === id));
  if (effects.some((effect) => !effect)) {
    throw new Error(`У «${input.monster.name}» есть отсутствующий эффект`);
  }
  const scores = Object.fromEntries(
    ABILITIES.map((key) => [key, Number(input.monster.abilities[key] ?? 10)]),
  ) as Record<(typeof ABILITIES)[number], number>;
  const mods = Object.fromEntries(ABILITIES.map((key) => [key, abilityMod(scores[key])])) as typeof scores;
  const storedWeapon = input.monster.ai.held_weapon_card;
  const heldWeapon = storedWeapon ? {...storedWeapon, properties:cardPropertyList(storedWeapon.properties)} : undefined;
  if (heldWeapon && (!heldWeapon.id || heldWeapon.type !== 'weapon')) throw new Error('Некорректное оружие монстра');
  if(heldWeapon){
    actions.push({id:`${input.monster.id}:unarmed-fallback`,name:'Безоружный удар',kind:'nonSpell',sourceEntityIds:[input.monster.id],
      mechanics:{npc_unarmed_fallback:true,activation:{mode:'active',cost:[{resource:'action'}]},
        targeting:{domain:'actor',actor_targets:true,shape:'single',min_targets:1,max_targets:1,range_ft:5,requires_line_of_sight:true,allowed_relations:['enemy']},
        effects:[{resolution:'attack_roll',attack_kind:'unarmed',ability:'str',vs:'ac',attack_bonus_override:mods.str+input.monster.proficiency_bonus,
          on_hit:[{kind:'damage',amount:Math.max(0,1+mods.str),type:'bludgeoning'}]}]},
      targeting:{minTargets:1,maxTargets:1,rangeFt:5,requiresLineOfSight:true,allowedRelations:['enemy']}});
  }
  const runtime: RuntimeState = {
    hp: { current: input.monster.max_hp, max: input.monster.max_hp, temp: 0 },
    resources: { action: 1, bonus_action: 1, reaction: 1 },
    maxResources: { action: 1, bonus_action: 1, reaction: 1 },
    equipment: heldWeapon ? {main_hand: heldWeapon.id} : {},
    inventory: [], activeEffects: [],
  };
  const aiPassives: Record<string, unknown>[] = [
    { id: 'monster-ai-profile', kind: 'monster_ai', ...input.monster.ai },
    ...(input.monster.ai.pack_tactics ? [{
      id: 'monster-pack-tactics', kind: 'modifier', name: 'Тактика стаи', op: 'advantage',
      applies_to: {roll: 'attack', filter: {nearbyEligibleAllyToTarget: true}},
    }] : []),
    ...(input.monster.ai.bloodied_frenzy ? ['attack', 'saving_throw'].map(roll => ({
      id: `monster-bloodied-frenzy:${roll}`, kind: 'modifier', name: 'Ярость раненого',
      applies_to: {roll}, op: 'advantage', hp_fraction_at_most: 0.5,
    })) : []),
    ...(input.monster.ai.undead_fortitude ? [{
      id: 'monster-undead-fortitude', kind: 'zero_hp_save', name: 'Стойкость нежити',
      ability: 'con', dc_base: 5, remaining_hp: 1,
      except_damage_types: ['radiant'], except_critical: true,
    }] : []),
    ...(input.monster.ai.blindsight_ft ? [{
      id: 'monster-blindsight', kind: 'grant_sense', sense: 'blindsight',
      range: input.monster.ai.blindsight_ft,
    }] : []),
    ...(input.monster.ai.darkvision_ft ? [{
      id: 'monster-darkvision', kind: 'grant_sense', sense: 'darkvision',
      range: input.monster.ai.darkvision_ft,
    }] : []),
    ...(input.monster.ai.damage_immunities ?? []).map((damageType) => ({
      id: `monster-immunity:${damageType}`,
      kind: 'resistance', damage_type: damageType, value: 'immunity',
    })),
    ...(input.monster.ai.damage_vulnerabilities ?? []).map((damageType) => ({
      id: `monster-vulnerability:${damageType}`,
      kind: 'resistance', damage_type: damageType, value: 'vulnerability',
    })),
  ];
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
        creatureType: input.monster.creature_type,
        abilityScores: scores,
        abilityMods: mods,
        profBonus: input.monster.proficiency_bonus,
        level: 1,
        characterSpeed: input.monster.speed,
        baseSpeed: input.monster.speed,
        saveProficiencies: input.monster.ai.save_proficiencies ?? [],
        skillProficiencies: input.monster.ai.skill_proficiencies ?? [],
        skillExpertise: input.monster.ai.skill_expertise ?? [],
        ...(heldWeapon ? {knownCards: [heldWeapon], equippedCards: [heldWeapon]} : {}),
      },
      traits: { conditionImmunities: (input.monster.ai.condition_immunities ?? []).map((condition) => ({
        condition, sourceEntityIds: [input.monster.id],
      })) },
      runtime,
      passives: [
        ...effects.flatMap((effect) => effect?.mechanics ? [effect.mechanics] : []),
        ...aiPassives,
      ],
      attackProfile: {
        attacksPerAction: 1,
        size: SIZE_INDEX[input.monster.size] ?? 2,
        reachFt: Math.max(5, Number(input.monster.ai.reach_ft ?? 5)),
        graspingParts: [],
        sourceEntityIds: [input.monster.id],
      },
    },
  };
}
