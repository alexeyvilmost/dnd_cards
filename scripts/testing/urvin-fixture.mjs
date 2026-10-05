import assert from 'node:assert/strict';
import {randomUUID, createHash} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {localAcceptanceContext} from './acceptance-context.mjs';
import {assertTestDsn} from './guards.mjs';
import {insertFixtureRows} from './fixtures.mjs';
import {publicFixtureRow} from './integration-baseline.mjs';
import {repositoryRoot, execute, resolveTool} from './runtime.mjs';

const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
export const urvinHash=value=>'sha256:'+createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export const sqlLiteral=value=>"'"+String(value).replaceAll("'","''")+"'";
export const assertUUID=value=>assert.match(value,/^[a-f0-9-]{36}$/i,'Expected a generated fixture UUID');
export function verifyUrvinSeed(seed) {
  assert.equal(seed?.schemaVersion,1); assert.equal(seed.kind,'generated-public-seed-only');
  assert.deepEqual(seed.seedVersions,['199_materialize_roguelike_monsters','273_urvin_run']);
  assert.equal(seed.mode?.version,1); assert.equal(seed.mode.id,'urvin');
  assert.equal(seed.mode.auras.length,5); assert.equal(seed.mode.events.length,5);
  const slugs=[...new Set(seed.mode.encounters.flatMap(row=>row.monsters.map(monster=>monster.slug)))].sort();
  assert.deepEqual(seed.collections.monsters.map(row=>row.slug).sort(),slugs);
  const actions=new Set(seed.collections.actions.map(row=>row.id));
  const effects=new Set(seed.collections.effects.map(row=>row.id));
  for(const aura of seed.mode.auras)assert.ok(effects.has(aura.id),'Aura dependency missing');
  for(const monster of seed.collections.monsters){
    for(const id of monster.action_ids)assert.ok(actions.has(id),'Monster action missing');
    for(const id of monster.effect_ids)assert.ok(effects.has(id),'Monster effect missing');
  }
  for(const rows of Object.values(seed.collections))for(const row of rows){assertUUID(row.id);publicFixtureRow(row);}
  return seed;
}

/** Installs only fresh generated rows, restoring shared configuration and all
 * transient monster/action/effect rows in finally. Reward cards are retained as
 * dependencies of this gate's own saved characters; no existing card is edited. */
