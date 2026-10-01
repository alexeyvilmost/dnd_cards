import {test} from 'node:test';
import assert from 'node:assert/strict';
import {reviewSpellGrantAbilities} from './repair-spell-grant-abilities-20261001.mjs';
import {sha256Canonical} from './certification-hash.mjs';
const source=(id)=>({id,card_number:'SOURCE-'+id,name:id,description:'Granted class spells',detailed_description:null,
 mechanics:{effects:[{resolution:'auto',result:[{kind:'grant_spell',value:'SPELL-'+id,label:'always_prepared',freeuse:{resource_id:'old-pool-'+id,count:1}}]}]}});
const caster=(id,ability)=>({id,card_number:'CASTER-'+id,name:id,description:'Caster metadata',mechanics:{effects:[{resolution:'auto',result:[{kind:'spellcasting_ability',role:'primary',ability}]}]}});
test('different parent declarations add exact grant abilities without changing pools or identities',()=>{
 const one=source('one'),two=source('two'),a=caster('a','cha'),b=caster('b','wis');
 const classes=[{id:'parent-a',card_number:'CLASS-a',level_progression:{1:{effects:['a']}}},{id:'parent-b',card_number:'CLASS-b',level_progression:{1:{effects:['b']}}},
 {id:'child-a',card_number:'SUB-a',parent_class_id:'parent-a',level_progression:{3:{effects:['one']}}},
 {id:'child-b',card_number:'SUB-b',parent_class_id:'parent-b',level_progression:{3:{effects:['two']}}}];
 const input={sources:[one,two],effects:[one,two,a,b],classes},original=structuredClone(input);
 const result=reviewSpellGrantAbilities(input);
 assert.deepEqual(result.reviews.map(row=>row.ability),['cha','wis']);
 for(const row of result.reviews){assert.equal(row.mechanics.effects[0].result[0].freeuse.resource_id,'old-pool-'+row.id);assert.equal(row.changes.length,1);}
 assert.deepEqual(input,original);
 assert.equal(result.evidence.length,6);
});
test('direct reviewed ability requires exact source text and also covers dynamic spell choice templates',()=>{
 const one=source('one');one.mechanics.effects.push({kind:'choice',id:'unchanged',grant:{kind:'grant_spell',label:'known'}});
 const owner={id:'noncaster',card_number:'CLASS-noncaster',level_progression:{3:{effects:['one']}}};
 const review={id:one.id,ability:'int',description_hash:sha256Canonical({description:one.description,detailed_description:null})};
 const result=reviewSpellGrantAbilities({sources:[one],effects:[one],classes:[owner],directReviews:[review]});
 assert.equal(result.reviews[0].mechanics.effects[1].grant.ability,'int');
 assert.equal(result.reviews[0].mechanics.effects[1].id,'unchanged');
 assert.throws(()=>reviewSpellGrantAbilities({sources:[one],effects:[{...one,detailed_description:'Changed source'}],classes:[owner],directReviews:[review]}),/no reviewed casting ability/);
});
test('ambiguous or invalid caster declarations fail closed and existing conflicting grant metadata is retained',()=>{
 const one=source('one'),a=caster('a','cha'),b=caster('b','wis');
 const owner={id:'owner',card_number:'CLASS-owner',level_progression:{1:{effects:['one','a','b']}}};
 assert.throws(()=>reviewSpellGrantAbilities({sources:[one],effects:[one,a,b],classes:[owner]}),/no reviewed casting ability/);
 one.mechanics.effects[0].result[0].ability='int';
 assert.throws(()=>reviewSpellGrantAbilities({sources:[one],effects:[one,a],classes:[owner]}),/Conflicting existing grant ability/);
});
