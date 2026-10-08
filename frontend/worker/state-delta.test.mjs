import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compactState,expandState} from './state-delta.mjs';
const hash='sha256:'+'a'.repeat(64);
for(const size of [1,2,6])test('complete state and private references for '+size+' entities',()=>{
 const before={actors:Object.fromEntries(Array.from({length:size},(_,i)=>['entity-'+i,{hp:10,resources:{different:i},effects:[],turn:1,presentation:'🐉 & <entity>'+i}])),catalog:{a:1,b:2,c:3,d:4},log:Array.from({length:30},(_,i)=>({step:i,roll:i/31})),removed:true,nil:null};
 const next=structuredClone(before);delete next.removed;next.actors['entity-0'].hp=0;next.actors['entity-0'].resources={different:0};next.log=[...next.log.slice(3),{step:30,roll:0.7}];next.empty=[];
 const captured=JSON.stringify(before),frame=compactState(next,before,hash),actual=expandState(frame.state,before,frame.metadata,hash);
 assert.deepEqual(actual,next);assert(frame.metadata.references.length);assert(frame.metadata.arrayPrefixes.length);actual.catalog.a=900;actual.log[0].step=900;assert.equal(JSON.stringify(before),captured);
 assert.throws(()=>expandState(frame.state,before,frame.metadata,'sha256:'+'b'.repeat(64)),/Invalid exact/);
});
test('state transport rejects missing, overlapping, unsafe and excessive references',()=>{
 const before={catalog:{a:1,b:2,c:3,d:4},log:Array.from({length:10},(_,i)=>i)},frame=compactState({...before,log:[...before.log,11]},before,hash);
 const mutations=[m=>m.references.push(['catalog']),m=>m.references.push(['__proto__']),m=>m.references.push(['missing']),m=>m.references.push(['log']),m=>m.arrayPrefixes[0].length=999,m=>m.arrayPrefixes[0].offset=-1,m=>m.references.push(Array(9).fill('catalog')),m=>m.unknown=true];
 for(const mutate of mutations){const metadata=structuredClone(frame.metadata);mutate(metadata);assert.throws(()=>expandState(frame.state,before,metadata,hash));}
 assert.throws(()=>expandState({...frame.state,catalog:{}},before,frame.metadata,hash));
});
