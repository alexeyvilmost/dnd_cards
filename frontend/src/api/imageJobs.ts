import type { AxiosInstance } from 'axios';
import { AUTH_USER_STORAGE_KEY, readPersistedAuthToken } from './authSession';
import { imageAPIError, ImageAPIError, IMAGE_GENERATION_TIMEOUT_MS } from './imageErrors';
import {readLegacyImageAttempt,beginLegacyImageAttempt,finishLegacyImageAttempt,markLegacyImageAttemptUnknown} from './legacyImageAttempts';

export interface ImageJob {
  id:string;state:'queued'|'running'|'succeeded'|'failed'|'unknown';label:string;created_at:string;
  result?:Record<string,unknown>;problem?:Record<string,unknown>;
}
const pending=new Map<string,string>();
function owner():string {
  try { const user=JSON.parse(localStorage.getItem(AUTH_USER_STORAGE_KEY)??'null');return typeof user?.id==='string'?user.id:'anonymous'; }
  catch { return 'anonymous'; }
}
function canonical(value:unknown):unknown {
  return Array.isArray(value)?value.map(canonical):value&&typeof value==='object'
    ?Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)])):value;
}
async function requestKey(route:string,payload:unknown):Promise<string>{
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([owner(),route,canonical(payload)])));
  return `image-job:${Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('')}`;
}
function readSavedID(key:string):string|undefined {
  let id=pending.get(key);try{id??=localStorage.getItem(key)??undefined;}catch{/* Memory retains identity while storage is unavailable. */}
  return id&&/^[a-f0-9-]{36}$/i.test(id)?id:undefined;
}
function savedID(key:string):string {
  const id=readSavedID(key)??crypto.randomUUID();
  try{localStorage.setItem(key,id);if(localStorage.getItem(key)!==id)throw Error('Not durable');}
  catch{throw new ImageAPIError('Браузер не может сохранить номер задания. Разрешите локальное хранение перед генерацией.','image_job_storage_unavailable','application',undefined,undefined,'not_started');}
  pending.set(key,id);return id;
}
function clearID(key:string){pending.delete(key);try{localStorage.removeItem(key);}catch{/* Storage may be unavailable. */}}
/** A deliberate UI action permits another attempt; the old server job and
 * its uncertainty remain in history. This function never sends a request. */
export function allowNewImageAttempt(jobID:string){
  for(const [key,id] of pending)if(id===jobID)clearID(key);
  try{for(const key of Object.keys(localStorage))if(key.startsWith('image-job:')&&localStorage.getItem(key)===jobID)localStorage.removeItem(key);}catch{/* Storage may be unavailable. */}
}
function notify(){if(typeof window!=='undefined')window.dispatchEvent(new Event('image-jobs-changed'));}
function delay(signal?:AbortSignal){return new Promise<void>((resolve,reject)=>{
  const abort=()=>{clearTimeout(timer);reject(new ImageAPIError('Ожидание остановлено. Задание можно проверить в истории генерации.','image_cancelled','network',undefined,undefined,'unknown'));};
  const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},1000);
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
});}

/** One POST per invocation, with a durable request identity. Only job status
 * GETs repeat. An unknown outcome keeps the identity across reloads. */
