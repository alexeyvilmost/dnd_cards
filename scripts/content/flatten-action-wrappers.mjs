import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {archiveReviewedCatalog,catalogArchiveOptions} from './reviewed-catalog-archive.mjs';

const onlyKeys=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>keys.includes(key));
const empty=value=>value==null||value===''||(Array.isArray(value)&&!value.length)||(typeof value==='object'&&!Object.keys(value).length);
/** Strictly transparent permanent wrappers only. Duration, conditions, costs,
 * choices, triggers, narrative payloads and any unknown metadata stay intact. */
export function pureActionGrants(effect){
  if(effect.repeatable||['script','condition_description','related_effects','related_actions','related_cards','properties'].some(key=>!empty(effect[key])))return null;
  const mechanics=effect.mechanics;
  if(!onlyKeys(mechanics,['activation','effects'])||!onlyKeys(mechanics.activation,['mode'])||mechanics.activation.mode!=='passive'||!Array.isArray(mechanics.effects)||!mechanics.effects.length)return null;
  const grants=[];
  for(const block of mechanics.effects){
    if(!onlyKeys(block,['resolution','result','who'])||block.resolution!=='auto'||(block.who&&block.who!=='self')||!Array.isArray(block.result)||!block.result.length)return null;
    for(const payload of block.result){
      if(!onlyKeys(payload,['kind','value','values','level_gate','min_level'])||payload.kind!=='grant_action')return null;
      const values=payload.value??payload.values;const refs=Array.isArray(values)?values:[values];
      const gate=Math.max(payload.level_gate??1,payload.min_level??1);
      if(!Number.isSafeInteger(gate)||gate<1||gate>20||!refs.length||refs.some(ref=>typeof ref!=='string'||!ref.trim()))return null;
      grants.push(...refs.map(ref=>({ref,gate})));
    }
  }
  return grants.length?grants:null;
}

export function planActionWrapperMigration(snapshot){
  const actions=new Map();for(const action of snapshot.actions)for(const alias of [action.id,action.card_number]){
    if(actions.has(alias))throw Error('Ambiguous action alias');actions.set(alias,action);
  }
  const parents=[...snapshot.races.map(parent=>({...parent,table:'races',kind:'race'})),...snapshot.classes.map(parent=>({...parent,table:'classes',kind:'class'}))];
  const replacements=[];const skipped=[];
  for(const effect of snapshot.effects){
    const grants=pureActionGrants(effect);if(!grants)continue;
    const aliases=[effect.id,effect.card_number];
    const incoming=snapshot.edges.filter(edge=>aliases.includes(edge.target_key));
    if(incoming.some(edge=>!['race','class'].includes(edge.source_type)||!(edge.path==='related_effects'||/^related_effects\[\d+\]$/.test(edge.path)||/^level_progression\.\d+\.effects\[\d+\]$/.test(edge.path)))){skipped.push({id:effect.id,name:effect.name,reason:'Other owners or contextual references'});continue;}
    const owners=parents.filter(parent=>(parent.related_effects??[]).some(id=>aliases.includes(id))||Object.values(parent.level_progression??{}).some(entry=>(entry.effects??[]).some(id=>aliases.includes(id))));
    if(!owners.length){skipped.push({id:effect.id,name:effect.name,reason:'No species/class owner'});continue;}
    if(grants.some(grant=>!actions.has(grant.ref))){skipped.push({id:effect.id,name:effect.name,reason:'Missing action'});continue;}
    replacements.push({effect,grants:grants.map(grant=>({...grant,id:actions.get(grant.ref).id})),owners:owners.map(owner=>({table:owner.table,id:owner.id}))});
  }
  const changed=[];
  for(const owner of parents){
    const relevant=replacements.filter(replacement=>replacement.owners.some(parent=>parent.table===owner.table&&parent.id===owner.id));if(!relevant.length)continue;
    const before={related_effects:owner.related_effects,related_actions:owner.related_actions,level_progression:owner.level_progression};const after=structuredClone(before);
    for(const replacement of relevant){
      const aliases=[replacement.effect.id,replacement.effect.card_number];
      const attach=(ids,level)=>{
        if(!ids?.some(id=>aliases.includes(id)))return ids;
        for(const grant of replacement.grants){const gate=Math.max(level,grant.gate);
          // Classes already use the common progression collector. Species keep
          // unconditional grants in related_actions, gated grants in progression.
          if(owner.table==='races'&&level===0&&grant.gate===1){after.related_actions=[...new Set([...(after.related_actions??[]),grant.id])];}
          else{after.level_progression??={};const at=String(Math.max(1,gate,level===0&&owner.is_subclass?(owner.subclass_level??3):1));const entry=after.level_progression[at]??={effects:[],actions:[]};entry.actions=[...new Set([...(entry.actions??[]),grant.id])];}
        }
        return ids.filter(id=>!aliases.includes(id));
      };
      after.related_effects=attach(after.related_effects,0);
      // Snapshot levels before attaching grants, so new entries don't re-enter.
      for(const [level,entry] of Object.entries(after.level_progression??{}))entry.effects=attach(entry.effects,Number(level));
    }
    changed.push({table:owner.table,id:owner.id,name:owner.name,before,after});
  }
  const actionUpdates=new Map();
  for(const replacement of replacements)for(const grant of replacement.grants){
    const action=actions.get(grant.ref);const before={description:action.description??'',detailed_description:action.detailed_description??null};
    const row=actionUpdates.get(action.id)??{id:action.id,name:action.name,before,after:structuredClone(before),mechanics:action.mechanics};
    for(const text of [replacement.effect.description,replacement.effect.detailed_description].filter(Boolean)){
      const normalized=value=>String(value??'').replace(/\s+/g,' ').trim();
      if(!normalized(row.after.description+' '+(row.after.detailed_description??'')).includes(normalized(text)))row.after.detailed_description=[row.after.detailed_description,text].filter(Boolean).join('\n\n');
    }
    if(JSON.stringify(row.before)!==JSON.stringify(row.after))actionUpdates.set(action.id,row);
  }
  return {version:1,replacements,parents:changed,actions:[...actionUpdates.values()],skipped};
}

