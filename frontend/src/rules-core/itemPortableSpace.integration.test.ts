import {describe,expect,it} from 'vitest';
import {createWorld,type ActorState,type GameCommand} from './domain';
import {handleCommand} from './handler';
import {foldEvents} from './reducer';
import {migrateWorldState} from './worldMigration';
import {createSequentialIdFactory,createStrictRngTape} from './determinism';
import {projectRuleAction} from '../canon/ruleActionProjection';
import type {Action} from '../types';
import related from '../../../scripts/content/data/item-completion-high-related-20260929.json';
import cards from '../../../outputs/catalog-completion-20260929/cards.json';
import {buildSheetWorldInput,initialSheetWorldInputDraft,sheetWorldInputFormContext} from '../character/sheetWorldInputForm';
import type {SheetCanonicalRuntime} from '../character/sheetCanonicalWorld';
import {parseItemTool} from './itemTools';

const ruleset={systemId:'dnd5e-2024' as const,releaseId:'portable-space',contentHash:'portable-space',errataVersion:'2024'};
const item={...cards.find(card=>card.card_number==='CARD-0856')!,mechanics:{activation:{mode:'passive',while:'carried'}}};
const actions=Object.fromEntries(['open','close','enter','exit','store','retrieve'].map(key=>[key,projectRuleAction(related.entities.find(row=>row.card_number===`ACT-item-completion-high-856-${key}`)!.patch as unknown as Action)]));
function actor(id:string):ActorState{return {id,name:id,kind:'playerCharacter',controllerId:id,ac:10,capabilities:{actionIds:id==='owner'?Object.values(actions).map(action=>action.id):[]},
  character:{level:1,profBonus:2,abilityMods:{str:0,dex:0,con:0,int:0,wis:0,cha:0},knownCards:[item as never]},runtime:{hp:{current:10,max:10,temp:0},resources:{action:12},maxResources:{action:12},inventory:id==='owner'?[{cardId:item.id,qty:1}]:[],equipment:{},activeEffects:[]}};}
const catalog={getAction:(id:string)=>Object.values(actions).find(action=>action.id===id)};
function command(world:ReturnType<typeof createWorld>,id:string,key:string,actorId='owner',containedObjectId?:string):GameCommand{return {schemaVersion:1,type:'UseAction',commandId:id,actorId,expectedRevision:world.revision,rulesetContentHash:ruleset.contentHash,actionId:actions[key].id,targetIds:[],
  worldInput:{type:'item_tool',objectId:'hole',containedObjectId,description:'Разложенная ткань',facts:{factsSource:'scenario',boardRevision:0,distanceFt:0,containedObjectDistanceFt:0,lineOfSight:true}}};}
