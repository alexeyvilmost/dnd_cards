import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {editorialFormatter} from './review-cantrips-20261014.mjs';
const manifest=JSON.parse(readFileSync(new URL('./data/cantrip-editorial-review-20261014.json',import.meta.url)));
const rows=manifest.entries.filter(e=>e.after);
const strip=text=>text.replace(/\[\[([^|]+)\|[^\]]+\]\]/g,'$1').replace(/\[\/?[a-z]+\]|:[a-z_]+:/g,'');
test('reviews every production cantrip and every variant without claiming an original for homebrew',()=>{
  assert.equal(manifest.entries.length,84);assert.equal(rows.length,83);
  assert.equal(rows.filter(e=>e.parent_id).length,49);
  assert.equal(manifest.entries.find(e=>e.card_number==='SPELL-0482').after,null);
  for(const row of rows){assert.ok(row.book_page);assert.ok(row.after.description);assert.ok(row.after.detailed_description);}
});
test('all reviewed links resolve to the retained catalog or the new МЗ concept',()=>{
  for(const row of rows)for(const field of ['description','detailed_description','upcast_description']) {
    for(const match of (row.after[field]??'').matchAll(/\[\[([^|]+)\|(\w+):([^\]]+)\]\]/g)) {
      assert.ok(manifest.reference_ids[match[2]]?.includes(match[3]),`${row.card_number}: unresolved ${match[2]}:${match[3]}`);
      assert.ok(match[2]!=='concept'||!manifest.condition_concept_remaps.some(r=>r.concept_id===match[3]),`condition concept duplicate ${match[3]}`);
    }
  }
});
test('typed damage markup is balanced and every colored mention contains its icon',()=>{
  for(const row of rows)for(const field of ['description','detailed_description','upcast_description']) {
    const text=row.after[field]??'';
    const blocks=[...text.matchAll(/\[([a-z]+)\]([\s\S]*?)\[\/\1\]/g)];
    for(const block of blocks)assert.ok(block[2].includes(`:${block[1]}:`),`${row.card_number}: no ${block[1]} icon`);
    assert.ok(!/\[\/?[a-z]+\]/.test(text.replace(/\[([a-z]+)\][\s\S]*?\[\/\1\]/g,'')),`${row.card_number}: unbalanced markup`);
  }
});
test('variants describe their selected option instead of repeating the parent choice',()=>{
  for(const row of rows.filter(e=>e.parent_id)) {
    const parent=rows.find(e=>e.id===row.parent_id);
    assert.notEqual(strip(row.after.description),strip(parent.after.description));
    assert.ok(!/Вариант:|выбираете навык|по вашему выбору:/.test(strip(row.after.description)));
    if(row.card_number.startsWith('SPELL-VAR-SPELL-0230-'))assert.ok(row.after.description.includes(row.name.split(' — ')[1]));
    if(row.card_number.startsWith('SPELL-VAR-SPELL-0295-')) {
      assert.match(row.after.description,/1к4/);assert.match(row.after.description,/один раз за ход/);
      const type=row.card_number.slice('SPELL-VAR-SPELL-0295-'.length);
      assert.ok(row.after.description.includes(`:${type}:`));
    }
    if(row.card_number.startsWith('SPELL-VAR-SPELL-0315-'))assert.match(row.after.description,/МЗ/);
  }
});
test('corrects semantic defects rather than just formatting the old prose',()=>{
  const get=ref=>rows.find(e=>e.card_number===ref).after;
  assert.ok(!get('SPELL-0260').upcast_description.includes('водные царства'));
  assert.ok(!get('SPELL-0295').description.includes('concept:resistance'));
  assert.match(get('prestidigitation').detailed_description,/вкус/);
  assert.match(get('light').detailed_description,/другое существо/);
  assert.match(get('mending').detailed_description,/ни в одном измерении/);
  assert.match(get('SPELL-0315').description,/можно/);
});
test('mechanical preimages use deterministic canonical hashes',()=>{
  const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
  for(const row of rows)assert.equal(createHash('sha256').update(JSON.stringify(stable(row.expected_mechanics))).digest('hex'),row.mechanics_sha256);
});
test('canonicalizes two condition references through catalog data',()=>{
  const format=editorialFormatter([], [{effect_type:'condition',card_number:'COND-charmed',id:'effect-one'},{effect_type:'condition',card_number:'COND-prone',id:'effect-two'}]);
  assert.equal(format('[[Очарованный|concept:charmed]] и [[Опрокинутый|concept:prone]]'),'[[Очарованный|effect:effect-one]] и [[Опрокинутый|effect:effect-two]]');
});