const literal=value=>"'"+String(value).replaceAll("'","''")+"'";
const json=value=>literal(JSON.stringify(value))+'::jsonb';
const parentProjection="jsonb_build_object('related_effects',to_jsonb(related_effects),'related_actions',to_jsonb(related_actions),'level_progression',level_progression::jsonb)";
export function actionWrapperMigrationSql(plan,{apply=false}={}){
  const sql=['BEGIN;'];
  // Serialize catalog writes and verify new incoming references before deleting.
  sql.push('LOCK TABLE effects,actions,races,classes,entity_reference_edges,characters_v3,character_templates IN SHARE ROW EXCLUSIVE MODE;');
  for(const row of plan.parents){if(!['races','classes'].includes(row.table))throw Error('Invalid owner table');
    sql.push(`DO $check$ BEGIN IF NOT EXISTS(SELECT 1 FROM ${row.table} WHERE id=${literal(row.id)} AND deleted_at IS NULL AND ${parentProjection} IN (${json(row.before)},${json(row.after)})) THEN RAISE EXCEPTION 'Wrapper owner preimage changed: ${row.id}'; END IF; END $check$;`);
  }
  for(const replacement of plan.replacements){const e=replacement.effect;const aliases=`ARRAY[${literal(e.id)},${literal(e.card_number)}]`;
    if(Object.keys(e).some(key=>!/^[a-z_]+$/.test(key)))throw Error('Invalid effect field');
    const projection=`(SELECT jsonb_object_agg(key,value) FROM jsonb_each(to_jsonb(e)) WHERE key=ANY(ARRAY[${Object.keys(e).map(literal).join(',')}]))`;
    sql.push(`DO $check$ BEGIN IF NOT EXISTS(SELECT 1 FROM effects e WHERE id=${literal(e.id)} AND ${projection}=${json(e)}) THEN RAISE EXCEPTION 'Wrapper preimage changed: ${e.id}'; END IF; IF EXISTS(SELECT 1 FROM entity_reference_edges WHERE target_type='effect' AND target_key=ANY(${aliases}) AND (source_type NOT IN ('race','class') OR source_id NOT IN (${replacement.owners.map(owner=>literal(owner.id)).join(',')}) OR NOT(path ~ '^related_effects\\[[0-9]+\\]$' OR path ~ '^level_progression\\.[0-9]+\\.effects\\[[0-9]+\\]$'))) THEN RAISE EXCEPTION 'Wrapper gained another owner: ${e.id}'; END IF; IF EXISTS(SELECT 1 FROM characters_v3 c,unnest(${aliases}) alias WHERE c.effect_ids::text LIKE '%' || alias || '%') OR EXISTS(SELECT 1 FROM character_templates t,unnest(${aliases}) alias WHERE t.character::text LIKE '%' || alias || '%') THEN RAISE EXCEPTION 'Wrapper has a direct character/template attachment: ${e.id}'; END IF; END $check$;`);
    for(const action of replacement.grants)sql.push(`DO $check$ BEGIN IF NOT EXISTS(SELECT 1 FROM actions WHERE id=${literal(action.id)} AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Granted action disappeared'; END IF; END $check$;`);
  }
  const actionProjection="jsonb_build_object('description',description,'detailed_description',detailed_description)";
  for(const row of plan.actions??[])sql.push(`DO $check$ BEGIN IF NOT EXISTS(SELECT 1 FROM actions WHERE id=${literal(row.id)} AND deleted_at IS NULL AND mechanics::jsonb=${json(row.mechanics)} AND ${actionProjection} IN (${json(row.before)},${json(row.after)})) THEN RAISE EXCEPTION 'Action description changed'; END IF; END $check$;`);
  if(apply){
    for(const row of plan.parents)sql.push(`UPDATE ${row.table} SET related_effects=${row.after.related_effects==null?'NULL':json(row.after.related_effects)},related_actions=${row.after.related_actions==null?'NULL':json(row.after.related_actions)},level_progression=${json(row.after.level_progression)},updated_at=now() WHERE id=${literal(row.id)} AND ${parentProjection}=${json(row.before)};`);
    for(const row of plan.actions??[])sql.push(`UPDATE actions SET detailed_description=${row.after.detailed_description==null?'NULL':literal(row.after.detailed_description)},updated_at=now() WHERE id=${literal(row.id)} AND ${actionProjection}=${json(row.before)};`);
    for(const replacement of plan.replacements){sql.push(`UPDATE effects SET deleted_at=now(),updated_at=now() WHERE id=${literal(replacement.effect.id)} AND deleted_at IS NULL;`);
      sql.push(`DELETE FROM entity_reference_edges WHERE source_type='effect' AND source_id=${literal(replacement.effect.id)};`);
    }
  }
  sql.push('COMMIT;');return sql.join('\n');
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const planPath=process.argv.find(argument=>argument.endsWith('.json'));if(!planPath)throw Error('Reviewed plan JSON is required');
  const plan=JSON.parse(fs.readFileSync(planPath,'utf8'));const apply=process.argv.includes('--apply');
  if(apply)archiveReviewedCatalog({...catalogArchiveOptions(process.argv),operation:'flatten-action-wrappers',payload:plan});
  if(!process.env.DATABASE_URL)throw Error('DATABASE_URL is required');const url=new URL(process.env.DATABASE_URL);
  const result=spawnSync(process.env.PSQL_BIN||'psql',['-w','-X','-v','ON_ERROR_STOP=1'],{input:actionWrapperMigrationSql(plan,{apply}),encoding:'utf8',windowsHide:true,env:{...process.env,PGHOST:url.hostname,PGPORT:url.port||'5432',PGDATABASE:decodeURIComponent(url.pathname.slice(1)),PGUSER:decodeURIComponent(url.username),PGPASSWORD:decodeURIComponent(url.password),PGSSLMODE:url.searchParams.get('sslmode')||'require'}});
  if(result.status!==0)throw Error('Wrapper migration failed; transaction rolled back');
  console.log(`${apply?'Applied':'Checked'} ${plan.replacements.length} action wrappers and ${plan.parents.length} owners.`);
}
