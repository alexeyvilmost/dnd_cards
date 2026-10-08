import {describe, expect, it} from 'vitest';
import repair from '../../../scripts/content/healing-recipient-repair.json';
import cureWounds from './fixtures/healingRecipient.json';
import {actorHasConsciousVitality} from '../engine/lifePolicies';
import {createWorld, type ActorState, type RuleActionDefinition} from '../rules-core/domain';
import type {SoloCombatState} from '../solo-combat/types';
import {stepRoguelikeCombat, type RoguelikeCombatEnvelope} from './combatWorker';

const hash = `sha256:${'e'.repeat(64)}`;
const healingWord = repair.spells.find(spell => spell.card_number === 'SPELL-0213')!;

describe('healing the selected unconscious ally', () => {
  it.each([
    ['Healing Word', healingWord.after],
    ['Cure Wounds', cureWounds.mechanics],
  ] as const)('%s restores hits and death saves, spends once, and replays identically', (_label, mechanics) => {
    const slotLevel = mechanics.activation.cost.find(cost => cost.resource === 'spell_slot')!.level!;
    const slotKey = `spell_slot_${slotLevel}`;
    const action = {spell:{level:slotLevel,ritual:false,components:{verbal:false,somatic:false,material:false}},id:'healing-action',kind:'spell',name:_label,sourceEntityIds:['healing-entity'],mechanics,
      targeting:{minTargets:1,maxTargets:1,rangeFt:60,allowedRelations:['self','ally'],requiresLineOfSight:false}} as unknown as RuleActionDefinition;
    const actors = ['caster','ally','enemy'].map((id):ActorState => ({id,name:id,controllerId:id,kind:id==='enemy'?'monster':'playerCharacter',ac:12,
      capabilities:{actionIds:id==='caster'?[action.id]:[]},
      ...(id==='caster'?{spellcastingAccess:{grants:[{grantId:'test-grant',actionId:action.id,sourceId:'test-class',access:'known' as const,level:slotLevel,slotResource:slotKey}],preparedSources:{}}}:{}),
      character:{baseSpeed:30,level:13,profBonus:2,spellcastingMod:3,abilityMods:{str:0,dex:0,con:0,int:0,wis:0,cha:3}},
      runtime:{hp:{current:id==='ally'?0:10,max:30,temp:0},resources:{action:1,bonus_action:1,reaction:1,[slotKey]:1},maxResources:{action:1,bonus_action:1,reaction:1,[slotKey]:1},inventory:[],equipment:{},
        activeEffects:[],
        ...(id==='ally'?{deathSaves:{successes:1,failures:2,dead:false,stable:false}}:{})}}));
    const world=createWorld({id:'healing-test',ruleset:{systemId:'dnd5e-2024',releaseId:'test',contentHash:'test',errataVersion:'test'},actors});
    world.scene={mode:'encounter',round:1,initiative:['caster','ally','enemy'],activeIndex:0,turnStarted:true};
    const state={schemaVersion:1,characterId:'caster',controlledCharacterIds:['caster','ally'],runtimeRevision:0,world,log:[],outcome:'active',deathSavesVersion:1,
      tokens:{caster:{actorId:'caster',position:{x:1,y:1}},ally:{actorId:'ally',position:{x:2,y:1}},enemy:{actorId:'enemy',position:{x:8,y:8}}},sideByActorId:{caster:'party',ally:'party',enemy:'enemy'},
      movementRemainingFt:{caster:30},boardRevision:0,combatAreas:{},catalogActions:[action],playerActionIds:[action.id],certifiedPlayerActionIds:[action.id],actionPresentation:{}} as unknown as SoloCombatState;
    const before:RoguelikeCombatEnvelope={schemaVersion:1,artifactHash:hash,entropy:{seed:'healing-recipient',cursor:0},state};
    const intent={type:'action' as const,actorId:'caster',actionId:action.id,targetIds:['ally'],worldPosition:{x:2,y:1}};
    expect(actorHasConsciousVitality(before.state.world.actors.ally)).toBe(false);
    const saved=JSON.stringify(before),first=stepRoguelikeCombat(before,intent,hash);
    expect(first.envelope.state.world.actors.ally.runtime.hp.current).toBeGreaterThan(0);
    expect(first.envelope.state.world.actors.ally.runtime.deathSaves).toEqual({successes:0,failures:0,dead:false,stable:false});
    expect(actorHasConsciousVitality(first.envelope.state.world.actors.ally)).toBe(true);
    expect(first.envelope.state.world.actors.caster.runtime.hp).toEqual(before.state.world.actors.caster.runtime.hp);
    expect(first.envelope.state.world.actors.caster.runtime.resources[slotKey]).toBe(0);
    expect(JSON.stringify(before)).toBe(saved);
    expect(stepRoguelikeCombat(JSON.parse(saved),intent,hash)).toEqual(first);
    const settled=JSON.stringify(first.envelope);
    expect(()=>stepRoguelikeCombat(first.envelope,intent,hash)).toThrow();
    expect(JSON.stringify(first.envelope)).toBe(settled);
  });
});
