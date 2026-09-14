import {afterEach,describe,expect,it,vi} from 'vitest';
import {combatRollModeFor,getSettings} from './settings';

afterEach(()=>vi.unstubAllGlobals());
describe('per-side roll preferences',()=>{
  it('defaults to icons, interface previews and player mode while respecting saved preferences',()=>{
    vi.stubGlobal('localStorage',{getItem:()=>null});
    expect(getSettings()).toMatchObject({entityDisplay:{actions:'icon',spells:'icon',effects:'icon',items:'icon'},itemPreview:'interface',playerMode:true});
    vi.stubGlobal('localStorage',{getItem:()=>JSON.stringify({entityDisplay:{actions:'row'},itemPreview:'card',playerMode:false})});
    expect(getSettings()).toMatchObject({entityDisplay:{actions:'row',effects:'icon'},itemPreview:'card',playerMode:false});
  });
  it.each(['standard','fast','skip'] as const)('migrates the old global %s preference to both sides',mode=>{
    vi.stubGlobal('localStorage',{getItem:()=>JSON.stringify({combatRollMode:mode})});
    const settings=getSettings();
    expect(combatRollModeFor(settings,'own')).toBe(mode);
    expect(combatRollModeFor(settings,'enemy')).toBe(mode);
  });
  it('keeps independent preferences and defaults legacy beats to own',()=>{
    vi.stubGlobal('localStorage',{getItem:()=>JSON.stringify({combatRollMode:'standard',enemyCombatRollMode:'skip'})});
    expect(combatRollModeFor(getSettings(),'enemy')).toBe('skip');
    expect(combatRollModeFor(getSettings())).toBe('standard');
  });
  it('validates malformed modes',()=>{
    vi.stubGlobal('localStorage',{getItem:()=>JSON.stringify({combatRollMode:'invalid',enemyCombatRollMode:'invalid'})});
    expect(getSettings().enemyCombatRollMode).toBe('standard');
  });
});
