import assert from 'node:assert/strict';
const copy=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));

/** Replays only captured canonical functions and their exact input tapes; no rules here. */
export function replayDurableCase(engine,row) {
  assert.equal(typeof engine[row.name],'function','Captured continuation export is missing');
  const run=()=>{
    let cursor=0;
    const decode=value=>{
      if(value&&typeof value==='object'){
        if(value.__captureUndefined===true)return undefined;
        if(typeof value.__captureFunction==='string'){
          const read=key=>(...input)=>{const call=row.calls[cursor++];assert.ok(call,'Unrecorded continuation callback/RNG draw');assert.equal(key,call.key);assert.deepEqual(input,call.input);return copy(call.result);};
          const fn=read(value.__captureFunction);if(value.dieAware)fn.rollDie=read(`${value.__captureFunction}.rollDie`);return fn;
        }
        return Array.isArray(value)?value.map(decode):Object.fromEntries(Object.entries(value).map(([key,entry])=>[key,decode(entry)]));
      }
      return value;
    };
    const args=decode(copy(row.args)),state=args[0].world?args[0]:args[0].state,before=copy(state);
    const random=Math.random;let result;
    try{Math.random=()=>{throw Error('Continuation used uncaptured ambient randomness');};result=engine[row.name](...args);}
    finally{Math.random=random;}
    assert.equal(cursor,row.calls.length,'Continuation tape consumption changed');
    assert.deepEqual(copy(state),before,'Continuation changed persisted input');
    assert.deepEqual(copy(result),row.result,'Saved board continuation, resources, history or roll changed');
    return copy(result);
  };
  const first=run(),reloaded=run();assert.deepEqual(reloaded,first,'JSON reload changed continuation');return first;
}
