import {describe,expect,it} from 'vitest';
import {createWorld,type ActorState} from '../rules-core/domain';
import {projectRuleAction} from '../canon/ruleActionProjection';
import type {Action} from '../types';
import related from '../../../scripts/content/data/item-completion-high-related-20260929.json';
import cards from '../../../outputs/catalog-completion-20260929/cards.json';
import {executeCombatAction} from './engine';
import {gridDistanceFt} from './tacticalGrid';
import type {SoloCombatState} from './types';

const item=cards.find(card=>card.card_number==='CARD-0856')!;
const actions=Object.fromEntries(['store','retrieve','exit'].map(key=>[key,projectRuleAction(
  related.entities.find(row=>row.card_number===`ACT-item-completion-high-856-${key}`)!.patch as unknown as Action,
)]));
function actor(id:string,inside=false):ActorState{return {
  id,name:id,kind:'playerCharacter',controllerId:id,ac:10,
  capabilities:{actionIds:Object.values(actions).map(action=>action.id)},
  planeId:inside?'portable-space:hole':'material',
  character:{level:1,profBonus:2,abilityMods:{str:0,dex:0,con:0,int:0,wis:0,cha:0}},
  runtime:{hp:{current:12,max:12,temp:0},resources:{action:5},maxResources:{action:5},inventory:[],equipment:{},activeEffects:[]},
};}
function setup(inside=false):SoloCombatState{
  const world=createWorld({id:'portable-board',ruleset:{systemId:'dnd5e-2024',releaseId:'test',contentHash:'test',errataVersion:'test'},
    actors:[actor('hero',inside),actor('other')],objects:[
      {id:'hole',name:'Дыра',kind:'item',size:'medium',itemCardId:item.id,ownerActorId:'hero',grantsToOwner:true,
        grantedActionRefs:Object.values(actions).map(action=>action.id),planeId:'material',portableSpace:{open:true,diameterFt:6,depthFt:10,exitDistanceFt:5,
          occupantActorIds:inside?['hero']:[],containedObjectIds:[]}},
      {id:'coin',name:'Монета',kind:'item',size:'tiny',planeId:'material',unattended:true},
    ]});
  world.scene={mode:'encounter',round:1,activeIndex:0,initiative:['hero','other'],turnStarted:true};
  return {schemaVersion:1,deathSavesVersion:1,routeCommandVersion:1,characterId:'hero',controlledCharacterIds:['hero'],runtimeRevision:0,world,
    tokens:{hero:{actorId:'hero',position:{x:2,y:1}},other:{actorId:'other',position:{x:11,y:9}}},sideByActorId:{hero:'party',other:'enemy'},
    combatAreas:{},boardRevision:7,worldObjectPositions:{hole:{x:2,y:2},coin:{x:3,y:2}},
    catalogActions:Object.values(actions),playerActionIds:Object.values(actions).map(action=>action.id),certifiedPlayerActionIds:[],
    opportunityActionIds:{},movementRemainingFt:{hero:30,other:30},log:[],outcome:'active',actionPresentation:{},
  } as unknown as SoloCombatState;
}
const worldInput=(containedObjectId?:string)=>({type:'item_tool' as const,objectId:'hole',containedObjectId,description:'',
  facts:{factsSource:'scenario' as const,boardRevision:0,distanceFt:0,containedObjectDistanceFt:0,lineOfSight:true}});

describe('portable-space board consequences',()=>{
  it('binds both object distances to the board, hides stored objects, and restores them next to the same hole',()=>{
    const far=setup();far.worldObjectPositions!.coin={x:8,y:8};
    expect(()=>executeCombatAction({state:far,actorId:'hero',actionId:actions.store.id,targetIds:[],worldInput:worldInput('coin')})).toThrow(/досягаемости/);
    expect(far.world.actors.hero.runtime.resources.action).toBe(5);
    const initial=setup();
    const stored=executeCombatAction({state:initial,actorId:'hero',actionId:actions.store.id,targetIds:[],worldInput:worldInput('coin')});
    expect(stored.world.objects.coin.containedByObjectId).toBe('hole');
    expect(stored.worldObjectPositions?.coin).toBeUndefined();
    const retrieved=executeCombatAction({state:JSON.parse(JSON.stringify(stored)),actorId:'hero',actionId:actions.retrieve.id,targetIds:[],worldInput:worldInput('coin')});
    expect(retrieved.world.objects.coin.containedByObjectId).toBeUndefined();
    expect(retrieved.worldObjectPositions?.coin).toEqual({x:2,y:2});
    expect(retrieved.world.actors.hero.runtime.resources.action).toBe(3);
  });
  it('rejects a remote exit cell before payment and places a successful escape in a free cell within five feet',()=>{
    const initial=setup(true);
    initial.world.objects.hole.portableSpace!.open=false;
    expect(()=>executeCombatAction({state:initial,actorId:'hero',actionId:actions.exit.id,targetIds:[],worldInput:worldInput(),worldPosition:{x:8,y:8},rng:()=>0.9})).toThrow(/свободной клетки/);
    expect(initial.world.actors.hero.runtime.resources.action).toBe(5);
    const escaped=executeCombatAction({state:initial,actorId:'hero',actionId:actions.exit.id,targetIds:[],worldInput:worldInput(),rng:()=>0.9});
    expect(escaped.world.actors.hero.planeId).toBe('material');
    expect(gridDistanceFt({x:2,y:2},escaped.tokens.hero.position)).toBeLessThanOrEqual(5);
    expect(escaped.tokens.hero.position).not.toEqual(escaped.tokens.other.position);
    expect(escaped.world.actors.hero.runtime.resources.action).toBe(4);
  });
});
