// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import type {AxiosInstance} from 'axios';
import {webcrypto} from 'node:crypto';

beforeEach(()=>{vi.resetModules();localStorage.clear();localStorage.setItem('auth_token','local-token');localStorage.setItem('user',JSON.stringify({id:'owner-A'}));vi.stubGlobal('crypto',webcrypto);});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
function fake(post:ReturnType<typeof vi.fn>,get=vi.fn(),enabled=true){return {post,get:(route:string,...args:unknown[])=>route==='/api/images/jobs/capabilities'?Promise.resolve({data:{protocol_version:1,enabled}}):get(route,...args)} as unknown as AxiosInstance;}

it('polls an admitted job without another paid POST',async()=>{
 const {generateImageRequest}=await import('./imageJobs');vi.useFakeTimers();let id='';
 const post=vi.fn(async(_route,_body,config)=>{id=config.headers['Idempotency-Key'];return {status:202,data:{job:{id,state:'queued'}}};});
 const get=vi.fn(async()=>({data:{job:{id,state:'succeeded',result:{image_url:'https://images.test/done.png'}}}}));
 const result=generateImageRequest(fake(post,get),'/api/images/generate-standalone',{prompt:'private description'});
 await vi.waitFor(()=>expect(post).toHaveBeenCalledOnce());await vi.advanceTimersByTimeAsync(1000);
 await expect(result).resolves.toEqual({image_url:'https://images.test/done.png'});expect(get).toHaveBeenCalledOnce();expect(post).toHaveBeenCalledOnce();
 expect(Object.keys(localStorage).filter(key=>key.startsWith('image-job:'))).toEqual([]);
});

it('keeps request identity after lost admission and module reload without storing the prompt',async()=>{
 let first='';const post=vi.fn(async(_route,_body,config)=>{first=config.headers['Idempotency-Key'];throw Error('lost response');});
 const api=await import('./imageJobs');await expect(api.generateImageRequest(fake(post),'/api/images/generate-standalone',{prompt:'SECRET description',quality:'low'})).rejects.toThrow('lost response');
 expect(JSON.stringify(localStorage)).not.toContain('SECRET');vi.resetModules();const reloaded=await import('./imageJobs');
 const retry=vi.fn(async(_route,_body,config)=>{expect(config.headers['Idempotency-Key']).toBe(first);return {status:202,data:{job:{id:first,state:'succeeded',result:{image_url:'saved'}}}};});
 await expect(reloaded.generateImageRequest(fake(retry),'/api/images/generate-standalone',{quality:'low',prompt:'SECRET description'})).resolves.toEqual({image_url:'saved'});
 expect(post).toHaveBeenCalledOnce();expect(retry).toHaveBeenCalledOnce();
});

it('unknown outcomes require deliberate permission for a new identity',async()=>{
 const {generateImageRequest,allowNewImageAttempt}=await import('./imageJobs');const ids:string[]=[];
 const post=vi.fn(async(_route,_body,config)=>{const id=config.headers['Idempotency-Key'];ids.push(id);return {status:202,data:{job:{id,state:'unknown',problem:{code:'image_job_interrupted',outcome:'unknown'}}}};});
 for(let i=0;i<2;i++)await expect(generateImageRequest(fake(post),'/api/images/generate-standalone',{prompt:'same'})).rejects.toMatchObject({outcome:'unknown'});
 expect(ids[0]).toBe(ids[1]);allowNewImageAttempt(ids[0]);expect(post).toHaveBeenCalledTimes(2);
 await expect(generateImageRequest(fake(post),'/api/images/generate-standalone',{prompt:'same'})).rejects.toMatchObject({outcome:'unknown'});expect(ids[2]).not.toBe(ids[0]);
});

it('does not return another account result after session changes',async()=>{
 const {generateImageRequest}=await import('./imageJobs');
 const post=vi.fn(async()=>{localStorage.setItem('user',JSON.stringify({id:'owner-B'}));return {status:200,data:{image_url:'private'}};});
 await expect(generateImageRequest(fake(post),'/api/images/generate-standalone',{prompt:'local'})).rejects.toMatchObject({code:'image_job_session_changed'});
});

it('does not pay when request identity cannot survive a reload',async()=>{
 const {generateImageRequest}=await import('./imageJobs');const post=vi.fn();
 const blocked=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw Error('quota');});
 try {await expect(generateImageRequest(fake(post),'/api/images/generate-standalone',{prompt:'local'})).rejects.toMatchObject({code:'image_job_storage_unavailable',outcome:'not_started'});expect(post).not.toHaveBeenCalled();}
 finally {blocked.mockRestore();}
});

it('stopping the wait retains the durable job and sends no retry',async()=>{
 const {generateImageRequest}=await import('./imageJobs');const abort=new AbortController();
 const post=vi.fn(async(_route,_body,config)=>{abort.abort();return {status:202,data:{job:{id:config.headers['Idempotency-Key'],state:'running'}}};});const get=vi.fn();
 await expect(generateImageRequest(fake(post,get),'/api/images/generate-standalone',{prompt:'local'},{signal:abort.signal})).rejects.toMatchObject({code:'image_cancelled'});
 expect(post).toHaveBeenCalledOnce();expect(get).not.toHaveBeenCalled();expect(Object.keys(localStorage).some(key=>key.startsWith('image-job:'))).toBe(true);
});

it('an OFF admission response never falls back to a synchronous paid route',async()=>{
 const {generateImageRequest}=await import('./imageJobs');const ids:string[]=[],routes:string[]=[];
 const post=vi.fn(async(route,_body,config)=>{routes.push(route);ids.push(config.headers['Idempotency-Key']);throw {response:{status:503,data:{code:'image_jobs_disabled',outcome:'not_started'}}};});
 await expect(generateImageRequest(fake(post),'/api/images/generate-standalone',{prompt:'local'})).rejects.toMatchObject({response:{status:503}});
 // The second browser request observes OFF, but its existing UUID still goes
 // only to the job protocol (a pre-migration backend returns 404, never pays).
 await expect(generateImageRequest(fake(post,vi.fn(),false),'/api/images/generate-standalone',{prompt:'local'})).rejects.toMatchObject({response:{status:503}});
 expect(ids[0]).toBe(ids[1]);expect(routes).toEqual(['/api/images/jobs/generate-standalone','/api/images/jobs/generate-standalone']);
});

it('an uncertain legacy POST cannot become a new job after enabling the flag',async()=>{
 const {generateImageRequest}=await import('./imageJobs');const post=vi.fn(async()=>{throw Error('lost legacy response');});
 await expect(generateImageRequest(fake(post,vi.fn(),false),'/api/images/generate-standalone',{prompt:'local'})).rejects.toThrow('lost legacy response');
 await expect(generateImageRequest(fake(post),'/api/images/generate-standalone',{prompt:'local'})).rejects.toMatchObject({code:'image_legacy_outcome_unknown',outcome:'unknown'});
 expect(post).toHaveBeenCalledOnce();
});
