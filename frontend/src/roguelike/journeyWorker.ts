import type {ForgeCharacter} from '../character/types';
import type {EngineEvent, RollLog} from '../mvp/contracts';
import type {Ability, GameCommand, WorldState, UncommittedRuleEvent, RuleAutomaticHazardDefinition} from '../rules-core/domain';
import {handleCommand} from '../rules-core/handler';
import {availableRollInfluences, spendRollInfluence, withD20Replacement, type RollInfluence} from '../engine/rollInfluence';
import {prepareRoguelikeCombatParticipant, type FrozenCombatCatalog} from './combatCatalog';
import {createRoguelikeCombatRandom} from './combatWorker';
import {runtimeInventoryPayload, writeRulesEngineRuntimeTurnState} from '../character/runtime';
import {writeSheetCanonicalWorld} from '../character/sheetCanonicalWorld';
import {mergeSheetCombatParticipantWorlds} from '../character/sheetCombatSession';
import {projectSheetCompanionParticipantWorld} from '../character/sheetCompanionInteraction';
import {settleJourneyAuras} from '../engine/journeyAuras';

interface Check {ability: Ability; skill: string; dc: number}
interface Envelope {
  version: 1; before: WorldState; after: WorldState; roll: RollLog;
  values: number[]; cursor: number; influenced: boolean;
  phase: 'influence'|'boost'|'resolved';
}
type Input = {character: ForgeCharacter; catalog: FrozenCombatCatalog; seed: string; commandId: string;
  check: Check; envelope?: Envelope; resolve?: boolean; effectId?: string};
function engineEvents(events: UncommittedRuleEvent[]): EngineEvent[] {
  return events.flatMap(e=>e.payload.type==='EngineEventRecorded'?[e.payload.event]:[]);
}
function resultRoll(events: EngineEvent[], fallback?: RollLog): RollLog {
  const event=[...events].reverse().find(e=>e.type==='roll');
  if(event?.type==='roll')return {...event.roll,kind:'d20'};
  if(fallback)return fallback;
  throw Error('Проверка не создала бросок');
}
function patch(character: ForgeCharacter, canonical: Extract<Awaited<ReturnType<typeof prepareRoguelikeCombatParticipant>>,{status:'ready'}>['participant']['canonical'],world: WorldState) {
  const rt=world.actors[character.id].runtime;
  const turn=writeSheetCanonicalWorld(character.turn_state,character.id,world,canonical.resourceBindings);
  return {current_hp:rt.hp.current,resources:rt.resources,max_resources:rt.maxResources,active_effects:rt.activeEffects,
    inventory_items:runtimeInventoryPayload(rt),equipment:rt.equipment,
    turn_state:writeRulesEngineRuntimeTurnState(turn,rt),runtime_revision:Number(character.runtime_revision)+1};
}

/** Persistable held check. Catalog, seed and envelope stay behind the API.
 * Replays use the common command handler; only the selected d20 is replaced. */