function use(world:ReturnType<typeof createWorld>,id:string,key:string,actorId='owner',rolls:number[]=[],containedObjectId?:string){
  const tape=createStrictRngTape(rolls.map(value=>({label:'athletics',sides:20,value}))),env={rng:tape.rng,nextId:createSequentialIdFactory(id),clock:()=>1};
  const cmd=command(world,id,key,actorId,containedObjectId),result=handleCommand(world,cmd,catalog,env);
  if(result.status!=='accepted')throw Error(`${result.code}: ${result.message}`);
  expect(foldEvents(world,result.events)).toEqual(result.nextState);
  tape.assertExhausted();return {state:migrateWorldState(JSON.parse(JSON.stringify(result.nextState))),cmd,env,events:result.events};
}
describe('portable-space physical object',()=>{
  it('opens one instance, admits another actor, keeps the occupant while folded, and permits a DC 10 escape',()=>{
    const world=createWorld({id:'portable',ruleset,actors:[actor('owner'),actor('guest')]});
    const form=sheetWorldInputFormContext({runtime:{world,actorId:'owner'} as SheetCanonicalRuntime,action:actions.open})!;
    const draft=initialSheetWorldInputDraft(form,'hole');
    expect(draft.newObjectProfile).toBe('portable_space');
    const prepared=buildSheetWorldInput(form,{...draft,createObject:true,newObjectName:'Дыра'});
    expect(prepared.issues).toEqual([]);
    world.objects.hole=prepared.result!.scenarioObjects[0];
    const opened=use(world,'open-1','open');
    expect(opened.state.objects.hole.portableSpace).toMatchObject({open:true,diameterFt:6,depthFt:10,exitDistanceFt:5,occupantActorIds:[]});
    expect(opened.state.actors.owner.runtime.inventory.find(row=>row.cardId===item.id)?.qty??0).toBe(0);
    expect(handleCommand(opened.state,opened.cmd,catalog,opened.env).status).toBe('rejected');
    expect(opened.state.objects.hole.planeId).toBe(opened.state.actors.guest.planeId??'material');
    const entered=use(opened.state,'guest-enter','enter','guest');
    expect(entered.state.actors.guest.planeId).toBe('portable-space:hole');
    expect(entered.state.objects.hole.portableSpace?.occupantActorIds).toEqual(['guest']);
    const closed=use(entered.state,'close-1','close');
    expect(closed.state.objects.hole.portableSpace?.open).toBe(false);
    expect(closed.state.objects.hole.portableSpace?.occupantActorIds).toEqual(['guest']);
    const failed=use(closed.state,'escape-fail','exit','guest',[4]);
    expect(failed.state.actors.guest.planeId).toBe('portable-space:hole');
    const escaped=use(failed.state,'escape-success','exit','guest',[16]);
    expect(escaped.state.actors.guest.planeId).toBe('material');
    expect(escaped.state.objects.hole.portableSpace?.occupantActorIds).toEqual([]);
    expect(escaped.events.find(event=>event.payload.type==='ActorPlaneChanged')?.payload).toMatchObject({type:'ActorPlaneChanged',exitDistanceFt:5});
    const reopened=use(escaped.state,'open-2','open');
    expect(reopened.state.objects.hole.portableSpace?.open).toBe(true);
    expect(reopened.state.actors.owner.runtime.inventory.find(row=>row.cardId===item.id)?.qty??0).toBe(0);
  });
  it('uses other portable-space dimensions and escape DC from data rather than an item identity',()=>{
    const alternate={...actions.open,mechanics:{...actions.open.mechanics,requires_item_source:'other-space',primitive:{type:'item_tool',policy:{...parseItemTool(actions.open.mechanics),item_card_id:'other-space',diameter_ft:12,depth_ft:4,exit_distance_ft:10}}}};
    expect(parseItemTool(alternate.mechanics)).toMatchObject({diameter_ft:12,depth_ft:4,exit_distance_ft:10});
    const world=createWorld({id:'other-space',ruleset,actors:[actor('owner')]});
    const form=sheetWorldInputFormContext({runtime:{world,actorId:'owner'} as SheetCanonicalRuntime,action:alternate})!;
    const draft=initialSheetWorldInputDraft(form,'other-hole');
    const prepared=buildSheetWorldInput(form,{...draft,createObject:true,newObjectName:'Другая дыра'});
    expect(prepared.issues).toEqual([]);
    expect(prepared.result?.scenarioObjects[0]).toMatchObject({itemCardId:'other-space',portableSpace:{diameterFt:12,depthFt:4,exitDistanceFt:10}});
    const alternateStore={...actions.store,id:'alternate-store',sourceEntityIds:['other-space'] as [string],
      mechanics:{...actions.store.mechanics,requires_item_source:'other-space',primitive:{type:'item_tool',policy:{...parseItemTool(actions.store.mechanics),item_card_id:'other-space'}}}};
    world.actors.owner.capabilities.actionIds.push(alternateStore.id);
    world.objects['other-hole']={...prepared.result!.scenarioObjects[0],ownerActorId:'owner',grantsToOwner:true,
      grantedActionRefs:[alternateStore.id],portableSpace:{...prepared.result!.scenarioObjects[0].portableSpace!,open:true}};
    world.objects.bead={id:'bead',name:'Бусина',kind:'item',size:'tiny',planeId:'material',unattended:true};
    const cmd:GameCommand={schemaVersion:1,type:'UseAction',commandId:'alternate-store-1',actorId:'owner',expectedRevision:world.revision,
      rulesetContentHash:ruleset.contentHash,actionId:alternateStore.id,targetIds:[],worldInput:{type:'item_tool',objectId:'other-hole',
        containedObjectId:'bead',description:'',facts:{factsSource:'scenario',boardRevision:0,distanceFt:0,containedObjectDistanceFt:0,lineOfSight:true}}};
    const result=handleCommand(world,cmd,{getAction:id=>id===alternateStore.id?alternateStore:undefined},
      {rng:()=>{throw Error('no RNG')},nextId:createSequentialIdFactory('alternate'),clock:()=>1});
    expect(result.status).toBe('accepted');
    if(result.status==='accepted'){
      expect(result.nextState.objects['other-hole'].portableSpace?.containedObjectIds).toEqual(['bead']);
      expect(result.nextState.objects.bead.containedByObjectId).toBe('other-hole');
    }
  });
  it('stores two physical objects in one open instance and retrieves each atomically after closing and reopening',()=>{
    const world=createWorld({id:'portable-objects',ruleset,actors:[actor('owner')],objects:[
      {id:'hole',name:'Дыра',kind:'item',size:'medium',itemCardId:item.id,planeId:'material',portableSpace:{open:false,diameterFt:6,depthFt:10,exitDistanceFt:5,occupantActorIds:[],containedObjectIds:[]}},
      {id:'coin',name:'Монета',kind:'item',size:'tiny',planeId:'material',unattended:true},
      {id:'rope',name:'Верёвка',kind:'item',size:'small',planeId:'material',unattended:true},
    ]});
    const opened=use(world,'open','open').state;
    const coin=use(opened,'store-coin','store','owner',[],'coin');
    expect(coin.events.some(event=>event.payload.type==='WorldObjectMutationRecorded'&&event.payload.event.type==='WorldObjectsPatched')).toBe(true);
    expect(coin.state.objects.hole.portableSpace?.containedObjectIds).toEqual(['coin']);
    expect(coin.state.objects.coin).toMatchObject({containedByObjectId:'hole',planeId:'portable-space:hole'});
    expect(handleCommand(coin.state,coin.cmd,catalog,coin.env).status).toBe('rejected');
    const rope=use(coin.state,'store-rope','store','owner',[],'rope').state;
    expect(rope.objects.hole.portableSpace?.containedObjectIds).toEqual(['coin','rope']);
    const closed=use(rope,'close','close').state;
    expect(closed.objects.hole.portableSpace?.containedObjectIds).toEqual(['coin','rope']);
    const reopened=use(closed,'reopen','open').state;
    const taken=use(reopened,'retrieve-coin','retrieve','owner',[],'coin').state;
    expect(taken.objects.hole.portableSpace?.containedObjectIds).toEqual(['rope']);
    expect(taken.objects.coin.containedByObjectId).toBeUndefined();
    expect(taken.objects.coin.planeId).toBe('material');
    const emptied=use(taken,'retrieve-rope','retrieve','owner',[],'rope').state;
    expect(emptied.objects.hole.portableSpace?.containedObjectIds).toEqual([]);
    expect(emptied.objects.rope.containedByObjectId).toBeUndefined();
  });
});
