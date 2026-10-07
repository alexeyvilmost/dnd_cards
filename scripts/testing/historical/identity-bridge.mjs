// Fixture-only authored bootstrap binding before any gameplay/history exists.
// Generated identities are explicitly rebound from authenticated public inputs; no original-writer replay or history repair is claimed.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const directory=path.dirname(fileURLToPath(import.meta.url));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const lit=v=>`'${String(v).replaceAll("'","''")}'`;
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const digest=/^[a-f0-9]{64}$/;
const cards=['action_basic_weapon','action_basic_offhand','ACT-second-wind'];
export function bridgeSource(){
 const receipt=JSON.parse(fs.readFileSync(path.join(directory,'authored-bootstrap-identity-bridge-sources-20261007.json'))),used=[];
 function source(file){const pin=receipt.files.find(p=>p.path===file);if(!pin)throw Error('Bridge source absent');const b=execFileSync('git',['show',pin.commit+':'+file],{maxBuffer:16*1024**2}),blob=execFileSync('git',['rev-parse',pin.commit+':'+file]).toString().trim();if(sha(b)!==pin.sha256||b.length!==pin.bytes||blob!==pin.blob)throw Error('Original bridge source bytes differ');const actual=fs.readFileSync(file);if(sha(actual)!==pin.sha256){const extension=receipt.extensions.find(e=>e.path===file);if(!extension||sha(actual)!==extension.sha256||actual.length!==extension.bytes)throw Error('Unreviewed current registry source');const published=execFileSync('git',['show',extension.commit+':'+file],{maxBuffer:16*1024**2});if(sha(published)!==extension.sha256||execFileSync('git',['rev-parse',extension.commit+':'+file]).toString().trim()!==extension.blob)throw Error('Reviewed current registry bytes differ');const marker='\t\t// Здесь можно добавлять новые миграции\n',original=b.toString().split(marker),current=actual.toString().split(marker);if(original.length!==2||current.length!==2||original[0]!==current[0]||!current[1].endsWith(original[1]))throw Error('Original registry code changed');const added=current[1].slice(0,current[1].length-original[1].length);if(sha(added)!==extension.extensionHash||JSON.stringify([...added.matchAll(/Version: \"([^\"]+)\"/g)].map(m=>m[1]))!==JSON.stringify(extension.addedVersions))throw Error('Reviewed extension differs');used.push(extension);}used.push(pin);return b.toString();}
 const registry=source('backend/migrations/migrations.go'),forge=source('backend/migrations/seed_forge_mvp.go');
 const start=registry.indexOf('func seedBasicActions('),end=registry.indexOf('\n}',start),basic=registry.slice(start,end+2);
 if(start<0||end<start||!registry.includes('id UUID PRIMARY KEY DEFAULT gen_random_uuid()')||!basic.includes('ON CONFLICT (card_number) DO NOTHING'))throw Error('Generated identity source differs');
 const expected=cards.slice(0,2).map(card=>{const match=[...basic.matchAll(/\{\s*cardNumber:\s*"([^"]+)",\s*name:\s*"([^"]+)",\s*imageURL:\s*"([^"]+)",\s*description:\s*"([^"]+)",\s*mechanics:\s*`([^`]+)`/g)].filter(m=>m[1]===card);if(match.length!==1)throw Error('Unique basic seed literal absent');const m=match[0];return {card,name:m[2],description:m[4],image_url:m[3],mechanics:JSON.parse(m[5]),rarity:'common',action_type:'base_action',type:'basic',resource:'',author:'System',source:'PHB 2024'};});
 const mechanics=forge.match(/secondWindMech := `([^`]+)`/),call=forge.match(/upsertAction\(db, "ACT-second-wind", "([^"]+)",\s*"([^"]+)", "([^"]+)", secondWindMech\)/);
 if(!mechanics||!call||!forge.includes("VALUES ($1, $2, $3, 'common', $4, 'bonus_action', $5::jsonb, 'Admin')")||!forge.includes('RETURNING id::text'))throw Error('Unique forge seed literal absent');
 expected.push({card:cards[2],name:call[1],description:call[2],mechanics:JSON.parse(mechanics[1]),rarity:'common',action_type:call[3],resource:'bonus_action',author:'Admin'});
 return {expected,sourceFiles:used,descriptorHash:sha(fs.readFileSync(path.join(directory,'authored-bootstrap-identity-bridge-sources-20261007.json')))};
}
export async function captureMigrationOwnedBridge(query){
 if((await query('fresh_chain','SELECT max(version) FROM schema_migrations;')).trim()!=='082_character_system_metadata')throw Error('Bridge requires natural 082 boundary');
 const source=bridgeSource(),entries=[];
 for(const value of source.expected){const fields=Object.entries(value).filter(([k])=>k!=='card').map(([k,v])=>k==='mechanics'?`mechanics=${lit(JSON.stringify(v))}::jsonb`:`${k}=${lit(v)}`).join(' AND ');const record=JSON.parse(await query('fresh_chain',`SELECT jsonb_build_object('rows',count(*),'id',min(id::text),'fieldsExact',coalesce(bool_and(${fields}),false),'unlocked',coalesce(bool_and(support IS NULL AND deleted_at IS NULL),false),'rowHash',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY id),''),'UTF8')),'hex')) FROM actions t WHERE card_number=${lit(value.card)};`));if(record.rows!==1||!uuid.test(record.id)||!record.fieldsExact||!record.unlocked||!digest.test(record.rowHash))throw Error('Migration-owned source row differs');entries.push({card:value.card,...record});}
 if(new Set(entries.map(e=>e.id)).size!==3)throw Error('Migration-owned identity collision');
 return {schemaVersion:1,kind:'authored-bootstrap-identity-observed-at082',boundary:'082_character_system_metadata',descriptorHash:source.descriptorHash,sourceFiles:source.sourceFiles,entries};
}
export function bindMigrationOwnedStage(plan,bridge){
 if(!plan.boundary.startsWith('101_'))return plan;
 const source=bridgeSource();if(!bridge||bridge.schemaVersion!==1||bridge.kind!=='authored-bootstrap-identity-observed-at082'||bridge.boundary!=='082_character_system_metadata'||bridge.descriptorHash!==source.descriptorHash||JSON.stringify(bridge.sourceFiles)!==JSON.stringify(source.sourceFiles)||!Array.isArray(bridge.entries)||bridge.entries.length!==3)throw Error('Observed generated identity bridge absent');
 const changes=plan.changes.map(row=>{if(row.table!=='actions'||!cards.includes(row.card))return row;const matches=bridge.entries.filter(x=>x.card===row.card),before=source.expected.find(x=>x.card===row.card);if(matches.length!==1)throw Error('Bridge membership differs');const entry=matches[0];if(entry.rows!==1||!uuid.test(entry.id)||!digest.test(entry.rowHash)||!entry.fieldsExact||!entry.unlocked)throw Error('Bridge observation invalid');return {...row,sourcePublicId:row.id,id:entry.id,before:before.mechanics,beforeName:before.name,requiredFullRowHash:entry.rowHash,identityMode:'authenticated-authored-bootstrap-identity',sourcePublicBeforeHash:row.beforeHash,beforeHash:'migration-literal-bound',changeRequired:true};});
 if(changes.filter(x=>x.requiredFullRowHash).length!==3||new Set(changes.map(x=>x.table+':'+x.id)).size!==changes.length)throw Error('Bound source domain collision');
 return {...plan,changes,identityBridge:bridge};
}
