import assert from 'node:assert/strict';

const copy=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));

/** Replays recorded inputs through the real handler; contains no game rules. */
export function replayPendingCase(handleCommand,row) {
  const catalogCalls=new Map();
  for(const call of row.calls.filter(call=>call.name.startsWith('catalog.'))){
    const key=JSON.stringify([call.name,call.args]);
    if(catalogCalls.has(key))assert.deepEqual(call.value,catalogCalls.get(key),'Fixture catalog changed during one command');
    else catalogCalls.set(key,call.value);
  }
  const catalog=Object.fromEntries(row.catalogMethods.map(name=>[name,(...args)=>{
    const key=JSON.stringify([`catalog.${name}`,args]);
    assert.ok(catalogCalls.has(key),`Unrecorded catalog read: ${name}`);
    return copy(catalogCalls.get(key));
  }]));
  const run=()=>{
    const world=copy(row.world),command=copy(row.command);
    const random=row.calls.filter(call=>['env.rng','env.rollDie'].includes(call.name));
    const clocks=row.calls.filter(call=>call.name==='env.clock');
    const ids=row.calls.filter(call=>call.name==='env.nextId');
    let r=0,c=0,i=0;
    const draw=(name,args)=>{
      const call=random[r++];assert.ok(call,'Unrecorded RNG draw');
      assert.equal(call.name,name);assert.deepEqual(call.args,args);return call.value;
    };
    const rng=()=>draw('env.rng',[]);
    if(row.dieAware)rng.rollDie=sides=>draw('env.rollDie',[sides]);
    const env={rng,clock:()=>{assert.ok(clocks[c],'Unrecorded clock read');return clocks[c++].value;},
      nextId:()=>{assert.ok(ids[i],'Unrecorded generated ID');return ids[i++].value;}};
    const result=handleCommand(world,command,catalog,env);
    assert.deepEqual(copy(result),row.result,'Saved result, events, breakdown or pending continuation changed');
    assert.deepEqual(world,row.world,'Continuation mutated its saved input');
    assert.deepEqual(command,row.command,'Continuation mutated its command');
    assert.deepEqual([r,c,i],[random.length,clocks.length,ids.length],'Deterministic tape consumption changed');
    const committed=copy(result.nextState),beforeDuplicate=copy(committed);
    const noDraw=()=>{throw Error('Duplicate consumed RNG or generated another ID');};
    const duplicate=handleCommand(committed,copy(command),catalog,{rng:noDraw,nextId:noDraw,clock:()=>clocks.at(-1)?.value??0});
    assert.equal(duplicate.status,'rejected');assert.equal(duplicate.code,'DuplicateCommand');
    assert.deepEqual(committed,beforeDuplicate,'Duplicate changed resources, history or state');
    return copy(result);
  };
  const first=run(),second=run();
  assert.deepEqual(second,first,'Repeated saved input differs');
  return first;
}
