import {describe,it,expect} from 'vitest';
import {combatBeatAudioPlan} from './combatSounds';
import {builtInAudioCatalog,type AudioCatalog,type AudioCue} from './catalog';
import type {SoloCombatState} from '../solo-combat/types';
import type {CombatBeat} from '../solo-combat/presentation';
import type {CombatAnimationProfile} from '../solo-combat/animationProfiles';
const cue=(key:string):AudioCue=>({key,name:key,url:`/${key}.mp3`,channel:'effects',gain:1,loop:false,license:'test',version:2});
const profile=(key='arbitrary.profile',primitive:CombatAnimationProfile['primitive']='projectile'):CombatAnimationProfile=>({key,primitive,motion:{durationMs:1000,scale:1},palette:{primary:'#fff',secondary:'#aaa'},casterCircle:false});
const beat:CombatBeat={id:'one:0',sourceEntryId:'one',sourceId:'hero',sourceName:'Hero',actionName:'Anything',actionId:'ability',entityRef:{kind:'action',id:'source'},animation:profile(),cues:[{actorId:'enemy',kind:'damage',text:'4'}]};
const state={world:{id:'encounter'},log:[],actionPresentation:{ability:{entityType:'action',entityId:'changed-current-entity'}}} as unknown as SoloCombatState;
const catalog:AudioCatalog={cues:['charge','launch','hit','miss','heal','activate','custom-one','custom-two'].map(cue),bindings:[],can_manage:false,profiles:{'arbitrary.profile':{launch:'launch',hit:'hit',miss:'miss',healing:'heal'}}};
const plan=(value:CombatBeat=beat,data=catalog)=>combatBeatAudioPlan(state,value,data);