export async function executeJourneyCheck(input: Input) {
  const prepared=await prepareRoguelikeCombatParticipant(input.character,input.catalog,[]);
  if(prepared.status!=='ready')return prepared;
  const canonical=prepared.participant.canonical;
  const sources=canonical.actions.map(a=>({id:a.id,name:a.name,...a.mechanics}));
  const random=createRoguelikeCombatRandom(input.seed,input.envelope?.cursor??0);
  let serial=0;
  const environment=(rng:()=>number)=>({rng,clock:()=>0,nextId:()=>`${input.commandId}:${serial++}`});
  const execute=(world:WorldState,command:Partial<GameCommand>,rng:()=>number)=>{
    const result=handleCommand(world,{schemaVersion:1,commandId:input.commandId,actorId:input.character.id,
      expectedRevision:world.revision,rulesetContentHash:world.ruleset.contentHash,...command} as GameCommand,canonical.catalog,environment(rng));
    if(result.status!=='accepted')throw Error(result.message);
    return result;
  };
  let e:Envelope;
  let events:EngineEvent[]=[];
  if(!input.envelope){
    const before=structuredClone(canonical.world);
    const result=execute(before,{type:'AbilityCheck',...input.check},random.rng);
    events=engineEvents(result.events);
    e={version:1,before,after:result.nextState,roll:resultRoll(events),values:[...random.randomValues],cursor:random.cursor,influenced:false,phase:'influence'};
  }else{
    e=structuredClone(input.envelope);
    if(e.version!==1||e.phase==='resolved'||!input.resolve)throw Error('Проверка уже завершена');
    if(e.phase==='influence'){
      if(input.effectId){
        const rt=e.before.actors[input.character.id].runtime;
        const influence=availableRollInfluences(rt,sources,'check',e.roll).find(a=>a.id===input.effectId);
        if(!influence||e.influenced)throw Error('Воздействие недоступно');
        e.before.actors[input.character.id].runtime=spendRollInfluence(rt,influence).state;
        const replacement=1+Math.floor(random.rng()*20);let cursor=0;
        const result=execute(e.before,{type:'AbilityCheck',...input.check},withD20Replacement(()=>e.values[cursor++]??random.rng(),replacement,influence.name));
        e.after=result.nextState;events=engineEvents(result.events);e.roll=resultRoll(events);e.influenced=true;
      }
      e.phase=e.after.pendingResolution?.type==='check_boost'?'boost':'resolved';
    }else{
      const pending=e.after.pendingResolution;
      if(pending?.type!=='check_boost')throw Error('Нет ожидающей проверки');
      const result=execute(e.after,{type:'ResolveDecision',resolutionId:pending.id,requestId:pending.request.id,
        response:{kind:'reaction',actionId:input.effectId||null}},random.rng);
      e.after=result.nextState;events=engineEvents(result.events);e.roll=resultRoll(events,e.roll);e.phase='resolved';
    }
  }
  e.cursor=random.cursor;
  let influences:RollInfluence[]=[];
  if(e.phase==='influence')influences=availableRollInfluences(e.before.actors[input.character.id].runtime,sources,'check',e.roll);
  if(e.phase==='boost'&&e.after.pendingResolution?.type==='check_boost'){
    influences=e.after.pendingResolution.request.options.flatMap(option=>{
      const action=canonical.actions.find(a=>a.id===option.actionId);if(!action)return [];
      return [{id:action.id,name:action.name,description:String(action.mechanics.description??'После провала проверки'),mechanics:action.mechanics,
        operation:'reroll_kept_d20' as const,cost:[]}];
    });
  }
  return {status:'ready' as const,envelope:e,public:{roll:e.roll,phase:e.phase,influences},events,
    ...(e.phase==='resolved'?{patch:patch(input.character,canonical,e.after)}:{})};
}

/** Event consequences are catalog-owned automatic hazards, the same primitive
 * used by terrain: resistance, temporary HP and reduced-to-zero triggers apply. */
export async function executeJourneyEffect(input:{character:ForgeCharacter;characters?:ForgeCharacter[];catalog:FrozenCombatCatalog;seed:string;commandId:string;hazard:RuleAutomaticHazardDefinition}){
  const prepared=await prepareRoguelikeCombatParticipant(input.character,input.catalog,[]);
  if(prepared.status!=='ready')return prepared;
  const canonical={...prepared.participant.canonical};
  const participants=[prepared.participant];
  for(const character of input.characters??[]){
    if(character.id===input.character.id)continue;
    const ally=await prepareRoguelikeCombatParticipant(character,input.catalog,[]);
    if(ally.status!=='ready')return ally;
    participants.push(ally.participant);
  }
  if(participants.length>1)canonical.world=mergeSheetCombatParticipantWorlds({seeds:participants,ruleset:canonical.world.ruleset,worldId:`journey:${input.character.id}`,sceneMode:'exploration'});
  const random=createRoguelikeCombatRandom(input.seed,0);let serial=0;
  const catalog={...canonical.catalog,getHazard:(id:string)=>id===input.hazard.id?input.hazard:undefined};
  const result=handleCommand(canonical.world,{schemaVersion:1,commandId:input.commandId,actorId:input.character.id,
    expectedRevision:canonical.world.revision,rulesetContentHash:canonical.world.ruleset.contentHash,
    type:'TriggerHazard',hazardId:input.hazard.id,targetActorId:input.character.id},catalog,{rng:random.rng,clock:()=>0,nextId:()=>`${input.commandId}:${serial++}`});
  if(result.status!=='accepted')throw Error(result.message);
  if(result.nextState.pendingResolution)throw Error('Событие требует решения');
  const survival=settleJourneyAuras(result.nextState,participants.map(p=>p.character.id),'last_conscious',random.rng,input.character.id);
  const patches=Object.fromEntries(participants.map(p=>{
    const world=participants.length>1?projectSheetCompanionParticipantWorld({participant:p,mergedBefore:canonical.world,mergedAfter:survival.world,commandId:input.commandId}):survival.world;
    return [p.character.id,patch(p.character,p.canonical,world)];
  }));
  return {status:'ready' as const,patch:patches[input.character.id],patches,events:[...engineEvents(result.events),...survival.records.flatMap(r=>r.events)]};
}
