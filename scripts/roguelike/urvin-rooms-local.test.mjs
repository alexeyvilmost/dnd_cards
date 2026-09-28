// Scenario integration tests. Creates isolated QA runs, then arranges their
// first room (and terminal battle state) directly in the LOCAL DB. This tests
// room commands/rewards, not simulated playthrough balance. No user run is used.
import {readFile,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const base=process.env.ROGUELIKE_TEST_ORIGIN||'http://127.0.0.1:3001',out=new URL('../../outputs/urvin-273/',import.meta.url);
assert(['localhost','127.0.0.1','[::1]'].includes(new URL(base).hostname),'Local test origin required');
const access=JSON.parse(await readFile(new URL('access.json',out),'utf8'));
const auth=await(await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(access)})).json();assert(auth.token);
assert(process.env.ROGUELIKE_TEST_DATABASE_URL,'ROGUELIKE_TEST_DATABASE_URL must name the isolated local test database');
const db=new URL(process.env.ROGUELIKE_TEST_DATABASE_URL);assert(['localhost','127.0.0.1','[::1]'].includes(db.hostname));
const psql=process.env.PSQL||'psql';
const literal=v=>`'${String(v).replaceAll("'","''")}'`;
function sql(query){const r=spawnSync(psql,['-h',db.hostname,'-p',db.port||'5432','-U',decodeURIComponent(db.username),'-d',decodeURIComponent(db.pathname.slice(1)),'-At','-v','ON_ERROR_STOP=1'],{input:query,encoding:'utf8',env:{...process.env,PGPASSWORD:decodeURIComponent(db.password)}});assert.equal(r.status,0,r.stderr);return r.stdout.trim();}
async function api(path,method='GET',body,status=200){const r=await fetch(base+'/api'+path,{method,headers:{'Content-Type':'application/json',Authorization:`Bearer ${auth.token}`},...(body?{body:JSON.stringify(body)}:{})});const value=await r.json();assert.equal(r.status,status,`${method} ${path}: ${JSON.stringify(value)}`);return value;}
async function command(run,type,payload={},status=200,id=randomUUID()){return api(`/roguelike/runs/${run.id}/commands`,'POST',{type,payload,command_id:id,expected_revision:run.revision},status);}
const {mode}=await api('/roguelike/runs/modes'),{templates}=await api('/character-templates');
const created=[],checks=[];
async function scenario(kind,eventId,optionId,auraKey='ferocity'){
 const source=await api(`/character-templates/${templates.find(t=>t.preset_key==='swordsman').id}/copies`,'POST',{name:`Урвин QA · ${kind} ${eventId??''}`},201);
 let {run}=await api('/roguelike/runs','POST',{source_character_id:source.id,mode:'urvin',aura_id:mode.auras.find(a=>a.key===auraKey).id},201);
 const rules=structuredClone(mode);rules.event_combat_chance=0;rules.event_elite_chance=0;if(eventId)rules.events=rules.events.filter(e=>e.id===eventId);
 const j=run.journey;j.nodes[0].kind=kind;
 const where=`id=${literal(run.id)} AND user_id=${literal(auth.user.id)}`;
 sql(`UPDATE roguelike_runs SET journey=${literal(JSON.stringify(j))}::jsonb,mode_rules=${literal(JSON.stringify(rules))}::jsonb WHERE ${where};`);
 ({run}=await command(run,'enter_room',{node_id:j.nodes[0].id}));created.push({kind,eventId,optionId,id:run.id});
 return {run,where};
}
if(process.argv.includes('--browser-fixture')){
 const event=await scenario('event','sleeping-goblins');
 const shop=await scenario('shop');
 const preview={event:event.run.id,shop:shop.run.id};
 await writeFile(new URL('browser-fixtures.json',out),JSON.stringify(preview,null,2));
 console.log(JSON.stringify(preview));process.exit(0);
}
{
 let {run}=await scenario('treasure',null,null,'solitude');assert.equal(run.last_reward.experience,70);assert(run.last_reward.items.length===1);assert(run.journey.nodes[0].completed);
 await command(run,'enter_room',{node_id:'r0-l0'},409);checks.push('treasure grants gold/item and doubled experience once');
}
{
 let {run}=await scenario('shop');assert(run.shop.offers.length>=mode.shop.minimum_magic_items);assert(run.shop.staples.length);
 const {run:closed}=await command(run,'leave_room');await command(closed,'buy_cart',{items:[]},409);checks.push('expanded shop closes on departure');
}
for(const kind of ['pass','camp']){
 let {run}=await scenario(kind);const type=kind==='camp'?'long_rest':'short_rest';
 ({run}=await command(run,type,{preserve_preparation:true}));assert(run.journey.nodes[0].completed);
 await command(run,type,{},409);checks.push(`${kind} uses canonical rest once`);
}
for(const kind of ['elite','boss']){
 let {run,where}=await scenario(kind);assert(run.encounter.roster.some(r=>r.monster_slug.startsWith('urvin-')));
 ({run}=await command(run,'initialize_combat'));assert(run.combat_state);assert(run.combat_state.battleMap.id.startsWith('urvin-'));
 // Arrange terminal state only in this freshly created QA fixture.
 sql(`UPDATE roguelike_runs SET combat_envelope=jsonb_set(combat_envelope,'{state,outcome}','"victory"') WHERE ${where};`);
 const id=randomUUID(),before=run;
 ({run}=await command(run,'complete_encounter',{},200,id));assert.equal(run.encounters_won,1);assert(run.last_reward.items.length===1);
 const item=JSON.parse(sql(`SELECT to_json(row)::text FROM (SELECT rarity FROM cards WHERE id=${literal(run.last_reward.items[0].card_id)}) row;`));
 assert(['uncommon','rare','epic','legendary','artifact'].includes(item.rarity));if(kind==='boss')assert.notEqual(item.rarity,'uncommon');
 assert.deepEqual(await command(before,'complete_encounter',{},200,id),{run});
 assert.equal(run.status,kind==='boss'?'victory':'active');checks.push(`${kind} guardian compiles; terminal fixture reward and victory replay once`);
}
for(const event of mode.events){
 const option=event.options.find(o=>o.checks?.length);
 let {run}=await scenario('event',event.id,option.id);
 ({run}=await command(run,'event_choice',{option_id:option.id,character_id:run.character_id}));
 ({run}=await command(run,'event_roll'));const pending=run.journey.event.pending;assert(pending.roll.dice.length);
 assert.deepEqual((await api('/roguelike/runs/'+run.id)).run.journey.event.pending,pending);
 for(const type of ['camp_action','transfer_item','confirm_level_up','event_roll','claim_stash'])await command(run,type,{},409);
 ({run}=await command(run,'event_resolve'));assert.equal(run.journey.event.pending.roll.total,pending.roll.total);
 while(!run.journey.event.finished){
  if(run.journey.event.pending?.phase==='boost')({run}=await command(run,'event_resolve'));
  if(run.journey.event.pending?.phase==='resolved')({run}=await command(run,'event_continue'));
  else if(!run.journey.event.pending){({run}=await command(run,'event_roll'));({run}=await command(run,'event_resolve'));}
 }
 checks.push(`${event.id}: choice, held roll/reload, guarded mutations, canonical resolution and consequence`);
}
{
 let {run,where}=await scenario('event','sleeping-goblins','ambush');
 const option=run.journey.event.definition.options.find(o=>o.success?.surprise);
 ({run}=await command(run,'event_choice',{option_id:option.id,character_id:run.character_id}));assert(run.encounter.enemy_effects.length);
 assert(run.encounter.roster.every(r=>r.monster_slug==='goblin-warrior'));
 assert.equal(run.journey.nodes[0].resolved_kind,'normal');
 ({run}=await command(run,'initialize_combat'));
 assert(run.combat_state.initiative.filter(r=>r.actorId!==run.character_id).every(r=>r.roll.advantage==='disadvantage'));
 sql(`UPDATE roguelike_runs SET combat_envelope=jsonb_set(combat_envelope,'{state,outcome}','"defeat"') WHERE ${where};`);
 ({run}=await command(run,'complete_encounter'));const composition=run.encounter.composition_key;
 ({run}=await command(run,'retry'));assert(run.journey.event.finished);assert.equal(run.journey.nodes[0].resolved_kind,'normal');
 ({run}=await command(run,'resume_room'));assert.equal(run.encounter.composition_key,composition);checks.push('ambush disadvantage, event combat checkpoint, fixed roster on retry');
}
await writeFile(new URL('rooms.json',out),JSON.stringify({created,checks},null,2));console.log(JSON.stringify({created,checks},null,2));
