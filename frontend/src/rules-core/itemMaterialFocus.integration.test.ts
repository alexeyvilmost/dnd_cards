import {describe,expect,it} from 'vitest';
import {createWorld,type ActorState,type GameCommand,type RuleActionDefinition} from './domain';
import {itemMaterialFocus} from './itemMaterialFocus';
import {handleCommand} from './handler';
import type {Card} from '../types';
const ruleset={systemId:'dnd5e-2024' as const,releaseId:'focus',contentHash:'focus',errataVersion:'2024'};
describe('item spell material foci',()=>{
  it.each([['symbol',['cleric']],['pouch',undefined]] as const)('records %s source without removing costly materials or somatic components', (id,classes)=>{
    const card={id,name:id,mechanics:{activation:{mode:'passive',while:'carried'},spell_focus:{costless_materials:true,...(classes?{class_ids:classes}:{})},effects:[]}} as unknown as Card;
    const actor:ActorState={id:'hero',name:'Hero',kind:'playerCharacter',controllerId:'hero',capabilities:{actionIds:['spell']},character:{abilityMods:{str:0,dex:0,con:0,int:0,wis:0,cha:0},profBonus:2,level:1,knownCards:[card]},
      runtime:{hp:{current:1,max:1,temp:0},resources:{action:1},maxResources:{action:1},equipment:{},activeEffects:[],inventory:[{cardId:id,qty:1},{cardId:'priced-diamond',qty:1}]}};
    const spell:RuleActionDefinition={id:'spell',name:'Spell',kind:'spell',sourceEntityIds:['spell'],spell:{level:0,sourceClass:'cleric',components:{verbal:true,somatic:true,material:true}},
      mechanics:{activation:{mode:'active',cost:[{resource:'action',amount:1},{resource:'item',card_id:'priced-diamond',amount:1}]},effects:[]}};
    expect(itemMaterialFocus(actor,spell)?.cardId).toBe(id);
    expect(itemMaterialFocus(actor,{...spell,spell:{...spell.spell,sourceClass:'wizard'}})?.cardId).toBe(classes?undefined:id);
    const world=createWorld({id:'focus',ruleset,actors:[actor]}),command:GameCommand={schemaVersion:1,type:'UseAction',commandId:'cast',actorId:'hero',expectedRevision:0,rulesetContentHash:ruleset.contentHash,actionId:'spell',targetIds:[]};
    const env={rng:()=>{throw Error('Unexpected RNG');},nextId:()=>'',clock:()=>1},catalog={getAction:()=>spell};
    const result=handleCommand(world,command,catalog,env);if(result.status!=='accepted')throw Error(result.message);
    expect(result.nextState.actors.hero.runtime.inventory.find(row=>row.cardId==='priced-diamond')?.qty??0).toBe(0);
    const audit=result.events.filter(event=>event.payload.type==='EngineEventRecorded'&&event.payload.event.type==='world_interaction'&&event.payload.event.operation==='spell_material_focus');
    expect(audit).toHaveLength(1);expect(JSON.stringify(audit)).toContain('"somatic":true');
    expect(handleCommand(JSON.parse(JSON.stringify(result.nextState)),command,catalog,env).status).toBe('rejected');
    actor.runtime.inventory=[];expect(itemMaterialFocus(actor,spell)).toBeNull();
  });
});
