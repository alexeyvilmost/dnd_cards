// @vitest-environment jsdom
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {it,expect} from 'vitest';
import {usePassivePreferences, setPassivePreference, PASSIVE_PREFERENCES_KEY} from './passivePreferences';
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
it('synchronizes sheet, combat and storage events, rejecting invalid stored values',async()=>{
  localStorage.setItem(PASSIVE_PREFERENCES_KEY, JSON.stringify({wrong:'yes',off:false}));
  const node=document.createElement('div'),root=createRoot(node);
  function Consumer(){const [value]=usePassivePreferences();return <span>{JSON.stringify(value)}</span>;}
  try{
    await act(async()=>root.render(<><Consumer/><Consumer/></>));
    expect(node.textContent).not.toContain('wrong');
    await act(async()=>setPassivePreference('new-policy',true));
    expect([...node.querySelectorAll('span')].every(row=>row.textContent?.includes('"new-policy":true'))).toBe(true);
    await act(async()=>{localStorage.setItem(PASSIVE_PREFERENCES_KEY,'{"new-policy":false}');window.dispatchEvent(new StorageEvent('storage',{key:PASSIVE_PREFERENCES_KEY}));});
    expect([...node.querySelectorAll('span')].every(row=>row.textContent==='{"new-policy":false}')).toBe(true);
  }finally{await act(async()=>root.unmount());localStorage.removeItem(PASSIVE_PREFERENCES_KEY);}
});