export async function withUrvinFixture(stack, work) {
  assert.ok(stack?.env&&stack?.database?.query&&stack?.registry,'A runner-owned stack must be supplied');
  const context=await localAcceptanceContext(stack.env);
  assertTestDsn(stack.database.dsn,context.registry);
  assert.equal(stack.registry.fixture.profile,'integration-baseline');
  const query=async text=>JSON.parse((await stack.database.query(text,undefined,{sensitive:true})).trim().split(/\r?\n/).at(-1));
  const owned=async()=>assert.equal(await query("SELECT to_json(current_database()||':'||run_id) FROM test_run_ownership;"),`${context.registry.runId}:${context.registry.runId}`);
  await owned();
  const sourceFiles=['backend/migrations/materialize_roguelike_monsters_199.go','backend/migrations/urvin_run_273.go','backend/roguelikecontent/urvin.json','frontend/src/solo-combat/data/urvinMaps.json'];
  const sourceHashes=Object.fromEntries(await Promise.all(sourceFiles.map(async file=>[file,'sha256:'+createHash('sha256').update(await readFile(path.join(repositoryRoot,file))).digest('hex')])));
  const generated=await execute(resolveTool('go'),['run',path.join(repositoryRoot,'scripts/testing/export-urvin-fixture.go')],{
    cwd:path.join(repositoryRoot,'backend'),env:stack.env,signal:stack.signal});
  const seed=verifyUrvinSeed(JSON.parse(generated));
  const collections=Object.fromEntries(Object.entries(seed.collections).map(([table,rows])=>[table,rows.map(publicFixtureRow)]));
  const ids=Object.fromEntries(Object.entries(collections).map(([table,rows])=>[table,rows.map(row=>row.id)]));
  const inList=values=>values.map(sqlLiteral).join(',');
  for(const [table,rows] of Object.entries(collections)){
    const reference=table==='monsters'?'slug':'card_number';
    const count=await query(`SELECT to_json(count(*)) FROM ${table} WHERE id IN (${inList(ids[table])}) OR ${reference} IN (${inList(rows.map(row=>row[reference]))});`);
    assert.equal(count,0,'Urvin acceptance cannot replace existing catalog rows');
  }
  assert.equal(await query("SELECT to_json(count(*)) FROM roguelike_mode_definitions WHERE id='urvin';"),0,'Urvin fixture mode must be newly owned');
  const tables=['actions','effects','monsters'];
  const originalCatalog=await query(`SELECT json_build_object(${tables.flatMap(table=>[sqlLiteral(table),`(SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text,'')) FROM ${table} t)`]).join(',')});`);
  const settings=await query('SELECT to_jsonb(t) FROM roguelike_shop_settings t WHERE id=1;');
  const tags=[randomUUID(),randomUUID(),randomUUID()];
  const itemIds=[randomUUID(),randomUUID(),randomUUID()];
  const fixtureConfig={...settings.config,pool_tag:tags[0],starting_tag:tags[1],staple_tag:tags[2],
    levels:[1,2,3,4,5].map(level=>({level,slots:3,magic_limit:3,uncommon_bp:3000,rare_bp:3000,epic_bp:0}))};
  const version=settings.version+1;
  let settingsChanged=false,setupStarted=false,result,cleanupFailure;
  const manifest={schemaVersion:1,kind:'owned-urvin-catalog',sourceHashes,seedHash:urvinHash(seed),
    fixtureHash:urvinHash({collections,mode:seed.mode}),historicalChainVerified:false,sourceRows:Object.fromEntries(Object.entries(ids).map(([key,values])=>[key,values.length]))};
  try {
    setupStarted=true;
    for(const table of ['actions','effects','monsters'])await insertFixtureRows(stack.database,table,collections[table]);
    await stack.database.query(`INSERT INTO roguelike_mode_definitions(id,definition) VALUES ('urvin',${sqlLiteral(JSON.stringify(seed.mode))}::jsonb);`,undefined,{sensitive:true});
    await insertFixtureRows(stack.database,'entity_tag_definitions',tags.map((id,i)=>({id,name:`Urvin local ${context.registry.runId.slice(-8)} ${i}`,description:'Owned acceptance pool'})));
    const cards=itemIds.map((id,i)=>publicFixtureRow({id,name:`Urvin fixture reward ${i+1}`,description:'Synthetic local reward; ordinary item model',
      rarity:['common','uncommon','rare'][i],card_number:'UT-'+id.slice(0,15),price:1,price_currency:'gold',weight:0.1,mechanics:{},source:'Local tests'}));
    await insertFixtureRows(stack.database,'cards',cards);
    const assignments=[...itemIds.map(id=>`('card',${sqlLiteral(id)},${sqlLiteral(tags[0])})`),`('card',${sqlLiteral(itemIds[0])},${sqlLiteral(tags[2])})`];
    await stack.database.query(`INSERT INTO entity_tag_assignments(entity_type,entity_id,tag_id) VALUES ${assignments.join(',')};`,undefined,{sensitive:true});
    const changed=await query(`WITH changed AS (UPDATE roguelike_shop_settings SET config=${sqlLiteral(JSON.stringify(fixtureConfig))}::jsonb,version=${version} WHERE id=1 AND version=${settings.version} AND config=${sqlLiteral(JSON.stringify(settings.config))}::jsonb RETURNING id) SELECT to_json(count(*)) FROM changed;`);
    assert.equal(changed,1,'Merchant fixture lost its setup ownership');settingsChanged=true;
    await writeFile(path.join(context.output,'urvin-fixture.json'),JSON.stringify(manifest,null,2)+'\n');
    const apiFixture={context,mode:seed.mode,manifest,query,owned,itemIds,
      async arrangeRoom(run,owner,{kind,eventId}={}){
        await owned();assertUUID(run.id);assertUUID(owner);assert.equal(run.revision,0,'Only fresh command-free runs may be arranged');
        const journey=structuredClone(run.journey);assert.ok(journey.nodes.length);journey.nodes[0].kind=kind;
        const rules=structuredClone(seed.mode);rules.event_combat_chance=0;rules.event_elite_chance=0;
        if(eventId){rules.events=rules.events.filter(row=>row.id===eventId);assert.equal(rules.events.length,1);}
        const changed=await query(`WITH changed AS (UPDATE roguelike_runs SET journey=${sqlLiteral(JSON.stringify(journey))}::jsonb,mode_rules=${sqlLiteral(JSON.stringify(rules))}::jsonb WHERE id=${sqlLiteral(run.id)} AND user_id=${sqlLiteral(owner)} AND revision=${run.revision} AND combat_envelope='{}'::jsonb AND journey_private='{}'::jsonb AND NOT EXISTS(SELECT 1 FROM roguelike_command_receipts WHERE run_id=${sqlLiteral(run.id)}) RETURNING id) SELECT to_json(count(*)) FROM changed;`);
        assert.equal(changed,1,'Room fixture refused changed, foreign or already active run');
        return journey.nodes[0].id;
      },
      async withCombatProfile(profile, initialize){
        assert.ok(['passive','lethal'].includes(profile));await owned();
        const original=await query(`SELECT json_build_object('monsters',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM monsters t WHERE id IN (${inList(ids.monsters)})),'actions',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM actions t WHERE id IN (${inList(ids.actions)})));`);
        try{
          for(const row of original.actions){
            const mechanics=structuredClone(row.mechanics);
            for(const effect of mechanics.effects??[])for(const payload of effect.on_hit??[])if(payload.kind==='damage')payload.amount=profile==='passive'?0:1000;
            if(profile==='lethal')for(const effect of mechanics.effects??[])if(effect.resolution==='attack_roll')effect.attack_bonus_override=100;
            await stack.database.query(`UPDATE actions SET mechanics=${sqlLiteral(JSON.stringify(mechanics))}::jsonb WHERE id=${sqlLiteral(row.id)};`,undefined,{sensitive:true});
          }
          await stack.database.query(`UPDATE monsters SET max_hp=${profile==='passive'?1:1000},armor_class=${profile==='passive'?1:20} WHERE id IN (${inList(ids.monsters)});`,undefined,{sensitive:true});
          return await initialize();
        }finally{
          for(const row of original.actions)await stack.database.query(`UPDATE actions SET mechanics=${sqlLiteral(JSON.stringify(row.mechanics))}::jsonb WHERE id=${sqlLiteral(row.id)};`,undefined,{sensitive:true});
          for(const row of original.monsters)await stack.database.query(`UPDATE monsters SET max_hp=${row.max_hp},armor_class=${row.armor_class} WHERE id=${sqlLiteral(row.id)};`,undefined,{sensitive:true});
        }
      }};
    result=await work(apiFixture);
  }finally{
    try{
      await owned();
      if(settingsChanged){
        const changed=await query(`WITH changed AS (UPDATE roguelike_shop_settings SET config=${sqlLiteral(JSON.stringify(settings.config))}::jsonb,version=${settings.version} WHERE id=1 AND version=${version} AND config=${sqlLiteral(JSON.stringify(fixtureConfig))}::jsonb RETURNING id) SELECT to_json(count(*)) FROM changed;`);
        assert.equal(changed,1,'Refusing to overwrite an intervening merchant configuration');
      }
      if(setupStarted){
        await stack.database.query(`DELETE FROM entity_tag_assignments WHERE tag_id IN (${inList(tags)}); DELETE FROM entity_tag_definitions WHERE id IN (${inList(tags)}); DELETE FROM roguelike_mode_definitions WHERE id='urvin'; DELETE FROM monsters WHERE id IN (${inList(ids.monsters)}); DELETE FROM actions WHERE id IN (${inList(ids.actions)}); DELETE FROM effects WHERE id IN (${inList(ids.effects)});`,undefined,{sensitive:true});
      }
      assert.equal(urvinHash(await query('SELECT to_jsonb(t) FROM roguelike_shop_settings t WHERE id=1;')),urvinHash(settings),'Merchant configuration restore differs');
      const restored=await query(`SELECT json_build_object(${tables.flatMap(table=>[sqlLiteral(table),`(SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text,'')) FROM ${table} t)`]).join(',')});`);
      assert.equal(urvinHash(restored),urvinHash(originalCatalog),'Urvin fixture modified the shared catalog');
    }catch(error){cleanupFailure=error;}
    await writeFile(path.join(context.output,'urvin-fixture-cleanup.json'),JSON.stringify({schemaVersion:1,runId:context.registry.runId,status:cleanupFailure?'failed':'restored',sharedCatalogUnchanged:!cleanupFailure,sharedSettingsUnchanged:!cleanupFailure},null,2)+'\n');
    if(cleanupFailure)throw cleanupFailure;
  }
  return {...result,fixture:manifest,fixtureCleanup:{status:'restored',sharedCatalogUnchanged:true,sharedSettingsUnchanged:true,rewardCardsRetained:itemIds.length}};
}
