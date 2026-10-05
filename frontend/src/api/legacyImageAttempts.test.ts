// @vitest-environment jsdom
import {webcrypto} from 'node:crypto';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {beginLegacyImageAttempt,finishLegacyImageAttempt,listLegacyImageAttempts,markLegacyImageAttemptUnknown,readLegacyImageAttempt} from './legacyImageAttempts';

const key=`image-job:${'a'.repeat(64)}`;
function owner(id:string){localStorage.setItem('user',JSON.stringify({id}));}
beforeEach(()=>{localStorage.clear();markLegacyImageAttemptUnknown(key);owner('owner-A');vi.stubGlobal('crypto',webcrypto);});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});

it('persists only the opaque receipt before allowing a request and restores it after module reload',async()=>{
  const id=beginLegacyImageAttempt(key);
  const row=listLegacyImageAttempts()[0];
  expect(row).toEqual({id,key,owner:'owner-A',created_at:expect.any(String),active:true});
  const saved=JSON.parse(localStorage.getItem(Object.keys(localStorage).find(name=>name.startsWith('image-legacy-attempt:'))!)!);
  expect(Object.keys(saved).sort()).toEqual(['created_at','id','key','owner']);
  vi.resetModules();
  const reloaded=await import('./legacyImageAttempts');
  expect(reloaded.readLegacyImageAttempt(key)).toEqual({id});
  expect(()=>reloaded.beginLegacyImageAttempt(key)).toThrow(expect.objectContaining({outcome:'unknown'}));
  expect(reloaded.listLegacyImageAttempts()).toEqual([{...row,active:false}]);
});

it('isolates two owners and explicit acknowledgement permits a fresh identity only for the current owner',()=>{
  const first=beginLegacyImageAttempt(key);owner('owner-B');
  expect(readLegacyImageAttempt(key)).toBeNull();expect(listLegacyImageAttempts()).toEqual([]);
  const second=beginLegacyImageAttempt(key);expect(second).not.toBe(first);
  finishLegacyImageAttempt(key);expect(readLegacyImageAttempt(key)).toBeNull();
  owner('owner-A');expect(readLegacyImageAttempt(key)).toEqual({id:first});
  finishLegacyImageAttempt(key);expect(beginLegacyImageAttempt(key)).not.toBe(first);
});

it('fails before a request when storage cannot persist or read back the receipt',()=>{
  const write=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw Error('quota');});
  expect(()=>beginLegacyImageAttempt(key)).toThrow(expect.objectContaining({code:'image_job_storage_unavailable',outcome:'not_started'}));
  write.mockRestore();
  const ignored=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{});
  expect(()=>beginLegacyImageAttempt(key)).toThrow(expect.objectContaining({code:'image_job_storage_unavailable'}));
  ignored.mockRestore();expect(readLegacyImageAttempt(key)).toBeNull();
});

it('does not erase an uncertain receipt when acknowledgement cannot be saved',()=>{
  const id=beginLegacyImageAttempt(key);
  const remove=vi.spyOn(Storage.prototype,'removeItem').mockImplementation(()=>{});
  expect(()=>finishLegacyImageAttempt(key)).toThrow(expect.objectContaining({code:'image_job_storage_unavailable'}));
  remove.mockRestore();expect(readLegacyImageAttempt(key)).toEqual({id});
});

it('rejects malformed receipt or a nonopaque key without deleting previous evidence',()=>{
  beginLegacyImageAttempt(key);
  const storageKey=Object.keys(localStorage).find(name=>name.startsWith('image-legacy-attempt:'))!;
  localStorage.setItem(storageKey,'broken');
  expect(()=>readLegacyImageAttempt(key)).toThrow(expect.objectContaining({code:'image_job_storage_unavailable'}));
  expect(()=>listLegacyImageAttempts()).toThrow();expect(localStorage.getItem(storageKey)).toBe('broken');
  expect(()=>beginLegacyImageAttempt('private prompt')).toThrow();expect(JSON.stringify(localStorage)).not.toContain('private prompt');
});

it('fails closed when owner or local storage access is unavailable',()=>{
  localStorage.removeItem('user');expect(()=>beginLegacyImageAttempt(key)).toThrow();
  owner('owner-A');vi.spyOn(Storage.prototype,'getItem').mockImplementation(()=>{throw Error('unavailable');});
  expect(()=>readLegacyImageAttempt(key)).toThrow();expect(()=>listLegacyImageAttempts()).toThrow();
});

it('ending an interrupted wait never requires readable storage and retains its receipt',()=>{
  const id=beginLegacyImageAttempt(key);
  const read=vi.spyOn(Storage.prototype,'getItem').mockImplementation(()=>{throw Error('unavailable');});
  expect(()=>markLegacyImageAttemptUnknown(key)).not.toThrow();read.mockRestore();
  expect(readLegacyImageAttempt(key)).toEqual({id});expect(listLegacyImageAttempts()[0].active).toBe(false);
});
