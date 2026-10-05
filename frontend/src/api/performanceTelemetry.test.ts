// @vitest-environment jsdom
import {afterEach,describe,expect,it} from 'vitest';
import {emitClientPerformance,measureClientPhase,numericServerPerformance} from './performanceTelemetry';
afterEach(()=>{delete window.__DND_PERFORMANCE__;});
describe('local numeric performance observations',()=>{
  it('rejects bodies, unknown values, malformed or oversized headers',()=>{
    expect(numericServerPerformance('{"worker_execute_ms":2,"token":"secret","negative":-1,"nested":{"seed":"secret"}}')).toEqual({worker_execute_ms:2});
    expect(numericServerPerformance('x'.repeat(8193))).toEqual({});
    expect(numericServerPerformance('[]')).toEqual({});
  });
  it('is disabled by default and does not change the result',async()=>{
    const seen:unknown[]=[];const listener=(event:Event)=>seen.push((event as CustomEvent).detail);
    window.addEventListener('dnd:performance',listener);
    try {expect(await measureClientPhase('prepare',async()=>42)).toBe(42);expect(seen).toEqual([]);
      window.__DND_PERFORMANCE__=true;expect(await measureClientPhase('prepare',async()=>43)).toBe(43);
      expect(seen).toHaveLength(1);expect(seen[0]).toMatchObject({phase:'prepare',values:{duration_ms:expect.any(Number)}});
    }finally{window.removeEventListener('dnd:performance',listener);}
  });
  it('retains errors as errors and excludes their private details',async()=>{
    window.__DND_PERFORMANCE__=true;
    const seen:unknown[]=[];const listener=(event:Event)=>seen.push((event as CustomEvent).detail);
    window.addEventListener('dnd:performance',listener);
    try {await expect(measureClientPhase('prepare',async()=>{throw Error('private snapshot');})).rejects.toThrow('private snapshot');
      emitClientPerformance('safe',{duration_ms:1,invalid:NaN});expect(JSON.stringify(seen)).not.toContain('private');
      expect(seen[1]).toEqual({phase:'safe',values:{duration_ms:1}});
    }finally{window.removeEventListener('dnd:performance',listener);}
  });
});
