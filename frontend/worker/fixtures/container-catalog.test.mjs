import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {withContainerCatalog} from './container-catalog.mjs';

test('current fixture closure preserves historical rows and adds only declared public contents',async()=>{
  const original=JSON.parse(await readFile(new URL('../../src/roguelike/pinnedFighter.fixture.json',import.meta.url),'utf8'));
  const before=JSON.stringify(original),available=JSON.parse(await readFile(new URL('../../../officials/canon/prod-snapshot/cards.json',import.meta.url),'utf8'));
  const current=withContainerCatalog(original,available),rows=current.catalog.entities.card;
  assert.equal(JSON.stringify(original),before);assert.deepEqual(rows.slice(0,original.catalog.entities.card.length),original.catalog.entities.card);
  assert.equal(new Set(rows.map(row=>row.id)).size,rows.length);assert.equal(rows.length,26);
  for(const card of rows.filter(row=>['all','choice'].includes(row.container_mode)))for(const child of card.contents??[])assert.ok(rows.some(row=>row.id===child.card_id));
  assert.deepEqual(current.character,original.character);
});
test('fixture closure terminates cycles and refuses a missing source declaration',()=>{
  const row=(id,child)=>({id,container_mode:'all',contents:[{card_id:child}]}),input={catalog:{entities:{card:[row('a','b')]}}};
  const result=withContainerCatalog(input,[row('b','a')]);assert.equal(result.catalog.entities.card.length,2);
  assert.throws(()=>withContainerCatalog(input,[]),/Missing fixture container declaration/);
});