export async function generateImageRequest<T>(client:AxiosInstance,route:string,payload:unknown,options:{signal?:AbortSignal}={}):Promise<T>{
  if(options.signal?.aborted)throw imageAPIError(undefined,undefined,undefined,'ERR_CANCELED');
  const token=readPersistedAuthToken(),identity=owner(),key=await requestKey(route,payload);
  const assertIdentity=()=>{if(readPersistedAuthToken()!==token||owner()!==identity)throw new ImageAPIError('Сессия изменилась. Откройте историю генерации в нужном аккаунте.','image_job_session_changed','application');};
  assertIdentity();
  const legacy=readLegacyImageAttempt(key);
  if(legacy)throw new ImageAPIError('Исход предыдущего обычного запроса неизвестен. Проверьте изображение и разрешите новый запрос в истории генерации.','image_legacy_outcome_unknown','application',legacy.id,undefined,'unknown');
  const existingID=readSavedID(key);
  if(!existingID){
    const capability=await client.get<{enabled:boolean;protocol_version:number}>('/api/images/jobs/capabilities',{timeout:15_000,signal:options.signal}).then(response=>response.data).catch(error=>{
      // Both application clients normalize transport errors; images use
      // ImageAPIError while the general card client uses ApiRequestError.
      const failure=error as {status?:number;response?:{status?:number}};
      const status=failure?.status??failure?.response?.status;
      if(status===404)return {enabled:false,protocol_version:1};
      throw error;
    });
    assertIdentity();
    if(!capability||capability.protocol_version!==1||typeof capability.enabled!=='boolean')throw new ImageAPIError('Не удалось проверить режим генерации.','image_job_invalid','application');
    if(!capability.enabled){
      // Old synchronous mode is still supported, but an uncertain paid call
      // cannot silently become a new durable job after a later feature rollout.
      beginLegacyImageAttempt(key);
      try{
        const response=await client.post<T>(route,payload,{timeout:IMAGE_GENERATION_TIMEOUT_MS,signal:options.signal});
        assertIdentity();finishLegacyImageAttempt(key);return response.data;
      }catch(error){
        const outcome=error instanceof ImageAPIError?error.outcome:(error as {response?:{data?:{outcome?:string}}})?.response?.data?.outcome;
        if(outcome==='not_started'||outcome==='rejected'){assertIdentity();finishLegacyImageAttempt(key);}
        throw error;
      }finally{markLegacyImageAttemptUnknown(key);notify();}
    }
  }
  const id=existingID??savedID(key);
  const jobRoute:Record<string,string>={'/api/images/generate':'/api/images/jobs/generate','/api/images/generate-standalone':'/api/images/jobs/generate-standalone','/api/cards/generate-image':'/api/images/jobs/generate-card'};
  if(!jobRoute[route])throw new ImageAPIError('Неизвестный маршрут генерации.','image_job_invalid','application');
  const response=await client.post<{job:ImageJob}>(jobRoute[route],payload,{timeout:IMAGE_GENERATION_TIMEOUT_MS,signal:options.signal,headers:{'Idempotency-Key':id}}).catch(error=>{notify();throw error;});
  assertIdentity();
  if(response.status!==202)throw new ImageAPIError('Сервер не подтвердил фоновое задание. Проверьте историю генерации.','image_job_invalid','persistence',id,undefined,'unknown');
  let job=(response.data as {job:ImageJob}).job;
  notify();const deadline=Date.now()+10*60_000;
  while(true){
    assertIdentity();
    if(!job||job.id!==id||!['queued','running','succeeded','failed','unknown'].includes(job.state))throw new ImageAPIError('Не удалось подтвердить статус задания. Проверьте историю генерации.','image_job_invalid','persistence',id,undefined,'unknown');
    if(job.state==='succeeded'){
      if(!job.result||typeof job.result.image_url!=='string')throw new ImageAPIError('Результат задания неполон.','image_job_invalid','persistence',id,undefined,'unknown');
      clearID(key);notify();return job.result as T;
    }
    if(job.state==='failed'||job.state==='unknown'){
      // Keep both terminal failures attached to the original request. A new
      // paid attempt requires a deliberate new request in the job history.
      notify();throw imageAPIError(502,job.problem,job.id);
    }
    if(Date.now()>deadline)throw new ImageAPIError('Задание продолжается. Статус доступен в истории генерации.','image_job_pending','application',id,undefined,'unknown');
    await delay(options.signal);assertIdentity();
    job=(await client.get<{job:ImageJob}>(`/api/images/jobs/${id}`,{timeout:15_000,signal:options.signal})).data.job;
  }
}
