import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {assertExecutableMigrationRegistry,characterRetirementMigrationId,retiredObservedMigrationIds} from './migration-transition.mjs';
const hash='sha256:'+createHash('sha256').update(await readFile(new URL('../../backend/migrations/data/retire-legacy-characters-302.sql',import.meta.url))).digest('hex');
function fixture(){
 const ordinary=[{id:'001',checksum:'sha256:'+'a'.repeat(64)}],retirement={id:characterRetirementMigrationId,checksum:hash};
 const observed=retiredObservedMigrationIds.map(id=>({id,kind:'observed-id-only',observationHash:'sha256:'+'b'.repeat(64)}));
 return {metadata:{schemaVersion:1,versions:ordinary.map(row=>row.id),retiredObservedMigrationIds:[...retiredObservedMigrationIds],supportedRetirementMigrations:[retirement]},baseline:[...ordinary,...observed,retirement],target:[...ordinary,...observed,retirement]};
}
test('an already installed retirement requires the exact canonical SQL checksum and separate baked support',()=>{
 const f=fixture();assert.equal(assertExecutableMigrationRegistry(f.metadata,f.target,f.baseline),true);
});
for(const [name,mutate]of Object.entries({
 'cannot introduce a new retirement through an ordinary migration registry':f=>{f.baseline=f.baseline.filter(row=>row.id!==characterRetirementMigrationId);},
 'missing support is refused':f=>{delete f.metadata.supportedRetirementMigrations;},
 'changed baked SQL support is refused':f=>{f.metadata.supportedRetirementMigrations=[{id:characterRetirementMigrationId,checksum:'sha256:'+'c'.repeat(64)}];},
 'changed installed checksum is refused':f=>{f.baseline=f.baseline.map(row=>row.id===characterRetirementMigrationId?{...row,checksum:'sha256:'+'c'.repeat(64)}:row);},
 'extra retirement support cannot authorize another operation':f=>{f.metadata.supportedRetirementMigrations=[...f.metadata.supportedRetirementMigrations,{id:'999_delete_data',checksum:hash}];},
 'retirement cannot become an ID-only historical observation':f=>{f.target=f.target.map(row=>row.id===characterRetirementMigrationId?{id:row.id,kind:'observed-id-only',observationHash:'sha256:'+'b'.repeat(64)}:row);},
 'retirement must not become a startup executable':f=>{f.metadata.versions.push(characterRetirementMigrationId);},
 'duplicate retirement identities are refused':f=>{f.target.push({...f.target.at(-1)});},
 'unknown ledger identity is refused':f=>{f.target.push({id:'999_unknown',checksum:hash});f.baseline.push({id:'999_unknown',checksum:hash});},
 'old local-only retirement identity cannot authorize the new operation':f=>{f.target=f.target.map(row=>row.id===characterRetirementMigrationId?{...row,id:'301_retire_legacy_characters'}:row);f.baseline=structuredClone(f.target);f.metadata.supportedRetirementMigrations=[f.target.at(-1)];},
}))test(name,()=>{const f=fixture();mutate(f);assert.throws(()=>assertExecutableMigrationRegistry(f.metadata,f.target,f.baseline));});
test('existing observed history remains supported when no retirement is installed',()=>{
 const f=fixture();f.target=f.target.filter(row=>row.id!==characterRetirementMigrationId);f.baseline=f.baseline.filter(row=>row.id!==characterRetirementMigrationId);
 delete f.metadata.supportedRetirementMigrations;assert.equal(assertExecutableMigrationRegistry(f.metadata,f.target,f.baseline),true);
});
