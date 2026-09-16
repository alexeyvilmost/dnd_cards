// Local-only Forge pipeline and browser acceptance, QA-owned characters only.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire(new URL('../../frontend/package.json',import.meta.url));
const {chromium,expect}=require('@playwright/test');
const base='http://127.0.0.1:3001',out='outputs/martial-classes-256';
await mkdir(out,{recursive:true});
const credentials=JSON.parse(await readFile('outputs/party-maps-254/credentials.json','utf8'));
const auth=await(await fetch(`${base}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(credentials)})).json();assert(auth.token);
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1050},ignoreHTTPSErrors:true});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.addInitScript(({token,user})=>{localStorage.setItem('auth_token',token);localStorage.setItem('user',JSON.stringify(user));localStorage.setItem('boh:mobile-suggestion-dismissed','1');},auth);
 await page.goto(`${base}/character-forge`);
 const result=await page.evaluate(async()=>{
  const {autoBuildAt}=await import('/src/canon/autoBuild.ts');
  const {buildSavePayload}=await import('/src/character/forgeHelpers.ts');
  const {runtimeSeedFromSavePayload}=await import('/src/character/saveCharacter.ts');
  const {buildCharacterContext}=await import('/src/character/runtime.ts');
  const {buildResourceRuntimePatch}=await import('/src/character/resourceInit.ts');
  const {projectCharacterStartingEquipmentPatch}=await import('/src/character/startingEquipment.ts');
  const {charactersV3Api}=await import('/src/character/api.ts');
  const {loadSheetCombatParticipant}=await import('/src/character/sheetCombatTargetRuntime.ts');
  const client=await import('/src/api/client.ts');
  const classes=(await client.classesApi.getClasses({limit:1000})).classes;
  const races=(await client.racesApi.getRaces({limit:1000})).races;
  const backgrounds=(await client.backgroundsApi.getBackgrounds({limit:1000})).backgrounds;
  const feats=(await client.featsApi.getFeats({limit:1000})).feats;
  const content={classes,races,backgrounds,feats};
  const race=races.find(r=>r.card_number==='RACE-orc')??races.find(r=>r.name==='Орк'&&!r.parent_race_id);
  const background=backgrounds.find(b=>b.name==='Фермер');
  if(!race||!background)throw Error('QA roots missing');
  const results=[];
  for(const card of ['CLASS-barbarian','CLASS-monk'])for(const level of [1,2,3]){
   const cls=classes.find(c=>c.card_number===card);
   const subclass=classes.find(c=>c.parent_class_id===cls.id&&/берсерк|открытой ладони/i.test(c.name));
   const b=await autoBuildAt({classId:cls.id,raceId:race.id,backgroundId:background.id,level,subclassId:level===3?subclass?.id:undefined},content);
   if(b.issues.length||b.unresolvedNonSpell.length||b.unresolvedSpell.length)throw Error(JSON.stringify({card,level,issues:b.issues,unresolved:b.unresolvedNonSpell,spells:b.unresolvedSpell}));
   b.draft.name=`QA 256 ${cls.name} ${level}`;
   const payload=buildSavePayload(b.draft,b.assembled,b.ruleState);
   const ctx=buildCharacterContext(b.ruleState,b.draft,[],b.assembled.klass);
   const runtime=projectCharacterStartingEquipmentPatch(buildResourceRuntimePatch(runtimeSeedFromSavePayload(payload),ctx,b.assembled,true,undefined,b.ruleState.freeuseSpells)??{},b.draft,b.assembled);
   const character=await charactersV3Api.create({...payload,...runtime});
   const participant=await loadSheetCombatParticipant({character,basicActions:[],cards:new Map()});
   results.push({card,level,character,summary:{hp:character.max_hp,ac:character.armor_class,speed:character.speed,resources:character.resources,maxResources:character.max_resources,subclass:b.assembled.subclass?.name,actions:participant.canonical.actions.map(a=>({id:a.id,name:a.name,mechanics:a.mechanics})),warnings:participant.canonical.world.actors[participant.canonical.actorId].diagnostics}});
  }
  return results;
 });
 await writeFile(`${out}/builds.json`,JSON.stringify(result));
 for(const row of result){
  await page.goto(`${base}/characters-v3/${row.character.id}`);
  await expect(page.getByRole('button',{name:'Черты и способности',exact:true})).toBeVisible({timeout:40000});
  await page.screenshot({path:`${out}/${row.card}-${row.level}.png`,fullPage:true});
  console.log(JSON.stringify({card:row.card,level:row.level,id:row.character.id,...row.summary,actions:row.summary.actions.map(a=>a.name)}));
 }
 assert.deepEqual(errors,[]);
}finally{await writeFile(`${out}/browser-errors.json`,JSON.stringify(errors));await browser.close();}
