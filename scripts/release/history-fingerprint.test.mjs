import {test} from 'node:test';
import assert from 'node:assert/strict';
import {oldColumns,historyQuery} from './history-fingerprint.mjs';
test('lifecycle expansion compares all original character and run columns before its nullable column existed',()=>{
 assert.deepEqual(oldColumns('characters_v3',[]),['deleted_at']);
 assert.deepEqual(oldColumns('roguelike_runs',[]),['combat_catalog_ref','deleted_at']);
 assert.deepEqual(oldColumns('roguelike_runs',['299_frozen_combat_catalogs','301_character_lifecycle']),[]);
 assert.deepEqual(oldColumns('characters_v3',['301_character_lifecycle']),[]);
 const sql=historyQuery([{name:'characters_v3',columns:['id','name','deleted_at']}],[],{project:true});
 assert.match(sql,/SELECT t\."id",t\."name"/);assert.doesNotMatch(sql,/SELECT[^;]*t\."deleted_at"/);
 const accepted=historyQuery([{name:'characters_v3',columns:['id','name','deleted_at']}],['301_character_lifecycle'],{project:true});
 assert.match(accepted,/t\."deleted_at"/);
});