describe('accepted combat audio phases',()=>{
 it('shares visual release/contact markers instead of playing the complete attack at once',()=>{
  expect(plan()).toEqual([{key:'launch',eventId:'combat:encounter:one:0:source:launch',delayMs:96.8},{key:'hit',eventId:'combat:encounter:one:0:one:0:hit',delayMs:496.8}]);
 });
 it.each([
  {key:'arbitrary-heavy-blade',primitive:'melee_slash' as const,launch:.25,contact:.48,override:'hit' as const,sound:'custom-one'},
  {key:'unrelated-flying-axe',primitive:'weapon_throw' as const,launch:.26,contact:.50,override:'launch' as const,sound:'custom-two'},
 ])('inherits declared base phases for $key while retaining critical timing and explicit overrides',data=>{
  const animation:CombatAnimationProfile={...profile(data.key,data.primitive),baseProfileKey:'arbitrary.profile',strikeStyle:'critical',
   motion:{durationMs:1450,scale:1.4,launchRatio:data.launch,contactRatio:data.contact}};
  const critical={...beat,animation,roll:{outcome:'crit'} as CombatBeat['roll']};
  const inherited=plan(critical);
  expect(inherited.map(({key,delayMs})=>({key,delayMs}))).toEqual([
   {key:'launch',delayMs:1450*data.launch},{key:'hit',delayMs:1450*data.contact},
  ]);
  const overridden={...catalog,profiles:{...catalog.profiles,[data.key]:{[data.override]:data.sound}}};
  expect(plan(critical,overridden).map(({key,delayMs})=>({key,delayMs}))).toEqual([
   {key:data.override==='launch'?data.sound:'launch',delayMs:1450*data.launch},
   {key:data.override==='hit'?data.sound:'hit',delayMs:1450*data.contact},
  ]);
  const bound={...overridden,bindings:[{entity_type:'action',entity_id:'source',event:data.override,cue_key:'activate'}]};
  expect(plan(critical,bound).find(event=>event.eventId.endsWith(`:${data.override}`))?.key).toBe('activate');
  expect(combatBeatAudioPlan(state,critical,overridden,true).every(event=>event.delayMs===0)).toBe(true);
 });
 it('does not infer audio inheritance from a critical profile suffix',()=>{
  expect(plan({...beat,animation:{...profile('arbitrary.profile.critical'),strikeStyle:'critical'}})).toEqual([]);
 });
 it('plans charge, release and confirmed contact as distinct phases',()=>{
  const data={...catalog,profiles:{'arbitrary.profile':{charge:'charge',launch:'launch',hit:'hit'}}};
  expect(plan({...beat,animation:profile('arbitrary.profile','charged_beam')},data).map(({key,delayMs})=>({key,delayMs}))).toEqual([{key:'charge',delayMs:0},{key:'launch',delayMs:340},{key:'hit',delayMs:530}]);
 });
 it.each(['before-reaction','suppressed'] as const)('never schedules %s beats',kind=>{
  expect(plan({...beat,...(kind==='before-reaction'?{rollPhase:'before-reaction' as const}:{suppressAnimation:true})})).toEqual([]);
 });
 it('does not equate an unknown result or a save success with a hit',()=>{
  expect(plan({...beat,cues:[]}).map(event=>event.key)).toEqual(['launch']);
  expect(plan({...beat,cues:[{actorId:'enemy',kind:'effect',text:'Спасбросок: успех'}],rollKind:'save',roll:{outcome:'success'} as CombatBeat['roll']}).map(event=>event.key)).toEqual(['launch']);
  expect(plan({...beat,cues:[{actorId:'enemy',kind:'miss',text:'Промах'}]}).map(event=>event.key)).toEqual(['launch','miss']);
 });
 it.each([{kind:'action' as const,id:'unrelated-breath',sound:'custom-one'},{kind:'spell' as const,id:'unrelated-star',sound:'custom-two'}])('uses saved $kind bindings before profile defaults without name matching',({kind,id,sound})=>{
  const data={...catalog,bindings:[{entity_type:kind,entity_id:id,event:'launch' as const,cue_key:sound}]};
  expect(plan({...beat,actionName:'Renamed after the attack',entityRef:{kind,id}},data)[0].key).toBe(sound);
 });
 it('preserves legacy cast bindings as the release override',()=>{
  const data={...catalog,bindings:[{entity_type:'action',entity_id:'source',event:'cast' as const,cue_key:'custom-one'}]};
  expect(plan(beat,data).map(event=>event.key)).toEqual(['custom-one','hit']);
 });
 it('does not infer identity from changed action presentation and can use recorded weapon provenance',()=>{
  const data={...catalog,bindings:[{entity_type:'action',entity_id:'changed-current-entity',event:'hit' as const,cue_key:'custom-one'},{entity_type:'card',entity_id:'saved-weapon',event:'hit' as const,cue_key:'custom-two'}]};
  expect(plan(beat,data).at(-1)?.key).toBe('hit');
  const saved={...state,log:[{id:'one',records:[{ordinal:0,attackPresentation:{weaponCardId:'saved-weapon'}}]}]} as unknown as SoloCombatState;
  expect(combatBeatAudioPlan(saved,beat,data).at(-1)?.key).toBe('custom-two');
 });
 it('supports a saved entity ref even without an action ID',()=>{
  const data={...catalog,bindings:[{entity_type:'action',entity_id:'source',event:'hit' as const,cue_key:'custom-one'}]};
  expect(plan({...beat,actionId:undefined},data).at(-1)?.key).toBe('custom-one');
 });
 it('uses real catalog crossbow card assignments from both saved weapon and card provenance',()=>{
  const assignments=builtInAudioCatalog.bindings.filter(binding=>binding.entity_type==='card'&&binding.event==='launch'&&binding.cue_key==='weapon.crossbow.launch').slice(0,2);
  expect(assignments).toHaveLength(2);
  const data={...builtInAudioCatalog,profiles:{...builtInAudioCatalog.profiles,'arbitrary.profile':{launch:'weapon.bow.launch'}}};
  for(const assignment of assignments){
   const fromRef={...beat,entityRef:undefined,actionId:undefined,sourceEntityIds:[`card:${assignment.entity_id}`]};
   expect(plan(fromRef,data).find(event=>event.eventId.endsWith(':launch'))?.key).toBe('weapon.crossbow.launch');
   const saved={...state,log:[{id:'one',records:[{ordinal:0,attackPresentation:{weaponCardId:assignment.entity_id}}]}]} as unknown as SoloCombatState;
   expect(combatBeatAudioPlan(saved,{...fromRef,sourceEntityIds:undefined},data).find(event=>event.eventId.endsWith(':launch'))?.key).toBe('weapon.crossbow.launch');
  }
 });
 it('normalizes item provenance to the canonical card type for a second entity with different data',()=>{
  const data={...catalog,bindings:[{entity_type:'card',entity_id:'different-projector',event:'launch' as const,cue_key:'custom-two'}]};
  expect(plan({...beat,entityRef:undefined,sourceEntityIds:['item:different-projector']},data)[0].key).toBe('custom-two');
 });
 it('uses one release and coalesces identical area contacts while preserving distinct confirmed outcomes',()=>{
  const first={...beat,rollKind:'save' as const};
  const second={...first,id:'two:0',suppressAnimation:true,targetId:'two'};
  const third={...first,id:'three:0',suppressAnimation:true,targetId:'three',cues:[{actorId:'three',kind:'miss' as const,text:'Промах'}]};
  const grouped={...first,saveGroupId:'area-cast',saveRows:[first,second,third],cues:[...first.cues,...second.cues,...third.cues]};
  expect(plan(grouped).map(event=>event.key)).toEqual(['launch','hit','miss']);
  expect(plan(second)).toEqual([]);
 });
 it('plays only declared activation/healing phases and has no legacy critical cue',()=>{
  const data={...catalog,profiles:{'arbitrary.profile':{activate:'activate',healing:'heal'}}};
  expect(plan({...beat,cues:[{actorId:'hero',kind:'healing',text:'+4'}]},data).map(event=>event.key)).toEqual(['heal','activate']);
  expect(plan({...beat,roll:{outcome:'crit'} as CombatBeat['roll']}).map(event=>event.key)).toEqual(['launch','hit']);
 });
 it('has no unbound generic fallback and no delayed sound with reduced motion',()=>{
  expect(plan(beat,{...catalog,profiles:{}})).toEqual([]);
  expect(combatBeatAudioPlan(state,beat,catalog,true).every(event=>event.delayMs===0)).toBe(true);
 });
});
